import { useCallback, useEffect, useRef, useState } from "react";

import { type IssueQuery, normalizeIssueQuery } from "@/lib/issue-query";
import { getItem, removeItem, setItem } from "@/lib/storage";

// The web keeps the current filter in the URL; a phone has none, so the query
// is remembered per scope (one project, or "my issues" in one workspace) on
// the device. The search text is deliberately not remembered.
const KEY_PREFIX = "atur.issue-query.";

// Survives screen remounts within a session, so coming back never flashes defaults.
const memory = new Map<string, IssueQuery>();

/**
 * The active IssueQuery for a list, restored from and saved to device
 * storage. `ready` turns true once the stored value has been read.
 */
export function usePersistedQuery(scope: string, defaults: IssueQuery) {
  const [query, setQueryState] = useState<IssueQuery>(() => memory.get(scope) ?? defaults);
  const [ready, setReady] = useState(memory.has(scope));
  const latest = useRef(query);
  latest.current = query;

  useEffect(() => {
    let cancelled = false;
    const cached = memory.get(scope);
    if (cached) {
      setQueryState(cached);
      setReady(true);
      return;
    }
    setReady(false);
    void getItem(KEY_PREFIX + scope).then((raw) => {
      if (cancelled) return;
      let next = defaults;
      try {
        if (raw) next = normalizeIssueQuery(JSON.parse(raw), defaults);
      } catch {
        // Corrupt stored value: fall back to defaults.
      }
      memory.set(scope, next);
      setQueryState(next);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
    // `defaults` is a module constant per screen.
  }, [scope, defaults]);

  const persist = useCallback(
    (next: IssueQuery) => {
      memory.set(scope, next);
      const { q: _q, ...rest } = next;
      void setItem(KEY_PREFIX + scope, JSON.stringify(rest));
    },
    [scope],
  );

  /** Merge a patch; the search text stays session-only. */
  const setQuery = useCallback(
    (patch: Partial<IssueQuery>) => {
      const next = { ...latest.current, ...patch };
      latest.current = next;
      setQueryState(next);
      if (Object.keys(patch).some((k) => k !== "q")) persist(next);
      else memory.set(scope, next);
    },
    [persist, scope],
  );

  /** Replace the whole query (applying a view or preset). */
  const replaceQuery = useCallback(
    (next: IssueQuery) => {
      latest.current = next;
      setQueryState(next);
      persist(next);
    },
    [persist],
  );

  const reset = useCallback(() => {
    latest.current = defaults;
    setQueryState(defaults);
    memory.set(scope, defaults);
    void removeItem(KEY_PREFIX + scope);
  }, [defaults, scope]);

  return { query, ready, setQuery, replaceQuery, reset };
}
