import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Bot, ChevronDown, ChevronRight, Eye } from "@/lib/icons";
import { Skeleton } from "@/components/ui/skeleton";
import TodayBoard from "@/components/today/TodayBoard";
import { api, type PaneListItem } from "@/lib/api";
import { useWorkspaceStore } from "@/stores/workspace";
import { cn } from "@/lib/utils";

// Panel shells sit on --surface-elevated with the theme border; state colors
// always come from the --state-* tokens so light mode stays coherent.

const PANEL =
  "rounded-[14px] border border-border bg-[var(--surface-elevated)] overflow-hidden";

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
  if (
    s === "blocked" ||
    s === "waiting" ||
    s === "input_required" ||
    s === "needs_input"
  ) {
    return { tone: "amber", label: "blocked" };
  }
  if (s === "error" || s === "exited" || s === "dead") {
    return { tone: "amber", label: "needs you" };
  }
  return { tone: "gray", label: s === "" ? "idle" : s };
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
          {context && (
            <span className="truncate text-[13px] text-muted-foreground">
              {context}
            </span>
          )}
          {/* PaneListItem carries no timestamp — render the design's unknown-time dash. */}
          <span className="ml-1 shrink-0 font-ops-mono text-[12.5px] text-muted-foreground/70">
            —
          </span>
        </div>
        <div className="mt-[3px] flex items-center gap-1.5">
          <span
            className={cn(
              "h-1.5 w-1.5 shrink-0 rounded-full",
              TONE_DOT[status.tone],
            )}
          />
          <span
            className={cn(
              "truncate font-ops-mono text-xs font-semibold",
              TONE_TEXT[status.tone],
            )}
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
  const [open, setOpen] = useState(false);
  const panesQuery = useQuery({
    queryKey: ["panes"],
    queryFn: api.listPanes,
    refetchInterval: 10_000,
  });
  const panes = panesQuery.data?.panes ?? [];

  return (
    <section className={PANEL}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2.5 px-5 py-3.5 text-left"
      >
        <h2 className="text-sm font-semibold text-foreground">
          Agents on shift
        </h2>
        <span className="flex items-center gap-1.5 font-ops-mono text-[length:var(--text-meta)] text-muted-foreground">
          {panes.length} live {panes.length === 1 ? "pane" : "panes"}
          {open ? (
            <ChevronDown className="size-3.5" />
          ) : (
            <ChevronRight className="size-3.5" />
          )}
        </span>
      </button>
      {!open ? null : panesQuery.isPending ? (
        Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="border-t border-border px-5 py-[15px] first:border-t-0"
          >
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

// ── This week ──

function ThisWeekCard({ slug, isAll }: { slug: string; isAll: boolean }) {
  const weekFrom = toISODate(6);
  const today = toISODate(0);

  const trendQuery = useQuery({
    queryKey: ["dashboard-completion-trend", slug],
    queryFn: () =>
      isAll ? api.allCompletionTrend() : api.completionTrend(slug),
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
  const agentRuns = (agentUsageQuery.data?.results ?? []).reduce(
    (n, r) => n + r.entry_count,
    0,
  );

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
      <h2 className="text-[13.5px] font-bold text-muted-foreground">
        This week
      </h2>
      {rows.map((row) => (
        <div key={row.label} className="flex items-center">
          <span className="text-[13px] text-muted-foreground/70">
            {row.label}
          </span>
          <span className="min-w-2 flex-1" />
          <span className="font-ops-mono text-[13.5px] font-bold text-foreground">
            {row.value}
          </span>
        </div>
      ))}
    </section>
  );
}

// ── Page ──

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

  return (
    <div className="flex flex-col gap-5 xl:flex-row xl:items-start">
      <div className="min-w-0 flex-1">
        <TodayBoard slug={effectiveSlug} />
      </div>
      <aside className="flex w-full shrink-0 flex-col gap-5 xl:w-[340px]">
        <AgentsPanel />
        <ThisWeekCard slug={effectiveSlug} isAll={effectiveSlug === "all"} />
      </aside>
    </div>
  );
}
