import { useCallback, useRef, useState } from 'react';

interface UsePullToRefreshOptions {
  /** Distance in px required to trigger refresh (default 80) */
  threshold?: number;
  /** Callback invoked when pull crosses threshold */
  onRefresh: () => Promise<void> | void;
}

interface UsePullToRefreshReturn {
  /** Current pull distance in px (0 when not pulling) */
  pullDistance: number;
  /** True while the user is actively pulling */
  isPulling: boolean;
  /** True while the async refresh callback is running */
  isRefreshing: boolean;
  /** Spread these onto the scrollable container element */
  pullHandlers: {
    onTouchStart: (e: React.TouchEvent) => void;
    onTouchMove: (e: React.TouchEvent) => void;
    onTouchEnd: () => void;
  };
  /** Style object to apply on a pull indicator element */
  pullIndicatorStyle: React.CSSProperties;
  /** 0-1 progress toward the threshold */
  progress: number;
}

const THRESHOLD_DEFAULT = 80;

export default function usePullToRefresh({
  threshold = THRESHOLD_DEFAULT,
  onRefresh,
}: UsePullToRefreshOptions): UsePullToRefreshReturn {
  const [pullDistance, setPullDistance] = useState(0);
  const [isPulling, setIsPulling] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const startY = useRef(0);
  const canPull = useRef(false);

  const isTouchDevice = useCallback(() => {
    if (typeof window === 'undefined') return false;
    return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  }, []);

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (!isTouchDevice()) return;

      // Only allow pull when the container is scrolled to the very top
      const target = e.currentTarget;
      if (target.scrollTop > 0) {
        canPull.current = false;
        return;
      }

      canPull.current = true;
      startY.current = e.touches[0].clientY;
      setIsPulling(true);
    },
    [isTouchDevice],
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!isTouchDevice() || !canPull.current || isRefreshing) return;

      const diff = e.touches[0].clientY - startY.current;

      // Only care about downward pulls
      if (diff <= 0) {
        setPullDistance(0);
        return;
      }

      // Apply rubber-band resistance: grows slower as you pull further
      const resistance = 0.5;
      const maxPull = threshold * 2.5;
      const dist = Math.min(diff * resistance, maxPull);
      setPullDistance(dist);
    },
    [isTouchDevice, isRefreshing, threshold],
  );

  const handleTouchEnd = useCallback(async () => {
    if (!canPull.current) return;

    canPull.current = false;
    setIsPulling(false);

    if (pullDistance >= threshold && !isRefreshing) {
      setIsRefreshing(true);
      try {
        await onRefresh();
      } finally {
        setIsRefreshing(false);
        setPullDistance(0);
      }
    } else {
      setPullDistance(0);
    }
  }, [pullDistance, threshold, isRefreshing, onRefresh]);

  const progress = Math.min(pullDistance / threshold, 1);
  const pullIndicatorStyle: React.CSSProperties = {
    transform: `translateY(${pullDistance}px)`,
    opacity: pullDistance > 0 ? 1 : 0,
  };

  return {
    pullDistance,
    isPulling,
    isRefreshing,
    pullHandlers: {
      onTouchStart: handleTouchStart,
      onTouchMove: handleTouchMove,
      onTouchEnd: handleTouchEnd,
    },
    pullIndicatorStyle,
    progress,
  };
}
