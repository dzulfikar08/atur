import { RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PullToRefreshIndicatorProps {
  pullDistance: number;
  isRefreshing: boolean;
  progress: number;
}

export default function PullToRefreshIndicator({
  pullDistance,
  isRefreshing,
  progress,
}: PullToRefreshIndicatorProps) {
  if (pullDistance <= 0 && !isRefreshing) return null;

  return (
    <div
      className="flex items-center justify-center py-2 transition-opacity"
      style={{
        opacity: isRefreshing ? 1 : Math.min(progress, 1),
        transform: `translateY(${Math.min(pullDistance, 60)}px)`,
      }}
    >
      <RefreshCw
        className={cn(
          'h-5 w-5 text-muted-foreground',
          isRefreshing && 'animate-spin',
        )}
        style={{
          transform: isRefreshing ? undefined : `rotate(${progress * 360}deg)`,
          transition: isRefreshing ? undefined : 'transform 0.1s ease-out',
        }}
      />
      <span className="ml-2 text-xs text-muted-foreground">
        {isRefreshing ? 'Refreshing...' : progress >= 1 ? 'Release to refresh' : 'Pull down'}
      </span>
    </div>
  );
}
