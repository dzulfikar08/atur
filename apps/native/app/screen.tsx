import "@/unistyles";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import * as ScreenOrientation from "expo-screen-orientation";
import { StatusBar } from "expo-status-bar";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet } from "react-native-unistyles";

import { HtmlView, type HtmlViewHandle } from "@/components/html-view";
import { KeyboardFrame } from "@/components/keyboard-frame";
import { Text, type IconName } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import type { MouseMode } from "@/lib/screen-gestures";
import { charToKeysym, diffInput, KEYSYM } from "@/lib/screen-keys";
import {
  DEFAULT_SCREEN_PREFS,
  loadScreenPrefs,
  saveScreenPrefs,
  type ScreenPrefs,
  type ScreenQuality,
} from "@/lib/screen-prefs";
import {
  MAX_RECONNECT_ATTEMPTS,
  reconnectDelay,
  SCREEN_CLOSE,
  shouldAutoReconnect,
} from "@/lib/screen-session";
import { WS_ORIGIN } from "@/lib/socket";
import { SCREEN_HTML } from "@/lib/webview/screen-html.generated";

type Phase = "checking" | "connecting" | "live" | "reconnecting" | "ended";
type Mods = { ctrl?: boolean; alt?: boolean; shift?: boolean; super?: boolean };

// The soft keyboard's hidden input always holds this sentinel so Backspace has
// something to delete (Android fires no change on an empty field).
const SENTINEL = "\u200b\u200b";

// connect-src of the page's CSP: only our own API host.
const PAGE_HTML = SCREEN_HTML.replace("__CONNECT_SRC__", WS_ORIGIN);

/** A session that stays up this long has earned a fresh retry budget. */
const STABLE_MS = 10_000;

const STICKY: { name: keyof Mods; label: string }[] = [
  { name: "ctrl", label: "Ctrl" },
  { name: "alt", label: "Alt" },
  { name: "shift", label: "Shift" },
  { name: "super", label: "Super" },
];

const EXTRA_KEYS: { label: string; keysym: number; a11y?: string }[] = [
  { label: "Esc", keysym: KEYSYM.Escape },
  { label: "Tab", keysym: KEYSYM.Tab },
  { label: "←", keysym: KEYSYM.Left, a11y: "Left arrow" },
  { label: "↑", keysym: KEYSYM.Up, a11y: "Up arrow" },
  { label: "↓", keysym: KEYSYM.Down, a11y: "Down arrow" },
  { label: "→", keysym: KEYSYM.Right, a11y: "Right arrow" },
  { label: "Home", keysym: KEYSYM.Home },
  { label: "End", keysym: KEYSYM.End },
  { label: "PgUp", keysym: KEYSYM.PageUp, a11y: "Page up" },
  { label: "PgDn", keysym: KEYSYM.PageDown, a11y: "Page down" },
  { label: "Del", keysym: KEYSYM.Delete, a11y: "Delete" },
  { label: "Ins", keysym: KEYSYM.Insert, a11y: "Insert" },
  { label: "PrtSc", keysym: KEYSYM.Print, a11y: "Print screen" },
  ...Array.from({ length: 12 }, (_, i) => ({ label: `F${i + 1}`, keysym: KEYSYM.F1 + i })),
];

const MODE_LABEL: Record<MouseMode, string> = { pointer: "Mouse pointer", touch: "Direct touch" };

// Windows App's gesture table, per mode.
const GESTURES: Record<MouseMode, [string, string][]> = {
  pointer: [
    ["Drag", "Move the pointer"],
    ["Tap", "Click"],
    ["Double-tap", "Double click"],
    ["Double-tap, hold, drag", "Drag (select, move windows)"],
    ["Hold, or two-finger tap", "Right click"],
    ["Two-finger drag", "Scroll"],
    ["Three-finger tap", "Middle click"],
    ["Pinch", "Zoom"],
  ],
  touch: [
    ["Tap", "Click where you touch"],
    ["Hold", "Right click"],
    ["Double-tap, hold, drag", "Drag (select, move windows)"],
    ["Drag", "Pan the zoomed view"],
    ["Two-finger drag", "Scroll"],
    ["Three-finger tap", "Middle click"],
    ["Pinch", "Zoom"],
  ],
};

