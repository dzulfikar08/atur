import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { platformApi } from "@/lib/platformApi";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RefreshCw, Search, Shield } from "@/lib/icons";
import {
  AGENT_GROUPINGS,
  AgentTable,
  DailyBars,
  FeedList,
  PlatformGate,
  QueryState,
  StatTile,
  fmtAgo,
  fmtDate,
  fmtHours,
  fmtNum,
  fmtUsd,
} from "./parts";

const TABS: Record<string, string> = {
  overview: "Overview",
  users: "Users",
  workspaces: "Workspaces",
  activity: "Activity",
  agents: "Agents",
};

const RANGES: Record<string, string> = { "7": "7 days", "30": "30 days", "90": "90 days" };
const AGENT_RANGES: Record<string, string> = { ...RANGES, all: "All time" };

function RangePicker({
  value,
  onChange,
  ranges = RANGES,
}: {
  value: string;
  onChange: (v: string) => void;
  ranges?: Record<string, string>;
}) {
  return (
    <div className="inline-flex rounded-md border p-0.5" role="group" aria-label="Date range">
      {Object.entries(ranges).map(([k, label]) => (
        <button
          key={k}
          type="button"
          onClick={() => onChange(k)}
          aria-pressed={value === k}
          className={
            "min-h-8 rounded px-2.5 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
            (value === k
              ? "bg-muted text-foreground"
              : "text-muted-foreground hover:text-foreground")
          }
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative w-full sm:w-72">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="pl-8"
      />
    </div>
  );
}

function OverviewTab() {
  const [days, setDays] = useState("30");
  const q = useQuery({
    queryKey: ["platform", "overview", days],
    queryFn: () => platformApi.overview(days),
    placeholderData: keepPreviousData,
  });
  const t = q.data?.totals;
  return (
    <div className="space-y-4">
      <QueryState isLoading={q.isLoading} error={q.error}>
        {t && (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
            <StatTile
              label="Users"
              value={fmtNum(t.users)}
              hint={t.customers ? `+${fmtNum(t.customers)} portal customers` : undefined}
            />
            <StatTile label="Workspaces" value={fmtNum(t.workspaces)} />
            <StatTile label="Projects" value={fmtNum(t.projects)} />
            <StatTile
              label="Issues"
              value={fmtNum(t.issues)}
              hint={`${fmtNum(t.open_issues)} open`}
            />
            <StatTile label="Comments" value={fmtNum(t.comments)} />
            <StatTile label="Pages" value={fmtNum(t.pages)} />
            <StatTile label="CRM contacts" value={fmtNum(t.contacts)} />
            <StatTile label="Support tickets" value={fmtNum(t.tickets)} />
            <StatTile label="Active API keys" value={fmtNum(t.api_keys)} />
            <StatTile label="Human time" value={fmtHours(t.human_seconds)} />
            <StatTile label="Agent time" value={fmtHours(t.agent_seconds)} />
            <StatTile label="Agent tokens" value={fmtNum(t.agent_tokens)} />
          </div>
        )}
      </QueryState>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium">Daily</h2>
        <RangePicker value={days} onChange={setDays} />
      </div>
      {q.data && (
        <div className="grid gap-3 md:grid-cols-2">
          <DailyBars title="Issues created" rows={q.data.daily} field="issues" />
          <DailyBars title="Comments" rows={q.data.daily} field="comments" />
          <DailyBars title="Agent tokens" rows={q.data.daily} field="agent_tokens" />
          <DailyBars title="Signups" rows={q.data.daily} field="signups" />
        </div>
      )}
    </div>
  );
}

function UsersTab() {
  const [search, setSearch] = useState("");
  const [type, setType] = useState("team");
  const q = useQuery({
    queryKey: ["platform", "users", search.trim(), type],
    queryFn: () => platformApi.users(search.trim(), type),
    placeholderData: keepPreviousData,
  });
  const users = q.data ?? [];
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <SearchBox value={search} onChange={setSearch} placeholder="Search name, email, username" />
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          aria-label="User type"
          className="h-10 rounded-md border bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="team">Team accounts</option>
          <option value="customers">Portal customers</option>
          <option value="all">Everyone</option>
        </select>
        <span className="text-xs text-muted-foreground sm:ml-auto">{users.length} shown</span>
      </div>
      <Card>
        <CardContent className="p-0 sm:p-2">
          <QueryState
            isLoading={q.isLoading}
            error={q.error}
            empty={users.length === 0}
            emptyText="No users match."
          >
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead className="hidden text-right sm:table-cell">Workspaces</TableHead>
                    <TableHead className="hidden text-right md:table-cell">Issues</TableHead>
                    <TableHead className="hidden text-right md:table-cell">Comments</TableHead>
                    <TableHead className="hidden text-right lg:table-cell">Agent tokens</TableHead>
                    <TableHead className="text-right">Last seen</TableHead>
                    <TableHead className="hidden text-right lg:table-cell">Joined</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((u) => (
                    <TableRow key={u.id}>
                      <TableCell>
                        <Link
                          to={`/admin/users/${u.id}`}
                          className="block min-w-0 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <span className="flex flex-wrap items-center gap-1.5 font-medium hover:underline">
                            {u.display_name || u.username}
                            {!!u.is_superuser && <Badge variant="secondary">superuser</Badge>}
                            {!!u.is_bot && <Badge variant="outline">bot</Badge>}
                            {!!u.is_customer && <Badge variant="outline">customer</Badge>}
                            {!u.is_active && <Badge variant="destructive">inactive</Badge>}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {u.email}
                          </span>
                        </Link>
                      </TableCell>
                      <TableCell className="hidden text-right tabular-nums sm:table-cell">
                        {u.workspaces}
                      </TableCell>
                      <TableCell className="hidden text-right tabular-nums md:table-cell">
                        {fmtNum(u.issues_created)}
                      </TableCell>
                      <TableCell className="hidden text-right tabular-nums md:table-cell">
                        {fmtNum(u.comments)}
                      </TableCell>
                      <TableCell className="hidden text-right tabular-nums lg:table-cell">
                        {fmtNum(u.agent_tokens)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right text-muted-foreground">
                        {fmtAgo(u.last_seen_at)}
                      </TableCell>
                      <TableCell className="hidden whitespace-nowrap text-right text-muted-foreground lg:table-cell">
                        {fmtDate(u.created_at)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </QueryState>
        </CardContent>
      </Card>
    </div>
  );
}

function WorkspacesTab() {
  const [search, setSearch] = useState("");
  const q = useQuery({
    queryKey: ["platform", "workspaces", search.trim()],
    queryFn: () => platformApi.workspaces(search.trim()),
    placeholderData: keepPreviousData,
  });
  const workspaces = q.data ?? [];
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <SearchBox value={search} onChange={setSearch} placeholder="Search name or slug" />
        <span className="text-xs text-muted-foreground sm:ml-auto">
          {workspaces.length} shown, most recently active first
        </span>
      </div>
      <Card>
        <CardContent className="p-0 sm:p-2">
          <QueryState
            isLoading={q.isLoading}
            error={q.error}
            empty={workspaces.length === 0}
            emptyText="No workspaces match."
          >
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Workspace</TableHead>
                    <TableHead className="hidden md:table-cell">Owner</TableHead>
                    <TableHead className="hidden text-right sm:table-cell">Members</TableHead>
                    <TableHead className="hidden text-right sm:table-cell">Projects</TableHead>
                    <TableHead className="text-right">Open / issues</TableHead>
                    <TableHead className="hidden text-right lg:table-cell">Agent tokens</TableHead>
                    <TableHead className="text-right">Last activity</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {workspaces.map((w) => (
                    <TableRow key={w.id}>
                      <TableCell>
                        <Link
                          to={`/admin/workspaces/${w.slug}`}
                          className="block rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <span className="font-medium hover:underline">{w.name}</span>
                          <span className="block text-xs text-muted-foreground">
                            {w.slug}
                            {w.strategy_verdict ? ` · ${w.strategy_verdict}` : ""}
                          </span>
                        </Link>
                      </TableCell>
                      <TableCell className="hidden max-w-[14rem] truncate text-sm md:table-cell">
                        {w.owner_email}
                      </TableCell>
                      <TableCell className="hidden text-right tabular-nums sm:table-cell">
                        {w.members}
                      </TableCell>
                      <TableCell className="hidden text-right tabular-nums sm:table-cell">
                        {w.projects}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right tabular-nums">
                        {fmtNum(w.open_issues)} / {fmtNum(w.issues)}
                      </TableCell>
                      <TableCell className="hidden text-right tabular-nums lg:table-cell">
                        {fmtNum(w.agent_tokens)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right text-muted-foreground">
                        {fmtAgo(w.last_activity_at)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </QueryState>
        </CardContent>
      </Card>
    </div>
  );
}

function AgentsTab() {
  const [days, setDays] = useState("30");
  const [groupBy, setGroupBy] = useState("model");
  const q = useQuery({
    queryKey: ["platform", "agents", days],
    queryFn: () => platformApi.agents(days),
    placeholderData: keepPreviousData,
  });
  const rows = q.data ?? [];
  const tokens = rows.reduce((s, r) => s + r.total_tokens, 0);
  const priced = rows.filter((r) => r.cost_usd != null);
  const cost = priced.reduce((s, r) => s + (r.cost_usd ?? 0), 0);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <RangePicker value={days} onChange={setDays} ranges={AGENT_RANGES} />
        <select
          value={groupBy}
          onChange={(e) => setGroupBy(e.target.value)}
          aria-label="Group by"
          className="h-9 rounded-md border bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {Object.entries(AGENT_GROUPINGS).map(([k, g]) => (
            <option key={k} value={k}>
              By {g.label.toLowerCase()}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Tokens" value={fmtNum(tokens)} />
        <StatTile
          label="Cost"
          value={fmtUsd(cost)}
          hint={priced.length < rows.length ? "some models unpriced" : undefined}
        />
        <StatTile label="Runs" value={fmtNum(rows.reduce((s, r) => s + r.entries, 0))} />
        <StatTile label="Time" value={fmtHours(rows.reduce((s, r) => s + r.seconds, 0))} />
      </div>
      <Card>
        <CardContent className="p-0 sm:p-2">
          <QueryState
            isLoading={q.isLoading}
            error={q.error}
            empty={rows.length === 0}
            emptyText="No agent time entries in this range."
          >
            <AgentTable rows={rows} groupBy={groupBy} />
          </QueryState>
        </CardContent>
      </Card>
    </div>
  );
}

export default function PlatformPage() {
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const tab = TABS[params.get("tab") ?? ""] ? params.get("tab")! : "overview";
  return (
    <PlatformGate>
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <Shield className="h-6 w-6" />
          <h1 className="text-2xl font-bold">Platform</h1>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={() => qc.invalidateQueries({ queryKey: ["platform"] })}
          >
            <RefreshCw className="mr-1.5 h-4 w-4" />
            Refresh
          </Button>
        </div>
        <Tabs
          value={tab}
          onValueChange={(v) => setParams(v === "overview" ? {} : { tab: v }, { replace: true })}
        >
          <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
            <TabsList>
              {Object.entries(TABS).map(([k, label]) => (
                <TabsTrigger key={k} value={k}>
                  {label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          <TabsContent value="overview" className="mt-4">
            <OverviewTab />
          </TabsContent>
          <TabsContent value="users" className="mt-4">
            <UsersTab />
          </TabsContent>
          <TabsContent value="workspaces" className="mt-4">
            <WorkspacesTab />
          </TabsContent>
          <TabsContent value="activity" className="mt-4">
            <Card>
              <CardContent className="p-4">
                <FeedList />
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="agents" className="mt-4">
            <AgentsTab />
          </TabsContent>
        </Tabs>
      </div>
    </PlatformGate>
  );
}
