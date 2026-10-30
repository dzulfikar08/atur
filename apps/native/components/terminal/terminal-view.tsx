import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  FlatList,
  Pressable,
  ScrollView,
  View,
  type GestureResponderEvent,
  type NativeScrollEvent,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { StyleSheet } from "react-native-unistyles";

import { TERMINAL_PALETTE } from "@/components/terminal/palette";
import { TerminalRow } from "@/components/terminal/terminal-row";
import { Text } from "@/components/ui";
import { planPrompt, topRow, type ViewGeometry } from "@/lib/prompt-jump";
import { SCROLL_TRACE, scrollCount, scrollTrace } from "@/lib/scroll-trace";
import { CELL_WIDTH_EM, clampFontSize, LINE_HEIGHT_EM } from "@/lib/terminal-metrics";
import { previousPrompt, type TerminalScreen } from "@/lib/terminal-screen";

/** Within this many px of the bottom counts as "at the bottom". */
const STICK_SLACK = 48;
/** Vertical padding of the list content; getItemLayout offsets include it. */
const ROW_PAD = 4;
/** Closer than this many rows to the oldest loaded one, the reader gets older scrollback. */
const NEAR_TOP_ROWS = 80;
/**
 * Further than this many screens above the live grid, the rows that output pushes into scrollback
 * are not fetched (nobody sees them, and each one that arrives moves the list under the reader);
 * a top-up reads them when the reader comes back within reach.
 */
const FAR_SCREENS = 3;
/**
 * "Previous prompt" with none loaded above reads further back at most this many times: a pane
 * whose computer reports no prompts must not pull the whole scrollback for a button press.
 */
const PROMPT_OLDER_READS = 6;
/** A press that waits for a read of scrollback goes on with what is loaded after this long. */
const PROMPT_WAIT_MS = 3000;

type PromptDirection = "previous" | "next";

interface Row {
  key: string;
  line: string;
}

const keyOf = (item: Row) => item.key;

/** Proof build only: the touches that reach the view and the drags the list starts, as JS sees them. */
const TOUCH_TRACE = SCROLL_TRACE
  ? {
      onTouchStart: (event: GestureResponderEvent) =>
        scrollTrace("touch_start", { y: Math.round(event.nativeEvent.pageY) }),
      onTouchEnd: (event: GestureResponderEvent) =>
        scrollTrace("touch_end", { y: Math.round(event.nativeEvent.pageY) }),
      onTouchCancel: () => scrollTrace("touch_cancel"),
    }
  : {};
const DRAG_TRACE = SCROLL_TRACE
  ? {
      onScrollBeginDrag: () => scrollTrace("drag_begin"),
      onScrollEndDrag: () => scrollTrace("drag_end"),
    }
  : {};

interface TerminalViewProps {
  screen: TerminalScreen;
  fontSize: number;
  /** Live while pinching. */
  onFontSize: (size: number) => void;
  /** Once, when the pinch ends. */
  onFontSizeCommit: (size: number) => void;
  /** Tap on plain text (not a link): the owner usually opens the keyboard. */
  onTapText: () => void;
  /** The reader left the bottom: fetch scrollback to show above the live grid. */
  onScrollBack: () => void;
  /** The reader is near the oldest scrollback loaded: read further back. */
  onNearTop: () => void;
  /** Long-press on the text: the owner opens the text selector. */
  onSelectText: () => void;
}

/**
 * The pane's screen as native text: one memoised row per terminal line in
 * JetBrains Mono, scrolled horizontally when the grid is wider than the phone
 * and vertically when taller. Pinch scales the font; the view follows the
 * bottom of the screen until the reader scrolls up. Scrollback (loaded by the
 * owner on connect) sits above the live grid; each scroll away from the
 * bottom asks for a fresh copy, since output keeps scrolling into it, and
 * getting near the oldest loaded row asks for older rows. A button jumps back
 * to the bottom, and only there does the view follow new output.
 */
