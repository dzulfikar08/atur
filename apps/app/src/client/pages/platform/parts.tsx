import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ApiError } from "@/lib/api";
import { platformApi, type AgentUsageRow, type DailyRow, type FeedItem } from "@/lib/platformApi";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Activity, CircleDot, MessageSquare, Shield, Timer } from "@/lib/icons";
import { cn } from "@/lib/utils";

export const ROLE_LABELS: Record<number, string> = { 20: "Admin", 15: "Member", 5: "Guest" };

// Superuser gate shared by every console page: the server verdict on
// /api/admin/me decides, the client flag only hides the menu link.
export function PlatformGate({ children }: { children: ReactNode }) {
  const me = useQuery({ queryKey: ["platform", "me"], queryFn: platformApi.me, retry: false });
  if (me.isLoading) {
    return <div className="h-8 w-48 animate-pulse rounded bg-muted" aria-busy="true" />;
  }
  if (me.error) {
    const forbidden = me.error instanceof ApiError && me.error.status === 403;
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <Shield className="mx-auto h-8 w-8 text-muted-foreground" />
        <h1 className="mt-3 text-lg font-semibold">
          {forbidden ? "Platform operators only" : "Could not open the console"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {forbidden
            ? "This account is not a superuser."
            : me.error instanceof ApiError
              ? `${me.error.status}: ${me.error.message}`
              : String(me.error)}
        </p>
      </div>
    );
  }
  return <>{children}</>;
}

const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
const plain = new Intl.NumberFormat();
const usd = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" });

export function fmtNum(n: number): string {
  return n >= 10_000 ? compact.format(n) : plain.format(n);
}

export function fmtUsd(n: number | null): string {
  return n == null ? "unpriced" : usd.format(n);
}

export function fmtHours(seconds: number): string {
  return `${plain.format(Math.round(seconds / 360) / 10)}h`;
}

export function fmtAgo(iso: string | null): string {
  if (!iso) return "never";
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (Number.isNaN(s)) return "never";
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86_400 * 30) return `${Math.floor(s / 86_400)}d ago`;
  return fmtDate(iso);
}

export function fmtDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function issueHref(i: { workspace_slug: string; project_id: string; sequence_id: number }) {
  return `/${i.workspace_slug}/projects/${i.project_id}/issues/${i.sequence_id}`;
}

export function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

// One bar per day. Height is relative to the busiest day in the range; the
// hover title carries the exact count.
export function DailyBars({
  title,
  rows,
  field,
  format = fmtNum,
}: {
  title: string;
  rows: DailyRow[];
  field: Exclude<keyof DailyRow, "day">;
  format?: (n: number) => string;
}) {
  const max = Math.max(1, ...rows.map((r) => r[field]));
  const total = rows.reduce((sum, r) => sum + r[field], 0);
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-baseline justify-between text-sm font-medium">
          {title}
          <span className="text-xs font-normal text-muted-foreground tabular-nums">
            {format(total)} total
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div
          className="flex h-24 items-end gap-px"
          role="img"
          aria-label={`${title}: ${format(total)} over ${rows.length} days`}
        >
          {rows.map((r) => (
            <div
              key={r.day}
              title={`${r.day}: ${format(r[field])}`}
              className={cn("flex-1 rounded-sm", r[field] ? "bg-primary/70" : "bg-muted")}
              style={{ height: `${Math.max(4, (r[field] / max) * 100)}%` }}
            />
          ))}
        </div>
        <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
          <span>{rows[0]?.day}</span>
          <span>{rows[rows.length - 1]?.day}</span>
        </div>
      </CardContent>
    </Card>
  );
}

// Loading / error / empty wrapper for a query-backed block.
export function QueryState({
  isLoading,
  error,
  empty,
  emptyText,
  children,
}: {
  isLoading: boolean;
  error: unknown;
  empty?: boolean;
  emptyText?: string;
  children: ReactNode;
}) {
  if (isLoading) {
    return (
      <div className="space-y-2 py-2" aria-busy="true">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-5 animate-pulse rounded bg-muted" />
        ))}
      </div>
    );
  }
  if (error) {
    const msg = error instanceof ApiError ? `${error.status}: ${error.message}` : String(error);
    return <p className="py-4 text-sm text-destructive">Could not load: {msg}</p>;
  }
  if (empty) {
    return <p className="py-6 text-center text-sm text-muted-foreground">{emptyText}</p>;
  }
  return <>{children}</>;
}

