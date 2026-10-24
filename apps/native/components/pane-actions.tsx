import "@/unistyles";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useState, type ReactNode } from "react";
import { View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { Button, ErrorNote, ListRow, Sheet, Text, type IconName } from "@/components/ui";
import { api, type SplitDirection } from "@/lib/api";

export interface PaneRef {
  pane_id: string;
  title: string;
}

/** Optional view switcher shown at the top of the sheet (the pane screen's ⋯ menu). */
export interface PaneViewChoice {
  options: { value: string; label: string; icon: IconName }[];
  current: string;
  onChoose: (value: string) => void;
}

export function openPaneScreen(paneId: string) {
  router.push({ pathname: "/pane/[paneId]", params: { paneId } });
}

/**
 * Split / close actions for one pane, as a bottom sheet (long-press on a list
 * row, the pane screen's menu). Close confirms inside the sheet: an Alert
 * raised while a Modal is still dismissing is dropped on iOS. A split opens the
 * new pane; `onClosed` runs after a close (the pane screen uses it to leave).
 */
export function usePaneActions({ onClosed }: { onClosed?: () => void } = {}): {
  open: (pane: PaneRef, views?: PaneViewChoice) => void;
  /** Straight to the close confirmation (the list's quick × button). */
  confirmClose: (pane: PaneRef) => void;
  sheet: ReactNode;
} {
  const qc = useQueryClient();
  const { theme } = useUnistyles();
  const [target, setTarget] = useState<PaneRef | null>(null);
  const [views, setViews] = useState<PaneViewChoice | null>(null);
  const [confirming, setConfirming] = useState(false);

  const split = useMutation({
    mutationFn: (v: { pane: PaneRef; direction: SplitDirection }) =>
      api.splitPane(v.pane.pane_id, v.direction),
    onSuccess: (created) => {
      void qc.invalidateQueries({ queryKey: ["panes"] });
      dismiss();
      openPaneScreen(created.pane_id);
    },
  });
  const close = useMutation({
    mutationFn: (pane: PaneRef) => api.closePane(pane.pane_id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["panes"] });
      dismiss();
      onClosed?.();
    },
  });

  function dismiss() {
    setTarget(null);
    setConfirming(false);
    split.reset();
    close.reset();
  }

  const busy = split.isPending || close.isPending;
  const error = split.error ?? close.error;

  const sheet = (
    <Sheet
      visible={target !== null}
      title={confirming ? "Close this pane?" : (target?.title ?? "Pane")}
      onClose={() => {
        if (!busy) dismiss();
      }}
    >
      {target && confirming ? (
        <View style={styles.confirm}>
          <Text style={styles.confirmBody}>Anything running in it stops.</Text>
          <ErrorNote error={error} />
          <Button
            variant="destructive"
            label="Close pane"
            loading={close.isPending}
            onPress={() => close.mutate(target)}
          />
          <Button
            variant="secondary"
            label="Cancel"
            disabled={busy}
            onPress={() => setConfirming(false)}
          />
        </View>
      ) : target ? (
        <View>
          {views
            ? views.options.map((v) => {
                const on = v.value === views.current;
                return (
                  <ListRow
                    key={v.value}
                    icon={v.icon}
                    title={`${v.label} view`}
                    right={
                      on ? (
                        <Ionicons name="checkmark" size={18} color={theme.colors.foreground} />
                      ) : undefined
                    }
                    onPress={() => {
                      views.onChoose(v.value);
                      dismiss();
                    }}
                  />
                );
              })
            : null}
          {views ? <View style={styles.divider} /> : null}
          <ListRow
            icon="arrow-forward-outline"
            title="Split right"
            subtitle="New pane beside this one, same folder"
            onPress={() => split.mutate({ pane: target, direction: "right" })}
          />
          <ListRow
            icon="arrow-down-outline"
            title="Split down"
            subtitle="New pane below this one, same folder"
            onPress={() => split.mutate({ pane: target, direction: "down" })}
          />
          <ListRow
            icon="close-circle-outline"
            title="Close pane"
            destructive
            onPress={() => setConfirming(true)}
          />
          {split.isPending ? <Text style={styles.confirmBody}>Splitting…</Text> : null}
          <ErrorNote error={error} />
        </View>
      ) : null}
    </Sheet>
  );

  return {
    open: (pane, viewChoice) => {
      split.reset();
      close.reset();
      setConfirming(false);
      setViews(viewChoice ?? null);
      setTarget(pane);
    },
    confirmClose: (pane) => {
      split.reset();
      close.reset();
      setViews(null);
      setConfirming(true);
      setTarget(pane);
    },
    sheet,
  };
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
