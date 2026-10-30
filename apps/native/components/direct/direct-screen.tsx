import "@/unistyles";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import * as ScreenOrientation from "expo-screen-orientation";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  AppState,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
  type NativeTouchEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet } from "react-native-unistyles";

import {
  BarButton,
  DarkButton,
  EXTRA_KEYS,
  GESTURES,
  Key,
  MenuRow,
  MODE_LABEL,
  STICKY,
  styles as chrome,
} from "@/components/direct/screen-chrome";
import { loadScreenView } from "@/components/direct/screen-native-view";
import { KeyboardFrame } from "@/components/keyboard-frame";
import { Text } from "@/components/ui";
import {
  describeScreenState,
  describeScreenStats,
  SCREEN_PHASE_LABEL,
} from "@/lib/direct/screen-text";
import { ScreenInput, zoomFrame } from "@/lib/direct/screen-input";
import {
  anyMods,
  PASTE_KEYSYM,
  replayInput,
  SENTINEL,
  tapKey,
  type ScreenMods,
} from "@/lib/direct/screen-typing";
import { useDirect } from "@/lib/direct/use-direct";
import { useDirectScreen } from "@/lib/direct/use-direct-screen";
import { GestureRecognizer, type GestureAction, type MouseMode } from "@/lib/screen-gestures";
import {
  DEFAULT_SCREEN_PREFS,
  loadScreenPrefs,
  saveScreenPrefs,
  type ScreenPrefs,
} from "@/lib/screen-prefs";
import { toScreen } from "@/lib/screen-view";
import { useSession } from "@/lib/session";
import { AturDirect } from "@/modules/atur-direct";

/** The paired computer's desktop over the direct connection: native picture, touch gestures on top. */

type RippleKind = "left" | "right" | "view";
interface RippleDot {
  id: number;
  x: number;
  y: number;
  kind: RippleKind;
}

const RIPPLE_COLOR: Record<RippleKind, string> = {
  left: "#fafafa",
  right: "#f59e0b",
  view: "#a3a3a3",
};
/** Ctrl+V reads the clipboard the computer has just been given; leave it a moment. */
const PASTE_DELAY_MS = 80;

function goBack() {
  if (router.canGoBack()) router.back();
  else router.replace("/direct-home");
}

