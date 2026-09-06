import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { format, isValid } from "date-fns";
import { Bot, CheckCircle2, ChevronRight, Eye } from "@/lib/icons";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type AllIssue, type PaneListItem } from "@/lib/api";
import { useWorkspaceStore } from "@/stores/workspace";
import { cn } from "@/lib/utils";

// ── Ops-console visual language (see /tmp/pen-final/SPEC.md) ──
// Panel shells sit on --surface-elevated with the theme border; state colors
// always come from the --state-* tokens so light mode stays coherent.

const PANEL = "rounded-[14px] border border-border bg-[var(--surface-elevated)] overflow-hidden";

const TONE_DOT = {
  green: "bg-[var(--state-green)]",
  amber: "bg-[var(--state-amber)]",
  blue: "bg-[var(--state-blue)]",
  gray: "bg-muted-foreground/60",
} as const;
const TONE_TEXT = {
  green: "text-[var(--state-green)]",
  amber: "text-[var(--state-amber)]",
  blue: "text-[var(--state-blue)]",
  gray: "text-muted-foreground/70",
} as const;

type Tone = keyof typeof TONE_DOT;

/** Green = working, amber = blocked / needs attention, gray = everything else.
 *  Mirrors the status families PanesPage badges, mapped onto the design's
 *  two-color scheme with a quiet fallback for unknown statuses. */
function paneStatus(status: string | null): { tone: Tone; label: string } {
  const s = (status ?? "").trim().toLowerCase();
  if (s === "running" || s === "working" || s === "active") {
    return { tone: "green", label: "working" };
  }
  if (s === "blocked" || s === "waiting" || s === "input_required" || s === "needs_input") {
    return { tone: "amber", label: "blocked" };
  }
  if (s === "error" || s === "exited" || s === "dead") {
    return { tone: "amber", label: "needs you" };
  }
  return { tone: "gray", label: s === "" ? "idle" : s };
}

/** Amber states: an explicit need_review / needs_you canonical state, or any
 *  state whose name mentions review. The canonical key is derived server-side
 *  (services/states.ts), so key equality is the reliable signal. */
function isNeedReview(issue: AllIssue): boolean {
  if (issue.state?.key === "need_review" || issue.state?.key === "needs_you") return true;
  return /review/i.test(issue.state?.name ?? "");
}

/** Everything a dashboard row renders: mono key, detail link, state tone and
 *  meta line — derived once per issue and shared by the rail and My day. */
function issueView(issue: AllIssue): {
  key: string;
  link: string;
  dot: string;
  label: string;
  meta: string;
} {
  const state = issue.state;
  let tone: Tone = "gray";
  let label = state?.name || "Backlog";
  if (isNeedReview(issue)) {
    tone = "amber";
    label = state?.name || "Needs review";
  } else if (state?.key === "done" || state?.group === "completed") {
    tone = "green";
    label = state.name || "Done";
  } else if (state?.key === "in_progress" || state?.group === "started") {
    tone = "blue";
    label = state.name || "In progress";
  }

  const due = issue.target_date ? new Date(issue.target_date) : null;
  const meta = due && isValid(due) ? `${label} · due ${format(due, "MMM d")}` : label;

  return {
    key: issue.project_identifier
      ? `${issue.project_identifier}-${issue.sequence_id}`
      : `#${issue.sequence_id}`,
    link: `/${issue.workspace_slug}/projects/${issue.project_id}/issues/${issue.sequence_id}`,
    dot: TONE_DOT[tone],
    label,
    meta,
  };
}

function toISODate(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
}

function formatHours(totalSeconds: number): string {
  return `${(totalSeconds / 3600).toFixed(1)}h`;
}

// ── Agents on shift ──

function AgentRow({ pane }: { pane: PaneListItem }) {
  const status = paneStatus(pane.agent_status);
  const name = pane.agent || pane.workspace_label || pane.pane_id;
  const context = pane.title || pane.cwd;
  return (
    <div className="flex items-center gap-3.5 border-t border-border px-5 py-[15px] first:border-t-0">
      <div className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[9px] border border-border bg-[var(--surface-card-hover)]">
        <Bot className={cn("h-[17px] w-[17px]", TONE_TEXT[status.tone])} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="max-w-40 shrink-0 truncate text-[13.5px] font-bold text-foreground">
            {name}
          </span>
          {context && <span className="truncate text-[13px] text-muted-foreground">{context}</span>}
          {/* PaneListItem carries no timestamp — render the design's unknown-time dash. */}
          <span className="ml-1 shrink-0 font-ops-mono text-[12.5px] text-muted-foreground/70">
            —
          </span>
        </div>
        <div className="mt-[3px] flex items-center gap-1.5">
          <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", TONE_DOT[status.tone])} />
          <span
            className={cn("truncate font-ops-mono text-xs font-semibold", TONE_TEXT[status.tone])}
          >
            {status.label} · {pane.workspace_label}
          </span>
        </div>
      </div>
      <Link
        to={`/panes/${encodeURIComponent(pane.pane_id)}`}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-[var(--surface-card)] px-3 py-[7px] text-[12.5px] font-semibold text-muted-foreground transition-colors hover:bg-[var(--surface-card-hover)] hover:text-foreground"
      >
        <Eye className="h-[13px] w-[13px]" />
        Watch
      </Link>
    </div>
  );
}

