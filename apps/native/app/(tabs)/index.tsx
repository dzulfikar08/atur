import "@/unistyles";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { TodaySkeleton } from "@/components/skeletons";
import { BUCKETS, TodayBucket, useTodayPatch } from "@/components/today";
import {
  Chip,
  EmptyState,
  ErrorNote,
  Fab,
  IconButton,
  ListGroup,
  ListRow,
  OptionSheet,
  PageHeader,
  PriorityIcon,
  Screen,
  SectionTitle,
  StateIcon,
  Text,
} from "@/components/ui";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";
import { api, type Issue, type TodayBucketKey } from "@/lib/api";
import { formatToday } from "@/lib/format";
import { compareStates, dateKey } from "@/lib/issue-query";
import { splitProduct } from "@/lib/product";
import { ALL, useCurrentWorkspace } from "@/lib/workspace";

/** Web Today home: the owner's "what do I do today" buckets from /api/me/today. */
export default function Today() {
  const { theme } = useUnistyles();
  const me = useQuery({ queryKey: ["me"], queryFn: api.me });
  const { slug } = useCurrentWorkspace();
  const scope = slug === ALL ? undefined : slug;
  // The server buckets by the device's local date, so it is part of the cache key.
  const todayKey = dateKey(new Date());

  const today = useQuery({
    queryKey: ["today", slug, todayKey],
    queryFn: () => api.today(todayKey, scope),
    staleTime: 30_000,
    enabled: me.data ? me.data.workspaces.length > 0 : false,
  });
  const overview = useQuery({
    queryKey: ["analytics-overview", slug],
    queryFn: () => api.analyticsOverview(scope),
    enabled: me.data ? me.data.workspaces.length > 0 : false,
  });
  const decisions = useQuery({ queryKey: ["decisions"], queryFn: api.decisions });
  const waiting = (decisions.data ?? []).filter((d) => slug === ALL || d.workspace_slug === slug);

  const [product, setProduct] = useState<string | null>(null);
  const [stateTarget, setStateTarget] = useState<Issue | null>(null);
  const patch = useTodayPatch();

  const stateOptions = useQuery({
    queryKey: ["states", stateTarget?.workspace_slug, stateTarget?.project_id],
    queryFn: () => api.states(stateTarget!.workspace_slug!, stateTarget!.project_id),
    enabled: stateTarget !== null,
    staleTime: 5 * 60_000,
  });

  const data = today.data;
  const productCounts = useMemo(() => {
    const counts = new Map<string, number>();
    if (data) {
      for (const key of BUCKETS) {
        for (const issue of data[key]) {
          const p = splitProduct(issue.name).product;
          if (p) counts.set(p, (counts.get(p) ?? 0) + 1);
        }
      }
    }
    return [...counts.entries()].sort(([a, an], [b, bn]) => bn - an || a.localeCompare(b));
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return null;
    const out = {} as Record<TodayBucketKey, Issue[]>;
    for (const key of BUCKETS) {
      out[key] = product
        ? data[key].filter((i) => splitProduct(i.name).product === product)
        : data[key];
    }
    return out;
  }, [data, product]);
  const total = filtered ? BUCKETS.reduce((n, k) => n + filtered[k].length, 0) : 0;

  const refreshing = today.isRefetching || decisions.isRefetching;
  const refresh = () => {
    void me.refetch();
    void today.refetch();
    void overview.refetch();
    void decisions.refetch();
  };

  const noWorkspaces = me.data && me.data.workspaces.length === 0;
  const stats = [
    {
      label: "Total",
      value: overview.data?.total_issues,
      icon: "layers-outline",
      color: theme.colors.started,
    },
    {
      label: "Open",
      value: overview.data?.open_issues,
      icon: "ellipse-outline",
      color: theme.colors.amber,
    },
    {
      label: "Done",
      value: overview.data?.closed_issues,
      icon: "checkmark-circle-outline",
      color: theme.colors.completed,
    },
    {
      label: "Overdue",
      value: data?.counts.overdue,
      icon: "alert-circle-outline",
      color: theme.colors.urgent,
    },
  ] as const;

  const loading = !noWorkspaces && (me.isPending || today.isPending);

  return (
    <View style={styles.flex}>
      <Screen refreshing={refreshing} onRefresh={refresh}>
        {noWorkspaces ? null : <WorkspaceSwitcher />}
        <PageHeader
          title="Today"
          caption={formatToday(new Date())}
          right={
            <IconButton
              icon="search"
              label="Search issues"
              onPress={() => router.push("/search")}
            />
          }
        />
        <ErrorNote error={me.error ?? today.error} />

        {noWorkspaces ? (
          <EmptyState
            icon="briefcase-outline"
            title="No workspaces yet"
            body="Create a workspace on app.diatur.com, then pull to refresh."
          />
        ) : (
          <>
            <View style={styles.tiles}>
              {stats.map((s) => (
                <View key={s.label} style={styles.tile}>
                  <View style={[styles.tileIcon, { backgroundColor: `${s.color}1F` }]}>
                    <Ionicons name={s.icon} size={17} color={s.color} />
                  </View>
                  <View>
                    <Text style={styles.tileValue}>{s.value ?? "–"}</Text>
                    <Text style={styles.tileLabel}>{s.label}</Text>
                  </View>
                </View>
              ))}
            </View>

            <Pressable
              accessibilityRole="button"
              onPress={() => router.push("/my-issues")}
              style={({ pressed }) => [styles.myIssues, pressed && styles.pressed]}
            >
              <View style={styles.flex}>
                <Text style={styles.myIssuesTitle}>My issues</Text>
                <Text style={styles.myIssuesHint}>Filter, group and open saved views</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={theme.colors.mutedForeground} />
            </Pressable>

            {productCounts.length > 0 ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.chips}
                style={styles.chipStrip}
              >
                <Chip label="All" selected={!product} onPress={() => setProduct(null)} />
                {productCounts.map(([name, n]) => (
                  <Chip
                    key={name}
                    label={`${name} ${n}`}
                    selected={product === name}
                    onPress={() => setProduct(product === name ? null : name)}
                  />
                ))}
              </ScrollView>
            ) : null}

            {loading ? (
              <TodaySkeleton />
            ) : total === 0 ? (
              <EmptyState
                icon="sunny-outline"
                title="Nothing scheduled for today"
                body="Issues assigned to you with a start or target date show up here."
                action={{ label: "Open My Issues", onPress: () => router.push("/my-issues") }}
              />
            ) : (
              BUCKETS.map((k) => (
                <TodayBucket
                  key={k}
                  bucket={k}
                  issues={filtered![k]}
                  onPickState={setStateTarget}
                />
              ))
            )}

            {waiting.length > 0 ? (
              <>
                <SectionTitle
                  title="Decisions waiting"
                  right={<Text style={styles.count}>{waiting.length}</Text>}
                />
                <ListGroup>
                  {waiting.slice(0, 5).map((d) => (
                    <ListRow
                      key={d.id}
                      left={<PriorityIcon priority={d.priority} />}
                      title={d.name}
                      subtitle={`${d.project_identifier}-${d.sequence_id} · ${d.project_name}`}
                      chevron
                      onPress={() =>
                        router.push({
                          pathname: "/issue/[slug]/[projectId]/[issueId]",
                          params: {
                            slug: d.workspace_slug,
                            projectId: d.project_id,
                            issueId: d.id,
                          },
                        })
                      }
                    />
                  ))}
                </ListGroup>
              </>
            ) : null}
          </>
        )}
      </Screen>
      {noWorkspaces ? null : (
        <Fab icon="add" label="New issue" onPress={() => router.push("/new-issue")} />
      )}

      <OptionSheet
        visible={stateTarget !== null}
        title="Move to"
        onClose={() => setStateTarget(null)}
        options={[...(stateOptions.data ?? [])].sort(compareStates).map((s) => ({
          key: s.id,
          label: s.name,
          selected: s.id === stateTarget?.state_id,
          left: <StateIcon state={s} />,
        }))}
        onSelect={(id) =>
          stateTarget && patch.mutate({ issue: stateTarget, patch: { state_id: id } })
        }
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  flex: { flex: 1 },
  pressed: { opacity: 0.6 },
  count: {
    fontSize: theme.fontSize.xs,
    fontFamily: theme.fonts.bold,
    color: theme.colors.mutedForeground,
  },
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.sm },
  tile: {
    width: "48.5%",
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    padding: theme.spacing.md,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.hairline,
    backgroundColor: theme.colors.surfaceElevated,
  },
  tileIcon: {
    width: 34,
    height: 34,
    borderRadius: theme.radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  tileValue: { fontSize: theme.fontSize.lg, fontFamily: theme.fonts.heavy, lineHeight: 22 },
  tileLabel: { fontSize: 10, color: theme.colors.mutedForeground },
  myIssues: {
    flexDirection: "row",
    alignItems: "center",
    padding: theme.spacing.md,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.hairline,
    backgroundColor: theme.colors.surfaceElevated,
  },
  myIssuesTitle: { fontSize: theme.fontSize.base, fontFamily: theme.fonts.bold },
  myIssuesHint: { fontSize: theme.fontSize.xs, color: theme.colors.mutedForeground, marginTop: 1 },
  chipStrip: { marginHorizontal: -theme.spacing.lg, flexGrow: 0 },
  chips: { gap: theme.spacing.sm, paddingHorizontal: theme.spacing.lg },
}));
