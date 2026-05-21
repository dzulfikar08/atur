import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { format, parseISO, compareDesc } from "date-fns";
import { CalendarDays, ArrowRight } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface Cycle {
  id: string;
  name: string;
  description: string | null;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
  updated_at: string;
  project: string;
  workspace: string;
  owned_by: string;
  total_issues: number;
  completed_issues: number;
}

interface CycleListProps {
  slug: string;
  projectId: string;
}

function CycleCardSkeleton() {
  return (
    <div className="space-y-3 rounded-lg border p-4">
      <Skeleton className="h-5 w-36" />
      <Skeleton className="h-3 w-48" />
      <Skeleton className="h-2 w-full" />
      <div className="flex justify-between">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-3 w-10" />
      </div>
    </div>
  );
}

function CycleCard({ cycle, slug, projectId }: { cycle: Cycle; slug: string; projectId: string }) {
  const navigate = useNavigate();

  const total = cycle.total_issues ?? 0;
  const completed = cycle.completed_issues ?? 0;
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

  const now = new Date();
  let statusBadge: React.ReactNode = null;

  if (cycle.start_date && cycle.end_date) {
    const start = parseISO(cycle.start_date);
    const end = parseISO(cycle.end_date);

    if (end < now && percent < 100) {
      statusBadge = <Badge variant="destructive">Overdue</Badge>;
    } else if (start <= now && end >= now) {
      const daysLeft = Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      statusBadge = <Badge variant="secondary">{daysLeft}d left</Badge>;
    } else if (start > now) {
      statusBadge = <Badge variant="outline">Upcoming</Badge>;
    } else if (percent >= 100) {
      statusBadge = <Badge className="bg-emerald-500 text-white hover:bg-emerald-600">Completed</Badge>;
    }
  }

  return (
    <Card
      className="cursor-pointer hover:border-primary/50 transition-colors"
      onClick={() => navigate(`/${slug}/projects/${projectId}/cycles/${cycle.id}`)}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold truncate">{cycle.name}</h3>
            {cycle.start_date && cycle.end_date && (
              <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                <CalendarDays className="h-3 w-3" />
                <span>
                  {format(parseISO(cycle.start_date), "MMM d")} -{" "}
                  {format(parseISO(cycle.end_date), "MMM d, yyyy")}
                </span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {statusBadge}
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
          </div>
        </div>

        {cycle.description && (
          <p className="mt-2 text-xs text-muted-foreground line-clamp-2">
            {cycle.description}
          </p>
        )}

        {/* Progress bar */}
        <div className="mt-3">
          <div className="h-1.5 w-full rounded-full bg-muted">
            <div
              className={cn(
                "h-1.5 rounded-full transition-all",
                percent >= 100
                  ? "bg-emerald-500"
                  : percent >= 50
                    ? "bg-blue-500"
                    : "bg-amber-500"
              )}
              style={{ width: `${Math.min(percent, 100)}%` }}
            />
          </div>
          <div className="mt-1.5 flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {completed}/{total} issues
            </span>
            <span className="font-medium text-foreground">{percent}%</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function CycleList({ slug, projectId }: CycleListProps) {
  const { data: cycles = [], isLoading } = useQuery({
    queryKey: ["cycles", slug, projectId],
    queryFn: () =>
      apiFetch<Cycle[]>(
        `/workspaces/${slug}/projects/${projectId}/cycles/`
      ),
    enabled: !!slug && !!projectId,
  });

  const sorted = [...cycles].sort((a, b) => {
    const aDate = a.start_date ? a.start_date : a.created_at;
    const bDate = b.start_date ? b.start_date : b.created_at;
    return compareDesc(new Date(aDate), new Date(bDate));
  });

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <CycleCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (sorted.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="rounded-full bg-muted p-4 mb-4">
          <CalendarDays className="h-8 w-8 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-medium">No cycles yet</h3>
        <p className="mt-1 text-sm text-muted-foreground max-w-sm">
          Create your first sprint to start planning and tracking work in iterative cycles.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {sorted.map((cycle) => (
        <CycleCard
          key={cycle.id}
          cycle={cycle}
          slug={slug}
          projectId={projectId}
        />
      ))}
    </div>
  );
}
