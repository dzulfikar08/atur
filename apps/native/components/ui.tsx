import { Ionicons } from "@expo/vector-icons";
import React, { Fragment, useEffect, useRef, useState, type ComponentProps } from "react";
import {
  ActivityIndicator,
  Animated,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Text as RNText,
  StyleSheet as RNStyleSheet,
  Switch,
  TextInput,
  View,
  type TextInputProps,
  type TextProps,
  type ViewStyle,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { useTabBarInset } from "@/components/floating-tab-bar";
import { assetSource, type Priority } from "@/lib/api";
import { productColor } from "@/lib/product";
import { stateColor } from "@/theme";

// Atur mobile kit: graphite canvas, white hairline cards, one near-black
// primary. Color is reserved for meaning (state group, priority, danger).

export type IconName = ComponentProps<typeof Ionicons>["name"];

// --- Type ------------------------------------------------------------------

/**
 * Manrope text in the foreground color. Weight is a font family, never
 * `fontWeight`: set `fontFamily: theme.fonts.bold` etc. in the style, since
 * custom fonts ship one file per weight.
 */
export function Text({ style, ...rest }: TextProps) {
  return <RNText style={[styles.text, style]} {...rest} />;
}

/** JetBrains Mono, for issue keys like ATR-12. */
export function Mono({ style, ...rest }: TextProps) {
  return <RNText style={[styles.mono, style]} {...rest} />;
}

// --- Layout ----------------------------------------------------------------

/** Safe-area page. Scrolls by default; pass `scroll={false}` for lists. */
export function Screen({
  children,
  scroll = true,
  refreshing,
  onRefresh,
  edges = ["top"],
}: {
  children: React.ReactNode;
  scroll?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  edges?: ("top" | "bottom")[];
}) {
  const { theme } = useUnistyles();
  const tabBarInset = useTabBarInset();
  // Background polls refetch too; only a pull the user made shows the spinner
  // (otherwise every poll drags the page down as if pulled).
  const [pulled, setPulled] = useState(false);
  const sawRefresh = useRef(false);
  useEffect(() => {
    if (!pulled) return;
    if (refreshing) {
      sawRefresh.current = true;
      return;
    }
    if (sawRefresh.current) {
      sawRefresh.current = false;
      setPulled(false);
      return;
    }
    // The refetch was deduped or instant and never reported: don't spin forever.
    const timer = setTimeout(() => setPulled(false), 600);
    return () => clearTimeout(timer);
  }, [pulled, refreshing]);
  return (
    <SafeAreaView style={styles.screen} edges={edges}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={[
            styles.screenContent,
            // Content scrolls under the floating tab bar; the end clears it.
            tabBarInset > 0 && { paddingBottom: theme.spacing.lg + tabBarInset },
          ]}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            onRefresh ? (
              <RefreshControl
                refreshing={pulled && (refreshing ?? false)}
                onRefresh={() => {
                  setPulled(true);
                  onRefresh();
                }}
                tintColor={theme.colors.mutedForeground}
              />
            ) : undefined
          }
        >
          {children}
        </ScrollView>
      ) : (
        children
      )}
    </SafeAreaView>
  );
}

export function PageHeader({
  title,
  caption,
  right,
}: {
  title: string;
  caption?: string;
  right?: React.ReactNode;
}) {
  return (
    <View style={styles.pageHeader}>
      <View style={styles.flex}>
        <Text style={styles.pageTitle} accessibilityRole="header">
          {title}
        </Text>
        {caption ? <Text style={styles.caption}>{caption}</Text> : null}
      </View>
      {right}
    </View>
  );
}

