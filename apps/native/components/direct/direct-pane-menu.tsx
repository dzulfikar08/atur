import "@/unistyles";
import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { Button, ErrorNote, ListRow, Sheet, Text, type IconName } from "@/components/ui";

/**
 * The pane screen's ⋯ menu for a `direct:` pane: views, Select text and End session. The bridge's
 * split / close actions do not apply here, the session is not one of the bridge's panes.
 */
export function DirectPaneMenu({
  visible,
  title,
  views,
  current,
  onChoose,
  onSelectText,
  onEnd,
  onClose,
}: {
  visible: boolean;
  title: string;
  views: { value: string; label: string; icon: IconName }[];
  current: string;
  onChoose: (value: string) => void;
  onSelectText: () => void;
  /** Ends the session on the computer; the menu closes when it resolves. */
  onEnd: () => Promise<void>;
  onClose: () => void;
}) {
  const { theme } = useUnistyles();
  const [confirming, setConfirming] = useState(false);
  const [ending, setEnding] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const close = () => {
    if (ending) return;
    setConfirming(false);
    setError(null);
    onClose();
  };

  const end = async () => {
    setEnding(true);
    setError(null);
    try {
      await onEnd();
      setConfirming(false);
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setEnding(false);
    }
  };

  return (
    <Sheet visible={visible} title={confirming ? "End this session?" : title} onClose={close}>
      {confirming ? (
        <View style={styles.confirm}>
          <Text style={styles.confirmBody}>Anything running in it stops.</Text>
          <ErrorNote error={error} />
          <Button
            variant="destructive"
            label="End session"
            loading={ending}
            onPress={() => void end()}
          />
          <Button
            variant="secondary"
            label="Cancel"
            disabled={ending}
            onPress={() => setConfirming(false)}
          />
        </View>
      ) : (
        <View>
          {views.map((v) => (
            <ListRow
              key={v.value}
              icon={v.icon}
              title={`${v.label} view`}
              right={
                v.value === current ? (
                  <Ionicons name="checkmark" size={18} color={theme.colors.foreground} />
                ) : undefined
              }
              onPress={() => {
                onChoose(v.value);
                close();
              }}
            />
          ))}
          <ListRow
            icon="text-outline"
            title="Select text"
            onPress={() => {
              close();
              // After this sheet's modal is gone: iOS drops a modal opened over a dismissing one.
              setTimeout(onSelectText, 350);
            }}
          />
          <View style={styles.divider} />
          <ListRow
            icon="close-circle-outline"
            title="End session"
            destructive
            onPress={() => setConfirming(true)}
          />
        </View>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  confirm: { gap: theme.spacing.md, paddingBottom: theme.spacing.xs },
  confirmBody: { fontSize: theme.fontSize.sm, color: theme.colors.mutedForeground },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: theme.colors.hairline,
    marginVertical: theme.spacing.xs,
  },
}));
