import { useRef, useState } from "react";
import { FlatList, Pressable, ScrollView, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { EmptyState, Mono, Text } from "@/components/ui";
import type { ObserveBlock, PaneObserve } from "@/lib/pane-streams";

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
          <Text style={styles.expander}>{block.lineCount} lines — tap to expand</Text>
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

/** Structured (or raw) transcript of the pane from `/api/panes/observe`. */
export function Transcript({ observe }: { observe: PaneObserve }) {
  const list = useRef<FlatList<ObserveBlock>>(null);
  // Follow the stream only while the reader is parked at the bottom.
  const stick = useRef(true);

  if (observe.status === "unreachable") {
    return (
      <EmptyState
        icon="cloud-offline-outline"
        title="Transcript unavailable"
        body={observe.error ?? "Gave up after several attempts — the bridge may be offline."}
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
      ListHeaderComponent={header}
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

const styles = StyleSheet.create((theme) => ({
  flex: { flex: 1 },
  muted: { fontSize: theme.fontSize.sm, color: theme.colors.mutedForeground },
  errorText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.destructive,
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.sm,
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
