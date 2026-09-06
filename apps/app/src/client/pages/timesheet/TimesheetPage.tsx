import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { format, isValid, parseISO } from "date-fns";
import { api, type AgentUsageRow, type TimesheetRow } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Timer, Download, Bot } from "@/lib/icons";
import { toast } from "sonner";

// "Xh Ym" from seconds. Omits the hours part when 0 for short entries.
function formatDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  if (h === 0 && m === 0) return "0m";
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

// "10:25" clock-style h:mm for grid values.
function formatHm(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  return `${h}:${String(m).padStart(2, "0")}`;
}

// "38.5h" decimal hours for the summary cards.
function formatHours(totalSeconds: number): string {
  const h = totalSeconds / 3600;
  return Number.isInteger(h) ? `${h}h` : `${h.toFixed(1)}h`;
}

// "Sep 1" from an ISO yyyy-MM-dd filter value; raw string when unparsable.
function formatDay(iso: string): string {
  const d = parseISO(iso);
  return isValid(d) ? format(d, "MMM d") : iso;
}

// "12.0k" / "1.2M" token counts for the agent usage tables.
function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

// "$1.23" USD cost; em-dash when the model has no price row.
function formatCost(usd: number | null): string {
  if (usd == null) return "—";
  return usd.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

// Sheet column label (design: mono, 10.5px, tracked-out, dim).
const colClass =
  "shrink-0 text-center font-ops-mono text-[10.5px] font-semibold tracking-[1px] text-muted-foreground/70";
// Sheet cell value (mono, dim).
const cellClass = "shrink-0 text-center font-ops-mono text-[11px] text-muted-foreground";
// Sheet cell total (mono, bold, foreground).
const cellTotalClass = "shrink-0 text-center font-ops-mono text-[11.5px] font-bold text-foreground";

// Mono key + issue title in the label column.
function IssueLabel({ sequenceId, name }: { sequenceId: number; name: string }) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <span className="shrink-0 font-ops-mono text-[11px] font-bold text-muted-foreground/70">
        {sequenceId}
      </span>
      <span className="truncate text-[13px] font-semibold text-foreground">{name}</span>
    </div>
  );
}

// "hour chip" — mono value on an inset surface (design's day-value chip).
function HourChip({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-[6px] bg-(--surface-card-hover) px-[7px] py-[3px] font-ops-mono text-[11px] text-muted-foreground">
      {children}
    </span>
  );
}

interface MemberOption {
  id: string;
  label: string;
}

// Defensive member field mapping — workspace member rows vary in shape
// (top-level fields vs nested .member), and the API types them as plain
// rows. Read defensively across both shapes without trusting the shape.
function toMemberOption(m: unknown): MemberOption {
  const row: Record<string, unknown> =
    typeof m === "object" && m !== null ? (m as Record<string, unknown>) : {};
  const nestedRaw = row.member;
  const nested: Record<string, unknown> =
    typeof nestedRaw === "object" && nestedRaw !== null
      ? (nestedRaw as Record<string, unknown>)
      : {};
  const firstString = (...candidates: unknown[]): string => {
    for (const c of candidates) if (typeof c === "string" && c) return c;
    return "";
  };
  const id = firstString(row.id, nested.id, row.user_id);
  const label =
    firstString(
      row.display_name,
      nested.display_name,
      row.username,
      nested.username,
      row.email,
      nested.email,
    ) || id;
  return { id, label };
}