function AgentsPanel() {
  const panesQuery = useQuery({
    queryKey: ["panes"],
    queryFn: api.listPanes,
    refetchInterval: 10_000,
  });
  const panes = panesQuery.data?.panes ?? [];

  return (
    <section className={PANEL}>
      <div className="flex items-center justify-between gap-2.5 border-b border-border px-5 py-4">
        <h2 className="text-[15px] font-bold text-foreground">Agents on shift</h2>
        <span className="font-ops-mono text-[12.5px] text-muted-foreground/70">
          {panes.length} live {panes.length === 1 ? "pane" : "panes"}
        </span>
      </div>
      {panesQuery.isPending ? (
        Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="border-t border-border px-5 py-[15px] first:border-t-0">
            <Skeleton className="h-[34px] w-full" />
          </div>
        ))
      ) : panes.length === 0 ? (
        // Error and empty resolve the same way: keep the shell, hide the content.
        <p className="px-5 py-6 text-[13px] text-muted-foreground">
          No live panes right now. Agents appear here while they work.
        </p>
      ) : (
        panes.map((pane) => <AgentRow key={pane.pane_id} pane={pane} />)
      )}
    </section>
  );
}

// ── Needs your review ──

function ReviewCard({ issue }: { issue: AllIssue }) {
  const view = issueView(issue);
  const meta = `${issue.project_name || issue.workspace_name} · ${view.label}`;
  return (
    <div className="flex flex-col gap-2 border-t border-[var(--state-amber)] px-[18px] py-3.5 first:border-t-0">
      <div className="flex min-w-0 items-center gap-2">
        <span className="shrink-0 font-ops-mono text-[11.5px] font-bold tracking-[0.4px] text-[var(--state-amber)]">
          {view.key}
        </span>
        <span className="truncate text-[13.5px] font-bold text-foreground">{issue.name}</span>
      </div>
      <p className="text-xs leading-[18px] text-muted-foreground">{meta}</p>
      <div>
        <Link
          to={view.link}
          className="inline-flex rounded-lg bg-[var(--state-amber)] px-[13px] py-[7px] text-xs font-bold text-zinc-950 transition-opacity hover:opacity-90"
        >
          Review issue
        </Link>
      </div>
    </div>
  );
}

function ReviewPanel({ cards }: { cards: AllIssue[] }) {
  return (
    <section className="rounded-[14px] border border-[var(--state-amber)] bg-[var(--state-amber-soft)]">
      <div className="flex items-center gap-2 border-b border-[var(--state-amber)] px-[18px] py-3.5">
        <CheckCircle2 className="h-[15px] w-[15px] text-[var(--state-amber)]" />
        <h2 className="text-sm font-bold text-[var(--state-amber)]">Needs your review</h2>
        <span className="flex-1" />
        <span className="rounded-full bg-zinc-950 px-2 py-0.5 font-ops-mono text-[11.5px] font-bold text-[var(--state-amber)]">
          {cards.length}
        </span>
      </div>
      {cards.map((issue) => (
        <ReviewCard key={issue.id} issue={issue} />
      ))}
    </section>
  );
}

// ── My day ──

function MyDayPanel({ issues, isPending }: { issues: AllIssue[]; isPending: boolean }) {
  const rows = issues.slice(0, 6);
  return (
    <section className={PANEL}>
      <div className="border-b border-border px-5 py-4">
        <h2 className="text-[15px] font-bold text-foreground">My day</h2>
      </div>
      {isPending
        ? Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="border-t border-border px-5 py-[13px] first:border-t-0">
              <Skeleton className="h-9 w-full" />
            </div>
          ))
        : rows.map((issue) => {
            const view = issueView(issue);
            return (
              <Link
                key={issue.id}
                to={view.link}
                className="flex items-center gap-3 border-t border-border px-5 py-[13px] transition-colors first:border-t-0 hover:bg-[var(--surface-card-hover)]"
              >
                <span className={cn("h-2 w-2 shrink-0 rounded-full", view.dot)} />
                <span className="shrink-0 font-ops-mono text-xs font-bold tracking-[0.4px] text-muted-foreground/70">
                  {view.key}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-semibold text-foreground">
                    {issue.name}
                  </span>
                  <span className="block truncate text-[11.5px] text-muted-foreground/70">
                    {view.meta}
                  </span>
                </span>
                <ChevronRight className="h-[15px] w-[15px] shrink-0 text-muted-foreground/70" />
              </Link>
            );
          })}
      {!isPending && rows.length === 0 && (
        <p className="px-5 py-6 text-[13px] text-muted-foreground">
          No issues yet. Create one to get going.
        </p>
      )}
    </section>
  );
}

