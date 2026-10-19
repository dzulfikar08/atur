// Reconnect policy for the Screen view, after Windows App: a dropped session
// reconnects on its own (up to 20 attempts, backing off to 5 s between them)
// while the last frame stays on screen. A session another viewer took over
// stays ended.

export const MAX_RECONNECT_ATTEMPTS = 20;

/** Close codes the bridge uses for the screen socket (apps/bridge/src/screen.ts). */
export const SCREEN_CLOSE = {
  /** Another viewer took this desktop over. */
  replaced: 4001,
  /** The bridge stopped hearing pings from this viewer. */
  timedOut: 4002,
  /** Older bridges refused extra viewers outright. */
  tooManyViewers: 1013,
} as const;

/** Delay before reconnect attempt `attempt` (1-based): immediate, then 1, 2, 3, 5, 5… s. */
export function reconnectDelay(attempt: number): number {
  const steps = [0, 1000, 2000, 3000];
  return steps[attempt - 1] ?? 5000;
}

/** Whether to reconnect after the live session closed with `code`, `attempt` retries in. */
export function shouldAutoReconnect(code: number | undefined, attempt: number): boolean {
  if (attempt >= MAX_RECONNECT_ATTEMPTS) return false;
  return code !== SCREEN_CLOSE.replaced && code !== SCREEN_CLOSE.tooManyViewers;
}
