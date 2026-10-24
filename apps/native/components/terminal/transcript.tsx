import { Ionicons } from "@expo/vector-icons";
import { memo, useCallback, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, ScrollView, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { MarkdownBody } from "@/components/markdown-view";
import { EmptyState, Mono, Text, type IconName } from "@/components/ui";
import type { ObserveBlock, PaneObserve } from "@/lib/pane-streams";
import {
  isPendingAsk,
  newestFirst,
  toolIcon,
  toolTitle,
  type TranscriptEntry,
} from "@/lib/transcript";

// --- chat: the agent's session log -------------------------------------------

const UserBubble = memo(function UserBubble({ entry }: { entry: TranscriptEntry }) {
  return (
    <View style={styles.userBubble}>
      <Text style={styles.userText} selectable>
        {entry.text}
      </Text>
    </View>
  );
});

const AssistantText = memo(function AssistantText({ entry }: { entry: TranscriptEntry }) {
  if (entry.error) {
    return (
      <Text style={styles.errorEntry} selectable>
        {entry.text}
      </Text>
    );
  }
  return (
    <View style={styles.assistant}>
      <MarkdownBody source={entry.text} />
    </View>
  );
});

const ToolRow = memo(function ToolRow({ entry }: { entry: TranscriptEntry }) {
  const { theme } = useUnistyles();
  const [open, setOpen] = useState(false);
  const tool = entry.tool;
  if (!tool) return null;
  const result = tool.result?.trim();
  return (
    <View style={styles.tool}>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        disabled={!result}
        accessibilityRole="button"
        accessibilityLabel={`${toolTitle(tool.name)} ${tool.summary}`}
        accessibilityState={{ expanded: open }}
        style={styles.toolHead}
      >
        <Ionicons
          name={toolIcon(tool.name) as IconName}
          size={14}
          color={theme.colors.mutedForeground}
        />
        <Text style={styles.toolTitle}>{toolTitle(tool.name)}</Text>
        <Mono style={styles.toolSummary} numberOfLines={1}>
          {tool.summary}
        </Mono>
        {tool.status === "running" ? <ActivityIndicator size="small" /> : null}
        {tool.status === "error" ? (
          <Ionicons name="alert-circle" size={15} color={theme.colors.destructive} />
        ) : null}
        {result ? (
          <Ionicons
            name={open ? "chevron-up" : "chevron-down"}
            size={14}
            color={theme.colors.mutedForeground}
          />
        ) : null}
      </Pressable>
      {open && result ? (
        <ScrollView horizontal nestedScrollEnabled style={styles.toolResult}>
          <Mono
            style={[styles.toolResultText, tool.status === "error" && styles.toolResultError]}
            selectable
          >
            {result}
          </Mono>
        </ScrollView>
      ) : null}
    </View>
  );
});

const AskCard = memo(function AskCard({
  entry,
  pending,
}: {
  entry: TranscriptEntry;
  pending: boolean;
}) {
  const { theme } = useUnistyles();
  const answer = entry.tool?.result?.trim();
  return (
    <View style={[styles.ask, pending && styles.askPending]}>
      <View style={styles.askHead}>
        <Ionicons
          name="help-circle"
          size={16}
          color={pending ? theme.colors.needsYou : theme.colors.mutedForeground}
        />
        <Text style={[styles.askLabel, pending && styles.askLabelPending]}>
          {pending ? "Needs you" : "Question"}
        </Text>
      </View>
      <Text style={styles.askText} selectable>
        {entry.text || entry.tool?.summary}
      </Text>
      {answer ? (
        <Text style={styles.askAnswer} selectable>
          {answer}
        </Text>
      ) : null}
    </View>
  );
});

const EntryRow = memo(function EntryRow({
  entry,
  pending,
}: {
  entry: TranscriptEntry;
  pending: boolean;
}) {
  switch (entry.role) {
    case "user":
      return <UserBubble entry={entry} />;
    case "assistant":
      return <AssistantText entry={entry} />;
    case "ask":
      return <AskCard entry={entry} pending={pending} />;
    default:
      return <ToolRow entry={entry} />;
  }
});

function ChatList({ observe, header }: { observe: PaneObserve; header: React.ReactNode }) {
  const chat = observe.chat;
  const rows = useMemo(() => newestFirst(chat?.entries ?? []), [chat?.entries]);
  const newest = rows[0];
  const renderItem = useCallback(
    ({ item }: { item: TranscriptEntry }) => (
      <EntryRow entry={item} pending={isPendingAsk(item, newest)} />
    ),
    [newest],
  );
  return (
    <View style={styles.flex}>
      {header}
      <FlatList
        // Newest at the bottom; the list rests there and older pages extend the top.
        inverted
        data={rows}
        keyExtractor={(entry) => entry.id}
        renderItem={renderItem}
        contentContainerStyle={styles.chat}
        onEndReached={observe.loadOlder}
        onEndReachedThreshold={1.5}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={16}
        maxToRenderPerBatch={12}
        windowSize={9}
        ListEmptyComponent={<Text style={styles.muted}>This session has no messages yet.</Text>}
        ListFooterComponent={
          chat?.hasMore ? (
            <View style={styles.pageEdge}>
              <ActivityIndicator size="small" animating={observe.loadingOlder} />
            </View>
          ) : rows.length > 0 ? (
            <Text style={[styles.muted, styles.pageEdge]}>Start of session</Text>
          ) : null
        }
      />
    </View>
  );
}

// --- fallback: the visible screen, parsed -------------------------------------

/** Blocks taller than this collapse behind a "N lines" row. */
const COLLAPSE_THRESHOLD = 8;

function humanizeDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0.0s";
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  return minutes === 0 ? `${total}s` : `${minutes}m ${String(total % 60).padStart(2, "0")}s`;
}

