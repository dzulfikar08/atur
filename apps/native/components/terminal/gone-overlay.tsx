import { router } from "expo-router";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { Button, Text } from "@/components/ui";

/** Shown over a terminal whose pane exited or whose bridge could not be reached. */
export function GoneOverlay({ exited, onRetry }: { exited: boolean; onRetry: () => void }) {
  return (
    <View style={styles.gone}>
      <Text style={styles.title}>{exited ? "Pane exited" : "Execution plane unreachable"}</Text>
      <Text style={styles.body}>
        {exited
          ? "The terminal pane closed on the execution plane."
          : "Gave up after several attempts — the bridge may be offline."}
      </Text>
      <Button variant="secondary" label="Reconnect" onPress={onRetry} />
      <Button variant="ghost" label="Back to panes" onPress={() => router.back()} />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  gone: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing.sm,
    padding: theme.spacing.xl,
    backgroundColor: "rgba(0,0,0,0.85)",
  },
  title: { fontSize: theme.fontSize.md, fontFamily: theme.fonts.bold, color: "#fafafa" },
  body: { fontSize: theme.fontSize.sm, color: "#a3a3a3", textAlign: "center" },
}));