export function DirectScreen() {
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const direct = useDirect();
  const account = useSession();
  const NativeScreenView = useMemo(() => loadScreenView(), []);
  const supported =
    direct.state !== "unsupported" && AturDirect !== null && NativeScreenView !== null;
  const paired = direct.state !== "unpaired";

  const [prefs, setPrefs] = useState<ScreenPrefs | null>(null);
  const prefsRef = useRef<ScreenPrefs>(DEFAULT_SCREEN_PREFS);
  useEffect(() => {
    void loadScreenPrefs().then((loaded) => {
      prefsRef.current = loaded;
      setPrefs(loaded);
    });
  }, []);

  const { screen, state } = useDirectScreen(
    supported && paired && prefs
      ? { h264: AturDirect?.screenH264 === true, viewOnly: prefs.viewOnly }
      : null,
  );
  const screenRef = useRef(screen);
  screenRef.current = screen;

  // Landscape-capable: the app launches locked to portrait; the screens alone unlock.
  useEffect(() => {
    void ScreenOrientation.unlockAsync().catch(() => {});
    return () => {
      void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(
        () => {},
      );
    };
  }, []);

  const field = useRef<TextInput>(null);
  const [keyboard, setKeyboard] = useState(false);
  const [menu, setMenu] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [mods, setMods] = useState<ScreenMods>({});
  const [hint, setHint] = useState<string | null>(null);
  const [ripples, setRipples] = useState<RippleDot[]>([]);
  const [pictured, setPictured] = useState(false);
  const hintTimer = useRef<Timer | undefined>(undefined);
  const pasteTimer = useRef<Timer | undefined>(undefined);
  const tickTimer = useRef<Timer | undefined>(undefined);
  const rippleId = useRef(0);
  const [, redraw] = useReducer((n: number) => n + 1, 0);

  const flashHint = (text: string) => {
    setHint(text);
    clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setHint(null), 2500);
  };

  // --- input: gestures -> the model -> screenPointer / screenScroll -----------------------------

  const model = useRef<ScreenInput | null>(null);
  if (model.current === null) {
    model.current = new ScreenInput({
      pointer: (x, y, buttons) => screenRef.current?.pointer(x, y, buttons),
      scroll: (x, y, dx, dy) => screenRef.current?.scroll(x, y, dx, dy),
      feedback: (kind) => {
        void Haptics.impactAsync(
          kind === "hold" ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light,
        ).catch(() => {});
      },
      ripple: (x, y, kind) =>
        setRipples((list) => [...list.slice(-5), { id: ++rippleId.current, x, y, kind }]),
      changed: redraw,
    });
  }
  const input = model.current;
  const recognizer = useRef<GestureRecognizer | null>(null);
  if (recognizer.current === null) recognizer.current = new GestureRecognizer("pointer");
  const gestures = recognizer.current;

  const run = useCallback(
    (actions: GestureAction[]) => {
      for (const action of actions) input.apply(action);
      clearTimeout(tickTimer.current);
      const due = gestures.deadline();
      if (due !== null) {
        tickTimer.current = setTimeout(
          () => run(gestures.tick(performance.now())),
          Math.max(0, due - performance.now()),
        );
      }
    },
    [input, gestures],
  );

  const mode: MouseMode = prefs?.mode ?? DEFAULT_SCREEN_PREFS.mode;
  const viewOnly = state.viewOnly;
  // View-only sends nothing, so one finger should pan rather than steer a pointer.
  const effectiveMode: MouseMode = viewOnly ? "touch" : mode;
  useEffect(() => {
    run(gestures.cancel());
    input.setViewOnly(viewOnly);
    run(gestures.setMode(effectiveMode));
  }, [run, gestures, input, viewOnly, effectiveMode]);

  useEffect(() => {
    input.setPicture(state.width, state.height);
  }, [input, state.width, state.height]);

  useEffect(
    () => () => {
      clearTimeout(hintTimer.current);
      clearTimeout(pasteTimer.current);
      clearTimeout(tickTimer.current);
    },
    [],
  );

  // Back from the background the picture may have lost sync: ask for a full one.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") screenRef.current?.refresh();
    });
    return () => sub.remove();
  }, []);

  const connectionId = useRef<string | null>(null);
  if (direct.connection) connectionId.current = direct.connection.id;
  const viewId = connectionId.current;
  useEffect(() => {
    if (state.phase !== "ready") setPictured(false);
  }, [state.phase, viewId]);

  const points = (touches: readonly NativeTouchEvent[]) =>
    Array.from(touches, (t) => ({ id: Number(t.identifier), x: t.locationX, y: t.locationY }));

  const updatePrefs = (patch: Partial<ScreenPrefs>) => {
    const next = { ...prefsRef.current, ...patch };
    prefsRef.current = next;
    setPrefs(next);
    void saveScreenPrefs(next);
  };

  const setViewOnly = (value: boolean) => {
    updatePrefs({ viewOnly: value });
    screen?.setViewOnly(value);
  };

  const toggleMode = () => {
    const next: MouseMode = mode === "pointer" ? "touch" : "pointer";
    updatePrefs({ mode: next });
    flashHint(
      next === "pointer"
        ? "Mouse pointer: drag to move, tap to click"
        : "Direct touch: tap where you want to click",
    );
  };

  // --- keyboard ----------------------------------------------------------------------------------

  const toggleKeyboard = () => {
    // Typing into a view-only session would silently do nothing: switch to control.
    if (!keyboard && viewOnly) setViewOnly(false);
    setKeyboard(!keyboard);
  };

  useEffect(() => {
    if (keyboard) field.current?.focus();
    else field.current?.blur();
  }, [keyboard]);

  const tap = (keysym: number, wrap: ScreenMods = {}) => {
    if (screen) tapKey(screen, keysym, wrap);
  };

  const onType = (next: string) => {
    field.current?.setNativeProps({ text: SENTINEL });
    if (screen && replayInput(screen, next, mods)) setMods({});
  };

  // --- clipboard ---------------------------------------------------------------------------------

  // Text goes to the computer's clipboard, then Ctrl+V. (An image has no road over RFB.)
  const pasteFromPhone = async () => {
    setMenu(false);
    const text = await Clipboard.getStringAsync();
    if (!text) {
      const image = await Clipboard.hasImageAsync().catch(() => false);
      flashHint(image ? "Only text can be pasted over Direct" : "The phone clipboard is empty");
      return;
    }
    if (!screen?.clipboard(text)) return;
    clearTimeout(pasteTimer.current);
    pasteTimer.current = setTimeout(() => tap(PASTE_KEYSYM, { ctrl: true }), PASTE_DELAY_MS);
  };

  const copyFromComputer = () => {
    void Clipboard.setStringAsync(state.clipboard);
    screen?.clearClipboard();
    setMenu(false);
    flashHint("Computer clipboard copied to this phone");
  };

  const close = () => {
    screen?.close();
    goBack();
  };

  // --- the connection bar slides along the top edge, like Windows App's --------------------------

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

  // --- render --------------------------------------------------------------------------------------

  const onViewport = (e: LayoutChangeEvent) =>
    input.setViewport(e.nativeEvent.layout.width, e.nativeEvent.layout.height);

  if (!supported) {
    return (
      <Blocked
        title="Not available in this build"
        body="Screen over Direct needs the Atur app from the store or a development build. It does not run in the browser or in an older build."
      />
    );
  }
  if (!paired) {
    return (
      <Blocked
        title="No computer paired"
        body="Pair this phone with your computer first, under Direct."
        action={{ label: "Open Direct", onPress: () => router.replace("/direct-home") }}
      />
    );
  }

  const notice = describeScreenState(state);
  const waiting = state.phase === "connecting" || state.phase === "reconnecting";
  // Live, but nothing drawn yet (the first key frame is on its way).
  const waitingPicture = state.phase === "ready" && !pictured;
  const frame = zoomFrame(input.view);
  const live = state.phase === "ready" && input.live;
  const pointerAt = toScreen(input.placement(), input.pointer.x, input.pointer.y);
  const showPointer = live && effectiveMode === "pointer" && !viewOnly;
  const rtt = direct.rttMs;
  const dot =
    state.phase === "ready"
      ? rtt === null || rtt < 150
        ? chrome.dotGood
        : rtt < 400
          ? chrome.dotFair
          : chrome.dotPoor
      : state.phase === "connecting" || state.phase === "reconnecting"
        ? chrome.dotFair
        : chrome.dotPoor;
  const statusLabel = SCREEN_PHASE_LABEL[state.phase];
  const statsLabel =
    state.stats && state.phase === "ready" ? describeScreenStats(state.stats) : null;

  return (
    <View style={chrome.root}>
      <StatusBar hidden />

      <KeyboardFrame variant="fill" floor={insets.bottom}>
        <View style={chrome.flex} onLayout={onViewport}>
          {viewId && NativeScreenView ? (
            <View
              pointerEvents="none"
              style={[
                styles.frame,
                {
                  left: frame.left,
                  top: frame.top,
                  width: frame.width,
                  height: frame.height,
                  transformOrigin: "top left",
                  transform: [
                    { translateX: frame.translateX },
                    { translateY: frame.translateY },
                    { scale: frame.scale },
                  ],
                },
              ]}
            >
              <NativeScreenView
                testID="screen-view"
                connection={viewId}
                style={styles.fill}
                onFirstPicture={() => setPictured(true)}
                onDecoderError={() => screen?.decoderFailed()}
              />
            </View>
          ) : null}

          <View
            testID="screen-touch"
            style={styles.fill}
            onTouchStart={(e) =>
              run(gestures.down(points(e.nativeEvent.changedTouches), performance.now()))
            }
            onTouchMove={(e) =>
              run(gestures.move(points(e.nativeEvent.changedTouches), performance.now()))
            }
            onTouchEnd={(e) =>
              run(
                gestures.up(
                  points(e.nativeEvent.changedTouches).map((p) => p.id),
                  performance.now(),
                ),
              )
            }
            onTouchCancel={() => run(gestures.cancel())}
          />

          {showPointer ? (
            <View
              pointerEvents="none"
              style={[styles.pointer, { left: pointerAt.x - 9, top: pointerAt.y - 9 }]}
            />
          ) : null}
          {ripples.map((dotAt) => (
            <Ripple
              key={dotAt.id}
              x={dotAt.x}
              y={dotAt.y}
              color={RIPPLE_COLOR[dotAt.kind]}
              onDone={() => setRipples((list) => list.filter((r) => r.id !== dotAt.id))}
            />
          ))}

          {notice ? (
            <View style={chrome.center} pointerEvents="box-none">
              <View style={chrome.card}>
                {waiting ? <ActivityIndicator color="#fafafa" /> : null}
                <Text style={chrome.centerTitle}>{notice.title}</Text>
                {notice.body ? <Text style={chrome.centerBody}>{notice.body}</Text> : null}
                {notice.canRetry ? (
                  <DarkButton label="Try again" primary onPress={() => screen?.retry()} />
                ) : null}
                {notice.offerCloud && account.status === "authed" ? (
                  <DarkButton
                    label="Use Atur Cloud screen"
                    onPress={() => router.replace("/screen")}
                  />
                ) : null}
                {notice.canRetry || notice.offerCloud ? (
                  <DarkButton label="Back" onPress={close} />
                ) : null}
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
              chrome.keys,
              { paddingLeft: insets.left + 8, paddingRight: insets.right + 8 },
            ]}
            style={chrome.keysScroll}
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
                  if (anyMods(mods)) setMods({});
                }}
              />
            ))}
            <Key label="Paste" icon="clipboard-outline" onPress={() => void pasteFromPhone()} />
          </ScrollView>
        ) : null}
      </KeyboardFrame>

      {/* Hidden input that owns the OS keyboard; typed text is replayed as key presses. */}
      <TextInput
        ref={field}
        testID="screen-input"
        value={SENTINEL}
        onChangeText={onType}
        onSubmitEditing={() => {
          tap(0xff0d, mods);
          if (anyMods(mods)) setMods({});
        }}
        submitBehavior="submit"
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        keyboardType={Platform.OS === "android" ? "visible-password" : "default"}
        caretHidden
        style={chrome.hiddenInput}
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
        style={[chrome.barWrap, { top: insets.top + 6, transform: [{ translateX: shift }] }]}
        pointerEvents="box-none"
      >
        <View
          style={chrome.bar}
          onLayout={(e) => setBarWidth(e.nativeEvent.layout.width)}
          {...barDrag.panHandlers}
        >
          <View style={chrome.status} accessibilityLabel={`Connection: ${statusLabel}`}>
            {waitingPicture ? (
              <ActivityIndicator size="small" color="#fafafa" />
            ) : (
              <View style={[chrome.dot, dot]} />
            )}
            <Text testID="screen-state" style={chrome.statusText}>
              {statusLabel}
            </Text>
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
                testID="screen-keyboard"
                icon="keypad-outline"
                label="Keyboard"
                active={keyboard}
                onPress={toggleKeyboard}
              />
              <BarButton
                testID="screen-viewonly"
                icon={viewOnly ? "eye-outline" : "hand-left-outline"}
                label={
                  viewOnly ? "View only: tap to take control" : "Controlling: tap for view only"
                }
                active={viewOnly}
                onPress={() => setViewOnly(!viewOnly)}
              />
              <BarButton
                icon="scan-outline"
                label="Fit desktop to screen"
                onPress={() => input.fit()}
              />
              <BarButton
                icon="ellipsis-horizontal"
                label="More"
                active={menu}
                badge={state.clipboard !== ""}
                onPress={() => setMenu(!menu)}
              />
              <BarButton testID="screen-close" icon="close" label="Close screen" onPress={close} />
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
        {statsLabel && !collapsed ? (
          <Text testID="screen-stats" style={chrome.statsPill}>
            {statsLabel}
          </Text>
        ) : null}
        {hint ? <Text style={chrome.hint}>{hint}</Text> : null}

        {menu && !collapsed ? (
          <ScrollView style={chrome.menu} contentContainerStyle={chrome.menuBody}>
            {state.clipboard ? (
              <MenuRow
                icon="copy-outline"
                label="Copy computer clipboard"
                onPress={copyFromComputer}
              />
            ) : null}
            <MenuRow
              icon="clipboard-outline"
              label="Paste phone clipboard"
              detail="Text: sends it to the computer and presses Ctrl+V"
              onPress={() => void pasteFromPhone()}
            />
            <MenuRow
              icon="image-outline"
              label="Refresh the picture"
              detail="Asks the computer for a whole new picture"
              onPress={() => {
                screen?.refresh();
                setMenu(false);
              }}
            />
            <MenuRow
              icon="refresh"
              label="Reconnect"
              onPress={() => {
                screen?.retry();
                setMenu(false);
              }}
            />
            {state.stats ? (
              <View style={chrome.menuSection}>
                <Text style={chrome.menuLabel}>Picture</Text>
                <Text style={chrome.menuDetail}>
                  {`${describeScreenStats(state.stats)}, ${state.stats.dropped} dropped, ${Math.round(state.stats.decodeMs)} ms to decode`}
                </Text>
                {state.name ? <Text style={chrome.menuDetail}>{state.name}</Text> : null}
              </View>
            ) : null}
            <View style={chrome.menuSection}>
              <Text style={chrome.menuLabel}>{MODE_LABEL[mode]} gestures</Text>
              {GESTURES[mode].map(([gesture, action]) => (
                <View key={gesture} style={chrome.gestureRow}>
                  <Text style={chrome.gestureName}>{gesture}</Text>
                  <Text style={chrome.gestureAction}>{action}</Text>
                </View>
              ))}
            </View>
            <MenuRow icon="power" label="Disconnect" danger onPress={close} />
          </ScrollView>
        ) : null}
      </View>
    </View>
  );
}