function TranscriptBlock({ block }: { block: ObserveBlock }) {
  const [expanded, setExpanded] = useState(false);
  const collapsible = block.lineCount > COLLAPSE_THRESHOLD;
  const start = Date.parse(block.startedAt);
  const running = !block.endedAt && Number.isFinite(start);
  const end = block.endedAt ? Date.parse(block.endedAt) : Date.now();
  const kindLabel =
    block.kind === "error"
      ? "Error"
      : block.kind === "model"
        ? (block.model ?? "Model")
        : block.kind === "tool"
          ? "Tool"
          : "Output";
  return (
    <View style={[styles.block, block.kind === "error" && styles.blockError]}>
      <View style={styles.blockHead}>
        <Text style={[styles.kind, block.kind === "error" && styles.kindError]}>{kindLabel}</Text>
        {block.kind === "tool" && block.title ? (
          <Text style={styles.blockTitle} numberOfLines={1}>
            {block.title}
          </Text>
        ) : (
          <View style={styles.flex} />
        )}
        {Number.isFinite(start) ? (
          <Mono>
            {humanizeDuration(end - start)}
            {running ? "…" : ""}
          </Mono>
        ) : null}
      </View>
      {collapsible && !expanded ? (
        <Pressable onPress={() => setExpanded(true)} accessibilityRole="button">
          <Text style={styles.expander}>{block.lineCount} lines, tap to expand</Text>
        </Pressable>
      ) : (
        <>
          <Text style={styles.blockText} selectable>
            {block.text}
          </Text>
          {collapsible ? (
            <Pressable onPress={() => setExpanded(false)} accessibilityRole="button">
              <Text style={styles.expander}>Tap to collapse</Text>
            </Pressable>
          ) : null}
        </>
      )}
    </View>
  );
}

function ScreenTranscript({ observe, header }: { observe: PaneObserve; header: React.ReactNode }) {
  const list = useRef<FlatList<ObserveBlock>>(null);
  // Follow the stream only while the reader is parked at the bottom.
  const stick = useRef(true);

  if (observe.mode === "raw") {
    return (
      <ScrollView contentContainerStyle={styles.transcript}>
        {header}
        <Text style={styles.rawText} selectable>
          {observe.rawText || "waiting for output…"}
        </Text>
      </ScrollView>
    );
  }

  return (
    <FlatList
      ref={list}
      data={observe.blocks}
      keyExtractor={(block) => String(block.id)}
      renderItem={({ item }) => <TranscriptBlock block={item} />}
      contentContainerStyle={styles.transcript}
      ListHeaderComponent={<>{header}</>}
      ListEmptyComponent={
        <Text style={styles.muted}>
          {observe.status === "connected" ? "waiting for output…" : "Connecting…"}
        </Text>
      }
      onScroll={({ nativeEvent: e }) => {
        stick.current = e.contentOffset.y + e.layoutMeasurement.height >= e.contentSize.height - 48;
      }}
      scrollEventThrottle={64}
      onContentSizeChange={() => {
        if (stick.current) list.current?.scrollToEnd({ animated: false });
      }}
    />
  );
}

