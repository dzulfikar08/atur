import "@/unistyles";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { DirectSessionsSection } from "@/components/direct/direct-section";
import { PairingConfirm, usePairing } from "@/components/direct/pairing-confirm";
import { PairingScanner } from "@/components/direct/pairing-scanner";
import {
  Button,
  Chip,
  EmptyState,
  ErrorNote,
  Input,
  ListGroup,
  ListRow,
  Screen,
  SectionTitle,
  Sheet,
  Text,
} from "@/components/ui";
import { directManager } from "@/lib/direct";
import { DIRECT_STATE_LABEL, describeDirectError, describeFailure } from "@/lib/direct/describe";
import { openableSessions } from "@/lib/direct/session-meta";
import { useDirect } from "@/lib/direct/use-direct";
import { useSession } from "@/lib/session";
import type { EchoMode } from "@/modules/atur-direct/src/types";

const ECHO_MODES: { value: EchoMode; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "always", label: "Always" },
  { value: "never", label: "Never" },
];

/**
 * Settings of the direct path: pair with a computer running Atur Terminal (scan the code it
 * shows, or paste the link), see the connection, and choose how the app uses it. With `home` it
 * is also the Direct area for a phone without an Atur account: the computer's terminals are
 * listed here, and a row leads to sign-in.
 */
export function DirectSettings({ home = false }: { home?: boolean }) {
  const direct = useDirect();
  const supported = direct.state !== "unsupported";
  const paired = direct.state !== "unpaired" && supported;

  const account = useSession();
  const [scanning, setScanning] = useState(false);
  const [pasted, setPasted] = useState("");
  const pairing = usePairing({ onPaired: () => setPasted("") });
  const { problem, setProblem, review } = pairing;

  // How the core currently echoes typing; read from any open session, "auto" when none is open.
  const [echo, setEcho] = useState<EchoMode>("auto");
  const link = direct.connection;
  const probe = openableSessions(direct.sessions)[0]?.id;
  useEffect(() => {
    if (!link || !probe) return;
    let stale = false;
    link
      .echoStats(probe)
      .then((stats) => {
        if (!stale) setEcho(stats.mode);
      })
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, [link, probe]);

  const scanned = (data: string) => {
    setScanning(false);
    void review(data);
  };

  const chooseEcho = async (mode: EchoMode) => {
    if (!link) return;
    setEcho(mode);
    try {
      await link.setEchoMode(mode);
    } catch (error) {
      setProblem(describeDirectError(error));
    }
  };

  const confirmForget = () =>
    Alert.alert(
      "Forget this computer?",
      "This phone stops connecting to it directly. You can pair it again with a new code.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Forget", style: "destructive", onPress: () => void directManager.forget() },
      ],
    );

  if (!supported) {
    return (
      <Screen edges={["bottom"]}>
        <EmptyState
          icon="construct-outline"
          title="Not available in this build"
          body="Direct connection needs the Atur app from the store or a development build. It does not run in the browser or in an older build."
        />
      </Screen>
    );
  }

  return (
    <Screen edges={["bottom"]}>
      <SectionTitle title="Connection" />
      <ListGroup>
        <ListRow
          icon="swap-horizontal-outline"
          title={direct.serverName ?? "No computer paired"}
          subtitle={DIRECT_STATE_LABEL[direct.state]}
          value={
            direct.state === "connected" && direct.rttMs !== null ? `${direct.rttMs} ms` : undefined
          }
        />
        {paired && direct.state !== "connected" && direct.state !== "connecting" ? (
          <ListRow
            icon="refresh-outline"
            title="Connect now"
            chevron
            onPress={() => void directManager.connect()}
          />
        ) : null}
      </ListGroup>
      {direct.error && direct.state !== "connected" ? (
        <ErrorNote error={describeFailure(direct.error)} />
      ) : null}

      {home ? <DirectSessionsSection /> : null}

      <SectionTitle title={paired ? "Pair again" : "Pair a computer"} />
      {scanning ? (
        <PairingScanner onScanned={scanned} onCancel={() => setScanning(false)} />
      ) : (
        <View style={styles.form}>
          <Text style={styles.hint}>
            On your computer run atur-term mobile pair, then scan the code it shows.
          </Text>
          <Button
            icon="qr-code-outline"
            label="Scan pairing code"
            onPress={() => {
              setProblem(null);
              setScanning(true);
            }}
          />
          <Input
            label="Or paste the pairing link"
            value={pasted}
            onChangeText={setPasted}
            placeholder="Link from atur-term mobile pair"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="go"
            onSubmitEditing={() => void review(pasted)}
          />
          <Button
            variant="secondary"
            label="Check link"
            disabled={pasted.trim().length === 0}
            onPress={() => void review(pasted)}
          />
        </View>
      )}
      <ErrorNote error={problem} />

      {paired ? (
        <>
          <SectionTitle title="Use" />
          <ListGroup>
            <ListRow
              icon="flash-outline"
              title="Prefer direct connection"
              subtitle="Open terminals straight on your computer, and fall back to Atur Cloud"
              toggle={{
                value: direct.preferDirect,
                onChange: (next) => void directManager.setPreferDirect(next),
              }}
            />
          </ListGroup>

          <SectionTitle title="Local echo" />
          <View style={styles.chips}>
            {ECHO_MODES.map((mode) => (
              <Chip
                key={mode.value}
                label={mode.label}
                selected={echo === mode.value}
                onPress={() => void chooseEcho(mode.value)}
              />
            ))}
          </View>
          <Text style={styles.hint}>
            Shows what you type before the computer confirms it. Auto turns it on while the
            connection is slow.
            {link ? "" : " Connect to change it."}
          </Text>

          <ListGroup>
            <ListRow
              icon="trash-outline"
              title="Forget this computer"
              destructive
              onPress={confirmForget}
            />
          </ListGroup>
        </>
      ) : null}

      <Sheet
        visible={pairing.pending !== null}
        title="Pair with this computer?"
        onClose={pairing.cancel}
      >
        <PairingConfirm pairing={pairing} replaces={paired} />
      </Sheet>

      {home && account.status !== "authed" ? (
        <>
          <SectionTitle title="Atur Cloud" />
          <ListGroup>
            <ListRow
              icon="log-in-outline"
              title="Sign in to Atur Cloud"
              subtitle="Issues, inbox and terminals through the cloud"
              chevron
              onPress={() => router.push("/login")}
            />
          </ListGroup>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create((theme) => ({
  form: { gap: theme.spacing.md },
  chips: { flexDirection: "row", gap: theme.spacing.sm },
  hint: { fontSize: theme.fontSize.sm, color: theme.colors.mutedForeground },
}));
