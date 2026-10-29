import "@/unistyles";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { PairingConfirm, usePairing } from "@/components/direct/pairing-confirm";
import { usePlanBlocked } from "@/components/plan-gate";
import { Button, EmptyState, ErrorNote, Screen, SectionTitle, Text } from "@/components/ui";
import { useDirect } from "@/lib/direct/use-direct";
import { useSession } from "@/lib/session";

/**
 * A tapped pairing link (`atur://pair?...`, routed here by `+native-intent.tsx` as `?link=`).
 * The core checks the link; the user sees which computer it names and confirms before anything
 * is paired. Works signed out and signed in; the link is never logged.
 */
export default function PairLink() {
  const { link } = useLocalSearchParams<{ link?: string }>();
  const direct = useDirect();
  const account = useSession();
  const planBlocked = usePlanBlocked(account.status === "authed");
  const destination = account.status === "authed" && !planBlocked ? "/panes" : "/direct-home";
  const pairing = usePairing({ onPaired: () => router.replace(destination) });
  const { review, pending, problem } = pairing;

  useEffect(() => {
    void review(link ?? "");
  }, [link, review]);

  const leave = () => (router.canGoBack() ? router.back() : router.replace(destination));

  if (direct.state === "unsupported") {
    return (
      <Screen edges={["bottom"]}>
        <EmptyState
          icon="construct-outline"
          title="Not available in this build"
          body="Direct connection needs the Atur app from the store or a development build."
          action={{ label: "Close", onPress: leave }}
        />
      </Screen>
    );
  }

  return (
    <Screen edges={["bottom"]}>
      {pending ? (
        <>
          <SectionTitle title="Pair with this computer?" />
          <PairingConfirm
            pairing={{ ...pairing, cancel: leave }}
            replaces={direct.loaded && direct.state !== "unpaired"}
          />
        </>
      ) : problem ? (
        <View style={styles.form}>
          <SectionTitle title="Pairing link" />
          <ErrorNote error={problem} />
          <Button label="Close" onPress={leave} />
        </View>
      ) : (
        <Text style={styles.hint}>Checking the pairing link…</Text>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create((theme) => ({
  form: { gap: theme.spacing.md },
  hint: { fontSize: theme.fontSize.sm, color: theme.colors.mutedForeground },
}));
