import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { platformApi } from "@/lib/platformApi";
import { useAuthStore } from "@/stores/auth";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowLeft, ExternalLink } from "@/lib/icons";
import {
  AGENT_GROUPINGS,
  AgentTable,
  FeedList,
  PlatformGate,
  QueryState,
  ROLE_LABELS,
  StatTile,
  fmtAgo,
  fmtDate,
  fmtNum,
} from "./parts";

function WorkspaceDetail({ slug }: { slug: string }) {
  const me = useAuthStore((s) => s.user);
  const [groupBy, setGroupBy] = useState("model");
  const q = useQuery({
    queryKey: ["platform", "workspace", slug],
    queryFn: () => platformApi.workspace(slug),
  });
  const d = q.data;
  // Workspace pages are membership-gated; only link into ones the viewer is in.
  const isMember = !!d?.members.some((m) => m.id === me?.id && m.is_active);
  return (
    <QueryState isLoading={q.isLoading} error={q.error}>
      {d && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-start gap-3">
            <div className="min-w-0">
              <h1 className="text-xl font-bold">{d.workspace.name}</h1>
              <p className="text-sm text-muted-foreground">
                {d.workspace.slug} · owner{" "}
                <Link to={`/admin/users/${d.workspace.owner_id}`} className="hover:underline">
                  {d.workspace.owner_email ?? "unknown"}
                </Link>{" "}
                · created {fmtDate(d.workspace.created_at)}
              </p>
            </div>
            {isMember && (
              <Link
                to={`/${d.workspace.slug}`}
                className="ml-auto inline-flex min-h-9 items-center gap-1 rounded-md border px-3 text-sm hover:bg-muted"
              >
                Open workspace
                <ExternalLink className="h-4 w-4" />
              </Link>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <StatTile label="Members" value={fmtNum(d.workspace.members)} />
            <StatTile label="Projects" value={fmtNum(d.workspace.projects)} />
            <StatTile label="Issues" value={fmtNum(d.workspace.issues)} />
            <StatTile label="Open issues" value={fmtNum(d.workspace.open_issues)} />
            <StatTile label="Agent tokens" value={fmtNum(d.workspace.agent_tokens)} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Projects ({d.projects.length})</CardTitle>
              </CardHeader>
              <CardContent className="p-0 sm:p-2">
                {d.projects.length === 0 ? (
                  <p className="p-4 text-sm text-muted-foreground">No projects.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Project</TableHead>
                          <TableHead className="text-right">Open / issues</TableHead>
                          <TableHead className="text-right">Last activity</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {d.projects.map((p) => (
                          <TableRow key={p.id}>
                            <TableCell>
                              <span className="font-medium">{p.name}</span>{" "}
                              <span className="text-xs text-muted-foreground">{p.identifier}</span>
                              {!!p.is_pipeline && (
                                <Badge variant="outline" className="ml-1.5">
                                  pipeline
                                </Badge>
                              )}
                              {p.archived_at && (
                                <Badge variant="secondary" className="ml-1.5">
                                  archived
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-right tabular-nums">
                              {p.open_issues} / {p.issues}
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-right text-muted-foreground">
                              {fmtAgo(p.last_activity_at)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Members ({d.members.length})</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="divide-y">
                  {d.members.map((m) => (
                    <li key={m.id} className="flex items-center gap-2 py-2 text-sm">
                      <Link
                        to={`/admin/users/${m.id}`}
                        className="min-w-0 flex-1 truncate hover:underline"
                      >
                        <span className="font-medium">{m.display_name || m.email}</span>
                        {m.display_name && (
                          <span className="text-muted-foreground"> · {m.email}</span>
                        )}
                      </Link>
                      <Badge variant="outline">{ROLE_LABELS[m.role] ?? `Role ${m.role}`}</Badge>
                      {!m.is_active && <Badge variant="destructive">inactive</Badge>}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recently updated issues</CardTitle>
            </CardHeader>
            <CardContent>
              {d.recent_issues.length === 0 ? (
                <p className="text-sm text-muted-foreground">No issues.</p>
              ) : (
                <ul className="divide-y">
                  {d.recent_issues.map((i) => (
                    <li key={i.id} className="flex items-center gap-2 py-2 text-sm">
                      <span className="whitespace-nowrap text-xs font-medium text-muted-foreground">
                        {i.project_identifier}-{i.sequence_id}
                      </span>
                      {isMember ? (
                        <Link
                          to={`/${slug}/projects/${i.project_id}/issues/${i.sequence_id}`}
                          className="min-w-0 flex-1 truncate hover:underline"
                        >
                          {i.name}
                        </Link>
                      ) : (
                        <span className="min-w-0 flex-1 truncate">{i.name}</span>
                      )}
                      {i.state_name && <Badge variant="outline">{i.state_name}</Badge>}
                      <span className="hidden whitespace-nowrap text-xs text-muted-foreground sm:inline">
                        {fmtAgo(i.updated_at)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {d.agents.length > 0 && (
            <Card>
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <CardTitle className="text-base">Agent usage (all time)</CardTitle>
                <select
                  value={groupBy}
                  onChange={(e) => setGroupBy(e.target.value)}
                  aria-label="Group by"
                  className="h-9 rounded-md border bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {Object.entries(AGENT_GROUPINGS)
                    .filter(([k]) => k !== "workspace")
                    .map(([k, g]) => (
                      <option key={k} value={k}>
                        By {g.label.toLowerCase()}
                      </option>
                    ))}
                </select>
              </CardHeader>
              <CardContent className="p-0 sm:p-2">
                <AgentTable rows={d.agents} groupBy={groupBy} />
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Activity</CardTitle>
            </CardHeader>
            <CardContent>
              <FeedList workspace={slug} />
            </CardContent>
          </Card>
        </div>
      )}
    </QueryState>
  );
}

export default function PlatformWorkspacePage() {
  const { wsSlug } = useParams<{ wsSlug: string }>();
  return (
    <PlatformGate>
      <div className="space-y-4">
        <Link
          to="/admin?tab=workspaces"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Workspaces
        </Link>
        {wsSlug && <WorkspaceDetail slug={wsSlug} />}
      </div>
    </PlatformGate>
  );
}
