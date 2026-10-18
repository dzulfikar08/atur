import "@/unistyles";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { Pressable, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

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
import { isPaneLive, paneIssueKey, paneTitle, shortCwd } from "@/lib/pane-meta";

function PaneRow({ pane }: { pane: PaneListItem }) {
  const live = isPaneLive(pane);
  const issue = paneIssueKey(pane);
  const where = [pane.workspace_label, shortCwd(pane.cwd)].filter(Boolean).join(" · ");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open pane ${pane.pane_id}, ${paneTitle(pane)}`}
      onPress={() => router.push({ pathname: "/pane/[paneId]", params: { paneId: pane.pane_id } })}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={[styles.dot, live ? styles.dotLive : styles.dotIdle]} />
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
      <Text style={[styles.status, live && styles.statusLive]}>
        {live ? "live" : (pane.agent_status ?? "idle")}
      </Text>
    </Pressable>
  );
}

export default function Panes() {
  const me = useQuery({ queryKey: ["me"], queryFn: api.me });
  const panes = useQuery({ queryKey: ["panes"], queryFn: api.panes, refetchInterval: 10_000 });
  const list = panes.data ?? [];
  const liveCount = list.filter(isPaneLive).length;
  const unreachable = panes.error instanceof ApiError && panes.error.status === 502;

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
        caption={panes.data ? `${liveCount} live · ${list.length} total` : undefined}
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
        <ListGroup>
          {list.map((pane) => (
            <PaneRow key={pane.pane_id} pane={pane} />
          ))}
        </ListGroup>
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
  dotLive: { backgroundColor: theme.colors.completed },
  dotIdle: { backgroundColor: theme.colors.cancelled },
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
  statusLive: { color: theme.colors.completed },
  errorCard: { padding: theme.spacing.lg, gap: theme.spacing.md },
}));
