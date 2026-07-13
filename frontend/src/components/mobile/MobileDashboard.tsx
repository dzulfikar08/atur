import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Issue } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { Layers, Circle, CheckCircle2, AlertTriangle } from '@/lib/icons';
import MobileIssueCard from './MobileIssueCard';
import { useNavigate } from 'react-router-dom';
import usePullToRefresh from '@/hooks/usePullToRefresh';
import PullToRefreshIndicator from './PullToRefreshIndicator';
import { hapticMedium } from '@/lib/haptics';

interface MobileDashboardProps {
  slug: string;
  workspaceName: string;
}

const stats = [
  { key: 'total_issues', label: 'Total', icon: Layers, color: 'text-blue-500 bg-blue-50 dark:bg-blue-950/40' },
  { key: 'open_issues', label: 'Open', icon: Circle, color: 'text-amber-500 bg-amber-50 dark:bg-amber-950/40' },
  { key: 'closed_issues', label: 'Done', icon: CheckCircle2, color: 'text-emerald-500 bg-emerald-50 dark:bg-emerald-950/40' },
  { key: 'overdue_issues', label: 'Overdue', icon: AlertTriangle, color: 'text-red-500 bg-red-50 dark:bg-red-950/40' },
] as const;

export default function MobileDashboard({ slug, workspaceName }: MobileDashboardProps) {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: overview, isLoading: overviewLoading } = useQuery({
    queryKey: ['analytics-overview', slug],
    queryFn: () => api.analyticsOverview(slug),
  });

  const { data: projects = [] } = useQuery({
    queryKey: ['projects', slug],
    queryFn: () => api.listProjects(slug),
  });

  const firstProjectId = projects?.[0]?.id;

  const { data: recentIssues = [] } = useQuery({
    queryKey: ['recent-issues-mobile', slug, firstProjectId],
    queryFn: async () => {
      if (!firstProjectId) return [];
      const all: Issue[] = [];
      const slice = (projects ?? []).slice(0, 3);
      const results = await Promise.all(slice.map((p) => api.listIssues(slug, p.id).catch(() => [])));
      for (const pi of results) all.push(...pi);
      return all.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, 5);
    },
    enabled: !!firstProjectId,
  });

  const { data: states = [] } = useQuery({
    queryKey: ['states', slug, firstProjectId],
    queryFn: () => api.listStates(slug!, firstProjectId!),
    enabled: !!slug && !!firstProjectId,
  });

  const { pullDistance, isRefreshing, progress, pullHandlers } = usePullToRefresh({
    onRefresh: async () => {
      hapticMedium();
      await qc.invalidateQueries({ queryKey: ['analytics-overview', slug] });
      await qc.invalidateQueries({ queryKey: ['projects', slug] });
      await qc.invalidateQueries({ queryKey: ['recent-issues-mobile', slug] });
      await qc.invalidateQueries({ queryKey: ['states', slug] });
    },
  });

  return (
    <div
      className="space-y-4 overflow-y-auto"
      {...pullHandlers}
    >
      <PullToRefreshIndicator pullDistance={pullDistance} isRefreshing={isRefreshing} progress={progress} />
      {/* Welcome */}
      <div>
        <h1 className="text-lg font-bold">{workspaceName}</h1>
        <p className="text-xs text-muted-foreground">Your project overview</p>
      </div>

      {/* Quick stats - 2x2 grid */}
      <div className="grid grid-cols-2 gap-2">
        {stats.map((s) => {
          const Icon = s.icon;
          const value = overview?.[s.key] ?? 0;
          return (
            <Card key={s.key} className="p-0">
              <CardContent className="p-3 flex items-center gap-2.5">
                <div className={cn('h-8 w-8 rounded-lg flex items-center justify-center', s.color)}>
                  <Icon className="h-4 w-4" />
                </div>
                <div>
                  {overviewLoading ? (
                    <div className="h-5 w-8 rounded bg-muted animate-pulse" />
                  ) : (
                    <p className="text-lg font-bold leading-none">{value}</p>
                  )}
                  <p className="text-[10px] text-muted-foreground">{s.label}</p>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-2 gap-2">
        <button
          className="rounded-xl border bg-card p-3 text-left active:bg-muted/50 transition-colors"
          onClick={() => navigate(`/${slug}/issues`)}
        >
          <p className="text-sm font-medium">My Issues</p>
          <p className="text-[10px] text-muted-foreground">View all your issues</p>
        </button>
        <button
          className="rounded-xl border bg-card p-3 text-left active:bg-muted/50 transition-colors"
          onClick={() => navigate(`/${slug}/projects`)}
        >
          <p className="text-sm font-medium">Projects</p>
          <p className="text-[10px] text-muted-foreground">{projects.length} projects</p>
        </button>
      </div>

      {/* Recent issues */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold">Recent Activity</h2>
          <button
            className="text-xs text-primary font-medium"
            onClick={() => navigate(`/${slug}/issues`)}
          >
            View all
          </button>
        </div>
        <div className="space-y-2">
          {recentIssues.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-6">No recent issues</p>
          ) : (
            recentIssues.map((issue) => (
              <MobileIssueCard
                key={issue.id}
                issue={issue as any}
                slug={slug}
                states={states}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
