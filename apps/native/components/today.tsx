import { Ionicons } from "@expo/vector-icons";
import { type QueryClient, useMutation, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { ProductChip, StateBadge, Text } from "@/components/ui";
import {
  api,
  type Issue,
  type IssuePatch,
  type TodayBucketKey,
  type TodayResponse,
} from "@/lib/api";
import { dueLabel } from "@/lib/format";
import { dateKey } from "@/lib/issue-query";
import { splitProduct } from "@/lib/product";
import { priorityColor, type Palette } from "@/theme";

export const BUCKETS: TodayBucketKey[] = [
  "overdue",
  "due_today",
  "needs_you",
  "need_review",
  "in_progress",
  "due_this_week",
];

/** Bucket label + hint, as the web's BUCKET_META. */
export const BUCKET_META: Record<
  TodayBucketKey,
  { label: string; hint: string; color: (c: Palette) => string }
> = {
  overdue: { label: "Overdue", hint: "Past target date", color: (c) => c.urgent },
  due_today: { label: "Due today", hint: "Target is today", color: (c) => c.amber },
  needs_you: { label: "Needs You", hint: "Waiting on you", color: (c) => c.needsYou },
  need_review: { label: "Need Review", hint: "Ready for review", color: (c) => c.review },
  in_progress: {
    label: "In progress today",
    hint: "Started, not yet due",
    color: (c) => c.started,
  },
  due_this_week: { label: "Upcoming 7 days", hint: "Due within a week", color: (c) => c.backlog },
};

const PREVIEW_ROWS = 8;

/** Drop an issue from every cached Today response so a quick action feels instant. */
function removeFromToday(qc: QueryClient, issueId: string) {
  qc.setQueriesData<TodayResponse>({ queryKey: ["today"] }, (old) => {
    if (!old) return old;
    const next = { ...old, counts: { ...old.counts } };
    for (const key of BUCKETS) {
      const kept = old[key].filter((i) => i.id !== issueId);
      if (kept.length !== old[key].length) {
        next[key] = kept;
        next.counts[key] = kept.length;
        next.counts.total--;
      }
    }
    return next;
  });
}

/** PATCH one issue wherever it lives (workspace + project come from the row itself). */
export function useTodayPatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ issue, patch }: { issue: Issue; patch: IssuePatch }) =>
      api.updateIssue(issue.workspace_slug!, issue.project_id, issue.id, patch),
    onMutate: ({ issue }) => removeFromToday(qc, issue.id),
    onSettled: (_data, _err, { issue }) => {
      void qc.invalidateQueries({ queryKey: ["today"] });
      void qc.invalidateQueries({ queryKey: ["my-issues"] });
      void qc.invalidateQueries({ queryKey: ["analytics-overview"] });
      void qc.invalidateQueries({
        queryKey: ["project-issues", issue.workspace_slug, issue.project_id],
      });
      void qc.invalidateQueries({
        queryKey: ["issue", issue.workspace_slug, issue.project_id, issue.id],
      });
    },
  });
}

/** The project's "done" state: canonical key first, then the completed group. */
export async function doneStateOf(qc: QueryClient, issue: Issue) {
  const states = await qc.fetchQuery({
    queryKey: ["states", issue.workspace_slug, issue.project_id],
    queryFn: () => api.states(issue.workspace_slug!, issue.project_id),
    staleTime: 5 * 60_000,
  });
  return states.find((s) => s.key === "done") ?? states.find((s) => s.group === "completed");
}