/**
 * The pane's conversation from `/api/panes/observe`: the agent's session log as
 * a scrollable chat when the bridge has one, otherwise the parsed visible screen.
 */
export function Transcript({ observe }: { observe: PaneObserve }) {
  if (observe.status === "unreachable") {
    return (
      <EmptyState
        icon="cloud-offline-outline"
        title="Transcript unavailable"
        body={observe.error ?? "Gave up after several attempts. The bridge may be offline."}
        action={{ label: "Retry", onPress: observe.retry }}
      />
    );
  }

  const header = (
    <>
      {observe.error ? <Text style={styles.errorText}>Bridge error: {observe.error}</Text> : null}
      {observe.status === "reconnecting" ? <Text style={styles.muted}>Reconnecting…</Text> : null}
    </>
  );

  if (observe.chat) return <ChatList observe={observe} header={header} />;
  if (observe.awaitingChat) {
    return (
      <View style={styles.loading}>
        {header}
        <ActivityIndicator />
      </View>
    );
  }
  return <ScreenTranscript observe={observe} header={header} />;
}

const styles = StyleSheet.create((theme) => ({
  flex: { flex: 1 },
  muted: { fontSize: theme.fontSize.sm, color: theme.colors.mutedForeground },
  errorText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.destructive,
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.sm,
  },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", gap: theme.spacing.sm },
  chat: { padding: theme.spacing.md, gap: theme.spacing.md },
  pageEdge: { alignSelf: "center", paddingVertical: theme.spacing.md },
  userBubble: {
    alignSelf: "flex-end",
    maxWidth: "85%",
    backgroundColor: theme.colors.muted,
    borderRadius: theme.radius.lg,
    borderBottomRightRadius: theme.radius.sm,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  userText: { fontSize: theme.fontSize.base, lineHeight: 22 },
  assistant: { paddingHorizontal: theme.spacing.xs },
  errorEntry: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.destructive,
    paddingHorizontal: theme.spacing.xs,
  },
  tool: {
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.hairline,
    backgroundColor: theme.colors.card,
    overflow: "hidden",
  },
  toolHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  toolTitle: { fontSize: theme.fontSize.sm, fontFamily: theme.fonts.bold },
  toolSummary: { flex: 1, fontSize: theme.fontSize.xs, color: theme.colors.mutedForeground },
  toolResult: {
    maxHeight: 320,
    borderTopWidth: 1,
    borderTopColor: theme.colors.hairline,
    backgroundColor: theme.colors.muted,
  },
  toolResultText: { fontSize: 12, lineHeight: 17, padding: theme.spacing.md },
  toolResultError: { color: theme.colors.destructive },
  ask: {
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.hairline,
    backgroundColor: theme.colors.card,
    padding: theme.spacing.md,
    gap: theme.spacing.sm,
  },
  askPending: { borderColor: theme.colors.needsYou, borderWidth: 2 },
  askHead: { flexDirection: "row", alignItems: "center", gap: theme.spacing.xs },
  askLabel: {
    fontSize: theme.fontSize.xs,
    fontFamily: theme.fonts.bold,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    color: theme.colors.mutedForeground,
  },
  askLabelPending: { color: theme.colors.needsYou },
  askText: { fontSize: theme.fontSize.base, lineHeight: 22 },
  askAnswer: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
    borderTopWidth: 1,
    borderTopColor: theme.colors.hairline,
    paddingTop: theme.spacing.sm,
  },
  transcript: { padding: theme.spacing.md, gap: theme.spacing.sm },
  block: {
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.hairline,
    backgroundColor: theme.colors.card,
    padding: theme.spacing.md,
    gap: theme.spacing.xs,
  },
  blockError: { borderColor: theme.colors.destructive },
  blockHead: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm },
  kind: {
    fontSize: theme.fontSize.xs,
    fontFamily: theme.fonts.bold,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    color: theme.colors.mutedForeground,
  },
  kindError: { color: theme.colors.destructive },
  blockTitle: { flex: 1, fontSize: theme.fontSize.sm, fontFamily: theme.fonts.medium },
  blockText: { fontSize: 12, lineHeight: 17, fontFamily: theme.fonts.mono },
  rawText: {
    fontSize: 12,
    lineHeight: 17,
    fontFamily: theme.fonts.mono,
    padding: theme.spacing.md,
  },
  expander: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
    paddingVertical: 4,
  },
}));
