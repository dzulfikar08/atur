import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { Button, Text } from "@/components/ui";
import { OTA_ENABLED, useOtaForegroundCheck, useOtaUpdate } from "@/lib/ota";

/**
 * App-wide banner shown when an over-the-air update is downloaded. "Restart to update" reloads into it,
 * "Later" waits for the next cold start. Also owns the throttled foreground re-check. Renders nothing when
 * updates are disabled (dev client, Expo Go, web).
 */
export function UpdateBanner() {
  const ota = useOtaUpdate();
  const { theme } = useUnistyles();
  const insets = useSafeAreaInsets();
  const [dismissed, setDismissed] = useState(false);
  useOtaForegroundCheck(ota.check);

  if (!OTA_ENABLED || ota.phase !== "ready" || dismissed) return null;

  return (
    <View pointerEvents="box-none" style={[styles.anchor, { paddingTop: insets.top + 8 }]}>
      <View accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.card}>
        <View style={styles.row}>
          <Ionicons name="refresh-circle" size={24} color={theme.colors.foreground} />
          <View style={styles.texts}>
            <Text style={styles.title}>Update ready</Text>
            <Text style={styles.body}>Restart to update</Text>
          </View>
        </View>
        <View style={styles.actions}>
          <Button variant="ghost" label="Later" onPress={() => setDismissed(true)} />
          <Button label="Restart to update" onPress={() => void ota.restart()} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  anchor: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 90,
    elevation: 90,
    paddingHorizontal: theme.spacing.lg,
  },
  card: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.hairline,
    padding: theme.spacing.md,
    gap: theme.spacing.md,
    shadowColor: "#000000",
    shadowOpacity: 0.14,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  row: { flexDirection: "row", alignItems: "center", gap: theme.spacing.md },
  texts: { flex: 1, gap: 2 },
  title: { fontSize: theme.fontSize.base, fontFamily: theme.fonts.bold },
  body: { fontSize: theme.fontSize.sm, color: theme.colors.mutedForeground },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: theme.spacing.sm },
}));
