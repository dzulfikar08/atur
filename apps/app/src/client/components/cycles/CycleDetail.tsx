import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { CalendarDays, Plus, X, ArrowLeft, ListChecks, Inbox, BarChart3 } from "@/lib/icons";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  Legend,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import { apiFetch, api } from "@/lib/api";
import type { Issue, State } from "@/lib/api";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

interface Cycle {
  id: string;
  name: string;
  description: string | null;
  start_date: string | null;
  end_date: string | null;
  project: string;
  workspace: string;
  total_issues: number;
  completed_issues: number;
}

interface CycleIssue {
  id: string;
  issue: string;
}

interface CycleDetailProps {
  slug: string;
  projectId: string;
  cycleId: string;
  onBack: () => void;
}

function IssueRow({
  issue,
  stateLookup,
  inCycle,
  onToggle,
  isPending,
}: {
  issue: Issue;
  stateLookup: Map<string, State>;
  inCycle: boolean;
  onToggle: () => void;
  isPending: boolean;
}) {
  const state = issue.state_id ? stateLookup.get(issue.state_id) : null;

  return (
    <div className="flex items-center justify-between gap-2 sm:gap-3 rounded-lg border px-3 py-2 transition-colors hover:bg-muted/30">
      <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
        <span className="text-xs text-muted-foreground font-mono shrink-0">
          {String(issue.sequence_id).padStart(4, "0")}
        </span>
        <span className="text-sm truncate">{issue.name}</span>
        {state && (
          <Badge variant="secondary" className="text-xs shrink-0 hidden sm:inline-flex">
            {state.name}
          </Badge>
        )}
        {issue.priority && issue.priority !== "none" && (
          <span
            className="priority-text hidden shrink-0 text-xs font-medium uppercase sm:inline"
            data-priority={issue.priority}
          >
            {issue.priority}
          </span>
        )}
      </div>
      <Button
        variant={inCycle ? "ghost" : "outline"}
        size="sm"
        className={cn("shrink-0 h-7 text-xs", inCycle && "text-destructive hover:text-destructive")}
        onClick={onToggle}
        disabled={isPending}
      >
        {inCycle ? (
          <>
            <X className="h-3 w-3 mr-1" /> Remove
          </>
        ) : (
          <>
            <Plus className="h-3 w-3 mr-1" /> Add
          </>
        )}
      </Button>
    </div>
  );
}

const STATE_GROUP_COLORS: Record<string, string> = {
  backlog: "var(--state-backlog)",
  unstarted: "var(--state-unstarted)",
  started: "var(--state-started)",
  completed: "var(--state-completed)",
  cancelled: "var(--state-cancelled)",
};

const STATE_GROUP_LABELS: Record<string, string> = {
  backlog: "Backlog",
  unstarted: "Todo",
  started: "In Progress",
  completed: "Done",
  cancelled: "Cancelled",
};

function SectionSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-lg border px-3 py-2">
          <Skeleton className="h-3 w-10" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-6 w-16" />
        </div>
      ))}
    </div>
  );
}