export default function TimesheetPage() {
  const { slug } = useParams<{ slug: string }>();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [userId, setUserId] = useState<string>("");
  const [projectId, setProjectId] = useState<string>("");

  const membersQuery = useQuery({
    queryKey: ["workspace-members", slug],
    queryFn: async () =>
      (await api.listWorkspaceMembers(slug!)).map(toMemberOption).filter((m) => m.id),
    enabled: !!slug,
  });
  const projectsQuery = useQuery({
    queryKey: ["projects", slug],
    queryFn: async () => api.listProjects(slug!),
    enabled: !!slug,
  });

  const timesheetQuery = useQuery({
    queryKey: ["timesheet", slug, from, to, userId, projectId],
    queryFn: () =>
      api.listTimesheet(slug!, {
        from: from || undefined,
        to: to || undefined,
        user_id: userId || undefined,
        project_id: projectId || undefined,
      }),
    enabled: !!slug,
  });

  const agentUsageQuery = useQuery({
    queryKey: ["agent-usage", slug, from, to, projectId],
    queryFn: () =>
      api.listAgentUsage(slug!, {
        from: from || undefined,
        to: to || undefined,
        project_id: projectId || undefined,
      }),
    enabled: !!slug,
  });

  // Group rows by user for the table sections.
  const grouped = useMemo(() => {
    const rows = timesheetQuery.data?.results ?? [];
    const map = new Map<string, { label: string; rows: TimesheetRow[]; total: number }>();
    for (const r of rows) {
      const entry = map.get(r.user_id) ?? {
        label: r.user_name ?? r.user_email ?? r.user_id,
        rows: [],
        total: 0,
      };
      entry.rows.push(r);
      entry.total += r.total_seconds;
      map.set(r.user_id, entry);
    }
    return Array.from(map.entries()).map(([user_id, v]) => ({ user_id, ...v }));
  }, [timesheetQuery.data]);

  // Group agent rows by agent for the AI usage section.
  const agentGroups = useMemo(() => {
    const rows = agentUsageQuery.data?.results ?? [];
    const map = new Map<
      string,
      {
        label: string;
        model: string;
        rows: AgentUsageRow[];
        totalSeconds: number;
        totalTokens: number;
        totalCost: number | null;
      }
    >();
    for (const r of rows) {
      const entry = map.get(r.agent_name) ?? {
        label: r.agent_name,
        model: r.model,
        rows: [],
        totalSeconds: 0,
        totalTokens: 0,
        totalCost: null as number | null,
      };
      entry.rows.push(r);
      entry.totalSeconds += r.total_seconds;
      entry.totalTokens += r.total_tokens;
      // Skip unpriced rows — null stays null until a priced row appears.
      entry.totalCost =
        entry.totalCost == null
          ? r.cost_usd
          : r.cost_usd == null
            ? entry.totalCost
            : entry.totalCost + r.cost_usd;
      map.set(r.agent_name, entry);
    }
    return Array.from(map.entries())
      .map(([agent, v]) => ({ agent, ...v }))
      .sort((a, b) => b.totalTokens - a.totalTokens);
  }, [agentUsageQuery.data]);

  const totals = timesheetQuery.data?.totals;
  const agentTotals = agentUsageQuery.data?.totals;

  const rangeLabel =
    from || to ? `${from ? formatDay(from) : "…"} – ${to ? formatDay(to) : "…"}` : "All time";

  function exportCsv() {
    const rows = timesheetQuery.data?.results ?? [];
    if (rows.length === 0) {
      toast.info("No time entries to export");
      return;
    }
    const header = ["User", "Email", "Issue", "Sequence", "Project ID", "Total Seconds", "Entries"];
    const lines = rows.map((r) =>
      [
        r.user_name ?? "",
        r.user_email ?? "",
        `"${(r.issue_name ?? "").replace(/"/g, '""')}"`,
        r.sequence_id,
        r.project_id,
        r.total_seconds,
        r.entry_count,
      ].join(","),
    );
    const csv = [header.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `timesheet-${slug}-${from || "all"}-${to || "now"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-[18px] p-4 md:p-6">
      {/* Top bar */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2.5">
          <Timer className="h-4 w-4 text-muted-foreground" />
          <h1 className="text-[15px] font-bold text-foreground">Timesheet</h1>
        </div>
        <span className="font-ops-mono text-[12px] text-muted-foreground/70">{rangeLabel}</span>
        <div className="min-w-4 flex-1" />
        <Button
          variant="outline"
          size="sm"
          className="h-auto rounded-[9px] border-border bg-(--surface-elevated) px-[13px] py-[8px] text-[13px] font-semibold text-muted-foreground hover:bg-(--surface-card-hover) hover:text-foreground"
          onClick={exportCsv}
        >
          <Download className="h-3.5 w-3.5" /> Export CSV
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">From</label>
          <DatePicker value={from || null} onChange={(v) => setFrom(v || "")} className="w-40" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">To</label>
          <DatePicker value={to || null} onChange={(v) => setTo(v || "")} className="w-40" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Member</label>
          <Select value={userId || "all"} onValueChange={(v) => setUserId(v === "all" ? "" : v)}>
            <SelectTrigger className="w-48 h-9">
              <SelectValue placeholder="All members" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All members</SelectItem>
              {(membersQuery.data ?? []).map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Project</label>
          <Select
            value={projectId || "all"}
            onValueChange={(v) => setProjectId(v === "all" ? "" : v)}
          >
            <SelectTrigger className="w-48 h-9">
              <SelectValue placeholder="All projects" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All projects</SelectItem>
              {(projectsQuery.data ?? []).map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Summary — only the metrics the data actually carries */}
      {(totals || agentTotals) && (
        <div className="flex flex-wrap gap-[14px]">
          {totals && (
            <div className="flex flex-col gap-[3px] rounded-[11px] border border-border bg-(--surface-elevated) px-[18px] py-[12px]">
              <span className="font-ops-mono text-[10.5px] font-semibold tracking-[1px] text-muted-foreground/70">
                total
              </span>
              <span className="font-ops-mono text-[19px] font-bold text-foreground">
                {formatHours(totals.total_seconds)}
              </span>
            </div>
          )}
          {agentTotals && (
            <div className="flex flex-col gap-[3px] rounded-[11px] border border-border bg-(--surface-elevated) px-[18px] py-[12px]">
              <span className="font-ops-mono text-[10.5px] font-semibold tracking-[1px] text-muted-foreground/70">
                agent time
              </span>
              <span className="font-ops-mono text-[19px] font-bold text-foreground">
                {formatHours(agentTotals.total_seconds)}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Timesheet sheets */}
      {timesheetQuery.isLoading ? (
        <div className="animate-pulse text-sm text-muted-foreground">Loading…</div>
      ) : grouped.length === 0 ? (
        <div className="rounded-[14px] border border-border bg-(--surface-elevated) p-8 text-center text-sm text-muted-foreground">
          No time logged in this range.
        </div>
      ) : (
        <div className="flex flex-col gap-[18px]">
          {grouped.map((group) => (
            <section
              key={group.user_id}
              className="overflow-hidden rounded-[14px] border border-border bg-(--surface-elevated)"
            >
              {/* Head: member label in the issue slot + mono column labels */}
              <div className="flex items-center gap-2.5 bg-(--surface-card) px-[18px] py-[11px]">
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground">
                  {group.label}
                </span>
                <span className={`${colClass} w-[52px]`}>entries</span>
                <span className={`${colClass} w-[64px]`}>tracked</span>
              </div>
              {group.rows.map((r) => (
                <div
                  key={`${r.user_id}-${r.issue_id}`}
                  className="flex items-center gap-2.5 border-t border-border px-[18px] py-[12px]"
                >
                  <IssueLabel sequenceId={r.sequence_id} name={r.issue_name} />
                  <span className={`${cellClass} flex w-[52px] justify-center`}>
                    {r.entry_count}
                  </span>
                  <span className="flex w-[64px] shrink-0 justify-center">
                    <HourChip>{formatHm(r.total_seconds)}</HourChip>
                  </span>
                </div>
              ))}
              {/* Footer: group totals */}
              <div className="flex items-center gap-2.5 border-t border-border bg-(--surface-card) px-[18px] py-[12px]">
                <span className="min-w-0 flex-1 font-ops-mono text-[10.5px] font-semibold tracking-[1px] text-muted-foreground/70">
                  total
                </span>
                <span className={`${cellClass} flex w-[52px] justify-center`}>
                  {group.rows.reduce((n, r) => n + r.entry_count, 0)}
                </span>
                <span className={`${cellTotalClass} w-[64px]`}>{formatHm(group.total)}</span>
              </div>
            </section>
          ))}
        </div>
      )}

      {/* AI agent usage — separate KPI lane, excluded from human totals */}
      <div className="flex flex-wrap items-center gap-2.5 pt-2">
        <Bot className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-[15px] font-bold text-foreground">AI Agent Usage</h2>
        {agentTotals && (
          <span className="font-ops-mono text-[12px] text-muted-foreground/70">
            {formatTokens(agentTotals.total_tokens)} tokens ·{" "}
            {formatDuration(agentTotals.total_seconds)} · {formatCost(agentTotals.cost_usd)}
          </span>
        )}
      </div>
      {agentUsageQuery.isLoading ? (
        <div className="animate-pulse text-sm text-muted-foreground">Loading…</div>
      ) : agentGroups.length === 0 ? (
        <div className="rounded-[14px] border border-border bg-(--surface-elevated) p-8 text-center text-sm text-muted-foreground">
          No agent usage in this range. Agents log it with{" "}
          <code className="font-ops-mono text-xs">create_time_entry</code> using{" "}
          <code className="font-ops-mono text-xs">source="agent"</code>.
        </div>
      ) : (
        <div className="flex flex-col gap-[18px]">
          {agentGroups.map((group) => (
            <section
              key={group.agent}
              className="overflow-hidden rounded-[14px] border border-border bg-(--surface-elevated)"
            >
              <div className="overflow-x-auto">
                <div className="min-w-[760px]">
                  {/* Head: agent + model in the issue slot + mono column labels */}
                  <div className="flex items-center gap-2.5 bg-(--surface-card) px-[18px] py-[11px]">
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <span className="truncate text-[13px] font-semibold text-foreground">
                        {group.label}
                      </span>
                      <span className="shrink-0 font-ops-mono text-[11px] text-muted-foreground/70">
                        {group.model}
                      </span>
                    </div>
                    <span className={`${colClass} w-[52px]`}>entries</span>
                    <span className={`${colClass} w-[64px]`}>tracked</span>
                    <span className={`${colClass} w-[64px]`}>in</span>
                    <span className={`${colClass} w-[64px]`}>out</span>
                    <span className={`${colClass} w-[72px]`}>tokens</span>
                    <span className={`${colClass} w-[72px]`}>cost</span>
                  </div>
                  {group.rows.map((r) => (
                    <div
                      key={`${r.agent_name}-${r.issue_id}`}
                      className="flex items-center gap-2.5 border-t border-border px-[18px] py-[12px]"
                    >
                      <IssueLabel sequenceId={r.sequence_id} name={r.issue_name} />
                      <span className={`${cellClass} w-[52px]`}>{r.entry_count}</span>
                      <span className={`${cellClass} w-[64px]`}>{formatHm(r.total_seconds)}</span>
                      <span className={`${cellClass} w-[64px]`}>
                        {formatTokens(r.input_tokens)}
                      </span>
                      <span className={`${cellClass} w-[64px]`}>
                        {formatTokens(r.output_tokens)}
                      </span>
                      <span className={`${cellTotalClass} w-[72px]`}>
                        {formatTokens(r.total_tokens)}
                      </span>
                      <span className={`${cellTotalClass} w-[72px] tabular-nums`}>
                        {formatCost(r.cost_usd)}
                      </span>
                    </div>
                  ))}
                  {/* Footer: agent totals */}
                  <div className="flex items-center gap-2.5 border-t border-border bg-(--surface-card) px-[18px] py-[12px]">
                    <span className="min-w-0 flex-1 font-ops-mono text-[10.5px] font-semibold tracking-[1px] text-muted-foreground/70">
                      total
                    </span>
                    <span className={`${cellClass} w-[52px]`}>
                      {group.rows.reduce((n, r) => n + r.entry_count, 0)}
                    </span>
                    <span className={`${cellTotalClass} w-[64px]`}>
                      {formatHm(group.totalSeconds)}
                    </span>
                    <span className={`${cellClass} w-[64px]`} />
                    <span className={`${cellClass} w-[64px]`} />
                    <span className={`${cellTotalClass} w-[72px]`}>
                      {formatTokens(group.totalTokens)}
                    </span>
                    <span className={`${cellTotalClass} w-[72px] tabular-nums`}>
                      {formatCost(group.totalCost)}
                    </span>
                  </div>
                </div>
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
