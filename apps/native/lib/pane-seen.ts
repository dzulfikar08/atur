import { useSyncExternalStore } from "react";

import type { PaneListItem } from "@/lib/api";
import {
  acknowledge,
  isActionable,
  pruneSeen,
  type PaneAttention,
  type PaneSeen,
} from "@/lib/pane-meta";
import { getItem, removeItem, setItem } from "@/lib/storage";

// Which done / needs-you states the user already looked at, per pane, so the
// badge and the Today section only ask for what is new. Persisted so a restart
// doesn't resurrect everything that was already dealt with.
const KEY = "atur.pane_seen";

let seen: PaneSeen = {};
const listeners = new Set<() => void>();
let loading: Promise<void> | null = null;

function publish(next: PaneSeen) {
  if (next === seen) return;
  seen = next;
  for (const listener of listeners) listener();
  void setItem(KEY, JSON.stringify(next));
}

function parse(raw: string | null): PaneSeen {
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return {};
    const out: Record<string, PaneAttention> = {};
    for (const [paneId, attention] of Object.entries(value)) {
      if (attention === "needs-you" || attention === "done") out[paneId] = attention;
    }
    return out;
  } catch {
    return {};
  }
}

/** Reads the persisted state once; later calls reuse the first load. */
export function loadPaneSeen(): Promise<void> {
  loading ??= getItem(KEY).then((raw) => {
    // Anything acknowledged while the read was in flight wins.
    seen = { ...parse(raw), ...seen };
    for (const listener of listeners) listener();
  });
  return loading;
}

/** The user opened `paneId` while it was in `attention`. */
export function acknowledgePane(paneId: string, attention: PaneAttention) {
  if (!isActionable(attention)) return;
  publish(acknowledge(seen, paneId, attention));
}

/** Drop acknowledgements the latest pane list has outgrown. */
export function prunePaneSeen(list: readonly PaneListItem[]) {
  publish(pruneSeen(seen, list));
}

export async function clearPaneSeen(): Promise<void> {
  seen = {};
  for (const listener of listeners) listener();
  await removeItem(KEY);
}

export function usePaneSeen(): PaneSeen {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => seen,
  );
}
