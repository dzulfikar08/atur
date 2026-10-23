import "@/unistyles";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { router, useIsFocused } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { AgentAlertsCard } from "@/components/agent-alerts";
import { RowListSkeleton } from "@/components/skeletons";
import {
  Button,
  Card,
  EmptyState,
  IconButton,
  ListGroup,
  Mono,
  PageHeader,
  Screen,
  Text,
} from "@/components/ui";
import { api, ApiError, type PaneListItem } from "@/lib/api";
import {
  ATTENTION_LABEL,
  paneAttention,
  paneIssueKey,
  paneSummary,
  paneTitle,
  shortCwd,
  sortPanesByAttention,
} from "@/lib/pane-meta";
import { loadShellsOpen, saveShellsOpen } from "@/lib/terminal-prefs";

function openPane(pane: PaneListItem) {
  router.push({ pathname: "/pane/[paneId]", params: { paneId: pane.pane_id } });
}

function PaneRow({ pane }: { pane: PaneListItem }) {
  const { theme } = useUnistyles();
  const attention = paneAttention(pane);
  const issue = paneIssueKey(pane);
  const where = [pane.workspace_label, shortCwd(pane.cwd)].filter(Boolean).join(" · ");
  const dot = {
    "needs-you": theme.colors.urgent,
    done: theme.colors.completed,
    working: theme.colors.started,
    idle: theme.colors.cancelled,
    shell: theme.colors.cancelled,
  }[attention];
  const status = attention === "shell" ? null : ATTENTION_LABEL[attention];
  const loud = attention === "needs-you" || attention === "done" || attention === "working";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open pane ${pane.pane_id}, ${paneTitle(pane)}${status ? `, ${status}` : ""}`}
      onPress={() => openPane(pane)}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={[styles.dot, { backgroundColor: dot }]} />
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={1}>
          {paneTitle(pane)}
        </Text>
        <Mono numberOfLines={1}>{[pane.pane_id, where].filter(Boolean).join(" · ")}</Mono>
        {issue ? (
          <View style={styles.issue}>
            <Mono style={styles.issueText}>{issue}</Mono>
          </View>
        ) : null}
      </View>
      {status ? <Text style={[styles.status, loud && { color: dot }]}>{status}</Text> : null}
    </Pressable>
  );
}

function ShellsHeader({
  count,
  open,
  onToggle,
}: {
  count: number;
  open: boolean;
  onToggle: () => void;
}) {
  const { theme } = useUnistyles();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Shells, ${count}`}
      accessibilityHint={open ? "Collapse the shell list" : "Expand the shell list"}
      accessibilityState={{ expanded: open }}
      onPress={onToggle}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <Ionicons name="terminal-outline" size={16} color={theme.colors.mutedForeground} />
      <Text style={styles.shellsTitle}>Shells ({count})</Text>
      <Ionicons
        name={open ? "chevron-up" : "chevron-down"}
        size={16}
        color={theme.colors.mutedForeground}
      />
    </Pressable>
  );
}

export default function Panes() {
  const focused = useIsFocused();
  const me = useQuery({ queryKey: ["me"], queryFn: api.me });
  const panes = useQuery({
    queryKey: ["panes"],
    queryFn: api.panes,
    // The tab layout keeps the badge fresh at 10 s; poll faster while on screen.
    refetchInterval: focused ? 5_000 : false,
  });
  const list = panes.data ?? [];
  const { agents, shells } = useMemo(() => {
    const sorted = sortPanesByAttention(panes.data ?? []);
    return {
      agents: sorted.filter((p) => paneAttention(p) !== "shell"),
      shells: sorted.filter((p) => paneAttention(p) === "shell"),
    };
  }, [panes.data]);
  const unreachable = panes.error instanceof ApiError && panes.error.status === 502;

  const [shellsOpen, setShellsOpen] = useState(false);
  useEffect(() => {
    void loadShellsOpen().then(setShellsOpen);
  }, []);
  const toggleShells = () => {
    setShellsOpen(!shellsOpen);
    void saveShellsOpen(!shellsOpen);
  };

  return (
    <Screen
      refreshing={panes.isRefetching}
      onRefresh={() => {
        void me.refetch();
        void panes.refetch();
      }}
    >
      <PageHeader
        title="Panes"
        caption={panes.data ? paneSummary(list) : undefined}
        right={
          // Owner-only: the server refuses everyone else (403), so don't offer it.
          me.data?.is_superuser ? (
            <IconButton
              icon="desktop-outline"
              label="Open desktop screen"
              onPress={() => router.push("/screen")}
            />
          ) : undefined
        }
      />

      <AgentAlertsCard />

      {panes.isPending ? (
        <RowListSkeleton />
      ) : panes.isError ? (
        <Card style={styles.errorCard}>
          <EmptyState
            icon="cloud-offline-outline"
            title={unreachable ? "Execution plane unreachable" : "Couldn't load panes"}
            body={
              unreachable
                ? "The herdr bridge on the dev box isn't answering. Make sure the bridge daemon is running."
                : panes.error.message
            }
          />
          <Button variant="secondary" label="Retry" onPress={() => void panes.refetch()} />
        </Card>
      ) : list.length === 0 ? (
        <EmptyState
          icon="terminal-outline"
          title="No panes online"
          body="Panes appear here once the execution plane has open terminals in your workspaces."
        />
      ) : (
        <>
          {agents.length > 0 ? (
            <ListGroup>
              {agents.map((pane) => (
                <PaneRow key={pane.pane_id} pane={pane} />
              ))}
            </ListGroup>
          ) : null}
          {shells.length > 0 ? (
            <ListGroup>
              <ShellsHeader count={shells.length} open={shellsOpen} onToggle={toggleShells} />
              {shellsOpen ? shells.map((pane) => <PaneRow key={pane.pane_id} pane={pane} />) : null}
            </ListGroup>
          ) : null}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
  },
  pressed: { backgroundColor: theme.colors.surfaceHover },
  dot: { width: 9, height: 9, borderRadius: 5 },
  body: { flex: 1, gap: 2 },
  title: { fontSize: theme.fontSize.base, fontFamily: theme.fonts.bold },
  issue: {
    alignSelf: "flex-start",
    marginTop: 3,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.muted,
  },
  issueText: { fontSize: 11 },
  status: {
    fontSize: theme.fontSize.xs,
    fontFamily: theme.fonts.mono,
    color: theme.colors.mutedForeground,
  },
  shellsTitle: {
    flex: 1,
    fontSize: theme.fontSize.sm,
    fontFamily: theme.fonts.medium,
    color: theme.colors.mutedForeground,
  },
  errorCard: { padding: theme.spacing.lg, gap: theme.spacing.md },
}));
