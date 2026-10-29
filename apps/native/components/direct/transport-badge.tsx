import "@/unistyles";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { Text } from "@/components/ui";
import type { PaneTransport } from "@/lib/direct/transport-choice";

/** Which road the pane screen's frames take: straight to the computer, or through Atur Cloud. */
export function TransportBadge({
  transport,
  rttMs,
}: {
  transport: PaneTransport;
  rttMs: number | null;
}) {
  const direct = transport === "direct";
  const label = direct ? (rttMs === null ? "Direct" : `Direct · ${rttMs} ms`) : "Cloud";
  return (
    <View
      style={[styles.badge, direct && styles.badgeDirect]}
      accessibilityLabel={direct ? "Straight to your computer" : "Through Atur Cloud"}
    >
      <Text style={[styles.label, direct && styles.labelDirect]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  badge: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 1,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.muted,
  },
  badgeDirect: { backgroundColor: theme.colors.completed },
  label: {
    fontSize: theme.fontSize.xs,
    fontFamily: theme.fonts.bold,
    color: theme.colors.mutedForeground,
  },
  labelDirect: { color: theme.colors.primaryForeground },
}));