export function SectionTitle({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <View style={styles.sectionRow}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {right}
    </View>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

/** Rows inside one hairline card, separated by hairlines. */
export function ListGroup({ children }: { children: React.ReactNode }) {
  const items = React.Children.toArray(children).filter(Boolean);
  return (
    <View style={styles.card}>
      {items.map((child, i) => (
        <Fragment key={i}>
          {child}
          {i < items.length - 1 ? <View style={styles.separator} /> : null}
        </Fragment>
      ))}
    </View>
  );
}

export function ListRow({
  icon,
  left,
  title,
  subtitle,
  value,
  chevron,
  destructive,
  onPress,
  right,
  toggle,
  accessibilityLabel,
}: {
  icon?: IconName;
  left?: React.ReactNode;
  title: string;
  subtitle?: string;
  value?: string;
  chevron?: boolean;
  destructive?: boolean;
  onPress?: () => void;
  right?: React.ReactNode;
  /** Spoken label when the title alone doesn't carry the row (defaults to the title). */
  accessibilityLabel?: string;
  /** Makes the whole row a switch; tapping anywhere flips it. */
  toggle?: {
    value: boolean;
    onChange: (next: boolean) => void;
    busy?: boolean;
    disabled?: boolean;
  };
}) {
  const { theme } = useUnistyles();
  const color = destructive ? theme.colors.destructive : theme.colors.foreground;
  const toggleInactive = toggle ? toggle.disabled || toggle.busy : false;
  const press = toggle ? () => toggle.onChange(!toggle.value) : onPress;
  return (
    <Pressable
      accessibilityRole={toggle ? "switch" : onPress ? "button" : undefined}
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={
        toggle ? { checked: toggle.value, disabled: toggleInactive, busy: toggle.busy } : undefined
      }
      disabled={!press || toggleInactive}
      onPress={press}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      {icon ? (
        <View style={styles.rowIcon}>
          <Ionicons name={icon} size={17} color={color} />
        </View>
      ) : null}
      {left ? <View style={styles.rowLeft}>{left}</View> : null}
      <View style={styles.flex}>
        <Text style={[styles.rowTitle, { color }]} numberOfLines={2}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.rowSubtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {value ? <Text style={styles.rowValue}>{value}</Text> : null}
      {toggle ? (
        toggle.busy ? (
          <ActivityIndicator color={theme.colors.mutedForeground} />
        ) : (
          <View pointerEvents="none" importantForAccessibility="no-hide-descendants">
            <Switch
              value={toggle.value}
              disabled={toggle.disabled}
              trackColor={{ false: theme.colors.muted, true: theme.colors.primary }}
            />
          </View>
        )
      ) : (
        right
      )}
      {chevron ? (
        <Ionicons name="chevron-forward" size={16} color={theme.colors.mutedForeground} />
      ) : null}
    </Pressable>
  );
}

// --- Controls --------------------------------------------------------------

export function Button({
  label,
  onPress,
  variant = "primary",
  icon,
  loading,
  disabled,
}: {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "ghost" | "destructive";
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
}) {
  const { theme } = useUnistyles();
  const palette = {
    primary: { bg: theme.colors.primary, fg: theme.colors.primaryForeground },
    secondary: { bg: theme.colors.card, fg: theme.colors.foreground },
    ghost: { bg: "transparent", fg: theme.colors.foreground },
    destructive: { bg: theme.colors.destructiveSoft, fg: theme.colors.destructive },
  }[variant];
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: palette.bg },
        variant === "secondary" && styles.buttonOutline,
        pressed && styles.pressed,
        inactive && styles.disabled,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={palette.fg} />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={18} color={palette.fg} /> : null}
          <Text style={[styles.buttonLabel, { color: palette.fg }]}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

export function IconButton({
  icon,
  label,
  onPress,
  badge,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  badge?: number;
}) {
  const { theme } = useUnistyles();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
    >
      <Ionicons name={icon} size={20} color={theme.colors.foreground} />
      {badge ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badge > 99 ? "99+" : badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

export function Input({
  label,
  labelRight,
  style,
  ...props
}: TextInputProps & { label?: string; labelRight?: React.ReactNode }) {
  const { theme } = useUnistyles();
  return (
    <View style={styles.field}>
      {label || labelRight ? (
        <View style={styles.fieldHead}>
          <Text style={styles.fieldLabel}>{label}</Text>
          {labelRight}
        </View>
      ) : null}
      <TextInput
        placeholderTextColor={theme.colors.mutedForeground}
        style={[styles.input, props.multiline && styles.inputMultiline, style]}
        {...props}
      />
    </View>
  );
}

export function Chip({
  label,
  selected,
  onPress,
  onLongPress,
  dot,
}: {
  label: string;
  selected?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
  dot?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      style={({ pressed }) => [
        styles.chip,
        selected && styles.chipSelected,
        pressed && styles.pressed,
      ]}
    >
      {dot ? <View style={[styles.dot, { backgroundColor: dot }]} /> : null}
      <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>{label}</Text>
    </Pressable>
  );
}

/** Floating action button, bottom-right above the tab bar. */
export function Fab({
  icon,
  label,
  onPress,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
}) {
  const { theme } = useUnistyles();
  const tabBarInset = useTabBarInset();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.fab,
        tabBarInset > 0 && { bottom: theme.spacing.lg + tabBarInset },
        pressed && styles.pressed,
      ]}
    >
      <Ionicons name={icon} size={26} color={theme.colors.primaryForeground} />
    </Pressable>
  );
}