const QUALITY: { value: ScreenQuality; label: string }[] = [
  { value: "high", label: "Sharp" },
  { value: "balanced", label: "Balanced" },
  { value: "low", label: "Low data" },
];

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

function endMessage(
  code: number | undefined,
  reason: string | undefined,
  exhausted: boolean,
): string {
  if (code === SCREEN_CLOSE.replaced) return "Another viewer took over this desktop.";
  if (code === SCREEN_CLOSE.tooManyViewers)
    return "Too many viewers are connected to this desktop.";
  const why = reason ? ` (${reason})` : "";
  return exhausted
    ? `Couldn't reconnect after ${MAX_RECONNECT_ATTEMPTS} attempts${why}.`
    : `Disconnected${why}.`;
}

export default function DesktopScreen() {
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
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
  const [prefs, setPrefs] = useState<ScreenPrefs | null>(null);
  const prefsRef = useRef<ScreenPrefs>(DEFAULT_SCREEN_PREFS);
  const [phase, setPhase] = useState<Phase>("checking");
  const phaseRef = useRef<Phase>("checking");
  const [attempt, setAttempt] = useState(0);
  const attemptRef = useRef(0);
  const [endedWith, setEndedWith] = useState<string | null>(null);
  const [stats, setStats] = useState<{ rtt: number | null; kbps: number } | null>(null);
  const [keyboard, setKeyboard] = useState(false);
  const [menu, setMenu] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [mods, setMods] = useState<Mods>({});
  const [remoteClipboard, setRemoteClipboard] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const retryTimer = useRef<Timer | undefined>(undefined);
  const stableTimer = useRef<Timer | undefined>(undefined);
  const hintTimer = useRef<Timer | undefined>(undefined);
  /** Bumped by every connect and by `end`: an older attempt's ticket is dropped. */
  const connectSeq = useRef(0);
  /** A ticket request is in flight; its session will replace the page's current one. */
  const fetching = useRef(false);
  const mounted = useRef(true);

  const goTo = (next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  };

  // Landscape-capable: the app launches locked to portrait; this screen alone unlocks.
  useEffect(() => {
    void ScreenOrientation.unlockAsync().catch(() => {});
    return () => {
      void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(
        () => {},
      );
    };
  }, []);

  useEffect(() => {
    // Set here, not only at init: StrictMode runs this cleanup once in development.
    mounted.current = true;
    void loadScreenPrefs().then((loaded) => {
      prefsRef.current = loaded;
      setPrefs(loaded);
    });
    return () => {
      mounted.current = false;
      connectSeq.current++;
      clearTimeout(retryTimer.current);
      clearTimeout(stableTimer.current);
      clearTimeout(hintTimer.current);
    };
  }, []);

  const end = (message: string) => {
    connectSeq.current++;
    fetching.current = false;
    clearTimeout(retryTimer.current);
    retryTimer.current = undefined;
    setEndedWith(message);
    setStats(null);
    goTo("ended");
  };

  // A fresh single-use ticket per attempt: it is spent on the upgrade.
  const connect = async () => {
    clearTimeout(retryTimer.current);
    retryTimer.current = undefined;
    const seq = ++connectSeq.current;
    fetching.current = true;
    setEndedWith(null);
    goTo(attemptRef.current > 0 ? "reconnecting" : "connecting");
    let ticket: string;
    try {
      ({ ticket } = await api.screenTicket());
    } catch (error) {
      if (seq !== connectSeq.current || !mounted.current) return;
      fetching.current = false;
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        end(
          error.status === 403
            ? "Screen is limited to the platform owner."
            : "Sign in again to use Screen.",
        );
        return;
      }
      retry(undefined, error instanceof Error ? error.message : "couldn't start a session");
      return;
    }
    // Stopped, superseded by a newer attempt, or the view is gone.
    if (seq !== connectSeq.current || !mounted.current) return;
    fetching.current = false;
    const p = prefsRef.current;
    page.current?.send({
      t: "connect",
      url: `${WS_ORIGIN}/api/screen/ws?ticket=${encodeURIComponent(ticket)}`,
      viewOnly: p.viewOnly,
      mode: p.mode,
      quality: p.quality,
    });
  };
  const connectRef = useRef(connect);
  connectRef.current = connect;

  // Windows App behaviour: a drop reconnects on its own, the last frame stays up.
  const retry = (code: number | undefined, reason: string | undefined) => {
    if (!mounted.current || phaseRef.current === "ended") return;
    if (!shouldAutoReconnect(code, attemptRef.current)) {
      end(endMessage(code, reason, attemptRef.current >= MAX_RECONNECT_ATTEMPTS));
      return;
    }
    attemptRef.current += 1;
    setAttempt(attemptRef.current);
    goTo("reconnecting");
    retryTimer.current = setTimeout(() => {
      retryTimer.current = undefined;
      void connectRef.current();
    }, reconnectDelay(attemptRef.current));
  };

  const stopReconnecting = () => {
    page.current?.send({ t: "disconnect" });
    end("Reconnecting stopped.");
  };

  const reconnectNow = () => {
    attemptRef.current = 0;
    setAttempt(0);
    setMenu(false);
    void connect();
  };

  useEffect(() => {
    if (ready && pageReady && prefs && phaseRef.current === "checking") void connectRef.current();
  }, [ready, pageReady, prefs]);

  // Back from the background: prove a live socket still works, and run a
  // reconnect that is waiting out its backoff now. An attempt already in
  // flight is left alone.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      if (phaseRef.current === "live") page.current?.send({ t: "resume" });
      else if (phaseRef.current === "reconnecting" && retryTimer.current !== undefined) {
        void connectRef.current();
      }
    });
    return () => sub.remove();
  }, []);

  const onMessage = (message: Record<string, unknown>) => {
    switch (message.t) {
      case "ready":
        setPageReady(true);
        break;
      case "status":
        // Ended by the user (or for good): late reports from the page don't revive it.
        if (phaseRef.current === "ended") break;
        if (message.state === "connected") {
          goTo("live");
          setEndedWith(null);
          clearTimeout(stableTimer.current);
          stableTimer.current = setTimeout(() => {
            attemptRef.current = 0;
            setAttempt(0);
          }, STABLE_MS);
        } else if (message.state === "disconnected") {
          // A newer attempt is fetching its ticket and will replace this session.
          if (fetching.current) break;
          clearTimeout(stableTimer.current);
          setStats(null);
          setKeyboard(false);
          retry(
            typeof message.code === "number" ? message.code : undefined,
            typeof message.reason === "string" && message.reason ? message.reason : undefined,
          );
        }
        break;
      case "stats":
        setStats({
          rtt: typeof message.rtt === "number" ? message.rtt : null,
          kbps: typeof message.kbps === "number" ? message.kbps : 0,
        });
        break;
      case "clipboard":
        if (typeof message.text === "string") setRemoteClipboard(message.text);
        break;
      case "feedback":
        void Haptics.impactAsync(
          message.kind === "hold"
            ? Haptics.ImpactFeedbackStyle.Medium
            : Haptics.ImpactFeedbackStyle.Light,
        ).catch(() => {});
        break;
    }
  };

  const updatePrefs = (patch: Partial<ScreenPrefs>) => {
    const next = { ...prefsRef.current, ...patch };
    prefsRef.current = next;
    setPrefs(next);
    void saveScreenPrefs(next);
    if (patch.mode) page.current?.send({ t: "mode", value: patch.mode });
    if (patch.quality) page.current?.send({ t: "quality", value: patch.quality });
    if (patch.viewOnly !== undefined) page.current?.send({ t: "viewOnly", value: patch.viewOnly });
  };

  const flashHint = (text: string) => {
    setHint(text);
    clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setHint(null), 2500);
  };

  const toggleMode = () => {
    const next: MouseMode = prefsRef.current.mode === "pointer" ? "touch" : "pointer";
    updatePrefs({ mode: next });
    flashHint(
      next === "pointer"
        ? "Mouse pointer: drag to move, tap to click"
        : "Direct touch: tap where you want to click",
    );
  };

  const toggleKeyboard = () => {
    // Typing into a view-only session would silently do nothing: switch to control.
    if (!keyboard && prefsRef.current.viewOnly) updatePrefs({ viewOnly: false });
    setKeyboard(!keyboard);
  };

  useEffect(() => {
    if (keyboard) input.current?.focus();
    else input.current?.blur();
  }, [keyboard]);

  const tap = (keysym: number, wrap: Mods = {}) =>
    page.current?.send({ t: "tap", keysym, mods: wrap });

  const onType = (next: string) => {
    input.current?.setNativeProps({ text: SENTINEL });
    const { deleted, inserted } = diffInput(SENTINEL, next);
    for (let i = 0; i < deleted; i++) tap(KEYSYM.BackSpace);
    const syms = Array.from(inserted)
      .map(charToKeysym)
      .filter((sym): sym is number => sym !== null);
    if (Object.values(mods).some(Boolean)) {
      for (const sym of syms) tap(sym, mods);
      setMods({});
    } else if (syms.length > 0) {
      page.current?.send({ t: "type", syms });
    }
  };

  const pasteFromPhone = async () => {
    setMenu(false);
    const text = await Clipboard.getStringAsync();
    if (text) page.current?.send({ t: "paste", text, pressPaste: true });
  };

  const copyFromDesktop = () => {
    void Clipboard.setStringAsync(remoteClipboard);
    setRemoteClipboard("");
    setMenu(false);
    flashHint("Desktop clipboard copied to this phone");
  };

  const disconnect = () => {
    clearTimeout(retryTimer.current);
    page.current?.send({ t: "disconnect" });
    router.back();
  };

  // The connection bar slides along the top edge, like Windows App's.
  const [barShift, setBarShift] = useState(0);
  const [barWidth, setBarWidth] = useState(0);
  const dragStart = useRef(0);
  const shiftRef = useRef(0);
  shiftRef.current = barShift;
  const limit = Math.max(0, (windowWidth - barWidth) / 2 - 8);
  const limitRef = useRef(limit);
  limitRef.current = limit;
  const barDrag = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderGrant: () => {
        dragStart.current = shiftRef.current;
      },
      onPanResponderMove: (_e, g) => {
        const l = limitRef.current;
        setBarShift(Math.min(l, Math.max(-l, dragStart.current + g.dx)));
      },
    }),
  ).current;
  const shift = Math.min(limit, Math.max(-limit, barShift));

  const message =
    me.isSuccess && !owner
      ? "Screen is limited to the platform owner."
      : owner
        ? blockedMessage(status.error, status.data?.available)
        : null;
  const mode = prefs?.mode ?? DEFAULT_SCREEN_PREFS.mode;
  const viewOnly = prefs?.viewOnly ?? DEFAULT_SCREEN_PREFS.viewOnly;
  const quality = prefs?.quality ?? DEFAULT_SCREEN_PREFS.quality;

  const rtt = stats?.rtt ?? null;
  const dot =
    phase === "live"
      ? rtt === null || rtt < 150
        ? styles.dotGood
        : rtt < 400
          ? styles.dotFair
          : styles.dotPoor
      : phase === "ended"
        ? styles.dotPoor
        : styles.dotFair;
  const statusLabel =
    phase === "live"
      ? rtt === null
        ? "Live"
        : `${rtt} ms`
      : phase === "reconnecting"
        ? "Reconnecting"
        : phase === "ended"
          ? "Disconnected"
          : "Connecting";

  return (
    <View style={styles.root}>
      <StatusBar hidden />

      <KeyboardFrame variant="fill">
        <View style={styles.flex}>
          {ready ? (
            <HtmlView ref={page} html={PAGE_HTML} onMessage={onMessage} style={styles.page} />
          ) : (
            <View style={styles.center}>
              <Ionicons name="desktop-outline" size={32} color="#a3a3a3" />
              <Text style={styles.centerTitle}>
                {message ?? (status.isPending || me.isPending ? "Checking desktop sharing…" : "")}
              </Text>
              <DarkButton label="Back" onPress={() => router.back()} />
            </View>
          )}

          {ready && (phase === "connecting" || phase === "reconnecting") ? (
            <View style={styles.center} pointerEvents="box-none">
              <View style={styles.card}>
                <ActivityIndicator color="#fafafa" />
                <Text style={styles.centerTitle}>
                  {phase === "connecting" ? "Connecting to the desktop…" : "Reconnecting…"}
                </Text>
                {phase === "reconnecting" ? (
                  <Text style={styles.centerBody}>
                    Attempt {Math.max(1, attempt)} of {MAX_RECONNECT_ATTEMPTS}
                  </Text>
                ) : null}
                {phase === "reconnecting" ? (
                  <DarkButton label="Stop reconnecting" onPress={stopReconnecting} />
                ) : null}
              </View>
            </View>
          ) : null}

          {ready && phase === "ended" ? (
            <View style={styles.center} pointerEvents="box-none">
              <View style={styles.card}>
                <Text style={styles.centerTitle}>Session ended</Text>
                {endedWith ? <Text style={styles.centerBody}>{endedWith}</Text> : null}
                <DarkButton label="Reconnect" primary onPress={reconnectNow} />
                <DarkButton label="Back" onPress={() => router.back()} />
              </View>
            </View>
          ) : null}
        </View>

        {keyboard ? (
          <ScrollView
            horizontal
            keyboardShouldPersistTaps="always"
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={[
              styles.keys,
              { paddingLeft: insets.left + 8, paddingRight: insets.right + 8 },
            ]}
            style={styles.keysScroll}
          >
            <Key label="Hide keyboard" icon="chevron-down" onPress={() => setKeyboard(false)} />
            {STICKY.map((mod) => (
              <Key
                key={mod.name}
                label={mod.label}
                active={mods[mod.name] === true}
                onPress={() => setMods((m) => ({ ...m, [mod.name]: !m[mod.name] }))}
              />
            ))}
            {EXTRA_KEYS.map((key) => (
              <Key
                key={key.label}
                label={key.label}
                a11y={key.a11y}
                onPress={() => {
                  tap(key.keysym, mods);
                  setMods({});
                }}
              />
            ))}
            <Key label="Paste" icon="clipboard-outline" onPress={() => void pasteFromPhone()} />
          </ScrollView>
        ) : null}
      </KeyboardFrame>

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

      {menu ? (
        <Pressable
          style={StyleSheet.absoluteFill}
          accessibilityLabel="Close menu"
          onPress={() => setMenu(false)}
        />
      ) : null}

      {/* Connection bar: floats over the desktop, slides along the top, tucks away. */}
      <View
        style={[styles.barWrap, { top: insets.top + 6, transform: [{ translateX: shift }] }]}
        pointerEvents="box-none"
      >
        <View
          style={styles.bar}
          onLayout={(e) => setBarWidth(e.nativeEvent.layout.width)}
          {...barDrag.panHandlers}
        >
          <View style={styles.status} accessibilityLabel={`Connection: ${statusLabel}`}>
            <View style={[styles.dot, dot]} />
            <Text style={styles.statusText}>{statusLabel}</Text>
          </View>
          {collapsed ? (
            <BarButton
              icon="chevron-down"
              label="Show connection bar"
              onPress={() => setCollapsed(false)}
            />
          ) : (
            <>
              <BarButton
                icon={mode === "pointer" ? "navigate-outline" : "hand-left-outline"}
                label={`Mouse mode: ${MODE_LABEL[mode]}`}
                onPress={toggleMode}
              />
              <BarButton
                icon="keypad-outline"
                label="Keyboard"
                active={keyboard}
                onPress={toggleKeyboard}
              />
              <BarButton
                icon="scan-outline"
                label="Fit desktop to screen"
                onPress={() => page.current?.send({ t: "fit" })}
              />
              <BarButton
                icon="ellipsis-horizontal"
                label="More"
                active={menu}
                badge={remoteClipboard !== ""}
                onPress={() => setMenu(!menu)}
              />
              <BarButton
                icon="chevron-up"
                label="Hide connection bar"
                onPress={() => {
                  setMenu(false);
                  setCollapsed(true);
                }}
              />
            </>
          )}
        </View>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}

        {menu && !collapsed ? (
          <ScrollView style={styles.menu} contentContainerStyle={styles.menuBody}>
            <MenuRow
              icon={viewOnly ? "eye-outline" : "hand-left-outline"}
              label={viewOnly ? "View only (taps are not sent)" : "Controlling the desktop"}
              detail={viewOnly ? "Tap to take control" : "Tap to switch to view only"}
              onPress={() => updatePrefs({ viewOnly: !viewOnly })}
            />
            <View style={styles.menuSection}>
              <Text style={styles.menuLabel}>Picture</Text>
              <View style={styles.segment}>
                {QUALITY.map((q) => (
                  <Pressable
                    key={q.value}
                    accessibilityRole="button"
                    accessibilityState={{ selected: quality === q.value }}
                    onPress={() => updatePrefs({ quality: q.value })}
                    style={[styles.segmentItem, quality === q.value && styles.segmentActive]}
                  >
                    <Text
                      style={[styles.segmentText, quality === q.value && styles.segmentTextActive]}
                    >
                      {q.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
              {stats && phase === "live" ? (
                <Text style={styles.menuDetail}>
                  {stats.rtt !== null ? `Round trip ${stats.rtt} ms, ` : ""}
                  receiving{" "}
                  {stats.kbps >= 1000
                    ? `${(stats.kbps / 1000).toFixed(1)} Mbit/s`
                    : `${stats.kbps} kbit/s`}
                </Text>
              ) : null}
            </View>
            {remoteClipboard ? (
              <MenuRow
                icon="copy-outline"
                label="Copy desktop clipboard"
                onPress={copyFromDesktop}
              />
            ) : null}
            <MenuRow
              icon="clipboard-outline"
              label="Paste phone clipboard"
              detail="Sends it to the desktop and presses Ctrl+V"
              onPress={() => void pasteFromPhone()}
            />
            <MenuRow icon="refresh" label="Reconnect" onPress={reconnectNow} />
            <View style={styles.menuSection}>
              <Text style={styles.menuLabel}>{MODE_LABEL[mode]} gestures</Text>
              {GESTURES[mode].map(([gesture, action]) => (
                <View key={gesture} style={styles.gestureRow}>
                  <Text style={styles.gestureName}>{gesture}</Text>
                  <Text style={styles.gestureAction}>{action}</Text>
                </View>
              ))}
            </View>
            <MenuRow icon="power" label="Disconnect" danger onPress={disconnect} />
          </ScrollView>
        ) : null}
      </View>
    </View>
  );
}

function BarButton({
  icon,
  label,
  onPress,
  active,
  badge,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  active?: boolean;
  badge?: boolean;
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
        pressed && styles.pressed,
      ]}
    >
      <Ionicons name={icon} size={20} color="#fafafa" />
      {badge ? <View style={styles.badge} /> : null}
    </Pressable>
  );
}

