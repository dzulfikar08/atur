import { router, Stack } from "expo-router";

import { EmptyState, Screen } from "@/components/ui";

export default function NotFound() {
  return (
    <Screen>
      <Stack.Screen options={{ title: "Not found" }} />
      <EmptyState
        icon="help-buoy-outline"
        title="This screen doesn't exist"
        action={{ label: "Go home", onPress: () => router.replace("/") }}
      />
    </Screen>
  );
}
