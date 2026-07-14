import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiFetch, type AnalyticsOverview, type Project } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Shield, Users, Activity, TrendingUp, TrendingDown, FolderKanban, ArrowUpRight } from '@/lib/icons';

interface Member {
  id: string;
  workspace_id: string;
  member_id: string;
  role: number;
  is_active: boolean;
  created_at: string;
  member?: {
    display_name?: string;
    email?: string;
    username?: string;
  };
}

const ROLE_LABELS: Record<number, string> = {
  20: 'Admin',
  15: 'Member',
  5: 'Guest',
};

function formatTrend(value: number) {
  if (value === 0) return <span className="text-muted-foreground text-xs">0</span>;
  const isPositive = value > 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${isPositive ? 'text-emerald-500' : 'text-red-500'}`}>
      {isPositive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {isPositive ? '+' : ''}{value}
    </span>
  );
}

function StatCard({
  title,
  value,
  trend,
  icon: Icon,
}: {
  title: string;
  value: number;
  trend: number;
  icon: React.ElementType;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{title}</p>
            <p className="mt-1 text-2xl font-bold">{value}</p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <Icon className="h-4 w-4 text-muted-foreground" />
            {formatTrend(trend)}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function StatCardSkeleton() {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="space-y-2">
          <div className="h-4 w-20 animate-pulse rounded bg-muted" />
          <div className="h-7 w-12 animate-pulse rounded bg-muted" />
        </div>
      </CardContent>
    </Card>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function AdminDashboardPage() {
  const { slug } = useParams<{ slug: string }>();

  const { data: overview, isLoading: overviewLoading } = useQuery<AnalyticsOverview>({
    queryKey: ['analytics-overview', slug],
    queryFn: () => apiFetch(`/workspaces/${slug}/analytics/overview`),
    enabled: !!slug,
  });

  const { data: members = [], isLoading: membersLoading } = useQuery<Member[]>({
    queryKey: ['members', slug],
    queryFn: () => apiFetch<{ results: Member[] }>(`/workspaces/${slug}/members/`).then((d) => d.results),
    enabled: !!slug,
  });

  const { data: projects = [], isLoading: projectsLoading } = useQuery<Project[]>({
    queryKey: ['projects', slug],
    queryFn: () => apiFetch<{ results: Project[] }>(`/workspaces/${slug}/projects/`).then((d) => d.results),
    enabled: !!slug,
  });

  if (!slug) return null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Shield className="h-6 w-6" />
        <h1 className="text-2xl font-bold">Admin Dashboard</h1>
      </div>

      {/* Stats Cards */}
      {overviewLoading ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <StatCardSkeleton key={i} />)}
        </div>
      ) : overview ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard title="Total Issues" value={overview.total_issues} trend={overview.total_trend} icon={Activity} />
          <StatCard title="Open Issues" value={overview.open_issues} trend={overview.open_trend} icon={TrendingUp} />
          <StatCard title="Closed Issues" value={overview.closed_issues} trend={overview.closed_trend} icon={TrendingDown} />
          <StatCard title="Overdue Issues" value={overview.overdue_issues} trend={overview.overdue_trend} icon={Activity} />
        </div>
      ) : null}

      {/* Members Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4" />
            Members
          </CardTitle>
          <CardDescription>
            {members.length} {members.length === 1 ? 'member' : 'members'} in this workspace
          </CardDescription>
        </CardHeader>
        <CardContent>
          {membersLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4">
                  <div className="h-4 w-32 animate-pulse rounded bg-muted" />
                  <div className="h-4 w-20 animate-pulse rounded bg-muted" />
                  <div className="h-4 w-16 animate-pulse rounded bg-muted" />
                </div>
              ))}
            </div>
          ) : members.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No members found.</p>
          ) : (
            <div className="overflow-x-auto -mx-6 px-6 md:mx-0 md:px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="hidden sm:table-cell">Status</TableHead>
                  <TableHead className="hidden md:table-cell">Joined</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>
                      <div>
                        <p className="text-sm font-medium">
                          {m.member?.display_name || m.member?.username || 'Unknown'}
                        </p>
                        <p className="text-xs text-muted-foreground">{m.member?.email ?? ''}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{ROLE_LABELS[m.role] ?? `Role ${m.role}`}</Badge>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <Badge variant={m.is_active ? 'outline' : 'secondary'} className={m.is_active ? 'text-emerald-500 border-emerald-500/30' : ''}>
                        {m.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground hidden md:table-cell">
                      {formatDate(m.created_at)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Projects Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <FolderKanban className="h-4 w-4" />
            Projects
          </CardTitle>
          <CardDescription>
            {projects.length} {projects.length === 1 ? 'project' : 'projects'} in this workspace
          </CardDescription>
        </CardHeader>
        <CardContent>
          {projectsLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-5 w-48 animate-pulse rounded bg-muted" />
              ))}
            </div>
          ) : projects.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No projects yet.</p>
          ) : (
            <div className="divide-y divide-border">
              {projects.map((p) => (
                <Link
                  key={p.id}
                  to={`/${slug}/projects/${p.id}`}
                  className="flex items-center justify-between py-3 first:pt-0 last:pb-0 group"
                >
                  <div className="flex items-center gap-3">
                    <FolderKanban className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium group-hover:text-primary transition-colors">
                      {p.name}
                    </span>
                  </div>
                  <ArrowUpRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
