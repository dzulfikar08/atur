import "@/unistyles";
import { useQuery } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { Alert, FlatList, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet } from "react-native-unistyles";

import { HtmlView, type HtmlViewHandle } from "@/components/html-view";
import { KeyboardFrame } from "@/components/keyboard-frame";
import { Button, Chip, EmptyState, Mono, Text } from "@/components/ui";
import { api } from "@/lib/api";
import { paneTitle } from "@/lib/pane-meta";
import {
  usePaneAttach,
  usePaneObserve,
  type ObserveBlock,
  type PaneObserve,
  type PaneAttachStatus,
} from "@/lib/pane-streams";
import { TERMINAL_HTML } from "@/lib/webview/terminal-html.generated";

const STATUS_LABEL: Record<PaneAttachStatus, string> = {
  connecting: "Connecting…",
  connected: "Live",
  reconnecting: "Reconnecting…",
  unreachable: "Unreachable",
  exited: "Exited",
};

/** Blocks taller than this collapse behind a "N lines" row. */
const COLLAPSE_THRESHOLD = 8;

// CSI forms: what shells and TUIs accept without tracking the app's cursor-key mode.
const KEYS: { label: string; data: string }[] = [
  { label: "Esc", data: "\x1b" },
  { label: "Tab", data: "\t" },
  { label: "←", data: "\x1b[D" },
  { label: "↑", data: "\x1b[A" },
  { label: "↓", data: "\x1b[B" },
  { label: "→", data: "\x1b[C" },
  { label: "|", data: "|" },
  { label: "/", data: "/" },
  { label: "-", data: "-" },
  { label: "~", data: "~" },
];

/** Ctrl+<char>: the byte a terminal sends, or null when the key has no control form. */
function controlChar(data: string): string | null {
  if (data.length !== 1) return null;
  const code = data.toUpperCase().charCodeAt(0);
  return code >= 0x40 && code <= 0x5f ? String.fromCharCode(code & 0x1f) : null;
}

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

function Transcript({ observe }: { observe: PaneObserve }) {
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

export default function PaneView() {
  const insets = useSafeAreaInsets();
  const { paneId } = useLocalSearchParams<{ paneId: string }>();
  const panes = useQuery({ queryKey: ["panes"], queryFn: api.panes });
  const pane = panes.data?.find((p) => p.pane_id === paneId);

  const [view, setView] = useState<"terminal" | "transcript">("terminal");
  const [ownsKeyboard, setOwnsKeyboard] = useState(false);
  const [bridgeError, setBridgeError] = useState<string | null>(null);
  const [ctrl, setCtrl] = useState(false);
  const ctrlRef = useRef(false);

  // The page posts "ready" once xterm exists; frames that arrive earlier wait.
  const terminal = useRef<HtmlViewHandle>(null);
  const pageReady = useRef(false);
  const backlog = useRef<object[]>([]);
  const push = useCallback((message: object) => {
    if (pageReady.current) terminal.current?.send(message);
    else backlog.current.push(message);
  }, []);

  const { status, sendInput, retry, claimKeyboard } = usePaneAttach(paneId ?? "", {
    // hello carries the real pane geometry — the grid is authoritative.
    onHello: ({ cols, rows, keyboard }) => {
      setOwnsKeyboard(keyboard);
      push({ t: "hello", cols, rows });
    },
    onSnapshot: (ansi) => {
      setBridgeError(null);
      push({ t: "snapshot", ansi });
    },
    onDiff: (rows) => push({ t: "diff", rows }),
    onKeyboard: setOwnsKeyboard,
    onError: setBridgeError,
  });
  const observe = usePaneObserve(paneId ?? "", view === "transcript");

  const setCtrlArmed = (armed: boolean) => {
    ctrlRef.current = armed;
    setCtrl(armed);
  };

  const onTerminalMessage = useCallback(
    (message: Record<string, unknown>) => {
      if (message.t === "ready") {
        pageReady.current = true;
        for (const queued of backlog.current.splice(0)) terminal.current?.send(queued);
      } else if (message.t === "data" && typeof message.data === "string") {
        let data = message.data;
        if (ctrlRef.current) {
          data = controlChar(data) ?? data;
          ctrlRef.current = false;
          setCtrl(false);
        }
        sendInput(data);
      }
    },
    [sendInput],
  );

  const paste = async () => {
    const text = (await Clipboard.getStringAsync()).replace(/\r?\n/g, "\r");
    if (!text) return;
    const send = () => sendInput(text);
    // A newline runs whatever precedes it: confirm before pasting a block.
    if (text.includes("\r")) {
      Alert.alert(
        "Paste multiple lines?",
        `${text.split("\r").length} lines will be typed into the terminal.`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Paste", onPress: send },
        ],
      );
    } else {
      send();
    }
  };

  if (!paneId) return null;

  const gone = status === "exited" || status === "unreachable";
  const canType = ownsKeyboard && status === "connected";

  return (
    <View style={[styles.screen, { paddingBottom: insets.bottom }]}>
      <Stack.Screen
        options={{ title: pane ? paneTitle(pane) : paneId, headerBackTitle: "Panes" }}
      />
      <KeyboardFrame variant="fill">
        <View style={styles.toolbar}>
          <Chip
            label="Terminal"
            selected={view === "terminal"}
            onPress={() => setView("terminal")}
          />
          <Chip
            label="Transcript"
            selected={view === "transcript"}
            onPress={() => setView("transcript")}
          />
          <View style={styles.flex} />
          <Text
            style={[
              styles.status,
              status === "connected" && styles.statusLive,
              gone && styles.statusBad,
            ]}
          >
            {STATUS_LABEL[status]}
          </Text>
        </View>

        <View style={styles.keyboardBar}>
          <Text style={styles.muted}>{ownsKeyboard ? "Keyboard: yours" : "Read-only"}</Text>
          {!ownsKeyboard && status === "connected" ? (
            <Pressable
              onPress={claimKeyboard}
              accessibilityRole="button"
              accessibilityLabel="Take keyboard"
              style={styles.take}
            >
              <Text style={styles.takeText}>Take keyboard</Text>
            </Pressable>
          ) : null}
        </View>

        {bridgeError ? <Text style={styles.errorText}>Bridge error: {bridgeError}</Text> : null}

        {/* The terminal stays mounted while Transcript is shown so xterm keeps its grid. */}
        <View style={[styles.flex, view !== "terminal" && styles.hidden]}>
          <HtmlView
            ref={terminal}
            html={TERMINAL_HTML}
            onMessage={onTerminalMessage}
            style={styles.webview}
          />
          {gone ? (
            <View style={styles.gone}>
              <Text style={styles.goneTitle}>
                {status === "exited" ? "Pane exited" : "Execution plane unreachable"}
              </Text>
              <Text style={styles.goneBody}>
                {status === "exited"
                  ? "The terminal pane closed on the execution plane."
                  : "Gave up after several attempts — the bridge may be offline."}
              </Text>
              <Button variant="secondary" label="Reconnect" onPress={retry} />
              <Button variant="ghost" label="Back to panes" onPress={() => router.back()} />
            </View>
          ) : null}
        </View>
        {view === "transcript" ? (
          <View style={styles.flex}>
            <Transcript observe={observe} />
          </View>
        ) : null}

        {view === "terminal" ? (
          <ScrollView
            horizontal
            keyboardShouldPersistTaps="always"
            showsHorizontalScrollIndicator={false}
            style={styles.keysScroll}
            contentContainerStyle={styles.keys}
          >
            <Key
              label="⌨"
              onPress={() => terminal.current?.send({ t: "focus" })}
              enabled={canType}
            />
            <Key label="Ctrl" active={ctrl} enabled={canType} onPress={() => setCtrlArmed(!ctrl)} />
            {KEYS.map((key) => (
              <Key
                key={key.label}
                label={key.label}
                enabled={canType}
                onPress={() => sendInput(key.data)}
              />
            ))}
            <Key label="Paste" enabled={canType} onPress={() => void paste()} />
          </ScrollView>
        ) : null}
      </KeyboardFrame>
    </View>
  );
}

