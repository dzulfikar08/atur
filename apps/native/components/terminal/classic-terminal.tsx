import * as Clipboard from "expo-clipboard";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Pressable, ScrollView, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { HtmlView, type HtmlViewHandle } from "@/components/html-view";
import { Text } from "@/components/ui";
import { controlChar } from "@/lib/terminal-keys";
import type { TerminalScreen } from "@/lib/terminal-screen";
import { TERMINAL_HTML } from "@/lib/webview/terminal-html.generated";

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

interface ClassicTerminalProps {
  screen: TerminalScreen;
  canType: boolean;
  sendInput: (data: string) => boolean;
}

/**
 * The original renderer: xterm.js in a locked-down WebView, fed the same
 * frames as the native view. It mounts mid-stream, so it first replays the
 * current screen, then follows live frames.
 */
export function ClassicTerminal({ screen, canType, sendInput }: ClassicTerminalProps) {
  const terminal = useRef<HtmlViewHandle>(null);
  const [pageReady, setPageReady] = useState(false);
  const [ctrl, setCtrl] = useState(false);
  const ctrlRef = useRef(false);

  useEffect(() => {
    if (!pageReady) return;
    for (const frame of screen.replay()) terminal.current?.send(frame);
    return screen.subscribeFrames((frame) => terminal.current?.send(frame));
  }, [pageReady, screen]);

  const setCtrlArmed = (armed: boolean) => {
    ctrlRef.current = armed;
    setCtrl(armed);
  };

  const onMessage = useCallback(
    (message: Record<string, unknown>) => {
      if (message.t === "ready") {
        setPageReady(true);
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
    const go = () => sendInput(text);
    // A newline runs whatever precedes it: confirm before pasting a block.
    if (text.includes("\r")) {
      Alert.alert(
        "Paste multiple lines?",
        `${text.split("\r").length} lines will be typed into the terminal.`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Paste", onPress: go },
        ],
      );
    } else {
      go();
    }
  };

  return (
    <View style={styles.fill}>
      <HtmlView ref={terminal} html={TERMINAL_HTML} onMessage={onMessage} style={styles.webview} />
      <ScrollView
        horizontal
        keyboardShouldPersistTaps="always"
        showsHorizontalScrollIndicator={false}
        style={styles.keysScroll}
        contentContainerStyle={styles.keys}
      >
        <Key label="⌨" onPress={() => terminal.current?.send({ t: "focus" })} enabled={canType} />
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
  fill: { flex: 1 },
  webview: { flex: 1, backgroundColor: "#0a0a0a" },
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