function Blocked({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: { label: string; onPress: () => void };
}) {
  return (
    <View style={chrome.root}>
      <StatusBar hidden />
      <View style={chrome.center}>
        <Ionicons name="desktop-outline" size={32} color="#a3a3a3" />
        <Text testID="screen-state" style={chrome.centerTitle}>
          {title}
        </Text>
        <Text style={chrome.centerBody}>{body}</Text>
        {action ? <DarkButton label={action.label} primary onPress={action.onPress} /> : null}
        <DarkButton testID="screen-close" label="Back" onPress={goBack} />
      </View>
    </View>
  );
}

function Ripple({
  x,
  y,
  color,
  onDone,
}: {
  x: number;
  y: number;
  color: string;
  onDone: () => void;
}) {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(progress, { toValue: 1, duration: 420, useNativeDriver: true }).start(onDone);
    // Runs once per dot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.ripple,
        {
          left: x - 18,
          top: y - 18,
          borderColor: color,
          opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [0.9, 0] }),
          transform: [
            { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1.5] }) },
          ],
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  fill: { ...StyleSheet.absoluteFillObject },
  frame: { position: "absolute", backgroundColor: "#000" },
  pointer: {
    position: "absolute",
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: "#fafafa",
    backgroundColor: "rgba(96,165,250,0.35)",
  },
  ripple: {
    position: "absolute",
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
  },
});
