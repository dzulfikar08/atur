import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import {
  DEFAULT_QUERY,
  QUERY_KEYS,
  parseIssueQuery,
  serializeIssueQuery,
  type IssueQuery,
} from "@/lib/issueQuery";

export type QueryPatch = Partial<IssueQuery> | ((prev: IssueQuery) => IssueQuery);

/**
 * IssueQuery bound to the URL. Every filter/sort/group lives in the query
 * string so a reload or a shared link restores the exact view. `defaults` are
 * the page's baseline (e.g. My Issues defaults to assignee=me): values equal
 * to the default are omitted from the URL, and anything the page doesn't own
 * (?peek=) is preserved.
 */
export function useIssueQuery(defaults: IssueQuery = DEFAULT_QUERY) {
  const [params, setParams] = useSearchParams();
  const query = useMemo(() => parseIssueQuery(params, defaults), [params, defaults]);

  const setQuery = useCallback(
    (patch: QueryPatch) => {
      setParams(
        (prev) => {
          const current = parseIssueQuery(prev, defaults);
          const next = typeof patch === "function" ? patch(current) : { ...current, ...patch };
          const out = new URLSearchParams(prev);
          for (const key of QUERY_KEYS) out.delete(key);
          for (const [k, v] of serializeIssueQuery(next, defaults)) out.set(k, v);
          return out;
        },
        { replace: true },
      );
    },
    [setParams, defaults],
  );

  /** Clear filters and sort/group back to the defaults; the layout (view) stays. */
  const reset = useCallback(
    () => setQuery((prev) => ({ ...defaults, view: prev.view })),
    [setQuery, defaults],
  );

  return { query, setQuery, reset, defaults };
}
