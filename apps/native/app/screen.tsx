import "@/unistyles";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import { router } from "expo-router";
import * as ScreenOrientation from "expo-screen-orientation";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useRef, useState } from "react";
import { Platform, Pressable, ScrollView, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet } from "react-native-unistyles";

import { HtmlView, type HtmlViewHandle } from "@/components/html-view";
import { KeyboardFrame } from "@/components/keyboard-frame";
import { Button, Text, type IconName } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { charToKeysym, diffInput, KEYSYM } from "@/lib/screen-keys";
import { WS_ORIGIN } from "@/lib/socket";
import { SCREEN_HTML } from "@/lib/webview/screen-html.generated";

type Conn = "idle" | "connecting" | "connected" | "disconnected";
type Mods = { ctrl?: boolean; alt?: boolean; shift?: boolean; super?: boolean };

// The soft keyboard's hidden input always holds this sentinel so Backspace has
// something to delete (Android fires no change on an empty field).
const SENTINEL = "\u200b\u200b";

// connect-src of the page's CSP: only our own API host.
const PAGE_HTML = SCREEN_HTML.replace("__CONNECT_SRC__", WS_ORIGIN);

const EXTRA_KEYS: { label: string; keysym: number }[] = [
  { label: "Esc", keysym: KEYSYM.Escape },
  { label: "Tab", keysym: KEYSYM.Tab },
  { label: "←", keysym: KEYSYM.Left },
  { label: "↑", keysym: KEYSYM.Up },
  { label: "↓", keysym: KEYSYM.Down },
  { label: "→", keysym: KEYSYM.Right },
  { label: "⏎", keysym: KEYSYM.Return },
];

const STICKY: { name: keyof Mods; label: string }[] = [
  { name: "ctrl", label: "Ctrl" },
  { name: "alt", label: "Alt" },
  { name: "shift", label: "Shift" },
  { name: "super", label: "Super" },
];

const CONN_LABEL: Record<Conn, string> = {
  idle: "Idle",
  connecting: "Connecting…",
  connected: "Live",
  disconnected: "Disconnected",
};

function blockedMessage(error: unknown, available: boolean | undefined): string | null {
  if (error instanceof ApiError) {
    if (error.status === 403) return "Screen is limited to the platform owner.";
    if (error.status === 502) return "The dev box bridge is unreachable.";
    return "Couldn't check desktop sharing.";
  }
  if (error) return "Couldn't check desktop sharing.";
  if (available === false) {
    return "Desktop sharing isn't available on the dev box (wayvnc or the Wayland session is missing).";
  }
  return null;
}