// --- Feedback --------------------------------------------------------------

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: IconName;
  title: string;
  body?: string;
  action?: { label: string; onPress: () => void };
}) {
  const { theme } = useUnistyles();
  return (
    <View style={styles.empty}>
      <Ionicons name={icon} size={28} color={theme.colors.mutedForeground} />
      <Text style={styles.emptyTitle}>{title}</Text>
      {body ? <Text style={styles.emptyBody}>{body}</Text> : null}
      {action ? <Button variant="secondary" label={action.label} onPress={action.onPress} /> : null}
    </View>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <Text style={styles.error} accessibilityRole="alert">
      {error instanceof Error ? error.message : String(error)}
    </Text>
  );
}

// --- Domain glyphs ---------------------------------------------------------

/** Circle glyph per state group, Plane-style (empty → half → check), in the shared token colour. */
export function StateIcon({
  state,
  size = 16,
}: {
  state?: { key?: string | null; group?: string | null } | null;
  size?: number;
}) {
  const { theme } = useUnistyles();
  const group = state?.group ?? "backlog";
  const name: IconName =
    group === "completed"
      ? "checkmark-circle"
      : group === "cancelled"
        ? "close-circle"
        : group === "started"
          ? "contrast"
          : group === "triage"
            ? "help-circle-outline"
            : "ellipse-outline";
  return (
    <Ionicons
      name={name}
      size={size}
      color={stateColor(theme.colors, state)}
      style={group === "backlog" ? { opacity: 0.7 } : undefined}
    />
  );
}

