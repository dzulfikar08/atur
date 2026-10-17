import { useEffect, useMemo, useState } from "react";
import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { format } from "date-fns";
import { toast } from "sonner";
import { useProjectNavStore } from "@/stores/projectNav";
import { api, apiFetch, type AllIssue, type State } from "@/lib/api";

export type TodayBucketKey =
  | "overdue"
  | "due_today"
  | "needs_you"
  | "need_review"
  | "in_progress"
  | "due_this_week";

export type TodayResponse = Record<TodayBucketKey, AllIssue[]> & {
  counts: Record<TodayBucketKey | "total", number>;
};

/** State rows from the states endpoint carry the canonical key too. */
export type KeyedState = State & { key?: string | null };

/** The user's local calendar date. The server buckets by this, not by UTC. */
export function localToday(): string {
  return format(new Date(), "yyyy-MM-dd");
}

export function useToday(slug: string | undefined) {
  const today = localToday();
  return useQuery({
    queryKey: ["today", slug, today],
    enabled: !!slug,
    staleTime: 30_000,
    queryFn: () => {
      const qs = new URLSearchParams({ today });
      if (slug && slug !== "all") qs.set("workspace", slug);
      return apiFetch<TodayResponse>(`/me/today/?${qs}`);
    },
  });
}

export function useProjectStates(
  slug: string | undefined,
  projectId: string | undefined,
) {
  return useQuery({
    queryKey: ["states", slug, projectId],
    enabled: !!slug && !!projectId,
    staleTime: 5 * 60_000,
    queryFn: () => api.listStates(slug!, projectId!) as Promise<KeyedState[]>,
  });
}

/** The project's "done" state: canonical key first, then the completed group. */
export function doneStateOf(states: KeyedState[]): KeyedState | undefined {
  return (
    states.find((s) => s.key === "done") ??
    states.find((s) => s.group === "completed")
  );
}

export interface IssuePatch {
  state_id?: string;
  priority?: string;
  start_date?: string | null;
  target_date?: string | null;
}

/** PATCH one issue wherever it lives (slug/project come from the row itself). */
export function useIssuePatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ issue, patch }: { issue: AllIssue; patch: IssuePatch }) =>
      apiFetch(
        `/workspaces/${issue.workspace_slug}/projects/${issue.project_id}/issues/${issue.sequence_id}/`,
        { method: "PATCH", body: JSON.stringify(patch) },
      ),
    onSettled: (_data, _err, { issue }) => {
      qc.invalidateQueries({ queryKey: ["today"] });
      qc.invalidateQueries({
        queryKey: ["issues", issue.workspace_slug, issue.project_id],
      });
    },
    onError: () => toast.error("Failed to update issue"),
  });
}

/** Debounced issue search for the command palette. */
export function useIssueSearch(
  raw: string,
  slug: string | undefined,
  enabled: boolean,
) {
  const [q, setQ] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQ(raw.trim()), 180);
    return () => clearTimeout(t);
  }, [raw]);
  const active = enabled && q.length >= 2;
  const query = useQuery({
    queryKey: ["issue-search", slug, q],
    enabled: active,
    staleTime: 15_000,
    queryFn: async () => {
      const qs = new URLSearchParams({
        q,
        limit: "8",
        sort: "updated_at:desc",
      });
      if (slug && slug !== "all") qs.set("workspace", slug);
      const res = await apiFetch<{ results: AllIssue[] }>(`/me/issues/?${qs}`);
      return res.results;
    },
  });
  return {
    results: active ? (query.data ?? []) : [],
    isSearching: active && query.isFetching,
  };
}

export function issueKey(
  issue: Pick<AllIssue, "project_identifier" | "sequence_id">,
): string {
  return issue.project_identifier
    ? `${issue.project_identifier}-${issue.sequence_id}`
    : `#${issue.sequence_id}`;
}

export function issueLink(issue: AllIssue): string {
  return `/${issue.workspace_slug}/projects/${issue.project_id}/issues/${issue.sequence_id}`;
}

/** Drop an issue from every cached Today response so a quick action feels instant. */
export function removeFromToday(qc: QueryClient, issueId: string) {
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

export const BUCKETS: TodayBucketKey[] = [
  "overdue",
  "due_today",
  "needs_you",
  "need_review",
  "in_progress",
  "due_this_week",
];

const NO_IDS: string[] = [];

/**
 * The workspace's projects in navigation order: pinned, then recently visited,
 * then the rest. `primary` is what "Go to project" and "New issue" target.
 * Sales pipelines are excluded: they are not where issues get worked.
 */
export function useNavProjects(slug: string | undefined, enabled = true) {
  const { data: all = [], isPending } = useQuery({
    queryKey: ["projects", slug],
    queryFn: () => api.listProjects(slug!),
    enabled: !!slug && slug !== "all" && enabled,
    staleTime: 60_000,
  });
  const pinnedIds =
    useProjectNavStore((s) => (slug ? s.pinned[slug] : undefined)) ?? NO_IDS;
  const recentIds =
    useProjectNavStore((s) => (slug ? s.recent[slug] : undefined)) ?? NO_IDS;

  return useMemo(() => {
    const projects = all.filter((p) => !p.is_pipeline);
    const byId = new Map(projects.map((p) => [p.id, p]));
    const pinned = pinnedIds.flatMap((id) => byId.get(id) ?? []);
    const recent = recentIds.flatMap((id) =>
      pinnedIds.includes(id) ? [] : (byId.get(id) ?? []),
    );
    const shown = new Set([...pinned, ...recent].map((p) => p.id));
    const rest = projects.filter((p) => !shown.has(p.id));
    return {
      pinned,
      recent,
      ordered: [...pinned, ...recent, ...rest],
      primary: pinned[0] ?? recent[0] ?? projects[0],
      isPending,
    };
  }, [all, pinnedIds, recentIds, isPending]);
}