export function TerminalView({
  screen,
  fontSize,
  onFontSize,
  onFontSizeCommit,
  onTapText,
  onScrollBack,
  onNearTop,
  onSelectText,
}: TerminalViewProps) {
  const { cols, lines, history, historyBase, prompts, historyReplies } = useSyncExternalStore(
    screen.subscribe,
    screen.getState,
  );
  scrollCount("view_render");
  // Newest row first, for an inverted list: offset 0 is the bottom of the pane,
  // so rows changing, appearing or going at the bottom while an agent streams
  // need no scroll correction at all. Keys: a scrollback row keeps
  // historyBase + index (appends below it never shift it); a live row is keyed by its
  // distance from the bottom of the grid, so the grid growing or shrinking (the pane is laid
  // out at the phone's size after it opens) adds or removes cells above the bottom row and the
  // bottom row stays the same cell: keyed from the top, the cell that was the bottom row ends
  // up 20 rows above it, and the list keeps *that* one in place, which leaves the reader that
  // far from the bottom, with nothing following the output.
  // The scrollback items are built only when scrollback changes, and a live item is reused
  // while its row is unchanged: a frame (ten a second while an agent prints) then touches only
  // the rows that changed instead of every cell.
  const historyItems = useMemo(() => {
    const items: Row[] = [];
    for (let j = history.length - 1; j >= 0; j--) {
      items.push({ key: `h${historyBase + j}`, line: history[j]! });
    }
    return items;
  }, [history, historyBase]);
  const liveItems = useRef<Row[]>([]);
  const rows = useMemo(() => {
    const previous = liveItems.current;
    const live: Row[] = [];
    for (let fromBottom = 0; fromBottom < lines.length; fromBottom++) {
      const line = lines[lines.length - 1 - fromBottom]!;
      const kept = previous[fromBottom];
      live.push(kept?.line === line ? kept : { key: `l${fromBottom}`, line });
    }
    liveItems.current = live;
    return live.concat(historyItems);
  }, [historyItems, lines]);
  useEffect(() => scrollTrace("grid_rows", { n: lines.length }), [lines.length]);
  const stick = useRef(true);
  /** Scrolled away from the bottom: the jump button shows and nothing follows the output. */
  const [away, setAway] = useState(false);
  const list = useRef<FlatList<Row>>(null);
  const scroll = useRef({ offset: 0, content: 0, viewport: 0 });
  const far = useRef(false);
  const [viewportWidth, setViewportWidth] = useState(0);
  /** "Previous prompt" has something to do: a prompt above the first row in view, or older rows to read. */
  const [canPrevious, setCanPrevious] = useState(false);
  /** A prompt press waiting for scrollback (a fresh top-up, or older rows) to arrive. */
  const waiting = useRef<{
    direction: PromptDirection;
    replies: number;
    reads: number;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);

  const lineHeight = Math.round(fontSize * LINE_HEIGHT_EM);
  const cellWidth = fontSize * CELL_WIDTH_EM;
  // A little slack: fallback fonts and rounding can make a row a hair wider than cols cells.
  const contentWidth = Math.max(viewportWidth, Math.ceil(cols * cellWidth * 1.03) + 12);

  // The latest props for callbacks that must keep their identity: the list re-renders every cell
  // when `renderItem` changes, and the pinch gesture must not change mid-pinch.
  const latest = useRef({
    fontSize,
    onFontSize,
    onFontSizeCommit,
    onTapText,
    onScrollBack,
    onNearTop,
    onSelectText,
  });
  latest.current = {
    fontSize,
    onFontSize,
    onFontSizeCommit,
    onTapText,
    onScrollBack,
    onNearTop,
    onSelectText,
  };

  const onLongPress = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    latest.current.onSelectText();
  }, []);

  const onTap = useCallback((url: string | null) => {
    if (url) {
      void Haptics.selectionAsync().catch(() => {});
      void WebBrowser.openBrowserAsync(url);
    } else {
      latest.current.onTapText();
    }
  }, []);

  // Pinch → font size, relative to the size when the gesture began.
  const pinchBase = useRef(fontSize);
  const lastSize = useRef(fontSize);
  const pinch = useMemo(
    () =>
      Gesture.Pinch()
        .runOnJS(true)
        .onStart(() => {
          pinchBase.current = latest.current.fontSize;
          lastSize.current = latest.current.fontSize;
        })
        .onUpdate((event) => {
          const next = clampFontSize(pinchBase.current * event.scale);
          if (next !== lastSize.current) {
            lastSize.current = next;
            latest.current.onFontSize(next);
          }
        })
        .onEnd(() => latest.current.onFontSizeCommit(lastSize.current)),
    [],
  );

  const nearTop = useCallback(() => {
    const { offset, content, viewport } = scroll.current;
    if (content > 0 && content - offset - viewport < NEAR_TOP_ROWS * lineHeight) {
      scrollTrace("near_top", { offset: Math.round(offset) });
      latest.current.onNearTop();
    }
  }, [lineHeight]);

  const onScroll = ({ nativeEvent: e }: { nativeEvent: NativeScrollEvent }) => {
    scroll.current = {
      offset: e.contentOffset.y,
      content: e.contentSize.height,
      viewport: e.layoutMeasurement.height,
    };
    scrollCount("scroll_event");
    if (SCROLL_TRACE) traceScroll(e);
    // Inverted: offset 0 is the bottom.
    const atBottom = e.contentOffset.y <= STICK_SLACK;
    const isFar = e.contentOffset.y > FAR_SCREENS * e.layoutMeasurement.height;
    if (!atBottom && (stick.current || (far.current && !isFar))) {
      scrollTrace("scroll_back", { offset: Math.round(e.contentOffset.y) });
      latest.current.onScrollBack();
    }
    far.current = isFar;
    refreshPrevious();
    if (stick.current !== atBottom) {
      scrollTrace("stick", { atBottom, offset: Math.round(e.contentOffset.y) });
      stick.current = atBottom;
      setAway(!atBottom);
    }
    if (!atBottom) nearTop();
  };

  // Proof build only: the offset at most four times a second, and every jump of more than a screen
  // between two events (a gesture does not make one).
  const lastTrace = useRef({ at: 0, offset: 0 });
  const traceScroll = (e: NativeScrollEvent) => {
    const now = Date.now();
    const offset = Math.round(e.contentOffset.y);
    const jump = Math.abs(offset - lastTrace.current.offset);
    if (now - lastTrace.current.at < 250 && jump < e.layoutMeasurement.height) return;
    lastTrace.current = { at: now, offset };
    scrollTrace("offset", {
      offset,
      content: Math.round(e.contentSize.height),
      viewport: Math.round(e.layoutMeasurement.height),
      jump,
    });
  };

  // Rows arriving above the reader (older scrollback) can leave them near the top still.
  const onContentSizeChange = (_width: number, height: number) => {
    if (SCROLL_TRACE) {
      scrollTrace("content", {
        height: Math.round(height),
        was: Math.round(scroll.current.content),
      });
    }
    scroll.current.content = height;
    if (!stick.current) nearTop();
  };

  const jumpToBottom = useCallback(() => {
    scrollTrace("jump_to_bottom", { offset: Math.round(scroll.current.offset) });
    stick.current = true;
    far.current = false;
    setAway(false);
    list.current?.scrollToOffset({ offset: 0, animated: false });
  }, []);

  // Previous / next prompt: the prompt rows come with the scrollback (`ScreenState.prompts`); a press
  // puts the target row at the top edge of the view. Previous with none loaded above reads older
  // rows and goes on when they arrive; next with none below is the bottom of the pane.
  const viewGeometry = (): ViewGeometry => ({
    offset: scroll.current.offset,
    viewport: scroll.current.viewport,
    lineHeight,
    pad: ROW_PAD,
  });

  const refreshPrevious = () => {
    const state = screen.getState();
    setCanPrevious(
      previousPrompt(state, topRow(state, viewGeometry())) !== null || screen.hasOlder(),
    );
  };

  const stopWaiting = useCallback(() => {
    if (!waiting.current) return;
    clearTimeout(waiting.current.timer);
    waiting.current = null;
  }, []);

  const startWaiting = (direction: PromptDirection, reads: number) => {
    stopWaiting();
    waiting.current = {
      direction,
      replies: screen.getState().historyReplies,
      reads,
      // No reply in time (the link dropped): go on with what is loaded.
      timer: setTimeout(() => {
        waiting.current = null;
        promptRun.current(direction, PROMPT_OLDER_READS);
      }, PROMPT_WAIT_MS),
    };
  };

  const runPrompt = (direction: PromptDirection, reads: number) => {
    const plan = planPrompt(
      direction,
      screen.getState(),
      viewGeometry(),
      reads < PROMPT_OLDER_READS && screen.hasOlder(),
    );
    scrollTrace("prompt_jump", { direction, plan: plan.kind, reads });
    switch (plan.kind) {
      case "scroll":
        scroll.current.offset = plan.offset;
        list.current?.scrollToOffset({ offset: plan.offset, animated: false });
        break;
      case "bottom":
        jumpToBottom();
        break;
      case "older":
        startWaiting(direction, reads + 1);
        screen.loadOlder();
        break;
      case "none":
        break;
    }
  };
  const promptRun = useRef(runPrompt);
  promptRun.current = runPrompt;

  const pressPrompt = (direction: PromptDirection) => {
    stopWaiting();
    if (stick.current) {
      // At the bottom the scrollback is not kept up to date: top it up, then go.
      startWaiting(direction, 0);
      latest.current.onScrollBack();
      return;
    }
    runPrompt(direction, 0);
  };

  // The read a press waited for is here.
  useEffect(() => {
    const wanted = waiting.current;
    if (!wanted || historyReplies <= wanted.replies) return;
    // A queued read that follows this reply re-bases the rows: jump when the last one has landed
    // (this effect runs again on that reply; the press's own timer is the way out if none comes).
    if (!screen.isIdle()) return;
    stopWaiting();
    promptRun.current(wanted.direction, wanted.reads);
  }, [historyReplies, screen, stopWaiting]);
  useEffect(() => stopWaiting, [stopWaiting]);

  // Prompts or rows changed: "previous prompt" may have gained or lost its target.
  useEffect(() => {
    refreshPrevious();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prompts, history, lines.length, historyReplies, lineHeight]);

  // Output while the reader is scrolled up pushes rows off the top of the live
  // grid into scrollback: top it up (the screen throttles) so they appear in
  // place, below what is being read, instead of leaving a gap.
  useEffect(() => {
    if (!stick.current && !far.current) latest.current.onScrollBack();
  }, [lines]);

  const renderItem = useCallback(
    ({ item }: { item: Row }) => (
      <TerminalRow
        line={item.line}
        fontSize={fontSize}
        lineHeight={lineHeight}
        cellWidth={cellWidth}
        onTap={onTap}
        onLongPress={onLongPress}
      />
    ),
    [fontSize, lineHeight, cellWidth, onTap, onLongPress],
  );

  const getItemLayout = useCallback(
    (_: unknown, index: number) => ({
      length: lineHeight,
      offset: ROW_PAD + lineHeight * index,
      index,
    }),
    [lineHeight],
  );

  return (
    <GestureDetector gesture={pinch}>
      <View
        style={styles.frame}
        onLayout={(event) => setViewportWidth(event.nativeEvent.layout.width)}
        {...TOUCH_TRACE}
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator
          nestedScrollEnabled
          // A pane that fits has nothing to scroll sideways, and a horizontal scroller that is
          // enabled anyway competes for the vertical swipes of the list inside it.
          scrollEnabled={contentWidth - viewportWidth > 2}
          contentContainerStyle={{ width: contentWidth }}
        >
          <FlatList
            ref={list}
            style={{ width: contentWidth }}
            inverted
            data={rows}
            keyExtractor={keyOf}
            extraData={fontSize}
            renderItem={renderItem}
            getItemLayout={getItemLayout}
            initialNumToRender={60}
            windowSize={9}
            maxToRenderPerBatch={30}
            // Off: on Android it blanked rows inside the nested horizontal ScrollView.
            removeClippedSubviews={false}
            nestedScrollEnabled
            keyboardShouldPersistTaps="always"
            // Rows inserted below the reader (live grid growing, scrollback appended)
            // keep what is being read in place; at the bottom, new rows stay in view.
            maintainVisibleContentPosition={{
              minIndexForVisible: 0,
              autoscrollToTopThreshold: STICK_SLACK,
            }}
            onLayout={(event) => {
              scroll.current.viewport = event.nativeEvent.layout.height;
              refreshPrevious();
            }}
            onScroll={onScroll}
            {...DRAG_TRACE}
            onContentSizeChange={onContentSizeChange}
            scrollEventThrottle={32}
            ListEmptyComponent={<Text style={styles.waiting}>waiting for output…</Text>}
            contentContainerStyle={styles.content}
          />
        </ScrollView>
        {prompts.length > 0 ? (
          <View style={styles.prompts}>
            <Pressable
              testID="prompt-prev"
              accessibilityRole="button"
              accessibilityLabel="Previous prompt"
              accessibilityState={{ disabled: !canPrevious }}
              disabled={!canPrevious}
              onPress={() => pressPrompt("previous")}
              hitSlop={4}
              style={[styles.promptButton, !canPrevious && styles.promptOff]}
            >
              <Ionicons name="chevron-up" size={20} color="#e5e5e5" />
            </Pressable>
            <Pressable
              testID="prompt-next"
              accessibilityRole="button"
              accessibilityLabel="Next prompt"
              accessibilityState={{ disabled: !away }}
              disabled={!away}
              onPress={() => pressPrompt("next")}
              hitSlop={4}
              style={[styles.promptButton, !away && styles.promptOff]}
            >
              <Ionicons name="chevron-down" size={20} color="#e5e5e5" />
            </Pressable>
          </View>
        ) : null}
        {away ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Jump to bottom"
            onPress={jumpToBottom}
            hitSlop={8}
            style={styles.jump}
          >
            <Ionicons name="arrow-down" size={20} color="#e5e5e5" />
          </Pressable>
        ) : null}
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create((theme) => ({
  frame: { flex: 1, backgroundColor: TERMINAL_PALETTE.background },
  content: { paddingHorizontal: 6, paddingVertical: ROW_PAD },
  jump: {
    position: "absolute",
    alignSelf: "center",
    bottom: theme.spacing.md,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.18)",
  },
  prompts: {
    position: "absolute",
    top: theme.spacing.md,
    right: theme.spacing.md,
    gap: theme.spacing.sm,
  },
  promptButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.18)",
  },
  promptOff: { opacity: 0.35 },
  waiting: {
    color: "#a3a3a3",
    fontFamily: theme.fonts.mono,
    fontSize: theme.fontSize.sm,
    padding: theme.spacing.md,
  },
}));
