// Scroll diagnostics for the proof build (EXPO_PUBLIC_ATUR_E2E=1) only: lines tagged
// `ATUR_E2E SCROLL` in logcat say what the terminal list did while the host swiped (scripts/
// e2e-direct-android.sh, phase 4). Nothing is logged, or computed, in any other build.

/** True in the proof build only; guards any call whose arguments cost something to build. */
export const SCROLL_TRACE = process.env.EXPO_PUBLIC_ATUR_E2E === "1";

const started = Date.now();

/** One diagnostic line; `fields` are `key=value` pairs. */
export function scrollTrace(event: string, fields: Record<string, number | string | boolean> = {}) {
  if (!SCROLL_TRACE) return;
  const text = Object.entries(fields)
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");
  console.log(`ATUR_E2E SCROLL t=${Date.now() - started} ${event} ${text}`);
}

/** Counts events and logs the count of each second once, as `<event>_per_s`. */
const counts = new Map<string, { n: number; since: number }>();
export function scrollCount(event: string) {
  if (!SCROLL_TRACE) return;
  const now = Date.now();
  const entry = counts.get(event) ?? { n: 0, since: now };
  entry.n += 1;
  if (now - entry.since >= 1000) {
    scrollTrace(`${event}_per_s`, { n: entry.n });
    entry.n = 0;
    entry.since = now;
  }
  counts.set(event, entry);
}