export default function CycleDetail({ slug, projectId, cycleId, onBack }: CycleDetailProps) {
  const qc = useQueryClient();
  const [backlogFilter, setBacklogFilter] = useState("");

  const { data: cycle, isLoading: cycleLoading } = useQuery({
    queryKey: ["cycle", slug, projectId, cycleId],
    queryFn: () => apiFetch<Cycle>(`/workspaces/${slug}/projects/${projectId}/cycles/${cycleId}/`),
    enabled: !!slug && !!projectId && !!cycleId,
  });

  const { data: cycleIssues = [], isLoading: ciLoading } = useQuery({
    queryKey: ["cycle-issues", slug, projectId, cycleId],
    queryFn: () =>
      apiFetch<{ results: CycleIssue[] }>(
        `/workspaces/${slug}/projects/${projectId}/cycles/${cycleId}/cycle-issues/`,
      ).then((d) => d.results),
    enabled: !!slug && !!projectId && !!cycleId,
  });

  const { data: allIssues = [], isLoading: issuesLoading } = useQuery({
    queryKey: ["issues", slug, projectId],
    queryFn: () => api.listIssues(slug, projectId),
    enabled: !!slug && !!projectId,
  });

  const { data: states = [] } = useQuery({
    queryKey: ["states", slug, projectId],
    queryFn: () => api.listStates(slug, projectId),
    enabled: !!slug && !!projectId,
  });

  const stateLookup = useMemo(() => {
    const map = new Map<string, State>();
    for (const s of states) {
      map.set(s.id, s);
    }
    return map;
  }, [states]);

  const completedStateIds = useMemo(() => {
    const ids = new Set<string>();
    for (const s of states) {
      if (s.group === "completed") ids.add(s.id);
    }
    return ids;
  }, [states]);

  const cycleIssueIds = useMemo(() => new Set(cycleIssues.map((ci) => ci.issue)), [cycleIssues]);

  const inSprintIssues = useMemo(
    () => allIssues.filter((i) => cycleIssueIds.has(i.id)),
    [allIssues, cycleIssueIds],
  );

  const backlogIssues = useMemo(() => {
    const filtered = allIssues.filter((i) => !cycleIssueIds.has(i.id));
    if (!backlogFilter.trim()) return filtered;
    const q = backlogFilter.toLowerCase();
    return filtered.filter(
      (i) => i.name.toLowerCase().includes(q) || String(i.sequence_id).includes(q),
    );
  }, [allIssues, cycleIssueIds, backlogFilter]);

  const total = cycle?.total_issues ?? inSprintIssues.length;
  const completed =
    cycle?.completed_issues ??
    inSprintIssues.filter((i) => i.state_id && completedStateIds.has(i.state_id)).length;
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

  // State distribution for pie chart
  const stateDistribution = useMemo(() => {
    const groups: Record<string, number> = {};
    for (const issue of inSprintIssues) {
      const sid = issue.state_id;
      const group = sid ? (stateLookup.get(sid)?.group ?? "backlog") : "backlog";
      groups[group] = (groups[group] ?? 0) + 1;
    }
    return Object.entries(groups)
      .map(([group, count]) => ({
        name: STATE_GROUP_LABELS[group] ?? group,
        value: count,
        color: STATE_GROUP_COLORS[group] ?? "var(--state-backlog)",
      }))
      .sort((a, b) => b.value - a.value);
  }, [inSprintIssues, stateLookup]);

  // Priority breakdown for bar chart
  const priorityBreakdown = useMemo(() => {
    const order = ["urgent", "high", "medium", "low", "none"];
    const labels: Record<string, string> = {
      urgent: "Urgent",
      high: "High",
      medium: "Medium",
      low: "Low",
      none: "No priority",
    };
    const counts: Record<string, number> = {};
    for (const issue of inSprintIssues) {
      const p = issue.priority ?? "none";
      counts[p] = (counts[p] ?? 0) + 1;
    }
    return order.filter((p) => counts[p]).map((p) => ({ name: labels[p], count: counts[p] }));
  }, [inSprintIssues]);

  const addMutation = useMutation({
    mutationFn: (issueId: string) =>
      apiFetch(`/workspaces/${slug}/projects/${projectId}/cycles/${cycleId}/issues/`, {
        method: "POST",
        body: JSON.stringify({ issue: issueId }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ["cycle-issues", slug, projectId, cycleId],
      });
      qc.invalidateQueries({
        queryKey: ["cycle", slug, projectId, cycleId],
      });
      toast.success("Issue added to sprint");
    },
    onError: () => toast.error("Failed to add issue"),
  });

  const removeMutation = useMutation({
    mutationFn: (issueId: string) =>
      apiFetch(`/workspaces/${slug}/projects/${projectId}/cycles/${cycleId}/issues/`, {
        method: "DELETE",
        body: JSON.stringify({ issue: issueId }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ["cycle-issues", slug, projectId, cycleId],
      });
      qc.invalidateQueries({
        queryKey: ["cycle", slug, projectId, cycleId],
      });
      toast.success("Issue removed from sprint");
    },
    onError: () => toast.error("Failed to remove issue"),
  });

  const isLoading = cycleLoading || ciLoading || issuesLoading;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b px-4 md:px-6 py-4">
        <div className="flex items-center gap-3 mb-3">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          {cycleLoading ? (
            <Skeleton className="h-6 w-48" />
          ) : (
            <h1 className="text-lg font-semibold">{cycle?.name ?? "Cycle"}</h1>
          )}
        </div>

        {cycle && (
          <div className="ml-0 sm:ml-11 space-y-3">
            {/* Dates */}
            {cycle.start_date && cycle.end_date && (
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <CalendarDays className="h-4 w-4" />
                <span>
                  {format(parseISO(cycle.start_date), "MMM d, yyyy")} -{" "}
                  {format(parseISO(cycle.end_date), "MMM d, yyyy")}
                </span>
              </div>
            )}

            {/* Description */}
            {cycle.description && (
              <p className="text-sm text-muted-foreground">{cycle.description}</p>
            )}

            {/* Progress bar */}
            <div className="space-y-1.5">
              <div className="h-2 w-full max-w-md rounded-full bg-muted">
                <div
                  className="h-2 rounded-full transition-all"
                  style={{
                    width: `${Math.min(percent, 100)}%`,
                    background:
                      percent >= 100
                        ? "var(--state-completed)"
                        : percent >= 50
                          ? "var(--state-started)"
                          : "var(--state-review)",
                  }}
                />
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span>
                  {completed}/{total} issues completed
                </span>
                <span className="font-medium text-foreground">{percent}%</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto px-4 md:px-6 py-4 space-y-6">
        {/* Analytics */}
        {inSprintIssues.length > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-3">
              <BarChart3 className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-semibold">Analytics</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* State Distribution Pie */}
              <div className="rounded-lg border p-4">
                <h3 className="text-xs font-medium text-muted-foreground mb-2">
                  State Distribution
                </h3>
                {stateDistribution.length > 0 ? (
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie
                        data={stateDistribution}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={70}
                        innerRadius={40}
                        paddingAngle={2}
                      >
                        {stateDistribution.map((entry, i) => (
                          <Cell key={i} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{
                          fontSize: 12,
                          borderRadius: 8,
                          border: "1px solid hsl(var(--border))",
                        }}
                      />
                      <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-xs text-muted-foreground text-center py-8">No data</p>
                )}
              </div>

              {/* Priority Breakdown Bar */}
              <div className="rounded-lg border p-4">
                <h3 className="text-xs font-medium text-muted-foreground mb-2">
                  Priority Breakdown
                </h3>
                {priorityBreakdown.length > 0 ? (
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart
                      data={priorityBreakdown}
                      margin={{ top: 4, right: 4, bottom: 4, left: -12 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                      <Tooltip
                        contentStyle={{
                          fontSize: 12,
                          borderRadius: 8,
                          border: "1px solid hsl(var(--border))",
                        }}
                      />
                      <Bar dataKey="count" fill="#6366f1" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-xs text-muted-foreground text-center py-8">No data</p>
                )}
              </div>
            </div>

            {/* Stats summary */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
              {stateDistribution.map((s) => (
                <div key={s.name} className="rounded-lg border p-3 text-center">
                  <div className="text-xl font-bold" style={{ color: s.color }}>
                    {s.value}
                  </div>
                  <div className="text-xs text-muted-foreground">{s.name}</div>
                </div>
              ))}
            </div>
          </section>
        )}

        <Separator />

        {/* In Sprint */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <ListChecks className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold">In Sprint</h2>
            <Badge variant="secondary" className="text-xs">
              {inSprintIssues.length}
            </Badge>
          </div>
          {isLoading ? (
            <SectionSkeleton />
          ) : inSprintIssues.length === 0 ? (
            <div className="rounded-lg border border-dashed py-8 text-center">
              <p className="text-sm text-muted-foreground">No issues in this sprint yet.</p>
              <p className="text-xs text-muted-foreground mt-1">
                Add issues from the backlog below.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {inSprintIssues.map((issue) => (
                <IssueRow
                  key={issue.id}
                  issue={issue}
                  stateLookup={stateLookup}
                  inCycle
                  onToggle={() => removeMutation.mutate(issue.id)}
                  isPending={removeMutation.isPending}
                />
              ))}
            </div>
          )}
        </section>

        <Separator />

        {/* Backlog */}
        <section>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-2">
              <Inbox className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">Backlog</h2>
              <Badge variant="secondary" className="text-xs">
                {backlogIssues.length}
              </Badge>
            </div>
            <input
              type="text"
              placeholder="Filter issues..."
              value={backlogFilter}
              onChange={(e) => setBacklogFilter(e.target.value)}
              className="h-8 w-full sm:w-56 rounded-md border border-input bg-background px-3 text-xs ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          {isLoading ? (
            <SectionSkeleton />
          ) : backlogIssues.length === 0 ? (
            <div className="rounded-lg border border-dashed py-8 text-center">
              <p className="text-sm text-muted-foreground">
                {backlogFilter.trim()
                  ? "No issues match your filter."
                  : "All project issues are in this sprint."}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {backlogIssues.map((issue) => (
                <IssueRow
                  key={issue.id}
                  issue={issue}
                  stateLookup={stateLookup}
                  inCycle={false}
                  onToggle={() => addMutation.mutate(issue.id)}
                  isPending={addMutation.isPending}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
