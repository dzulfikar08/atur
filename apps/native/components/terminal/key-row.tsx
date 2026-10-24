import * as Haptics from "expo-haptics";
import { useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { StyleSheet } from "react-native-unistyles";

import { Text } from "@/components/ui";
import { KEY_DATA, swipeSteps, type Modifiers } from "@/lib/terminal-keys";

/** Horizontal travel per arrow press while swiping across the key rows. */
const SWIPE_STEP_PX = 16;

type KeyDef =
  | { kind: "mod"; label: string; mod: keyof Modifiers }
  | { kind: "send"; label: string; data: string; a11y?: string }
  | { kind: "paste" }
  | { kind: "keyboard" }
  | { kind: "more" };

const ROW_ONE: KeyDef[] = [
  { kind: "mod", label: "Ctrl", mod: "ctrl" },
  { kind: "mod", label: "Alt", mod: "alt" },
  { kind: "send", label: "Esc", data: KEY_DATA.esc },
  { kind: "send", label: "Tab", data: KEY_DATA.tab },
  { kind: "send", label: "←", data: KEY_DATA.left, a11y: "Left" },
  { kind: "send", label: "↓", data: KEY_DATA.down, a11y: "Down" },
  { kind: "send", label: "↑", data: KEY_DATA.up, a11y: "Up" },
  { kind: "send", label: "→", data: KEY_DATA.right, a11y: "Right" },
];

const ROW_TWO: KeyDef[] = [
  { kind: "keyboard" },
  { kind: "send", label: "Home", data: KEY_DATA.home },
  { kind: "send", label: "End", data: KEY_DATA.end },
  { kind: "send", label: "PgUp", data: KEY_DATA.pageUp, a11y: "Page up" },
  { kind: "send", label: "PgDn", data: KEY_DATA.pageDown, a11y: "Page down" },
  { kind: "paste" },
  { kind: "send", label: "|", data: "|", a11y: "Pipe" },
  { kind: "send", label: "/", data: "/", a11y: "Slash" },
  { kind: "send", label: "-", data: "-", a11y: "Dash" },
  { kind: "send", label: "~", data: "~", a11y: "Tilde" },
];

/** Agent panes: one slim row of what an agent's TUI needs; ⋯ opens the rest. */
const ROW_COMPACT: KeyDef[] = [
  { kind: "send", label: "Esc", data: KEY_DATA.esc },
  { kind: "send", label: "Tab", data: KEY_DATA.tab },
  { kind: "send", label: "←", data: KEY_DATA.left, a11y: "Left" },
  { kind: "send", label: "↓", data: KEY_DATA.down, a11y: "Down" },
  { kind: "send", label: "↑", data: KEY_DATA.up, a11y: "Up" },
  { kind: "send", label: "→", data: KEY_DATA.right, a11y: "Right" },
  { kind: "mod", label: "Ctrl", mod: "ctrl" },
  { kind: "more" },
];

interface KeyRowProps {
  enabled: boolean;
  /** One slim row with a ⋯ toggle to the full two rows (agent panes). */
  compact?: boolean;
  mods: Modifiers;
  onToggleMod: (mod: keyof Modifiers) => void;
  /** Raw key data (modifiers are applied by the owner). */
  onKey: (data: string) => void;
  onPaste: () => void;
  onToggleKeyboard: () => void;
}

/**
 * Extra keys the soft keyboard lacks. Ctrl/Alt are sticky for one key. A
 * horizontal swipe anywhere across the rows repeats ←/→ (one press per
 * 16 px), so the cursor can be dragged along a command line.
 */
export function KeyRow({
  enabled,
  compact = false,
  mods,
  onToggleMod,
  onKey,
  onPaste,
  onToggleKeyboard,
}: KeyRowProps) {
  const [expanded, setExpanded] = useState(false);
  const emitted = useRef(0);
  const latest = useRef({ enabled, onKey });
  latest.current = { enabled, onKey };

  const swipe = Gesture.Pan()
    .runOnJS(true)
    .activeOffsetX([-14, 14])
    .failOffsetY([-24, 24])
    .onStart(() => {
      emitted.current = 0;
    })
    .onUpdate((event) => {
      if (!latest.current.enabled) return;
      const owed = swipeSteps(event.translationX, SWIPE_STEP_PX, emitted.current);
      if (owed === 0) return;
      const data = owed > 0 ? KEY_DATA.right : KEY_DATA.left;
      for (let i = 0; i < Math.abs(owed); i++) latest.current.onKey(data);
      emitted.current += owed;
      void Haptics.selectionAsync().catch(() => {});
    });

  const press = (action: () => void) => () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    action();
  };

  const render = (key: KeyDef, index: number) => {
    switch (key.kind) {
      case "mod":
        return (
          <KeyButton
            key={key.label}
            label={key.label}
            active={mods[key.mod]}
            enabled={enabled}
            onPress={press(() => onToggleMod(key.mod))}
          />
        );
      case "send":
        return (
          <KeyButton
            key={key.label}
            label={key.label}
            a11y={key.a11y}
            enabled={enabled}
            onPress={press(() => onKey(key.data))}
          />
        );
      case "paste":
        return <KeyButton key="paste" label="Paste" enabled={enabled} onPress={press(onPaste)} />;
      case "keyboard":
        return (
          <KeyButton
            key={`keyboard-${index}`}
            label="⌨"
            a11y="Toggle keyboard"
            enabled={enabled}
            onPress={press(onToggleKeyboard)}
          />
        );
      case "more":
        return (
          <KeyButton
            key="more"
            label={expanded ? "×" : "⋯"}
            a11y={expanded ? "Fewer keys" : "More keys"}
            enabled
            active={expanded}
            onPress={press(() => setExpanded((e) => !e))}
          />
        );
    }
  };

  const rows = !compact
    ? [ROW_ONE, ROW_TWO]
    : expanded
      ? [ROW_COMPACT, [...ROW_ONE.filter((k) => k.kind === "mod" && k.mod === "alt"), ...ROW_TWO]]
      : [ROW_COMPACT];

  return (
    <GestureDetector gesture={swipe}>
      <View style={styles.rows} accessibilityHint="Swipe sideways to move the cursor">
        {rows.map((row, i) => (
          <View key={i} style={styles.row}>
            {row.map(render)}
          </View>
        ))}
      </View>
    </GestureDetector>
  );
}

function KeyButton({
  label,
  a11y,
  onPress,
  enabled,
  active,
}: {
  label: string;
  a11y?: string;
  onPress: () => void;
  enabled: boolean;
  active?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y ?? label}
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
      <Text style={[styles.keyLabel, active && styles.keyLabelActive]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  rows: {
    gap: theme.spacing.xs,
    padding: theme.spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.hairline,
    backgroundColor: theme.colors.card,
  },
  row: { flexDirection: "row", gap: theme.spacing.xs },
  key: {
    flex: 1,
    height: 36,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.muted,
    alignItems: "center",
    justifyContent: "center",
  },
  keyActive: { backgroundColor: theme.colors.primary },
  keyPressed: { opacity: 0.6 },
  keyDisabled: { opacity: 0.35 },
  keyLabel: { fontSize: 11, fontFamily: theme.fonts.mono },
  keyLabelActive: { color: theme.colors.primaryForeground },
}));
