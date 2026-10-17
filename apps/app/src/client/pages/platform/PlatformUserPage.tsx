import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { platformApi } from "@/lib/platformApi";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft } from "@/lib/icons";
import {
  AGENT_GROUPINGS,
  PlatformGate,
  AgentTable,
  FeedList,
  QueryState,
  ROLE_LABELS,
  fmtAgo,
  fmtDate,
} from "./parts";

function UserDetail({ id }: { id: string }) {
  const [groupBy, setGroupBy] = useState("workspace");
  const q = useQuery({ queryKey: ["platform", "user", id], queryFn: () => platformApi.user(id) });
  const d = q.data;
  return (
    <QueryState isLoading={q.isLoading} error={q.error}>
      {d && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <Avatar className="h-12 w-12">
              {d.user.avatar ? <AvatarImage src={d.user.avatar} alt="" /> : null}
              <AvatarFallback>
                {(d.user.display_name || d.user.email).slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <h1 className="flex flex-wrap items-center gap-2 text-xl font-bold">
                {d.user.display_name || d.user.username}
                {!!d.user.is_superuser && <Badge variant="secondary">superuser</Badge>}
                {!!d.user.is_bot && <Badge variant="outline">bot</Badge>}
                {!!d.user.is_customer && <Badge variant="outline">customer</Badge>}
                {!d.user.is_active && <Badge variant="destructive">inactive</Badge>}
              </h1>
              <p className="truncate text-sm text-muted-foreground">
                {d.user.email} · @{d.user.username}
                {d.user.is_email_verified ? "" : " · email unverified"}
              </p>
              <p className="text-xs text-muted-foreground">
                Joined {fmtDate(d.user.created_at)} · {d.user.user_timezone ?? "UTC"} · session
                {d.user.session_expires_at
                  ? ` expires ${new Date(d.user.session_expires_at).toLocaleString()}`
                  : " none"}
              </p>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Workspaces ({d.memberships.length})</CardTitle>
              </CardHeader>
              <CardContent>
                {d.memberships.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Not a member of any workspace.</p>
                ) : (
                  <ul className="divide-y">
                    {d.memberships.map((m) => (
                      <li key={m.workspace_id} className="flex items-center gap-2 py-2 text-sm">
                        <Link
                          to={`/admin/workspaces/${m.slug}`}
                          className="min-w-0 flex-1 truncate font-medium hover:underline"
                        >
                          {m.name}
                        </Link>
                        {!!m.is_owner && <Badge variant="secondary">owner</Badge>}
                        <Badge variant="outline">{ROLE_LABELS[m.role] ?? `Role ${m.role}`}</Badge>
                        {!m.is_active && <Badge variant="destructive">inactive</Badge>}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">API keys ({d.api_keys.length})</CardTitle>
              </CardHeader>
              <CardContent>
                {d.api_keys.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No API keys.</p>
                ) : (
                  <ul className="divide-y">
                    {d.api_keys.map((k) => (
                      <li key={k.id} className="flex items-center gap-2 py-2 text-sm">
                        <span className="min-w-0 flex-1 truncate font-medium">
                          {k.label || "Unlabeled"}
                          {k.workspace_slug && (
                            <span className="font-normal text-muted-foreground">
                              {" "}
                              · {k.workspace_slug}
                            </span>
                          )}
                        </span>
                        {!k.is_active && <Badge variant="destructive">revoked</Badge>}
                        <span className="whitespace-nowrap text-xs text-muted-foreground">
                          used {fmtAgo(k.last_used_at)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>

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
                  {Object.entries(AGENT_GROUPINGS).map(([k, g]) => (
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
              <FeedList actor={id} />
            </CardContent>
          </Card>
        </div>
      )}
    </QueryState>
  );
}

export default function PlatformUserPage() {
  const { userId } = useParams<{ userId: string }>();
  return (
    <PlatformGate>
      <div className="space-y-4">
        <Link
          to="/admin?tab=users"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Users
        </Link>
        {userId && <UserDetail id={userId} />}
      </div>
    </PlatformGate>
  );
}
