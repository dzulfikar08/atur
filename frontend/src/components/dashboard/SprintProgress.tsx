import { useQuery } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { CalendarDays } from '@/lib/icons';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { api, type SprintData } from '@/lib/api';
import { cn } from '@/lib/utils';

interface SprintProgressProps {
  slug: string;
}

function SprintCardSkeleton() {
  return (
    <div className="space-y-3 p-3 rounded-lg border">
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-3 w-48" />
      <Skeleton className="h-2 w-full" />
      <Skeleton className="h-3 w-20" />
    </div>
  );
}

function SprintItem({ sprint }: { sprint: SprintData }) {
  const percent = sprint.total_issues > 0
    ? Math.round((sprint.completed_issues / sprint.total_issues) * 100)
    : 0;

  const startDate = parseISO(sprint.start_date);
  const endDate = parseISO(sprint.end_date);
  const now = new Date();
  const daysRemaining = Math.max(0, Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
  const isOverdue = endDate < now;

  return (
    <div className="rounded-lg border border-border p-3 transition-colors hover:bg-muted/30">
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-sm font-medium leading-tight">{sprint.name}</h4>
        <Badge
          variant={isOverdue ? 'destructive' : 'secondary'}
          className="shrink-0 text-[10px] px-1.5 py-0"
        >
          {isOverdue ? 'Overdue' : `${daysRemaining}d left`}
        </Badge>
      </div>
      <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
        <CalendarDays className="h-3 w-3" />
        <span>
          {format(startDate, 'MMM d')} - {format(endDate, 'MMM d, yyyy')}
        </span>
      </div>
      {/* Progress bar */}
      <div className="mt-2.5">
        <div className="h-1.5 w-full rounded-full bg-muted">
          <div
            className={cn(
              'h-1.5 rounded-full transition-all',
              percent >= 100
                ? 'bg-emerald-500'
                : percent >= 50
                  ? 'bg-blue-500'
                  : 'bg-amber-500'
            )}
            style={{ width: `${Math.min(percent, 100)}%` }}
          />
        </div>
      </div>
      <div className="mt-1.5 flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {sprint.completed_issues}/{sprint.total_issues} issues
        </span>
        <span className="font-medium text-foreground">{percent}%</span>
      </div>
    </div>
  );
}

export default function SprintProgress({ slug }: SprintProgressProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['sprint-analytics', slug],
    queryFn: () => api.sprintAnalytics(slug),
  });

  const sprints: SprintData[] = data ?? [];

  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold">Active Sprints</CardTitle>
      </CardHeader>
      <CardContent className="flex-1">
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <SprintCardSkeleton key={i} />
            ))}
          </div>
        ) : sprints.length === 0 ? (
          <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
            No active sprints.
          </div>
        ) : (
          <ScrollArea className="h-[340px] pr-2">
            <div className="space-y-3">
              {sprints.map((sprint) => (
                <SprintItem key={sprint.id} sprint={sprint} />
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
