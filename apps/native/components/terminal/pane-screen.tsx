import "@/unistyles";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { router, Stack } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { DirectPaneMenu } from "@/components/direct/direct-pane-menu";
import { TransportBadge } from "@/components/direct/transport-badge";
import { KeyboardFrame } from "@/components/keyboard-frame";
import { usePaneActions } from "@/components/pane-actions";
import { ClassicTerminal } from "@/components/terminal/classic-terminal";
import { GoneOverlay } from "@/components/terminal/gone-overlay";
import { NativeTerminal } from "@/components/terminal/native-terminal";
import { SelectTextSheet } from "@/components/terminal/select-text";
import { Transcript } from "@/components/terminal/transcript";
import { Text, type IconName } from "@/components/ui";
import { api } from "@/lib/api";
import { directManager } from "@/lib/direct";
import { directAttention, directSessionTitle } from "@/lib/direct/session-meta";
import { parsePaneTarget } from "@/lib/direct/transport-choice";
import { useDirect } from "@/lib/direct/use-direct";
import { ATTENTION_LABEL, paneAttention, paneTitle } from "@/lib/pane-meta";
import { acknowledgePane } from "@/lib/pane-seen";
import { usePaneAttach, usePaneObserve, type PaneAttachStatus } from "@/lib/pane-streams";
import { useSession } from "@/lib/session";
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

/**
 * One terminal. Used by `/pane/<id>` (signed in: bridge panes and `direct:` ones) and by
 * `/direct-pane/<session>` (no account needed): a `direct:` pane asks the account API for nothing.
 */