/** Tinted pill with a dot, the web's `.state-badge`. */
export function StateBadge({
  state,
  name,
  onPress,
  compact,
}: {
  state?: { key?: string | null; group?: string | null } | null;
  name?: string | null;
  onPress?: () => void;
  compact?: boolean;
}) {
  const { theme } = useUnistyles();
  const tint = stateColor(theme.colors, state);
  const label = name ?? "No state";
  const body = (
    <View
      style={[
        styles.badgePill,
        compact && styles.badgePillCompact,
        { backgroundColor: `${tint}1F` },
      ]}
    >
      <View style={[styles.dot, { backgroundColor: tint }]} />
      <Text style={[styles.badgePillText, { color: tint }]} numberOfLines={1}>
        {label}
      </Text>
      {onPress ? <Ionicons name="chevron-down" size={11} color={tint} /> : null}
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Change state (currently ${label})`}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => pressed && styles.pressed}
    >
      {body}
    </Pressable>
  );
}

/** Product tag chip (the "JoyoFit: …" title prefix), tinted like the web's `.product-chip`. */
export function ProductChip({ product }: { product: string }) {
  const { theme } = useUnistyles();
  const tint = productColor(theme.colors, product);
  return (
    <View style={[styles.badgePill, styles.badgePillCompact, { backgroundColor: `${tint}1F` }]}>
      <Text style={[styles.badgePillText, { color: tint }]} numberOfLines={1}>
        {product}
      </Text>
    </View>
  );
}

/** Pulsing placeholder block. Compose these into screen-shaped skeletons instead of spinners. */
export function Skeleton({
  width,
  height = 14,
  radius = 6,
  style,
}: {
  width?: number | `${number}%`;
  height?: number;
  radius?: number;
  style?: ViewStyle;
}) {
  const pulse = useRef(new Animated.Value(0.45)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 800,
          useNativeDriver: Platform.OS !== "web",
        }),
        Animated.timing(pulse, {
          toValue: 0.45,
          duration: 800,
          useNativeDriver: Platform.OS !== "web",
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.skeleton,
        { width: width ?? "100%", height, borderRadius: radius, opacity: pulse },
        style,
      ]}
    />
  );
}

export const PRIORITIES: { value: Priority; label: string }[] = [
  { value: "urgent", label: "Urgent" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
  { value: "none", label: "No priority" },
];

export function PriorityIcon({
  priority,
  size = 16,
}: {
  priority: Priority | null;
  size?: number;
}) {
  const { theme } = useUnistyles();
  const p = priority ?? "none";
  if (p === "none") {
    return <Ionicons name="remove-outline" size={size} color={theme.colors.priorityNone} />;
  }
  if (p === "urgent")
    return <Ionicons name="alert-circle" size={size} color={theme.colors.urgent} />;
  const bars = p === "high" ? 3 : p === "medium" ? 2 : 1;
  return (
    <View style={[styles.bars, { height: size, width: size }]} accessibilityLabel={`${p} priority`}>
      {[1, 2, 3].map((n) => (
        <View
          key={n}
          style={[
            styles.bar,
            {
              height: (size * (n + 1)) / 4,
              backgroundColor: n <= bars ? theme.colors[p] : theme.colors.hairline,
            },
          ]}
        />
      ))}
    </View>
  );
}

/** Round picture (user avatar / workspace logo); initial letter until it loads or if it fails. */
export function Avatar({
  name,
  uri,
  size = 28,
  square,
}: {
  name: string;
  uri?: string | null;
  size?: number;
  square?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const initial = (name.trim()[0] ?? "?").toUpperCase();
  const radius = square ? size * 0.25 : size / 2;
  return (
    <View
      accessibilityLabel={name}
      style={[styles.avatar, { width: size, height: size, borderRadius: radius }]}
    >
      <Text style={[styles.avatarText, { fontSize: size * 0.42 }]}>{initial}</Text>
      {uri && !failed ? (
        <Image
          source={assetSource(uri)}
          onError={() => setFailed(true)}
          style={[RNStyleSheet.absoluteFill, { borderRadius: radius }]}
        />
      ) : null}
    </View>
  );
}

// --- Sheet -----------------------------------------------------------------

export type SheetOption = {
  key: string;
  label: string;
  left?: React.ReactNode;
  selected?: boolean;
};

/**
 * Bottom sheet shell: dimmed backdrop, handle, title row and a scrollable body.
 * `done` adds a Done button for sheets that stay open while you pick.
 */
export function Sheet({
  visible,
  title,
  onClose,
  done,
  tall,
  headerRight,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  done?: boolean;
  /** Fill most of the screen (filter sheets); otherwise size to content. */
  tall?: boolean;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Pressable style={styles.overlay} onPress={onClose} accessibilityLabel="Close" />
        <View
          style={[styles.sheet, tall && styles.sheetTall, { paddingBottom: insets.bottom + 12 }]}
        >
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{title}</Text>
            {headerRight}
            {done ? (
              <Pressable accessibilityRole="button" onPress={onClose} hitSlop={8}>
                <Text style={styles.sheetDone}>Done</Text>
              </Pressable>
            ) : null}
          </View>
          <ScrollView
            style={styles.sheetList}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** Bottom sheet listing options; multi-select keeps it open on tap. */
export function OptionSheet({
  visible,
  title,
  options,
  onSelect,
  onClose,
  multi,
}: {
  visible: boolean;
  title: string;
  options: SheetOption[];
  onSelect: (key: string) => void;
  onClose: () => void;
  multi?: boolean;
}) {
  const { theme } = useUnistyles();
  return (
    <Sheet visible={visible} title={title} onClose={onClose} done={multi}>
      {options.length === 0 ? <Text style={styles.caption}>Nothing to pick.</Text> : null}
      {options.map((option) => (
        <Pressable
          key={option.key}
          accessibilityRole="button"
          accessibilityState={{ selected: option.selected }}
          onPress={() => {
            onSelect(option.key);
            if (!multi) onClose();
          }}
          style={({ pressed }) => [styles.sheetRow, pressed && styles.pressed]}
        >
          {option.left}
          <Text style={[styles.flex, styles.rowTitle]}>{option.label}</Text>
          {option.selected ? (
            <Ionicons name="checkmark" size={18} color={theme.colors.foreground} />
          ) : null}
        </Pressable>
      ))}
    </Sheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  text: { color: theme.colors.foreground, fontFamily: theme.fonts.regular },
  mono: { color: theme.colors.mutedForeground, fontFamily: theme.fonts.mono, fontSize: 12 },
  flex: { flex: 1 },
  screen: { flex: 1, backgroundColor: theme.colors.background },
  screenContent: {
    padding: theme.spacing.lg,
    paddingBottom: theme.spacing.xxl * 2,
    gap: theme.spacing.md,
  },
  pageHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    marginBottom: theme.spacing.xs,
  },
  pageTitle: { fontSize: theme.fontSize.title, fontFamily: theme.fonts.heavy, letterSpacing: -0.6 },
  caption: { fontSize: theme.fontSize.sm, color: theme.colors.mutedForeground, marginTop: 2 },
  sectionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: theme.spacing.md,
  },
  sectionTitle: {
    fontSize: theme.fontSize.xs,
    fontFamily: theme.fonts.bold,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    color: theme.colors.mutedForeground,
  },
  card: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.lg,
    borderWidth: RNStyleSheet.hairlineWidth,
    borderColor: theme.colors.hairline,
    overflow: "hidden",
  },
  separator: {
    height: RNStyleSheet.hairlineWidth,
    backgroundColor: theme.colors.hairline,
    marginLeft: theme.spacing.lg,
  },
  row: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
  },
  rowIcon: {
    width: 30,
    height: 30,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.muted,
    alignItems: "center",
    justifyContent: "center",
  },
  rowLeft: { minWidth: 30, alignItems: "center", justifyContent: "center" },
  rowTitle: { fontSize: theme.fontSize.base, fontFamily: theme.fonts.medium },
  rowSubtitle: { fontSize: theme.fontSize.sm, color: theme.colors.mutedForeground, marginTop: 2 },
  rowValue: { fontSize: theme.fontSize.sm, color: theme.colors.mutedForeground },
  pressed: { opacity: 0.6 },
  disabled: { opacity: 0.45 },
  button: {
    minHeight: 50,
    borderRadius: theme.radius.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.xl,
  },
  buttonOutline: { borderWidth: 1, borderColor: theme.colors.hairline },
  buttonLabel: { fontSize: theme.fontSize.base, fontFamily: theme.fonts.bold },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.card,
    borderWidth: RNStyleSheet.hairlineWidth,
    borderColor: theme.colors.hairline,
  },
  badge: {
    position: "absolute",
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: theme.colors.urgent,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { color: "#FFFFFF", fontSize: 10, fontFamily: theme.fonts.bold },
  field: { gap: theme.spacing.xs },
  fieldHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  fieldLabel: {
    fontSize: theme.fontSize.sm,
    fontFamily: theme.fonts.medium,
    color: theme.colors.mutedForeground,
  },
  input: {
    minHeight: 48,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.hairline,
    backgroundColor: theme.colors.card,
    paddingHorizontal: theme.spacing.md,
    fontSize: theme.fontSize.md,
    fontFamily: theme.fonts.regular,
    color: theme.colors.foreground,
  },
  inputMultiline: { minHeight: 110, paddingTop: theme.spacing.md, textAlignVertical: "top" },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 34,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.colors.hairline,
    backgroundColor: theme.colors.card,
  },
  chipSelected: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  chipLabel: { fontSize: theme.fontSize.sm, fontFamily: theme.fonts.medium },
  chipLabelSelected: { color: theme.colors.primaryForeground },
  dot: { width: 8, height: 8, borderRadius: 4 },
  badgePill: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    height: 24,
    paddingHorizontal: 9,
    borderRadius: theme.radius.pill,
  },
  badgePillCompact: { height: 20, paddingHorizontal: 7 },
  badgePillText: { fontSize: 12, fontFamily: theme.fonts.medium },
  skeleton: { backgroundColor: theme.colors.hairline },
  fab: {
    position: "absolute",
    right: theme.spacing.lg,
    bottom: theme.spacing.lg,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: theme.colors.primary,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000000",
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  empty: {
    alignItems: "center",
    gap: theme.spacing.sm,
    paddingVertical: theme.spacing.xxl,
    paddingHorizontal: theme.spacing.xl,
  },
  emptyTitle: { fontSize: theme.fontSize.md, fontFamily: theme.fonts.bold, textAlign: "center" },
  emptyBody: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.mutedForeground,
    textAlign: "center",
    lineHeight: 20,
    marginBottom: theme.spacing.sm,
  },
  error: { fontSize: theme.fontSize.sm, color: theme.colors.destructive },
  bars: { flexDirection: "row", alignItems: "flex-end", justifyContent: "center", gap: 1.5 },
  bar: { width: 3, borderRadius: 1 },
  avatar: {
    backgroundColor: theme.colors.muted,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontFamily: theme.fonts.bold },
  overlay: { flex: 1, backgroundColor: theme.colors.overlay },
  sheet: {
    maxHeight: "75%",
    backgroundColor: theme.colors.card,
    borderTopLeftRadius: theme.radius.xl,
    borderTopRightRadius: theme.radius.xl,
    paddingTop: theme.spacing.sm,
  },
  sheetTall: { height: "88%", maxHeight: "88%" },
  sheetHandle: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.colors.hairline,
    marginBottom: theme.spacing.sm,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.sm,
  },
  sheetTitle: { fontSize: theme.fontSize.lg, fontFamily: theme.fonts.bold },
  sheetDone: { fontSize: theme.fontSize.base, fontFamily: theme.fonts.bold },
  sheetList: { paddingHorizontal: theme.spacing.sm },
  sheetRow: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.radius.md,
  },
}));
