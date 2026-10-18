import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { Sheet, Text } from "@/components/ui";
import { dateKey } from "@/lib/issue-query";
import { parseDay } from "@/lib/format";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

const monthTitle = (year: number, month: number) =>
  new Date(year, month, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });

function addDays(base: Date, n: number): Date {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  d.setDate(d.getDate() + n);
  return d;
}

/**
 * Calendar bottom sheet for start/target dates (no native date-picker dep, so
 * it looks the same on both platforms). Picks YYYY-MM-DD, the format the API
 * stores; `null` clears.
 */
export function DateSheet({
  visible,
  title,
  value,
  onPick,
  onClose,
  clearLabel = "Clear",
}: {
  visible: boolean;
  title: string;
  value: string | null | undefined;
  onPick: (value: string | null) => void;
  onClose: () => void;
  clearLabel?: string;
}) {
  const { theme } = useUnistyles();
  const selected = value ? value.slice(0, 10) : null;
  const [cursor, setCursor] = useState(() => {
    const d = selected ? parseDay(selected) : new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });

  // Reopen on the selected month (or this one), not wherever it was left.
  useEffect(() => {
    if (!visible) return;
    const d = selected ? parseDay(selected) : new Date();
    setCursor({ year: d.getFullYear(), month: d.getMonth() });
  }, [visible, selected]);

  const today = new Date();
  const todayKey = dateKey(today);
  const first = new Date(cursor.year, cursor.month, 1);
  const daysInMonth = new Date(cursor.year, cursor.month + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array.from({ length: first.getDay() }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const shift = (delta: number) => {
    const d = new Date(cursor.year, cursor.month + delta, 1);
    setCursor({ year: d.getFullYear(), month: d.getMonth() });
  };
  const pick = (next: string | null) => {
    onPick(next);
    onClose();
  };

  const quick = [
    { label: "Today", value: todayKey },
    { label: "Tomorrow", value: dateKey(addDays(today, 1)) },
    { label: "In a week", value: dateKey(addDays(today, 7)) },
  ];

  return (
    <Sheet visible={visible} title={title} onClose={onClose}>
      <View style={styles.quickRow}>
        {quick.map((q) => (
          <Pressable
            key={q.label}
            accessibilityRole="button"
            onPress={() => pick(q.value)}
            style={({ pressed }) => [styles.quick, pressed && styles.pressed]}
          >
            <Text style={styles.quickLabel}>{q.label}</Text>
          </Pressable>
        ))}
        {selected ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => pick(null)}
            style={({ pressed }) => [styles.quick, pressed && styles.pressed]}
          >
            <Text style={[styles.quickLabel, { color: theme.colors.destructive }]}>
              {clearLabel}
            </Text>
          </Pressable>
        ) : null}
      </View>

      <View style={styles.monthRow}>
        <Pressable accessibilityLabel="Previous month" onPress={() => shift(-1)} hitSlop={10}>
          <Ionicons name="chevron-back" size={20} color={theme.colors.foreground} />
        </Pressable>
        <Text style={styles.monthTitle}>{monthTitle(cursor.year, cursor.month)}</Text>
        <Pressable accessibilityLabel="Next month" onPress={() => shift(1)} hitSlop={10}>
          <Ionicons name="chevron-forward" size={20} color={theme.colors.foreground} />
        </Pressable>
      </View>

      <View style={styles.weekRow}>
        {WEEKDAYS.map((w, i) => (
          <Text key={i} style={styles.weekday}>
            {w}
          </Text>
        ))}
      </View>
      <View style={styles.grid}>
        {cells.map((n, i) => {
          if (n === null) return <View key={i} style={styles.cell} />;
          const key = dateKey(new Date(cursor.year, cursor.month, n));
          const isSelected = key === selected;
          return (
            <Pressable
              key={i}
              accessibilityRole="button"
              accessibilityLabel={key}
              accessibilityState={{ selected: isSelected }}
              onPress={() => pick(key)}
              style={styles.cell}
            >
              <View
                style={[
                  styles.day,
                  isSelected && { backgroundColor: theme.colors.primary },
                  !isSelected && key === todayKey && { borderColor: theme.colors.mutedForeground },
                ]}
              >
                <Text
                  style={[styles.dayText, isSelected && { color: theme.colors.primaryForeground }]}
                >
                  {n}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  pressed: { opacity: 0.6 },
  quickRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.sm,
    paddingBottom: theme.spacing.md,
  },
  quick: {
    height: 34,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.colors.hairline,
    alignItems: "center",
    justifyContent: "center",
  },
  quickLabel: { fontSize: theme.fontSize.sm, fontFamily: theme.fonts.medium },
  monthRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing.md,
    paddingBottom: theme.spacing.sm,
  },
  monthTitle: { fontSize: theme.fontSize.md, fontFamily: theme.fonts.bold },
  weekRow: { flexDirection: "row", paddingHorizontal: theme.spacing.xs },
  weekday: {
    flex: 1,
    textAlign: "center",
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
    paddingBottom: theme.spacing.xs,
  },
  grid: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: theme.spacing.xs },
  cell: { width: `${100 / 7}%`, aspectRatio: 1.15, alignItems: "center", justifyContent: "center" },
  day: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
  },
  dayText: { fontSize: theme.fontSize.base, fontFamily: theme.fonts.medium },
}));
