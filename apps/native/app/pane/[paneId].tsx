import "@/unistyles";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { KeyboardFrame } from "@/components/keyboard-frame";
import { usePaneActions } from "@/components/pane-actions";
import { ClassicTerminal } from "@/components/terminal/classic-terminal";
import { GoneOverlay } from "@/components/terminal/gone-overlay";
import { NativeTerminal } from "@/components/terminal/native-terminal";
import { SelectTextSheet } from "@/components/terminal/select-text";
import { Transcript } from "@/components/terminal/transcript";
import { Text, type IconName } from "@/components/ui";
import { api } from "@/lib/api";
import { paneAttention, paneTitle } from "@/lib/pane-meta";
import { acknowledgePane } from "@/lib/pane-seen";
import { usePaneAttach, usePaneObserve, type PaneAttachStatus } from "@/lib/pane-streams";
import { loadPaneView, savePaneView, type PaneView } from "@/lib/terminal-prefs";
import { TerminalScreen } from "@/lib/terminal-screen";

const STATUS_LABEL: Record<PaneAttachStatus, string> = {
  connecting: "Connecting",
  connected: "Live",
  reconnecting: "Reconnecting",
  unreachable: "Unreachable",
  exited: "Exited",
};

const VIEWS: { value: PaneView; label: string; icon: IconName }[] = [
  { value: "native", label: "Native", icon: "terminal-outline" },
  { value: "classic", label: "Classic", icon: "code-slash-outline" },
  { value: "transcript", label: "Transcript", icon: "list-outline" },
];

export default function PaneView() {
  const insets = useSafeAreaInsets();
  const { theme } = useUnistyles();
  const { paneId } = useLocalSearchParams<{ paneId: string }>();
  const panes = useQuery({ queryKey: ["panes"], queryFn: api.panes });
  const pane = panes.data?.find((p) => p.pane_id === paneId);

  // Looking at the pane acknowledges whatever state it is in, including one it
  // reaches while the screen stays open.
  const attention = pane ? paneAttention(pane) : null;
  useEffect(() => {
    if (paneId && attention) acknowledgePane(paneId, attention);
  }, [paneId, attention]);

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

  // Split opens the new pane; closing this one leaves the screen (the pane is gone).
  const actions = usePaneActions({
    onClosed: () => (router.canGoBack() ? router.back() : router.replace("/panes")),
  });

  const [ownsKeyboard, setOwnsKeyboard] = useState(false);
  const [bridgeError, setBridgeError] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);

  // Frames land here once and feed whichever renderer is mounted.
  const screen = useMemo(() => new TerminalScreen(), [paneId]);

  const { status, sendInput, sendPaste, retry, claimKeyboard, requestHistory, requestResize } =
    usePaneAttach(paneId ?? "", {
      // hello carries the real pane geometry — the grid is authoritative.
      onHello: ({ cols, rows, keyboard }) => {
        setOwnsKeyboard(keyboard);
        // Opening a pane means using it: take the keyboard on every (re)connect.
        if (!keyboard) claimKeyboard();
        screen.hello(cols, rows);
      },
      onSnapshot: (ansi) => {
        setBridgeError(null);
        screen.snapshot(ansi);
      },
      onDiff: (rows) => screen.diff(rows),
      onHistory: (rows) => screen.setHistory(rows),
      onGeometry: ({ cols, rows }) => screen.hello(cols, rows),
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
        options={{
          headerBackTitle: "Panes",
          headerTitle: () => (
            <View style={styles.titleRow} accessibilityRole="header">
              <View
                style={[
                  styles.dot,
                  status === "connected" ? styles.dotLive : gone ? styles.dotBad : styles.dotWait,
                ]}
                accessibilityLabel={STATUS_LABEL[status]}
              />
              <Text style={styles.title} numberOfLines={1}>
                {pane ? paneTitle(pane) : paneId}
              </Text>
            </View>
          ),
          // One menu keeps the header clean: views, split and close all live in ⋯.
          headerRight: () => (
            <Pressable
              onPress={() =>
                actions.open(
                  { pane_id: paneId, title: pane ? paneTitle(pane) : paneId },
                  {
                    options: VIEWS,
                    current: view,
                    onChoose: (next) => chooseView(next as PaneView),
                    actions: [
                      {
                        key: "select",
                        icon: "text-outline",
                        title: "Select text",
                        onPress: () => {
                          // Fill in scrollback first if none is loaded yet.
                          if (screen.getState().history.length === 0) requestHistory(3000);
                          setSelecting(true);
                        },
                      },
                    ],
                  },
                )
              }
              accessibilityRole="button"
              accessibilityLabel="Pane menu"
              hitSlop={8}
              style={styles.menuBtn}
            >
              <Ionicons name="ellipsis-horizontal" size={22} color={theme.colors.foreground} />
            </Pressable>
          ),
        }}
      />
      <KeyboardFrame variant="fill">
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
              requestHistory={requestHistory}
              onClaimKeyboard={status === "connected" ? claimKeyboard : undefined}
              requestResize={requestResize}
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
      {actions.sheet}
      <SelectTextSheet visible={selecting} screen={screen} onClose={() => setSelecting(false)} />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  screen: { flex: 1, backgroundColor: theme.colors.background },
  flex: { flex: 1 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm, maxWidth: 180 },
  title: { fontSize: theme.fontSize.base, fontFamily: theme.fonts.bold, flexShrink: 1 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dotLive: { backgroundColor: theme.colors.completed },
  dotWait: { backgroundColor: theme.colors.started },
  dotBad: { backgroundColor: theme.colors.destructive },
  menuBtn: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  errorText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.destructive,
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.sm,
  },
}));
