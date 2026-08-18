import { useQuery } from "@tanstack/react-query";
import {
  Layers,
  Circle,
  CheckCircle2,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Minus,
} from "@/lib/icons";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type AnalyticsOverview } from "@/lib/api";
import { cn } from "@/lib/utils";

interface AnalyticsCardsProps {
  slug: string;
}

interface CardConfig {
  key: keyof AnalyticsOverview;
  trendKey: keyof AnalyticsOverview;
  label: string;
  icon: typeof Layers;
  color: string;
  bgColor: string;
}

const cards: CardConfig[] = [
  {
    key: "total_issues",
    trendKey: "total_trend",
    label: "Total Issues",
    icon: Layers,
    color: "text-blue-600 dark:text-blue-400",
    bgColor: "bg-blue-50 dark:bg-blue-950/40",
  },
  {
    key: "open_issues",
    trendKey: "open_trend",
    label: "Open Issues",
    icon: Circle,
    color: "text-amber-600 dark:text-amber-400",
    bgColor: "bg-amber-50 dark:bg-amber-950/40",
  },
  {
    key: "closed_issues",
    trendKey: "closed_trend",
    label: "Closed Issues",
    icon: CheckCircle2,
    color: "text-emerald-600 dark:text-emerald-400",
    bgColor: "bg-emerald-50 dark:bg-emerald-950/40",
  },
  {
    key: "overdue_issues",
    trendKey: "overdue_trend",
    label: "Overdue Issues",
    icon: AlertTriangle,
    color: "text-red-600 dark:text-red-400",
    bgColor: "bg-red-50 dark:bg-red-950/40",
  },
];

function TrendIndicator({ value }: { value: number }) {
  if (value > 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
        <TrendingUp className="h-3 w-3" />+{value}%
      </span>
    );
  }
  if (value < 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-xs font-medium text-red-600 dark:text-red-400">
        <TrendingDown className="h-3 w-3" />
        {value}%
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-0.5 text-xs font-medium text-muted-foreground">
      <Minus className="h-3 w-3" />
      0%
    </span>
  );
}

function AnalyticsCardSkeleton() {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-9 w-9 rounded-lg" />
        </div>
        <Skeleton className="mt-3 h-8 w-16" />
        <Skeleton className="mt-1.5 h-3 w-14" />
      </CardContent>
    </Card>
  );
}

export default function AnalyticsCards({ slug }: AnalyticsCardsProps) {
  const isAll = slug === "all";
  const { data, isLoading } = useQuery({
    queryKey: ["analytics-overview", slug],
    queryFn: () => (isAll ? api.allAnalyticsOverview() : api.analyticsOverview(slug)),
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((_, i) => (
          <AnalyticsCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((config) => {
        const Icon = config.icon;
        const value = data?.[config.key] ?? 0;
        const trend = data?.[config.trendKey] ?? 0;

        return (
          <Card key={config.key} className="transition-shadow duration-200 hover:shadow-elevated">
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-muted-foreground">{config.label}</p>
                <div
                  className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-xl shadow-soft",
                    config.bgColor,
                  )}
                >
                  <Icon className={cn("h-4.5 w-4.5", config.color)} />
                </div>
              </div>
              <p className="mt-3 text-2xl font-bold tracking-tight">{value.toLocaleString()}</p>
              <div className="mt-1.5 flex items-center gap-1.5">
                <TrendIndicator value={trend} />
                <span className="text-xs text-muted-foreground">vs last period</span>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
