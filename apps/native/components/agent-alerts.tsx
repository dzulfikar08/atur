import "@/unistyles";
import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Alert, Linking, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { Button, Card, Text } from "@/components/ui";
import {
  disableAgentAlerts,
  enableAgentAlerts,
  useAgentAlertsPrompt,
  type AlertsResult,
} from "@/lib/push";
import { useAgentAlertsEnabled } from "@/lib/push-state";

function explain(result: AlertsResult) {
  if (result.status === "denied") {
    Alert.alert(
      "Notifications are off",
      "Allow notifications for Atur in Settings to hear when an agent finishes or needs you.",
      [
        { text: "Not now", style: "cancel" },
        { text: "Open Settings", onPress: () => void Linking.openSettings() },
      ],
    );
  } else if (result.status === "unavailable") {
    Alert.alert("Couldn't turn on alerts", result.reason);
  }
}

/** Agent alerts state plus the actions behind every control that flips it. */
export function useAgentAlertsControl() {
  const enabled = useAgentAlertsEnabled();
  const [busy, setBusy] = useState(false);

  const set = async (next: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      if (next) explain(await enableAgentAlerts());
      else await disableAgentAlerts();
    } finally {
      setBusy(false);
    }
  };

  return { enabled: enabled === true, loaded: enabled !== null, busy, set };
}

/** One-time nudge at the top of the Panes tab; gone once alerts are on. */
export function AgentAlertsCard() {
  const { theme } = useUnistyles();
  const show = useAgentAlertsPrompt();
  const { busy, set } = useAgentAlertsControl();
  if (!show) return null;

  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <Ionicons name="notifications-outline" size={18} color={theme.colors.foreground} />
        <Text style={styles.text}>Get a notification when an agent finishes or needs you</Text>
      </View>
      <Button label="Turn on alerts" loading={busy} onPress={() => void set(true)} />
    </Card>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: { padding: theme.spacing.md, gap: theme.spacing.md },
  head: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm },
  text: { flex: 1, fontSize: theme.fontSize.sm, fontFamily: theme.fonts.medium },
}));