function MenuRow({
  icon,
  label,
  detail,
  onPress,
  danger,
}: {
  icon: IconName;
  label: string;
  detail?: string;
  onPress: () => void;
  danger?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.menuRow, pressed && styles.pressed]}
    >
      <Ionicons name={icon} size={20} color={danger ? "#fca5a5" : "#fafafa"} />
      <View style={styles.flex}>
        <Text style={[styles.menuText, danger && styles.menuDanger]}>{label}</Text>
        {detail ? <Text style={styles.menuDetail}>{detail}</Text> : null}
      </View>
    </Pressable>
  );
}

function Key({
  label,
  a11y,
  icon,
  active,
  onPress,
}: {
  label: string;
  a11y?: string;
  icon?: IconName;
  active?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y ?? label}
      accessibilityState={active === undefined ? undefined : { selected: active }}
      onPress={() => {
        void Haptics.selectionAsync().catch(() => {});
        onPress();
      }}
      style={({ pressed }) => [styles.key, active && styles.keyActive, pressed && styles.pressed]}
    >
      {icon ? (
        <Ionicons name={icon} size={18} color={active ? "#0a0a0a" : "#fafafa"} />
      ) : (
        <Text style={[styles.keyLabel, active && styles.keyLabelActive]}>{label}</Text>
      )}
    </Pressable>
  );
}