function Key({
  label,
  onPress,
  enabled,
  active,
}: {
  label: string;
  onPress: () => void;
  enabled: boolean;
  active?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label === "⌨" ? "Toggle keyboard" : label}
      accessibilityState={{ disabled: !enabled, selected: active }}
      disabled={!enabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.key,
        active && styles.keyActive,
        pressed && styles.keyPressed,
        !enabled && styles.keyDisabled,
      ]}
    >
      <Text style={[styles.keyLabel, active && styles.keyLabelActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  screen: { flex: 1, backgroundColor: theme.colors.background },
  flex: { flex: 1 },
  hidden: { display: "none" },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.sm,
  },
  status: {
    fontSize: theme.fontSize.xs,
    fontFamily: theme.fonts.mono,
    color: theme.colors.mutedForeground,
  },
  statusLive: { color: theme.colors.completed },
  statusBad: { color: theme.colors.destructive },
  keyboardBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.sm,
  },
  take: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 5,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.colors.hairline,
    backgroundColor: theme.colors.card,
  },
  takeText: { fontSize: theme.fontSize.sm, fontFamily: theme.fonts.bold },
  muted: { fontSize: theme.fontSize.sm, color: theme.colors.mutedForeground },
  errorText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.destructive,
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.sm,
  },
  webview: { flex: 1, backgroundColor: "#0a0a0a" },
  gone: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing.sm,
    padding: theme.spacing.xl,
    backgroundColor: "rgba(0,0,0,0.85)",
  },
  goneTitle: { fontSize: theme.fontSize.md, fontFamily: theme.fonts.bold, color: "#fafafa" },
  goneBody: { fontSize: theme.fontSize.sm, color: "#a3a3a3", textAlign: "center" },
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
  keysScroll: {
    flexGrow: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.hairline,
    backgroundColor: theme.colors.card,
  },
  keys: { gap: theme.spacing.xs, padding: theme.spacing.sm, alignItems: "center" },
  key: {
    minWidth: 44,
    height: 40,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.muted,
    alignItems: "center",
    justifyContent: "center",
  },
  keyActive: { backgroundColor: theme.colors.primary },
  keyPressed: { opacity: 0.6 },
  keyDisabled: { opacity: 0.35 },
  keyLabel: { fontSize: theme.fontSize.base, fontFamily: theme.fonts.mono },
  keyLabelActive: { color: theme.colors.primaryForeground },
}));