function stripTags(s: string): string {
  return s
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function feedLine(item: FeedItem): { icon: ReactNode; verb: string; detail: string | null } {
  switch (item.kind) {
    case "issue":
      return {
        icon: <CircleDot className="h-4 w-4" />,
        verb: "created",
        detail: item.detail && item.detail !== "none" ? `priority ${item.detail}` : null,
      };
    case "comment":
      return {
        icon: <MessageSquare className="h-4 w-4" />,
        verb: item.extra && item.extra !== "internal" ? "replied publicly on" : "commented on",
        detail: item.detail ? stripTags(item.detail) : null,
      };
    case "activity":
      return {
        icon: <Activity className="h-4 w-4" />,
        verb: `changed ${item.detail ?? "a field"} on`,
        detail: item.extra ? stripTags(item.extra) : null,
      };
    case "time":
      return {
        icon: <Timer className="h-4 w-4" />,
        verb: `logged ${fmtHours(item.seconds ?? 0)} on`,
        detail:
          item.detail === "human"
            ? null
            : [
                item.detail,
                item.extra,
                item.tokens != null ? `${fmtNum(item.tokens)} tokens` : null,
              ]
                .filter(Boolean)
                .join(" · "),
      };
  }
}

// Cross-workspace activity, newest first, with cursor paging.
export function FeedList({ workspace, actor }: { workspace?: string; actor?: string }) {
  const q = useInfiniteQuery({
    queryKey: ["platform", "feed", workspace ?? "", actor ?? ""],
    queryFn: ({ pageParam }) => platformApi.feed({ before: pageParam, workspace, actor }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_before ?? undefined,
  });
  const items = q.data?.pages.flatMap((p) => p.results) ?? [];
  return (
    <QueryState
      isLoading={q.isLoading}
      error={q.error}
      empty={items.length === 0}
      emptyText="No activity yet."
    >
      <ol className="divide-y">
        {items.map((item) => {
          const line = feedLine(item);
          return (
            <li key={`${item.kind}:${item.id}`} className="flex gap-3 py-2.5">
              <span className="mt-0.5 text-muted-foreground">{line.icon}</span>
              <div className="min-w-0 flex-1 text-sm">
                <p className="break-words">
                  <span className="font-medium">
                    {item.actor_name || item.actor_email || "Unknown"}
                  </span>{" "}
                  <span className="text-muted-foreground">{line.verb}</span>{" "}
                  <Link to={issueHref(item)} className="font-medium hover:underline">
                    {item.project_identifier}-{item.sequence_id}
                  </Link>{" "}
                  <span>{item.issue_name}</span>
                </p>
                {line.detail && (
                  <p className="mt-0.5 line-clamp-2 break-words text-xs text-muted-foreground">
                    {line.detail}
                  </p>
                )}
                <p className="mt-0.5 text-xs text-muted-foreground">
                  <Link to={`/admin/workspaces/${item.workspace_slug}`} className="hover:underline">
                    {item.workspace_name}
                  </Link>{" "}
                  · <time dateTime={item.at}>{fmtAgo(item.at)}</time>
                </p>
              </div>
            </li>
          );
        })}
      </ol>
      {q.hasNextPage && (
        <div className="pt-3 text-center">
          <Button
            variant="outline"
            size="sm"
            onClick={() => q.fetchNextPage()}
            disabled={q.isFetchingNextPage}
          >
            {q.isFetchingNextPage ? "Loading…" : "Load older"}
          </Button>
        </div>
      )}
    </QueryState>
  );
}

type AgentGroup = {
  key: string;
  entries: number;
  seconds: number;
  tokens: number;
  cost: number | null;
  unpriced: boolean;
  lastAt: string | null;
};

function groupAgents(rows: AgentUsageRow[], keyOf: (r: AgentUsageRow) => string): AgentGroup[] {
  const groups = new Map<string, AgentGroup>();
  for (const r of rows) {
    const key = keyOf(r);
    const g = groups.get(key) ?? {
      key,
      entries: 0,
      seconds: 0,
      tokens: 0,
      cost: null,
      unpriced: false,
      lastAt: null,
    };
    g.entries += r.entries;
    g.seconds += r.seconds;
    g.tokens += r.total_tokens;
    if (r.cost_usd == null) g.unpriced = true;
    else g.cost = (g.cost ?? 0) + r.cost_usd;
    if (r.last_at && (!g.lastAt || r.last_at > g.lastAt)) g.lastAt = r.last_at;
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => b.tokens - a.tokens);
}

type AgentGrouping = { label: string; keyOf: (r: AgentUsageRow) => string };
const BY_MODEL: AgentGrouping = { label: "Model", keyOf: (r) => r.model };

export const AGENT_GROUPINGS: Record<string, AgentGrouping> = {
  model: BY_MODEL,
  workspace: { label: "Workspace", keyOf: (r) => r.workspace_slug },
  // Harness prefix ("omp", "codex") so per-pane names roll up.
  harness: { label: "Harness", keyOf: (r) => r.agent_name.split("/")[0] ?? r.agent_name },
  agent: { label: "Agent", keyOf: (r) => r.agent_name },
};

export function AgentTable({ rows, groupBy }: { rows: AgentUsageRow[]; groupBy: string }) {
  const grouping = AGENT_GROUPINGS[groupBy] ?? BY_MODEL;
  const groups = groupAgents(rows, grouping.keyOf);
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{grouping.label}</TableHead>
            <TableHead className="text-right">Tokens</TableHead>
            <TableHead className="text-right">Cost</TableHead>
            <TableHead className="hidden text-right sm:table-cell">Runs</TableHead>
            <TableHead className="hidden text-right md:table-cell">Time</TableHead>
            <TableHead className="hidden text-right md:table-cell">Last run</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {groups.map((g) => (
            <TableRow key={g.key}>
              <TableCell className="max-w-[16rem] truncate font-medium">{g.key}</TableCell>
              <TableCell className="text-right tabular-nums">{fmtNum(g.tokens)}</TableCell>
              <TableCell className="text-right tabular-nums">
                {fmtUsd(g.cost)}
                {g.unpriced && g.cost != null && (
                  <span className="text-muted-foreground" title="Some models have no price row">
                    {" "}
                    +?
                  </span>
                )}
              </TableCell>
              <TableCell className="hidden text-right tabular-nums sm:table-cell">
                {fmtNum(g.entries)}
              </TableCell>
              <TableCell className="hidden text-right tabular-nums md:table-cell">
                {fmtHours(g.seconds)}
              </TableCell>
              <TableCell className="hidden text-right text-muted-foreground md:table-cell">
                {fmtAgo(g.lastAt)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