function DarkButton({
  label,
  onPress,
  primary,
}: {
  label: string;
  onPress: () => void;
  primary?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.darkButton,
        primary && styles.darkButtonPrimary,
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.darkButtonText, primary && styles.darkButtonTextPrimary]}>{label}</Text>
    </Pressable>
  );
}

// The Screen view is always dark: it frames a remote desktop, and light chrome
// around it would glare in a dim room. Colours are fixed rather than themed.
const styles = StyleSheet.create((theme) => ({
  root: { flex: 1, backgroundColor: "#000" },
  flex: { flex: 1 },
  page: { flex: 1, backgroundColor: "#000" },
  pressed: { opacity: 0.6 },
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
  centerBody: { fontSize: theme.fontSize.sm, color: "#d4d4d4", textAlign: "center" },
  card: {
    alignItems: "stretch",
    gap: theme.spacing.sm,
    minWidth: 260,
    maxWidth: 360,
    padding: theme.spacing.lg,
    borderRadius: theme.radius.lg,
    backgroundColor: "rgba(20,20,20,0.92)",
  },
  darkButton: {
    minHeight: 44,
    borderRadius: theme.radius.md,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: theme.spacing.lg,
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  darkButtonPrimary: { backgroundColor: "#fafafa" },
  darkButtonText: {
    fontSize: theme.fontSize.base,
    fontFamily: theme.fonts.medium,
    color: "#fafafa",
  },
  darkButtonTextPrimary: { color: "#0a0a0a" },
  barWrap: { position: "absolute", left: 0, right: 0, alignItems: "center" },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderRadius: theme.radius.lg,
    backgroundColor: "rgba(10,10,10,0.82)",
  },
  status: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 6,
    minWidth: 64,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dotGood: { backgroundColor: "#4ade80" },
  dotFair: { backgroundColor: "#fbbf24" },
  dotPoor: { backgroundColor: "#f87171" },
  statusText: { fontSize: theme.fontSize.xs, fontFamily: theme.fonts.mono, color: "#e5e5e5" },
  barButton: {
    width: 44,
    height: 44,
    borderRadius: theme.radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  barButtonActive: { backgroundColor: "rgba(96,165,250,0.45)" },
  badge: {
    position: "absolute",
    top: 9,
    right: 9,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#60a5fa",
  },
  hint: {
    marginTop: 6,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 6,
    borderRadius: theme.radius.md,
    overflow: "hidden",
    fontSize: theme.fontSize.sm,
    color: "#fafafa",
    backgroundColor: "rgba(10,10,10,0.82)",
  },
  menu: {
    marginTop: 6,
    width: 320,
    maxWidth: "94%",
    maxHeight: 460,
    borderRadius: theme.radius.lg,
    backgroundColor: "rgba(18,18,18,0.96)",
  },
  menuBody: { padding: theme.spacing.sm, gap: 2 },
  menuRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    minHeight: 48,
    paddingHorizontal: theme.spacing.sm,
    borderRadius: theme.radius.md,
  },
  menuText: { fontSize: theme.fontSize.base, color: "#fafafa" },
  menuDanger: { color: "#fca5a5" },
  menuDetail: { fontSize: theme.fontSize.xs, color: "#c4c4c4" },
  menuSection: { gap: 6, paddingHorizontal: theme.spacing.sm, paddingVertical: theme.spacing.sm },
  menuLabel: { fontSize: theme.fontSize.xs, fontFamily: theme.fonts.medium, color: "#c4c4c4" },
  segment: { flexDirection: "row", gap: 4 },
  segmentItem: {
    flex: 1,
    minHeight: 40,
    borderRadius: theme.radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  segmentActive: { backgroundColor: "#fafafa" },
  segmentText: { fontSize: theme.fontSize.sm, color: "#fafafa" },
  segmentTextActive: { color: "#0a0a0a", fontFamily: theme.fonts.medium },
  gestureRow: { flexDirection: "row", gap: theme.spacing.sm },
  gestureName: {
    flex: 1,
    fontSize: theme.fontSize.sm,
    fontFamily: theme.fonts.medium,
    color: "#fafafa",
  },
  gestureAction: { flex: 1, fontSize: theme.fontSize.sm, color: "#d4d4d4" },
  hiddenInput: { position: "absolute", width: 1, height: 1, opacity: 0, left: 0, bottom: 0 },
  keysScroll: { flexGrow: 0, backgroundColor: "rgba(20,20,20,0.96)" },
  keys: { gap: theme.spacing.xs, paddingVertical: theme.spacing.sm, alignItems: "center" },
  key: {
    minWidth: 44,
    height: 44,
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
