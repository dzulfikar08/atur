import "@/unistyles";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Pressable, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { Text, type IconName } from "@/components/ui";
import type { MouseMode } from "@/lib/screen-gestures";
import { KEYSYM } from "@/lib/screen-keys";
import type { ScreenMods } from "@/lib/direct/screen-typing";

// The pieces of the Screen view's chrome (connection bar, menu, key row, buttons), as the cloud
// Screen page has them (app/screen.tsx). The Screen view is always dark: it frames a remote
// desktop, and light chrome around it would glare in a dim room. Colours are fixed, not themed.

export const STICKY: { name: keyof ScreenMods; label: string }[] = [
  { name: "ctrl", label: "Ctrl" },
  { name: "alt", label: "Alt" },
  { name: "shift", label: "Shift" },
  { name: "super", label: "Super" },
];

export const EXTRA_KEYS: { label: string; keysym: number; a11y?: string }[] = [
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

export const MODE_LABEL: Record<MouseMode, string> = {
  pointer: "Mouse pointer",
  touch: "Direct touch",
};

// Windows App's gesture table, per mode.
export const GESTURES: Record<MouseMode, [string, string][]> = {
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

export function BarButton({
  icon,
  label,
  onPress,
  active,
  badge,
  testID,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  active?: boolean;
  badge?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
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

export function MenuRow({
  icon,
  label,
  detail,
  onPress,
  danger,
  testID,
}: {
  icon: IconName;
  label: string;
  detail?: string;
  onPress: () => void;
  danger?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
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

export function Key({
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

export function DarkButton({
  label,
  onPress,
  primary,
  testID,
}: {
  label: string;
  onPress: () => void;
  primary?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
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

export const styles = StyleSheet.create((theme) => ({
  root: { flex: 1, backgroundColor: "#000" },
  flex: { flex: 1 },
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
  statsPill: {
    marginTop: 6,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 3,
    borderRadius: theme.radius.md,
    overflow: "hidden",
    fontSize: theme.fontSize.xs,
    fontFamily: theme.fonts.mono,
    color: "#d4d4d4",
    backgroundColor: "rgba(10,10,10,0.68)",
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
