import * as Haptics from "expo-haptics";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { FlatList, ScrollView, View, type NativeScrollEvent } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { StyleSheet } from "react-native-unistyles";

import { TERMINAL_PALETTE } from "@/components/terminal/palette";
import { TerminalRow } from "@/components/terminal/terminal-row";
import { Text } from "@/components/ui";
import { CELL_WIDTH_EM, clampFontSize, LINE_HEIGHT_EM } from "@/lib/terminal-metrics";
import type { TerminalScreen } from "@/lib/terminal-screen";

/** Within this many px of the bottom counts as "at the bottom". */
const STICK_SLACK = 48;
/** Vertical padding of the list content; getItemLayout offsets include it. */
const ROW_PAD = 4;

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
  /** Long-press on the text: the owner opens the text selector. */
  onSelectText: () => void;
}

/**
 * The pane's screen as native text: one memoised row per terminal line in
 * JetBrains Mono, scrolled horizontally when the grid is wider than the phone
 * and vertically when taller. Pinch scales the font; the view follows the
 * bottom of the screen until the reader scrolls up. Scrollback (loaded by the
 * owner on connect) sits above the live grid; each scroll away from the
 * bottom asks for a fresh copy, since output keeps scrolling into it.
 */
export function TerminalView({
  screen,
  fontSize,
  onFontSize,
  onFontSizeCommit,
  onTapText,
  onScrollBack,
  onSelectText,
}: TerminalViewProps) {
  const { cols, lines, history } = useSyncExternalStore(screen.subscribe, screen.getState);
  const rows = useMemo(
    () => (history.length > 0 ? [...history, ...lines] : (lines as string[])),
    [history, lines],
  );
  const list = useRef<FlatList<string>>(null);
  const stick = useRef(true);
  const [viewportWidth, setViewportWidth] = useState(0);

  const lineHeight = Math.round(fontSize * LINE_HEIGHT_EM);
  const cellWidth = fontSize * CELL_WIDTH_EM;
  // A little slack: fallback fonts and rounding can make a row a hair wider than cols cells.
  const contentWidth = Math.max(viewportWidth, Math.ceil(cols * cellWidth * 1.03) + 12);

  const onLongPress = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    onSelectText();
  }, [onSelectText]);

  const onTap = useCallback(
    (url: string | null) => {
      if (url) {
        void Haptics.selectionAsync().catch(() => {});
        void WebBrowser.openBrowserAsync(url);
      } else {
        onTapText();
      }
    },
    [onTapText],
  );

  // Pinch → font size, relative to the size when the gesture began. The handlers
  // read the latest props through a ref so the gesture object never changes
  // mid-pinch (every size change re-renders this component).
  const latest = useRef({ fontSize, onFontSize, onFontSizeCommit });
  latest.current = { fontSize, onFontSize, onFontSizeCommit };
  const pinchBase = useRef(fontSize);
  const lastSize = useRef(fontSize);
  const pinch = Gesture.Pinch()
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
    .onEnd(() => latest.current.onFontSizeCommit(lastSize.current));

  const onScroll = ({ nativeEvent: e }: { nativeEvent: NativeScrollEvent }) => {
    const atBottom =
      e.contentOffset.y + e.layoutMeasurement.height >= e.contentSize.height - STICK_SLACK;
    if (stick.current && !atBottom) onScrollBack();
    stick.current = atBottom;
  };

  return (
    <GestureDetector gesture={pinch}>
      <View
        style={styles.frame}
        onLayout={(event) => setViewportWidth(event.nativeEvent.layout.width)}
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator
          nestedScrollEnabled
          contentContainerStyle={{ width: contentWidth }}
        >
          <FlatList
            ref={list}
            style={{ width: contentWidth }}
            data={rows}
            // Distinct key spaces: prepended scrollback must not take over the live rows' keys.
            keyExtractor={(_, index) =>
              index < history.length ? `h${index}` : `l${index - history.length}`
            }
            extraData={fontSize}
            renderItem={({ item }) => (
              <TerminalRow
                line={item}
                fontSize={fontSize}
                lineHeight={lineHeight}
                cellWidth={cellWidth}
                onTap={onTap}
                onLongPress={onLongPress}
              />
            )}
            getItemLayout={(_, index) => ({
              length: lineHeight,
              offset: ROW_PAD + lineHeight * index,
              index,
            })}
            initialNumToRender={60}
            windowSize={9}
            maxToRenderPerBatch={30}
            removeClippedSubviews
            nestedScrollEnabled
            keyboardShouldPersistTaps="always"
            // Scrollback arrives above the rows being read: keep them in place.
            maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
            onScroll={onScroll}
            scrollEventThrottle={32}
            onContentSizeChange={() => {
              if (stick.current) list.current?.scrollToEnd({ animated: false });
            }}
            // The keyboard (or rotation) shrinks the view without changing the
            // content, so onContentSizeChange stays quiet: keep the newest line visible.
            onLayout={() => {
              if (stick.current) list.current?.scrollToEnd({ animated: false });
            }}
            ListEmptyComponent={<Text style={styles.waiting}>waiting for output…</Text>}
            contentContainerStyle={styles.content}
          />
        </ScrollView>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create((theme) => ({
  frame: { flex: 1, backgroundColor: TERMINAL_PALETTE.background },
  content: { paddingHorizontal: 6, paddingVertical: ROW_PAD },
  waiting: {
    color: "#a3a3a3",
    fontFamily: theme.fonts.mono,
    fontSize: theme.fontSize.sm,
    padding: theme.spacing.md,
  },
}));
