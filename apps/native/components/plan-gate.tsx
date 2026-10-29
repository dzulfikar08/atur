import "@/unistyles";
import { useMutation, useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { Button, Screen, Text } from "@/components/ui";
import { api } from "@/lib/api";
import { disableAgentAlerts } from "@/lib/push";
import { endSession } from "@/lib/session";

// App Store 3.1.3(f) / Google Play payments policy: this screen must not carry
// purchase buttons, prices, or links to an external purchase flow. It only
// tells the user where the plan is managed.

/**
 * True when the signed-in account has no Atur Cloud plan. Only the account's own screens are held
 * back (the root layout swaps them for the plan screen); the Direct area never asks.
 */
export function usePlanBlocked(authed: boolean): boolean {
  const me = useQuery({ queryKey: ["me"], queryFn: api.me, enabled: authed });
  return authed && me.data?.billing?.entitled === false;
}

/** The plan screen: where the plan is managed, plus the way into Direct, which needs no plan. */
export function PlanRequired() {
  const me = useQuery({ queryKey: ["me"], queryFn: api.me });
  const email = me.data?.email ?? "";
  const signOut = useMutation({
    mutationFn: async () => {
      await disableAgentAlerts().catch(() => undefined);
      await api.signOut().catch(() => undefined);
    },
    onSettled: () => endSession(),
  });
  return (
    <Screen scroll={false}>
      <View style={styles.body}>
        <Text style={styles.title} accessibilityRole="header">
          Atur Cloud plan needed
        </Text>
        <Text style={styles.text}>
          This app works with a Solo or Team plan on your Atur Cloud account. You are signed in as{" "}
          {email}.
        </Text>
        <Text style={styles.text}>
          You can manage your plan at app.diatur.com from a web browser. Once it is active, come
          back and check again.
        </Text>
        <View style={styles.actions}>
          <Button label="Check again" onPress={() => void me.refetch()} loading={me.isFetching} />
          <Button
            label="Use Direct without a plan"
            variant="secondary"
            onPress={() => router.push("/direct-home")}
          />
          <Button
            label="Sign out"
            variant="secondary"
            onPress={() => signOut.mutate()}
            loading={signOut.isPending}
          />
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create((theme) => ({
  body: { flex: 1, justifyContent: "center", padding: 24, gap: 14 },
  title: { fontSize: 24, fontFamily: theme.fonts.bold, color: theme.colors.foreground },
  text: { fontSize: 15, lineHeight: 22, color: theme.colors.mutedForeground },
  actions: { marginTop: 10, gap: 10 },
}));