function TodayRow({
  issue,
  now,
  onPickState,
  onDone,
  onSnooze,
}: {
  issue: Issue;
  now: Date;
  onPickState: (issue: Issue) => void;
  onDone: (issue: Issue) => void;
  onSnooze: (issue: Issue) => void;
}) {
  const { theme } = useUnistyles();
  const { product, title } = splitProduct(issue.name);
  const due = dueLabel(issue.target_date, now);
  const key = issue.project_identifier
    ? `${issue.project_identifier}-${issue.sequence_id}`
    : `#${issue.sequence_id}`;

  return (
    <View style={styles.row}>
      <View style={styles.rowMain}>
        <View
          accessibilityLabel={`Priority: ${issue.priority ?? "none"}`}
          style={[
            styles.priorityDot,
            { backgroundColor: priorityColor(theme.colors, issue.priority) },
          ]}
        />
        <View style={styles.rowBody}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${key} ${issue.name}`}
            onPress={() =>
              router.push({
                pathname: "/issue/[slug]/[projectId]/[issueId]",
                params: {
                  slug: issue.workspace_slug!,
                  projectId: issue.project_id,
                  issueId: issue.id,
                },
              })
            }
            style={({ pressed }) => [styles.titleLine, pressed && styles.pressed]}
          >
            {product ? <ProductChip product={product} /> : null}
            <Text style={styles.title} numberOfLines={2}>
              {title}
            </Text>
          </Pressable>
          <View style={styles.metaLine}>
            <Text style={styles.key}>{key}</Text>
            {due ? (
              <Text
                style={[
                  styles.due,
                  due.late && { color: theme.colors.urgent, fontFamily: theme.fonts.bold },
                ]}
              >
                {due.text}
              </Text>
            ) : null}
            <StateBadge
              state={issue.state}
              name={issue.state?.name}
              compact
              onPress={() => onPickState(issue)}
            />
          </View>
        </View>
      </View>
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Mark done"
          onPress={() => onDone(issue)}
          hitSlop={4}
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}
        >
          <Ionicons name="checkmark" size={20} color={theme.colors.completed} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Snooze to tomorrow"
          onPress={() => onSnooze(issue)}
          hitSlop={4}
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}
        >
          <Ionicons name="arrow-forward" size={19} color={theme.colors.mutedForeground} />
        </Pressable>
      </View>
    </View>
  );
}

/** One collapsible Today section (Overdue, Due today, Needs You, …). */
export function TodayBucket({
  bucket,
  issues,
  onPickState,
}: {
  bucket: TodayBucketKey;
  issues: Issue[];
  onPickState: (issue: Issue) => void;
}) {
  const { theme } = useUnistyles();
  const qc = useQueryClient();
  const patch = useTodayPatch();
  const [open, setOpen] = useState(true);
  const [all, setAll] = useState(false);
  const now = useMemo(() => new Date(), []);
  if (issues.length === 0) return null;

  const meta = BUCKET_META[bucket];
  const tint = meta.color(theme.colors);
  const rows = all ? issues : issues.slice(0, PREVIEW_ROWS);

  const snooze = (issue: Issue) => {
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    patch.mutate({ issue, patch: { target_date: dateKey(tomorrow) } });
  };
  const done = async (issue: Issue) => {
    const state = await doneStateOf(qc, issue).catch(() => undefined);
    if (state) patch.mutate({ issue, patch: { state_id: state.id } });
  };

  return (
    <View style={styles.card}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((o) => !o)}
        style={styles.head}
      >
        <Ionicons
          name={open ? "chevron-down" : "chevron-forward"}
          size={14}
          color={theme.colors.mutedForeground}
        />
        <View style={[styles.headDot, { backgroundColor: tint }]} />
        <Text style={styles.headLabel}>{meta.label}</Text>
        <View style={[styles.countPill, { backgroundColor: `${tint}24` }]}>
          <Text style={[styles.countText, { color: tint }]}>{issues.length}</Text>
        </View>
        <Text style={styles.hint} numberOfLines={1}>
          {meta.hint}
        </Text>
      </Pressable>
      {open ? (
        <View>
          {rows.map((issue) => (
            <TodayRow
              key={issue.id}
              issue={issue}
              now={now}
              onPickState={onPickState}
              onDone={(i) => void done(i)}
              onSnooze={snooze}
            />
          ))}
          {issues.length > PREVIEW_ROWS ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => setAll((a) => !a)}
              style={({ pressed }) => [styles.more, pressed && styles.pressed]}
            >
              <Text style={styles.moreText}>
                {all ? "Show fewer" : `Show ${issues.length - PREVIEW_ROWS} more`}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  pressed: { opacity: 0.6 },
  card: {
    backgroundColor: theme.colors.surfaceElevated,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.hairline,
    overflow: "hidden",
  },
  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.md,
  },
  headDot: { width: 8, height: 8, borderRadius: 4 },
  headLabel: { fontSize: theme.fontSize.base, fontFamily: theme.fonts.bold },
  countPill: { borderRadius: theme.radius.pill, paddingHorizontal: 7, paddingVertical: 1 },
  countText: { fontSize: theme.fontSize.xs, fontFamily: theme.fonts.bold },
  hint: {
    flex: 1,
    fontSize: theme.fontSize.xs,
    color: theme.colors.mutedForeground,
    textAlign: "right",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: theme.colors.hairline,
  },
  rowMain: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing.md,
    paddingLeft: theme.spacing.md,
    paddingVertical: theme.spacing.md,
  },
  priorityDot: { width: 8, height: 8, borderRadius: 4, marginTop: 7 },
  rowBody: { flex: 1, gap: 6 },
  titleLine: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing.sm,
    flexWrap: "wrap",
  },
  title: {
    flexShrink: 1,
    fontSize: theme.fontSize.base,
    fontFamily: theme.fonts.medium,
    lineHeight: 21,
  },
  metaLine: { flexDirection: "row", alignItems: "center", gap: theme.spacing.sm, flexWrap: "wrap" },
  key: {
    fontSize: theme.fontSize.xs,
    fontFamily: theme.fonts.mono,
    color: theme.colors.mutedForeground,
  },
  due: { fontSize: theme.fontSize.xs, color: theme.colors.mutedForeground },
  actions: { flexDirection: "row", paddingHorizontal: theme.spacing.xs },
  action: { width: 38, height: 44, alignItems: "center", justifyContent: "center" },
  more: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.hairline,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.md,
  },
  moreText: {
    fontSize: theme.fontSize.sm,
    fontFamily: theme.fonts.medium,
    color: theme.colors.mutedForeground,
  },
}));