export function PaneScreen({ paneId }: { paneId: string }) {
  const insets = useSafeAreaInsets();
  const { theme } = useUnistyles();
  const account = useSession();
  const target = parsePaneTarget(paneId);
  // The pane list is the account's; a direct pane (and a signed-out user) has no use for it.
  const panes = useQuery({
    queryKey: ["panes"],
    queryFn: api.panes,
    enabled: account.status === "authed" && !target.directOnly,
  });
  const pane = panes.data?.find((p) => p.pane_id === paneId);
  const leave = () =>
    router.canGoBack()
      ? router.back()
      : router.replace(account.status === "authed" ? "/panes" : "/direct-home");
  const direct = useDirect();
  const session = direct.sessions.find((s) => s.id === target.sessionId);
  const title = pane
    ? paneTitle(pane)
    : session
      ? directSessionTitle(session)
      : target.directOnly
        ? `Session ${target.sessionId}`
        : paneId;

  // Looking at the pane acknowledges whatever state it is in, including one it
  // reaches while the screen stays open.
  const attention = pane ? paneAttention(pane) : null;
  useEffect(() => {
    if (paneId && attention) acknowledgePane(paneId, attention);
  }, [paneId, attention]);

  // On a direct session the computer holds the Done state: the view clears it for every client.
  const directSessionId = session?.id;
  const directDone = session?.agent?.state === "done";
  useEffect(() => {
    if (directSessionId && directDone) void directManager.acknowledge(directSessionId);
  }, [directSessionId, directDone]);
  const shown = pane ? paneAttention(pane) : session ? directAttention(session) : "shell";
  const shownLabel = shown === "shell" ? null : ATTENTION_LABEL[shown];

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

  // A `direct:` pane has no transcript (that is the bridge's) and no split / close.
  const shownView = target.directOnly && view === "transcript" ? "native" : view;
  const [menuOpen, setMenuOpen] = useState(false);

  // Split opens the new pane; closing this one leaves the screen (the pane is gone).
  const actions = usePaneActions({
    onClosed: leave,
  });

  const [ownsKeyboard, setOwnsKeyboard] = useState(false);
  const [bridgeError, setBridgeError] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  // Text selector: long-press on the terminal, or ⋯ → Select text.
  const openSelector = () => {
    screen.loadHistory(); // top up (or load) scrollback so the selector has it
    setSelecting(true);
  };

  // Frames land here once and feed whichever renderer is mounted.
  const screen = useMemo(() => new TerminalScreen(), [paneId]);

  const {
    status,
    transport,
    sendInput,
    sendPaste,
    retry,
    claimKeyboard,
    requestHistory,
    requestResize,
  } = usePaneAttach(paneId, {
    // hello carries the real pane geometry — the grid is authoritative.
    onHello: ({ cols, rows, keyboard }) => {
      setOwnsKeyboard(keyboard);
      // Opening a pane means using it: take the keyboard on every (re)connect.
      if (!keyboard) claimKeyboard();
      const reflowed = screen.getState().cols !== cols;
      screen.hello(cols, rows);
      // A (re)connect: scrollback requests go to this socket. A full read
      // still appends when it overlaps, so a reconnect never moves the rows
      // being read; a new width rewraps every row, so that one replaces.
      screen.setHistorySource(requestHistory);
      screen.loadHistory(reflowed ? "replace" : "full");
    },
    onSnapshot: (ansi) => {
      setBridgeError(null);
      screen.snapshot(ansi);
    },
    onDiff: (rows) => screen.diff(rows),
    onHistory: (rows, visible, prompts) => screen.setHistory(rows, visible, prompts),
    onHistoryFailed: () => screen.historyFailed(),
    onGeometry: ({ cols, rows }) => {
      const reflowed = screen.getState().cols !== cols;
      screen.hello(cols, rows);
      if (reflowed) screen.loadHistory("replace");
    },
    onKeyboard: setOwnsKeyboard,
    onError: setBridgeError,
  });
  const observe = usePaneObserve(paneId, shownView === "transcript" && !target.directOnly);

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
                {title}
              </Text>
              {shownLabel ? <Text style={styles.attention}>{shownLabel}</Text> : null}
              <TransportBadge
                transport={transport}
                rttMs={direct.rttMs}
                wire={direct.connection?.transport}
              />
            </View>
          ),
          // One menu keeps the header clean: views, split and close all live in ⋯.
          headerRight: () => (
            <Pressable
              onPress={() =>
                target.directOnly
                  ? setMenuOpen(true)
                  : actions.open(
                      { pane_id: paneId, title },
                      {
                        options: VIEWS,
                        current: view,
                        onChoose: (next) => chooseView(next as PaneView),
                        actions: [
                          {
                            key: "select",
                            icon: "text-outline",
                            title: "Select text",
                            onPress: openSelector,
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
        {bridgeError ? (
          <Text style={styles.errorText}>
            {transport === "direct" ? "Direct" : "Bridge"} error: {bridgeError}
          </Text>
        ) : null}

        <View style={styles.flex}>
          {shownView === "native" ? (
            <NativeTerminal
              paneId={paneId}
              transport={transport}
              screen={screen}
              canType={canType}
              isAgent={Boolean(pane?.agent ?? session?.agent)}
              sendInput={sendInput}
              sendPaste={sendPaste}
              onClaimKeyboard={status === "connected" ? claimKeyboard : undefined}
              requestResize={requestResize}
              onSelectText={openSelector}
            />
          ) : null}
          {shownView === "classic" ? (
            <ClassicTerminal screen={screen} canType={canType} sendInput={sendInput} />
          ) : null}
          {shownView === "transcript" ? <Transcript observe={observe} /> : null}
          {gone && shownView !== "transcript" ? (
            <GoneOverlay exited={status === "exited"} onRetry={retry} />
          ) : null}
        </View>
      </KeyboardFrame>
      {actions.sheet}
      {target.directOnly ? (
        <DirectPaneMenu
          visible={menuOpen}
          title={title}
          views={VIEWS.filter((v) => v.value !== "transcript")}
          current={shownView}
          onChoose={(next) => chooseView(next as PaneView)}
          onSelectText={openSelector}
          onEnd={async () => {
            const link = direct.connection;
            if (!link) throw new Error("Not connected to your computer");
            await link.endSession(target.sessionId);
            leave();
          }}
          onClose={() => setMenuOpen(false)}
        />
      ) : null}
      <SelectTextSheet visible={selecting} screen={screen} onClose={() => setSelecting(false)} />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  screen: { flex: 1, backgroundColor: theme.colors.background },
  flex: { flex: 1 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm, maxWidth: 240 },
  title: { fontSize: theme.fontSize.base, fontFamily: theme.fonts.bold, flexShrink: 1 },
  attention: { fontSize: theme.fontSize.xs, color: theme.colors.mutedForeground },
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
