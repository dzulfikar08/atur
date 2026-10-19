import "@/unistyles";
import { useQuery } from "@tanstack/react-query";
import { Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet } from "react-native-unistyles";

import { KeyboardFrame } from "@/components/keyboard-frame";
import { ClassicTerminal } from "@/components/terminal/classic-terminal";
import { GoneOverlay } from "@/components/terminal/gone-overlay";
import { NativeTerminal } from "@/components/terminal/native-terminal";
import { Transcript } from "@/components/terminal/transcript";
import { Chip, Text } from "@/components/ui";
import { api } from "@/lib/api";
import { paneTitle } from "@/lib/pane-meta";
import { usePaneAttach, usePaneObserve, type PaneAttachStatus } from "@/lib/pane-streams";
import { loadPaneView, savePaneView, type PaneView } from "@/lib/terminal-prefs";
import { TerminalScreen } from "@/lib/terminal-screen";

const STATUS_LABEL: Record<PaneAttachStatus, string> = {
  connecting: "Connecting…",
  connected: "Live",
  reconnecting: "Reconnecting…",
  unreachable: "Unreachable",
  exited: "Exited",
};

const VIEWS: { value: PaneView; label: string }[] = [
  { value: "native", label: "Native" },
  { value: "classic", label: "Classic" },
  { value: "transcript", label: "Transcript" },
];

export default function PaneView() {
  const insets = useSafeAreaInsets();
  const { paneId } = useLocalSearchParams<{ paneId: string }>();
  const panes = useQuery({ queryKey: ["panes"], queryFn: api.panes });
  const pane = panes.data?.find((p) => p.pane_id === paneId);

  // Native is the default; the last choice is remembered across panes and launches.
  const [view, setView] = useState<PaneView>("native");
  const chosen = useRef(false);
  useEffect(() => {
    void loadPaneView().then((saved) => {
      if (saved && !chosen.current) setView(saved);
    });
  }, []);
  const chooseView = (next: PaneView) => {
    chosen.current = true;
    setView(next);
    void savePaneView(next);
  };

  const [ownsKeyboard, setOwnsKeyboard] = useState(false);
  const [bridgeError, setBridgeError] = useState<string | null>(null);

  // Frames land here once and feed whichever renderer is mounted.
  const screen = useMemo(() => new TerminalScreen(), [paneId]);

  const { status, sendInput, sendPaste, retry, claimKeyboard } = usePaneAttach(paneId ?? "", {
    // hello carries the real pane geometry — the grid is authoritative.
    onHello: ({ cols, rows, keyboard }) => {
      setOwnsKeyboard(keyboard);
      screen.hello(cols, rows);
    },
    onSnapshot: (ansi) => {
      setBridgeError(null);
      screen.snapshot(ansi);
    },
    onDiff: (rows) => screen.diff(rows),
    onKeyboard: setOwnsKeyboard,
    onError: setBridgeError,
  });
  const observe = usePaneObserve(paneId ?? "", view === "transcript");

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
          {VIEWS.map((v) => (
            <Chip
              key={v.value}
              label={v.label}
              selected={view === v.value}
              onPress={() => chooseView(v.value)}
            />
          ))}
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

        <View style={styles.flex}>
          {view === "native" ? (
            <NativeTerminal
              paneId={paneId}
              screen={screen}
              canType={canType}
              isAgent={Boolean(pane?.agent)}
              sendInput={sendInput}
              sendPaste={sendPaste}
            />
          ) : null}
          {view === "classic" ? (
            <ClassicTerminal screen={screen} canType={canType} sendInput={sendInput} />
          ) : null}
          {view === "transcript" ? <Transcript observe={observe} /> : null}
          {gone && view !== "transcript" ? (
            <GoneOverlay exited={status === "exited"} onRetry={retry} />
          ) : null}
        </View>
      </KeyboardFrame>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  screen: { flex: 1, backgroundColor: theme.colors.background },
  flex: { flex: 1 },
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
}));
