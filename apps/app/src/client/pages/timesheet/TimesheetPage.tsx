import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, type AgentUsageRow, type TimesheetRow } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Card } from "@/components/ui/card";
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

// "12.0k" / "1.2M" token counts for the agent usage tables.
function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

interface MemberOption {
  id: string;
  label: string;
}

// Defensive member field mapping — workspace member rows vary in shape
// (top-level fields vs nested .member). Fall back across both.
function toMemberOption(m: any): MemberOption {
  const id = m?.id ?? m?.member?.id ?? m?.user_id ?? "";
  const label =
    m?.display_name ??
    m?.member?.display_name ??
    m?.username ??
    m?.member?.username ??
    m?.email ??
    m?.member?.email ??
    id;
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
      { label: string; model: string; rows: AgentUsageRow[]; totalSeconds: number; totalTokens: number }
    >();
    for (const r of rows) {
      const entry = map.get(r.agent_name) ?? {
        label: r.agent_name,
        model: r.model,
        rows: [],
        totalSeconds: 0,
        totalTokens: 0,
      };
      entry.rows.push(r);
      entry.totalSeconds += r.total_seconds;
      entry.totalTokens += r.total_tokens;
      map.set(r.agent_name, entry);
    }
    return Array.from(map.entries())
      .map(([agent, v]) => ({ agent, ...v }))
      .sort((a, b) => b.totalTokens - a.totalTokens);
  }, [agentUsageQuery.data]);

  const totals = timesheetQuery.data?.totals;

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
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <div className="flex items-center gap-2">
        <Timer className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-semibold">Timesheet</h1>
        <span className="text-sm text-muted-foreground ml-auto">
          {totals
            ? `${formatDuration(totals.total_seconds)} · ${totals.total_entries} entries`
            : ""}
        </span>
      </div>

      {/* Filters */}
      <Card className="p-3 flex flex-wrap items-end gap-3">
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
        <Button variant="outline" size="sm" className="h-9 ml-auto" onClick={exportCsv}>
          <Download className="h-4 w-4 mr-1" /> CSV
        </Button>
      </Card>

      {/* Table */}
      {timesheetQuery.isLoading ? (
        <div className="animate-pulse text-sm text-muted-foreground">Loading…</div>
      ) : grouped.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          No time logged in this range.
        </Card>
      ) : (
        <div className="space-y-4">
          {grouped.map((group) => (
            <Card key={group.user_id} className="overflow-hidden">
              <div className="flex items-center justify-between bg-muted/40 px-4 py-2 border-b">
                <span className="text-sm font-medium">{group.label}</span>
                <span className="text-sm text-muted-foreground">{formatDuration(group.total)}</span>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="px-4 py-2 font-medium">Issue</th>
                    <th className="px-4 py-2 font-medium text-right">Entries</th>
                    <th className="px-4 py-2 font-medium text-right">Tracked</th>
                  </tr>
                </thead>
                <tbody>
                  {group.rows.map((r) => (
                    <tr key={`${r.user_id}-${r.issue_id}`} className="border-t">
                      <td className="px-4 py-2">
                        <span className="font-mono text-xs text-muted-foreground mr-2">
                          {r.sequence_id}
                        </span>
                        {r.issue_name}
                      </td>
                      <td className="px-4 py-2 text-right text-muted-foreground">
                        {r.entry_count}
                      </td>
                      <td className="px-4 py-2 text-right font-medium">
                        {formatDuration(r.total_seconds)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          ))}
        </div>
      )}

      {/* AI agent usage — separate KPI lane, excluded from human totals */}
      <div className="flex items-center gap-2 pt-2">
        <Bot className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-semibold">AI Agent Usage</h2>
        <span className="text-sm text-muted-foreground ml-auto">
          {agentUsageQuery.data
            ? `${formatTokens(agentUsageQuery.data.totals.total_tokens)} tokens · ${formatDuration(agentUsageQuery.data.totals.total_seconds)}`
            : ""}
        </span>
      </div>
      {agentUsageQuery.isLoading ? (
        <div className="animate-pulse text-sm text-muted-foreground">Loading…</div>
      ) : agentGroups.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          No agent usage in this range. Agents log it with{" "}
          <code className="font-mono text-xs">create_time_entry</code> using{" "}
          <code className="font-mono text-xs">source="agent"</code>.
        </Card>
      ) : (
        <div className="space-y-4">
          {agentGroups.map((group) => (
            <Card key={group.agent} className="overflow-hidden">
              <div className="flex items-center justify-between bg-muted/40 px-4 py-2 border-b">
                <span className="text-sm font-medium">
                  {group.label}
                  <span className="ml-2 font-mono text-xs text-muted-foreground">{group.model}</span>
                </span>
                <span className="text-sm text-muted-foreground">
                  {formatTokens(group.totalTokens)} tokens · {formatDuration(group.totalSeconds)}
                </span>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="px-4 py-2 font-medium">Issue</th>
                    <th className="px-4 py-2 font-medium text-right">Entries</th>
                    <th className="px-4 py-2 font-medium text-right">Tracked</th>
                    <th className="px-4 py-2 font-medium text-right">In</th>
                    <th className="px-4 py-2 font-medium text-right">Out</th>
                    <th className="px-4 py-2 font-medium text-right">Tokens</th>
                  </tr>
                </thead>
                <tbody>
                  {group.rows.map((r) => (
                    <tr key={`${r.agent_name}-${r.issue_id}`} className="border-t">
                      <td className="px-4 py-2">
                        <span className="font-mono text-xs text-muted-foreground mr-2">
                          {r.sequence_id}
                        </span>
                        {r.issue_name}
                      </td>
                      <td className="px-4 py-2 text-right text-muted-foreground">
                        {r.entry_count}
                      </td>
                      <td className="px-4 py-2 text-right text-muted-foreground">
                        {formatDuration(r.total_seconds)}
                      </td>
                      <td className="px-4 py-2 text-right text-muted-foreground">
                        {formatTokens(r.input_tokens)}
                      </td>
                      <td className="px-4 py-2 text-right text-muted-foreground">
                        {formatTokens(r.output_tokens)}
                      </td>
                      <td className="px-4 py-2 text-right font-medium">
                        {formatTokens(r.total_tokens)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
