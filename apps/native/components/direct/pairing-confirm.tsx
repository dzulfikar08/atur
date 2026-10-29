import "@/unistyles";
import { useCallback, useState } from "react";
import { Platform, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { Button, Input, Mono, Text } from "@/components/ui";
import { directManager } from "@/lib/direct";
import { describeDirectError } from "@/lib/direct/describe";
import { pairingLinkOf } from "@/lib/direct/pair-link";
import type { PairingTarget } from "@/modules/atur-direct/src/types";

/** A link read from the camera, pasted or opened from outside: checked by the core, waiting for the user's yes. */
export interface PendingPairing {
  link: string;
  target: PairingTarget;
}

export interface Pairing {
  /** The link the core accepted, waiting for Confirm. */
  pending: PendingPairing | null;
  deviceName: string;
  setDeviceName: (name: string) => void;
  /** Pairing is running. */
  pairing: boolean;
  /** One sentence for the last failure, null when there is none. */
  problem: string | null;
  setProblem: (problem: string | null) => void;
  /** Asks the core what `text` (a link, possibly wrapped) says; sets `pending` or `problem`. */
  review: (text: string) => Promise<void>;
  confirm: () => Promise<void>;
  cancel: () => void;
}

const defaultDeviceName = () => `Atur on ${Platform.OS}`;

/**
 * The pairing steps every entry point shares (the settings screen, the Direct area, a tapped
 * link): `review` asks the core what a link says, `confirm` pairs. Links are never logged and
 * never parsed here; the core does that.
 */
export function usePairing({ onPaired }: { onPaired?: () => void } = {}): Pairing {
  const [pending, setPending] = useState<PendingPairing | null>(null);
  const [deviceName, setDeviceName] = useState(defaultDeviceName);
  const [pairing, setPairing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const review = useCallback(async (text: string) => {
    setProblem(null);
    const link = pairingLinkOf(text);
    try {
      setPending({ link, target: await directManager.parsePairingLink(link) });
    } catch (error) {
      setPending(null);
      setProblem(describeDirectError(error));
    }
  }, []);

  const confirm = async () => {
    if (!pending) return;
    setPairing(true);
    setProblem(null);
    try {
      await directManager.pair(pending.link, deviceName.trim() || defaultDeviceName());
      setPending(null);
      onPaired?.();
    } catch (error) {
      setPending(null);
      setProblem(describeDirectError(error));
    } finally {
      setPairing(false);
    }
  };

  const cancel = () => {
    if (!pairing) setPending(null);
  };

  return {
    pending,
    deviceName,
    setDeviceName,
    pairing,
    problem,
    setProblem,
    review,
    confirm,
    cancel,
  };
}

/** The question shown before pairing: which computer, what name this phone gets, Confirm / Cancel. */
export function PairingConfirm({
  pairing,
  replaces,
}: {
  pairing: Pairing;
  /** A computer is paired already; pairing this one replaces it. */
  replaces: boolean;
}) {
  const { pending } = pairing;
  return (
    <View style={styles.form}>
      <Text style={styles.hint}>
        Make sure this is your computer. After pairing, this phone can open its terminals.
      </Text>
      <Mono>
        {pending?.target.hosts.map((host) => `${host}:${pending.target.port}`).join("\n")}
      </Mono>
      {replaces ? <Text style={styles.hint}>This replaces the computer paired now.</Text> : null}
      <Input
        label="Name of this phone"
        value={pairing.deviceName}
        onChangeText={pairing.setDeviceName}
        autoCorrect={false}
      />
      <Button label="Confirm" loading={pairing.pairing} onPress={() => void pairing.confirm()} />
      <Button
        variant="secondary"
        label="Cancel"
        disabled={pairing.pairing}
        onPress={pairing.cancel}
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  form: { gap: theme.spacing.md },
  hint: { fontSize: theme.fontSize.sm, color: theme.colors.mutedForeground },
}));
