import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { Circle, ArrowUpRight } from '@/lib/icons';
import AnalyticsCards from '@/components/dashboard/AnalyticsCards';
import CompletionChart from '@/components/dashboard/CompletionChart';
import SprintProgress from '@/components/dashboard/SprintProgress';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { api, type Issue } from '@/lib/api';
import { useWorkspaceStore } from '@/stores/workspace';
import { useWorkspaces } from '@/hooks/useWorkspaces';
import { cn } from '@/lib/utils';

const priorityColors: Record<string, string> = {
  urgent: 'text-red-600 dark:text-red-400',
  high: 'text-orange-600 dark:text-orange-400',
  medium: 'text-yellow-600 dark:text-yellow-400',
  low: 'text-blue-600 dark:text-blue-400',
  none: 'text-muted-foreground',
};

function RecentIssuesSkeleton() {
  return (
    <Card>
      <CardHeader className="pb-3">
        <Skeleton className="h-5 w-32" />
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="h-4 w-4" />
              <Skeleton className="h-4 flex-1 max-w-[280px]" />
              <Skeleton className="h-5 w-14 rounded-full" />
              <Skeleton className="h-4 w-20" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function RecentIssues({ slug }: { slug: string }) {
  const isAll = slug === 'all';

  const { data: projects, isLoading: projectsLoading } = useQuery({
    queryKey: ['projects', slug],
    queryFn: () => api.listProjects(slug),
    enabled: !isAll,
  });

  const firstProjectId = projects?.[0]?.id;

  const { data: issues, isLoading: issuesLoading } = useQuery({
    queryKey: ['recent-issues', slug, isAll ? 'all' : firstProjectId],
    queryFn: async (): Promise<Issue[]> => {
      if (isAll) return api.listAllIssues({ limit: 5 });
      if (!firstProjectId) return [];
      const allIssues: Issue[] = [];
      const projectSlice = (projects ?? []).slice(0, 3);
      const results = await Promise.all(
        projectSlice.map((p) => api.listIssues(slug, p.id).catch(() => []))
      );
      for (const projectIssues of results) {
        allIssues.push(...projectIssues);
      }
      return allIssues
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 5);
    },
    enabled: isAll || !!firstProjectId,
  });

  const isLoading = projectsLoading || issuesLoading;

  if (isLoading) return <RecentIssuesSkeleton />;

  const recentIssues = issues ?? [];

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold">Recent Issues</CardTitle>
          <button className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
            View all <ArrowUpRight className="h-3 w-3" />
          </button>
        </div>
      </CardHeader>
      <CardContent>
        {recentIssues.length === 0 ? (
          <div className="flex h-24 items-center justify-center text-sm text-muted-foreground">
            No recent issues.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {recentIssues.map((issue) => (
              <div
                key={issue.id}
                className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0"
              >
                <Circle
                  className={cn(
                    'h-4 w-4 shrink-0',
                    issue.state_id ? 'fill-emerald-500 text-emerald-500' : 'text-muted-foreground'
                  )}
                />
                <span className="flex-1 truncate text-sm">{issue.name}</span>
                <Badge variant="outline" className="shrink-0 text-[10px] px-1.5 py-0 hidden sm:inline-flex">
                  {issue.priority ?? 'none'}
                </Badge>
                <span
                  className={cn(
                    'shrink-0 text-xs font-medium capitalize hidden md:inline',
                    priorityColors[issue.priority ?? 'none'] ?? priorityColors.none
                  )}
                >
                  {issue.priority}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground w-20 sm:w-24 text-right">
                  {formatDistanceToNow(parseISO(issue.created_at), { addSuffix: true })}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function DesktopDashboard() {
  const { slug } = useParams<{ slug: string }>();
  const { data: workspaces = [] } = useWorkspaces();
  const currentSlug = useWorkspaceStore((s) => s.currentSlug);
  const effectiveSlug = slug ?? currentSlug;

  const isAll = effectiveSlug === 'all';
  const workspaceName = isAll
    ? 'All Workspaces'
    : (workspaces.find((w) => w.slug === effectiveSlug)?.name ?? effectiveSlug ?? 'Workspace');

  if (!effectiveSlug) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        No workspace selected.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Welcome to {workspaceName}</h1>
        <p className="mt-1 text-sm text-muted-foreground">Here is an overview of your project activity.</p>
      </div>
      <AnalyticsCards slug={effectiveSlug} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <CompletionChart slug={effectiveSlug} />
        </div>
        <div className="lg:col-span-1">
          <SprintProgress slug={effectiveSlug} />
        </div>
      </div>
      <RecentIssues slug={effectiveSlug} />
    </div>
  );
}