export default function DesktopScreen() {
  const insets = useSafeAreaInsets();
  const me = useQuery({ queryKey: ["me"], queryFn: api.me });
  const owner = me.data?.is_superuser === true;
  const status = useQuery({
    queryKey: ["screen-status"],
    queryFn: api.screenStatus,
    enabled: owner,
    retry: false,
  });
  const ready = owner && status.data?.available === true;

  const page = useRef<HtmlViewHandle>(null);
  const input = useRef<TextInput>(null);
  const [pageReady, setPageReady] = useState(false);
  const [conn, setConn] = useState<Conn>("idle");
  const [dropped, setDropped] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [viewOnly, setViewOnly] = useState(true);
  const viewOnlyRef = useRef(true);
  const [keyboard, setKeyboard] = useState(false);
  const [controls, setControls] = useState(true);
  const [mods, setMods] = useState<Mods>({});
  const [remoteClipboard, setRemoteClipboard] = useState("");

  // Landscape-capable: the app launches locked to portrait; this screen alone unlocks.
  useEffect(() => {
    void ScreenOrientation.unlockAsync().catch(() => {});
    return () => {
      void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(
        () => {},
      );
    };
  }, []);

  // A fresh single-use ticket per connection attempt: it is spent on the upgrade.
  const connect = useCallback(async () => {
    setConnectError(null);
    setConn("connecting");
    try {
      const { ticket } = await api.screenTicket();
      page.current?.send({
        t: "connect",
        url: `${WS_ORIGIN}/api/screen/ws?ticket=${encodeURIComponent(ticket)}`,
        viewOnly: viewOnlyRef.current,
      });
    } catch (error) {
      setConn("disconnected");
      setConnectError(error instanceof Error ? error.message : "Couldn't start a session.");
    }
  }, []);

  useEffect(() => {
    if (ready && pageReady) void connect();
  }, [ready, pageReady, connect]);

  const onMessage = useCallback((message: Record<string, unknown>) => {
    if (message.t === "ready") setPageReady(true);
    else if (message.t === "status") {
      const state = message.state;
      if (state === "connecting" || state === "connected" || state === "disconnected") {
        setConn(state);
        setDropped(state === "disconnected" && message.dropped === true);
        if (state === "disconnected") setKeyboard(false);
      }
    } else if (message.t === "clipboard" && typeof message.text === "string") {
      setRemoteClipboard(message.text);
    }
  }, []);

  const toggleViewOnly = () => {
    const next = !viewOnly;
    viewOnlyRef.current = next;
    setViewOnly(next);
    page.current?.send({ t: "viewOnly", value: next });
  };

  const toggleKeyboard = () => {
    // Typing into a view-only session would silently do nothing: switch to control.
    if (!keyboard && viewOnly) {
      viewOnlyRef.current = false;
      setViewOnly(false);
      page.current?.send({ t: "viewOnly", value: false });
    }
    setKeyboard(!keyboard);
  };

  useEffect(() => {
    if (keyboard) input.current?.focus();
    else input.current?.blur();
  }, [keyboard]);

  const tap = (keysym: number, wrap: Mods = {}) =>
    page.current?.send({ t: "tap", keysym, mods: wrap });
  const clearMods = () => setMods({});

  const onType = (next: string) => {
    input.current?.setNativeProps({ text: SENTINEL });
    const { deleted, inserted } = diffInput(SENTINEL, next);
    for (let i = 0; i < deleted; i++) tap(KEYSYM.BackSpace);
    const syms = Array.from(inserted)
      .map(charToKeysym)
      .filter((sym): sym is number => sym !== null);
    if (Object.values(mods).some(Boolean)) {
      for (const sym of syms) tap(sym, mods);
      clearMods();
    } else if (syms.length > 0) {
      page.current?.send({ t: "type", syms });
    }
  };

  const pasteFromPhone = async () => {
    const text = await Clipboard.getStringAsync();
    if (text) page.current?.send({ t: "paste", text, pressPaste: true });
  };

  const message =
    me.isSuccess && !owner
      ? "Screen is limited to the platform owner."
      : owner
        ? blockedMessage(status.error, status.data?.available)
        : null;
  const showPage = ready;
  const ended = conn === "disconnected";

  return (
    <View style={styles.root}>
      <StatusBar hidden />

      {showPage ? (
        <HtmlView ref={page} html={PAGE_HTML} onMessage={onMessage} style={styles.page} />
      ) : (
        <View style={styles.center}>
          <Ionicons name="desktop-outline" size={32} color="#a3a3a3" />
          <Text style={styles.centerTitle}>
            {message ?? (status.isPending || me.isPending ? "Checking desktop sharing…" : "")}
          </Text>
          <Button variant="secondary" label="Back" onPress={() => router.back()} />
        </View>
      )}

      {showPage && ended ? (
        <View style={styles.center} pointerEvents="box-none">
          <View style={styles.endedCard}>
            <Text style={styles.centerTitle}>
              {dropped ? "Connection dropped" : "Session ended"}
            </Text>
            {connectError ? <Text style={styles.centerBody}>{connectError}</Text> : null}
            <Button label="Reconnect" onPress={() => void connect()} />
            <Button variant="ghost" label="Back" onPress={() => router.back()} />
          </View>
        </View>
      ) : null}

      {/* Controls float over the desktop; the chevron tucks them away for full-screen. */}
      {controls ? (
        <View
          style={[
            styles.bar,
            {
              paddingTop: insets.top + 4,
              paddingLeft: insets.left + 8,
              paddingRight: insets.right + 8,
            },
          ]}
        >
          <Bar icon="arrow-back" label="Back" onPress={() => router.back()} />
          <Text style={styles.barStatus}>{CONN_LABEL[conn]}</Text>
          <View style={styles.flex} />
          {remoteClipboard ? (
            <Bar
              icon="clipboard-outline"
              label="Copy desktop clipboard"
              onPress={() => {
                void Clipboard.setStringAsync(remoteClipboard);
                setRemoteClipboard("");
              }}
            />
          ) : null}
          <Bar
            icon={viewOnly ? "eye-outline" : "hand-left-outline"}
            label={viewOnly ? "View only (tap to control)" : "Controlling (tap for view only)"}
            active={!viewOnly}
            onPress={toggleViewOnly}
          />
          <Bar icon="keypad-outline" label="Keyboard" active={keyboard} onPress={toggleKeyboard} />
          <Bar
            icon="scan-outline"
            label="Reset zoom"
            onPress={() => page.current?.send({ t: "resetZoom" })}
          />
          <Bar icon="refresh" label="Reconnect" onPress={() => void connect()} />
          <Bar icon="chevron-up" label="Hide controls" onPress={() => setControls(false)} />
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Show controls"
          onPress={() => setControls(true)}
          style={[styles.show, { top: insets.top + 6, right: insets.right + 8 }]}
        >
          <Ionicons name="chevron-down" size={18} color="#fafafa" />
        </Pressable>
      )}

      {/* Hidden input that owns the OS keyboard; typed text is replayed as key presses. */}
      <TextInput
        ref={input}
        value={SENTINEL}
        onChangeText={onType}
        onSubmitEditing={() => tap(KEYSYM.Return, mods)}
        submitBehavior="submit"
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        keyboardType={Platform.OS === "android" ? "visible-password" : "default"}
        caretHidden
        style={styles.hiddenInput}
        accessibilityElementsHidden
        importantForAccessibility="no"
      />

      {keyboard ? (
        <KeyboardFrame variant="dock">
          <ScrollView
            horizontal
            keyboardShouldPersistTaps="always"
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.keys}
            style={styles.keysScroll}
          >
            {STICKY.map((mod) => (
              <Pressable
                key={mod.name}
                accessibilityRole="button"
                accessibilityState={{ selected: mods[mod.name] === true }}
                onPress={() => setMods((m) => ({ ...m, [mod.name]: !m[mod.name] }))}
                style={[styles.key, mods[mod.name] && styles.keyActive]}
              >
                <Text style={[styles.keyLabel, mods[mod.name] && styles.keyLabelActive]}>
                  {mod.label}
                </Text>
              </Pressable>
            ))}
            {EXTRA_KEYS.map((key) => (
              <Pressable
                key={key.label}
                accessibilityRole="button"
                accessibilityLabel={key.label}
                onPress={() => {
                  tap(key.keysym, mods);
                  clearMods();
                }}
                style={styles.key}
              >
                <Text style={styles.keyLabel}>{key.label}</Text>
              </Pressable>
            ))}
            <Pressable
              accessibilityRole="button"
              onPress={() => void pasteFromPhone()}
              style={styles.key}
            >
              <Text style={styles.keyLabel}>Paste</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => page.current?.send({ t: "ctrlAltDel" })}
              style={styles.key}
            >
              <Text style={styles.keyLabel}>Ctrl+Alt+Del</Text>
            </Pressable>
          </ScrollView>
        </KeyboardFrame>
      ) : null}
    </View>
  );
}