// ── This week ──

function ThisWeekCard({ slug, isAll }: { slug: string; isAll: boolean }) {
  const weekFrom = toISODate(6);
  const today = toISODate(0);

  const trendQuery = useQuery({
    queryKey: ["dashboard-completion-trend", slug],
    queryFn: () => (isAll ? api.allCompletionTrend() : api.completionTrend(slug)),
  });
  // Agent usage and the timesheet are workspace-scoped endpoints — no
  // cross-workspace equivalent exists, so those rows are simply absent in
  // "All Workspaces" rather than showing made-up numbers.
  const agentUsageQuery = useQuery({
    queryKey: ["dashboard-agent-usage", slug, weekFrom],
    queryFn: () => api.listAgentUsage(slug, { from: weekFrom, to: today }),
    enabled: !isAll,
  });
  const timesheetQuery = useQuery({
    queryKey: ["dashboard-timesheet", slug, weekFrom],
    queryFn: () => api.listTimesheet(slug, { from: weekFrom, to: today }),
    enabled: !isAll,
  });

  const closedThisWeek = (trendQuery.data ?? [])
    .filter((p) => p.date >= weekFrom)
    .reduce((n, p) => n + p.completed, 0);
  const agentRuns = (agentUsageQuery.data?.results ?? []).reduce((n, r) => n + r.entry_count, 0);

  const rows: { label: string; value: string }[] = [];
  if (trendQuery.data) {
    rows.push({ label: "Issues closed", value: String(closedThisWeek) });
  }
  if (agentUsageQuery.data) {
    rows.push({ label: "Agent runs", value: String(agentRuns) });
  }
  if (timesheetQuery.data) {
    rows.push({
      label: "Time logged",
      value: formatHours(timesheetQuery.data.totals.total_seconds),
    });
  }
  if (rows.length === 0) return null;

  return (
    <section className="flex flex-col gap-3 rounded-[14px] border border-border bg-[var(--surface-elevated)] p-[18px]">
      <h2 className="text-[13.5px] font-bold text-muted-foreground">This week</h2>
      {rows.map((row) => (
        <div key={row.label} className="flex items-center">
          <span className="text-[13px] text-muted-foreground/70">{row.label}</span>
          <span className="min-w-2 flex-1" />
          <span className="font-ops-mono text-[13.5px] font-bold text-foreground">{row.value}</span>
        </div>
      ))}
    </section>
  );
}

// ── Page ──

function DashboardContent({ slug }: { slug: string }) {
  const isAll = slug === "all";

  const issuesQuery = useQuery({
    queryKey: ["dashboard-issues", slug],
    queryFn: () => api.listAllIssues({ limit: 50, workspace: isAll ? undefined : slug }),
  });

  const issues = useMemo(() => {
    const rows = issuesQuery.data ?? [];
    return [...rows].sort(
      (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
    );
  }, [issuesQuery.data]);

  // Review items first; with none in a review state, the rail falls back to
  // the most recent issues so the amber panel still reflects real work.
  const reviewIssues = issues.filter(isNeedReview).slice(0, 3);
  const reviewCards = reviewIssues.length > 0 ? reviewIssues : issues.slice(0, 3);

  return (
    <div className="flex flex-col gap-5 xl:flex-row xl:items-start">
      {/* Dominant left column */}
      <div className="flex min-w-0 flex-1 flex-col gap-5">
        <AgentsPanel />
        <MyDayPanel issues={issues} isPending={issuesQuery.isPending} />
      </div>

      {/* 400px-class right rail; stacks below xl */}
      <aside className="flex w-full shrink-0 flex-col gap-5 xl:w-[400px]">
        {issuesQuery.isPending ? (
          <section className="rounded-[14px] border border-[var(--state-amber)] bg-[var(--state-amber-soft)]">
            <div className="flex items-center gap-2 border-b border-[var(--state-amber)] px-[18px] py-3.5">
              <CheckCircle2 className="h-[15px] w-[15px] text-[var(--state-amber)]" />
              <h2 className="text-sm font-bold text-[var(--state-amber)]">Needs your review</h2>
            </div>
            <div className="px-[18px] py-3.5">
              <Skeleton className="h-16 w-full" />
            </div>
          </section>
        ) : reviewCards.length > 0 ? (
          <ReviewPanel cards={reviewCards} />
        ) : null}
        <ThisWeekCard slug={slug} isAll={isAll} />
      </aside>
    </div>
  );
}

export default function DesktopDashboard() {
  const { slug } = useParams<{ slug: string }>();
  const currentSlug = useWorkspaceStore((s) => s.currentSlug);
  const effectiveSlug = slug ?? currentSlug;

  if (!effectiveSlug) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        No workspace selected.
      </div>
    );
  }

  return <DashboardContent slug={effectiveSlug} />;
}
