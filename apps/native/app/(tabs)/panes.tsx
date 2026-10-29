import "@/unistyles";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { router, useIsFocused } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { AgentAlertsCard } from "@/components/agent-alerts";
import { DirectSessionsSection } from "@/components/direct/direct-section";
import { usePaneActions } from "@/components/pane-actions";
import { usePaneCreate } from "@/components/pane-create";
import { RowListSkeleton } from "@/components/skeletons";
import {
  Avatar,
  Button,
  Card,
  Chip,
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
import { activeWorkspace, filterByWorkspace, workspaceChips } from "@/lib/pane-workspaces";
import {
  loadPaneWorkspace,
  loadShellsOpen,
  savePaneWorkspace,
  saveShellsOpen,
} from "@/lib/terminal-prefs";

function openPane(pane: PaneListItem) {
  router.push({ pathname: "/pane/[paneId]", params: { paneId: pane.pane_id } });
}

function PaneRow({
  pane,
  logo,
  workspaceName,
  onLongPress,
  onClose,
}: {
  pane: PaneListItem;
  /** The bound Atur workspace's logo and name, when known. */
  logo: string | null;
  workspaceName: string;
  onLongPress: () => void;
  onClose: () => void;
}) {
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
      accessibilityHint="Long press to split or close"
      onPress={() => openPane(pane)}
      onLongPress={onLongPress}
      delayLongPress={350}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      {/* The project at a glance; the corner dot keeps the state colour. */}
      <View>
        <Avatar name={workspaceName} uri={logo} size={32} square />
        <View style={[styles.statusDot, { backgroundColor: dot }]} />
      </View>
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
      {/* Quick close: confirms in a sheet, no need to open the pane. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Close pane ${pane.pane_id}`}
        hitSlop={10}
        onPress={onClose}
        style={({ pressed }) => [styles.close, pressed && styles.pressed]}
      >
        <Ionicons name="close" size={18} color={theme.colors.mutedForeground} />
      </Pressable>
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
  const all = panes.data;
  // Atur workspace per slug, for each row's logo.
  const workspaces = new Map((me.data?.workspaces ?? []).map((w) => [w.slug, w]));
  const rowProps = (pane: PaneListItem) => {
    const ws = pane.workspace_slug ? workspaces.get(pane.workspace_slug) : undefined;
    return {
      pane,
      logo: ws?.logo ?? null,
      workspaceName: ws?.name ?? pane.machine?.name ?? pane.workspace_label ?? "?",
      onLongPress: () => openActions(pane),
      onClose: () => quickClose(pane),
    };
  };
  const unreachable = panes.error instanceof ApiError && panes.error.status === 502;

  // The workspace filter is remembered across launches. A workspace that has no
  // panes any more falls back to All without forgetting the choice.
  const [savedWorkspace, setSavedWorkspace] = useState<string | null>(null);
  useEffect(() => {
    void loadPaneWorkspace().then(setSavedWorkspace);
  }, []);
  const chips = useMemo(() => workspaceChips(all ?? []), [all]);
  const workspace = activeWorkspace(chips, savedWorkspace);
  const selectWorkspace = (key: string | null) => {
    setSavedWorkspace(key);
    void savePaneWorkspace(key);
  };

  const list = useMemo(() => filterByWorkspace(all ?? [], workspace), [all, workspace]);
  const { agents, shells } = useMemo(() => {
    const sorted = sortPanesByAttention(list);
    return {
      agents: sorted.filter((p) => paneAttention(p) !== "shell"),
      shells: sorted.filter((p) => paneAttention(p) === "shell"),
    };
  }, [list]);

  const [shellsOpen, setShellsOpen] = useState(false);
  useEffect(() => {
    void loadShellsOpen().then(setShellsOpen);
  }, []);
  const toggleShells = () => {
    setShellsOpen(!shellsOpen);
    void saveShellsOpen(!shellsOpen);
  };

  const actions = usePaneActions();
  const create = usePaneCreate({
    panes: all ?? [],
    selected: workspace,
    selectedLabel: chips.find((chip) => chip.key === workspace)?.label ?? null,
    onWorkspaceCreated: selectWorkspace,
  });
  const ref = (pane: PaneListItem) => ({ pane_id: pane.pane_id, title: paneTitle(pane) });
  const openActions = (pane: PaneListItem) => actions.open(ref(pane));
  const quickClose = (pane: PaneListItem) => actions.confirmClose(ref(pane));

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
        caption={all ? paneSummary(list) : undefined}
        right={
          <View style={styles.headerActions}>
            {/* Owner-only: the server refuses everyone else (403), so don't offer it. */}
            {me.data?.is_superuser ? (
              <IconButton
                icon="desktop-outline"
                label="Open desktop screen"
                onPress={() => router.push("/screen")}
              />
            ) : null}
            <IconButton icon="add" label="New pane or workspace" onPress={create.open} />
          </View>
        }
      />

      {chips.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
          style={styles.chipStrip}
          accessibilityLabel="Workspaces"
        >
          <Chip label="All" selected={workspace === null} onPress={() => selectWorkspace(null)} />
          {chips.map((chip) => (
            <Chip
              key={chip.key}
              label={chip.label}
              selected={workspace === chip.key}
              onPress={() => selectWorkspace(chip.key)}
            />
          ))}
        </ScrollView>
      ) : null}

      <AgentAlertsCard />
      <DirectSessionsSection />

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
          action={{ label: "New workspace", onPress: create.open }}
        />
      ) : (
        <>
          {agents.length > 0 ? (
            <ListGroup>
              {agents.map((pane) => (
                <PaneRow key={pane.pane_id} {...rowProps(pane)} />
              ))}
            </ListGroup>
          ) : null}
          {shells.length > 0 ? (
            <ListGroup>
              <ShellsHeader count={shells.length} open={shellsOpen} onToggle={toggleShells} />
              {shellsOpen
                ? shells.map((pane) => <PaneRow key={pane.pane_id} {...rowProps(pane)} />)
                : null}
            </ListGroup>
          ) : null}
        </>
      )}
      {actions.sheet}
      {create.sheet}
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
  statusDot: {
    position: "absolute",
    right: -3,
    bottom: -3,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: theme.colors.card,
  },
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
  close: {
    width: 32,
    height: 32,
    marginRight: -6,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  shellsTitle: {
    flex: 1,
    fontSize: theme.fontSize.sm,
    fontFamily: theme.fonts.medium,
    color: theme.colors.mutedForeground,
  },
  errorCard: { padding: theme.spacing.lg, gap: theme.spacing.md },
  headerActions: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm },
  chipStrip: { marginHorizontal: -theme.spacing.lg, flexGrow: 0 },
  chips: { gap: theme.spacing.sm, paddingHorizontal: theme.spacing.lg },
}));
