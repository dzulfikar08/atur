import "@/unistyles";
import { useEffect, useState } from "react";
import { Alert, Platform, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { PairingScanner } from "@/components/direct/pairing-scanner";
import {
  Button,
  Chip,
  EmptyState,
  ErrorNote,
  Input,
  ListGroup,
  ListRow,
  Mono,
  Screen,
  SectionTitle,
  Sheet,
  Text,
} from "@/components/ui";
import { directManager } from "@/lib/direct";
import { DIRECT_STATE_LABEL, describeDirectError, describeFailure } from "@/lib/direct/describe";
import { openableSessions } from "@/lib/direct/session-meta";
import { useDirect } from "@/lib/direct/use-direct";
import type { EchoMode, PairingTarget } from "@/modules/atur-direct/src/types";

const ECHO_MODES: { value: EchoMode; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "always", label: "Always" },
  { value: "never", label: "Never" },
];

/** A link read from the camera or pasted, checked by the core and waiting for the user's yes. */
interface PendingPairing {
  link: string;
  target: PairingTarget;
}

/**
 * Settings of the direct path: pair with a computer running Atur Terminal (scan the code it
 * shows, or paste the link), see the connection, and choose how the app uses it.
 */
export default function DirectSettings() {
  const direct = useDirect();
  const supported = direct.state !== "unsupported";
  const paired = direct.state !== "unpaired" && supported;

  const [scanning, setScanning] = useState(false);
  const [pasted, setPasted] = useState("");
  const [pending, setPending] = useState<PendingPairing | null>(null);
  const [deviceName, setDeviceName] = useState(`Atur on ${Platform.OS}`);
  const [pairing, setPairing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

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

  const review = async (text: string) => {
    setProblem(null);
    const trimmed = text.trim();
    try {
      setPending({ link: trimmed, target: await directManager.parsePairingLink(trimmed) });
    } catch (error) {
      setProblem(describeDirectError(error));
    }
  };

  const scanned = (data: string) => {
    setScanning(false);
    void review(data);
  };

  const closePending = () => {
    if (!pairing) setPending(null);
  };

  const confirmPairing = async () => {
    if (!pending) return;
    setPairing(true);
    setProblem(null);
    try {
      await directManager.pair(pending.link, deviceName.trim() || `Atur on ${Platform.OS}`);
      setPending(null);
      setPasted("");
    } catch (error) {
      setPending(null);
      setProblem(describeDirectError(error));
    } finally {
      setPairing(false);
    }
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

      <Sheet visible={pending !== null} title="Pair with this computer?" onClose={closePending}>
        <View style={styles.form}>
          <Text style={styles.hint}>
            Make sure this is your computer. After pairing, this phone can open its terminals.
          </Text>
          <Mono>
            {pending?.target.hosts.map((host) => `${host}:${pending.target.port}`).join("\n")}
          </Mono>
          {paired ? <Text style={styles.hint}>This replaces the computer paired now.</Text> : null}
          <Input
            label="Name of this phone"
            value={deviceName}
            onChangeText={setDeviceName}
            autoCorrect={false}
          />
          <Button label="Pair" loading={pairing} onPress={() => void confirmPairing()} />
          <Button variant="secondary" label="Cancel" disabled={pairing} onPress={closePending} />
        </View>
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create((theme) => ({
  form: { gap: theme.spacing.md },
  chips: { flexDirection: "row", gap: theme.spacing.sm },
  hint: { fontSize: theme.fontSize.sm, color: theme.colors.mutedForeground },
}));