function Bar({
  icon,
  label,
  onPress,
  active,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  active?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [
        styles.barButton,
        active && styles.barButtonActive,
        pressed && styles.barPressed,
      ]}
    >
      <Ionicons name={icon} size={20} color="#fafafa" />
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: { flex: 1, backgroundColor: "#000" },
  flex: { flex: 1 },
  page: { flex: 1, backgroundColor: "#000" },
  center: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing.md,
    padding: theme.spacing.xl,
  },
  centerTitle: {
    fontSize: theme.fontSize.md,
    fontFamily: theme.fonts.bold,
    color: "#fafafa",
    textAlign: "center",
  },
  centerBody: { fontSize: theme.fontSize.sm, color: "#a3a3a3", textAlign: "center" },
  endedCard: {
    alignItems: "stretch",
    gap: theme.spacing.sm,
    minWidth: 240,
    padding: theme.spacing.lg,
    borderRadius: theme.radius.lg,
    backgroundColor: "rgba(20,20,20,0.92)",
  },
  bar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    paddingBottom: 6,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  barStatus: { fontSize: theme.fontSize.xs, fontFamily: theme.fonts.mono, color: "#d4d4d4" },
  barButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  barButtonActive: { backgroundColor: "rgba(96,165,250,0.55)" },
  barPressed: { opacity: 0.6 },
  show: {
    position: "absolute",
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  hiddenInput: { position: "absolute", width: 1, height: 1, opacity: 0, left: 0, bottom: 0 },
  keysScroll: { backgroundColor: "rgba(20,20,20,0.94)" },
  keys: { gap: theme.spacing.xs, padding: theme.spacing.sm, alignItems: "center" },
  key: {
    minWidth: 44,
    height: 40,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.radius.md,
    backgroundColor: "rgba(255,255,255,0.14)",
    alignItems: "center",
    justifyContent: "center",
  },
  keyActive: { backgroundColor: "#fafafa" },
  keyLabel: { fontSize: theme.fontSize.base, fontFamily: theme.fonts.mono, color: "#fafafa" },
  keyLabelActive: { color: "#0a0a0a" },
}));
