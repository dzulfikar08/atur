// IssueQuery: the single description of "which issues, in what order, grouped
// how". It round-trips through the URL (?view=list&product=JoyoFit&due=overdue),
// is the payload of a saved view, and is applied client-side by
// applyIssueQuery(). The server accepts the same names (state_key, priority,
// assignee, label, product, due, q, sort) so both ends agree on the contract.

import { endOfWeek, format } from "date-fns";
import { splitProduct } from "@/lib/product";

export const VIEW_KINDS = ["board", "list", "sheet", "calendar", "gantt"] as const;
export type ViewKind = (typeof VIEW_KINDS)[number];

export const GROUP_BYS = [
  "none",
  "state",
  "priority",
  "product",
  "label",
  "assignee",
  "module",
  "due",
] as const;
export type GroupBy = (typeof GROUP_BYS)[number];

export const SORT_FIELDS = [
  "updated_at",
  "created_at",
  "sequence_id",
  "priority",
  "target_date",
  "start_date",
  "name",
  "state",
] as const;
export type SortField = (typeof SORT_FIELDS)[number];
export type SortDir = "asc" | "desc";

export const PRIORITIES = ["urgent", "high", "medium", "low", "none"] as const;
export const DUE_FILTERS = ["any", "overdue", "today", "week", "none"] as const;
export type DueFilter = (typeof DUE_FILTERS)[number];

// Canonical workflow keys, in workflow order (also the board column order
// tiebreak when every state shares sequence 65535).
export const STATE_KEYS = [
  "backlog",
  "todo",
  "in_progress",
  "needs_you",
  "need_review",
  "done",
  "cancelled",
] as const;
export type StateKey = (typeof STATE_KEYS)[number];

export const STATE_KEY_LABEL: Record<string, string> = {
  backlog: "Backlog",
  todo: "Todo",
  in_progress: "In Progress",
  needs_you: "Needs You",
  need_review: "Need Review",
  done: "Done",
  cancelled: "Cancelled",
};

const GROUP_ORDER: Record<string, number> = {
  backlog: 0,
  unstarted: 1,
  started: 2,
  completed: 3,
  cancelled: 4,
};

export interface IssueQuery {
  view: ViewKind;
  group: GroupBy;
  sort: { field: SortField; dir: SortDir };
  q: string;
  state: string[]; // StateKey list
  done: "hide" | "show";
  priority: string[];
  assignee: string[]; // user uuids | "me" | "none"
  label: string[]; // label uuids
  product: string[];
  module: string[]; // module uuids
  due: DueFilter;
  decision: boolean; // only is_decision issues
  // Inclusive YYYY-MM-DD ranges ("" = open-ended).
  target_from: string;
  target_to: string;
  start_from: string;
  start_to: string;
}

export const DEFAULT_QUERY: IssueQuery = {
  view: "board",
  group: "none",
  sort: { field: "updated_at", dir: "desc" },
  q: "",
  state: [],
  done: "hide",
  priority: [],
  assignee: [],
  label: [],
  product: [],
  module: [],
  due: "any",
  decision: false,
  target_from: "",
  target_to: "",
  start_from: "",
  start_to: "",
};

/**
 * My Issues opens on "assigned to me, not finished". Clearing the assignee
 * chip (?assignee=) widens it to everyone's issues.
 */
export const MY_ISSUES_QUERY: IssueQuery = {
  ...DEFAULT_QUERY,
  view: "list",
  assignee: ["me"],
  done: "hide",
};

// URL keys owned by IssueQuery (everything else, e.g. ?peek=, is untouched).
export const QUERY_KEYS = [
  "view",
  "group",
  "sort",
  "q",
  "state",
  "done",
  "priority",
  "assignee",
  "label",
  "product",
  "module",
  "due",
  "decision",
  "target_from",
  "target_to",
  "start_from",
  "start_to",
] as const;

const LIST_KEYS = ["state", "priority", "assignee", "label", "product", "module"] as const;

const oneOf = <T extends string>(allowed: readonly T[], v: string | null, fallback: T): T =>
  v && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;

const parseList = (v: string): string[] =>
  v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

const isDate = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

const parseSort = (v: string | null, fallback: IssueQuery["sort"]): IssueQuery["sort"] => {
  if (!v) return fallback;
  const [field = "", dir] = v.split(":");
  if (!(SORT_FIELDS as readonly string[]).includes(field)) return fallback;
  return { field: field as SortField, dir: dir === "asc" ? "asc" : "desc" };
};

/**
 * URL → IssueQuery. A key that is present but empty (`?assignee=`) means
 * "explicitly nothing selected" and overrides a non-empty default.
 */
export function parseIssueQuery(
  params: URLSearchParams,
  defaults: IssueQuery = DEFAULT_QUERY,
): IssueQuery {
  const next: IssueQuery = {
    ...defaults,
    view: oneOf(VIEW_KINDS, params.get("view"), defaults.view),
    group: oneOf(GROUP_BYS, params.get("group"), defaults.group),
    sort: parseSort(params.get("sort"), defaults.sort),
    q: params.get("q") ?? defaults.q,
    done: oneOf(["hide", "show"] as const, params.get("done"), defaults.done),
    due: oneOf(DUE_FILTERS, params.get("due"), defaults.due),
    decision: params.has("decision") ? params.get("decision") === "1" : defaults.decision,
    target_from: isDate(params.get("target_from"))
      ? params.get("target_from")!
      : defaults.target_from,
    target_to: isDate(params.get("target_to")) ? params.get("target_to")! : defaults.target_to,
    start_from: isDate(params.get("start_from")) ? params.get("start_from")! : defaults.start_from,
    start_to: isDate(params.get("start_to")) ? params.get("start_to")! : defaults.start_to,
  };
  for (const key of LIST_KEYS) {
    const raw = params.get(key);
    if (raw !== null) next[key] = parseList(raw);
  }
  return next;
}

const sameList = (a: string[], b: string[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

/** IssueQuery → URL params. Values equal to `defaults` are omitted. */
export function serializeIssueQuery(
  query: IssueQuery,
  defaults: IssueQuery = DEFAULT_QUERY,
): URLSearchParams {
  const p = new URLSearchParams();
  if (query.view !== defaults.view) p.set("view", query.view);
  if (query.group !== defaults.group) p.set("group", query.group);
  if (query.sort.field !== defaults.sort.field || query.sort.dir !== defaults.sort.dir)
    p.set("sort", `${query.sort.field}:${query.sort.dir}`);
  if (query.q !== defaults.q) p.set("q", query.q);
  if (query.done !== defaults.done) p.set("done", query.done);
  if (query.due !== defaults.due) p.set("due", query.due);
  if (query.decision !== defaults.decision) p.set("decision", query.decision ? "1" : "0");
  for (const key of ["target_from", "target_to", "start_from", "start_to"] as const)
    if (query[key] !== defaults[key]) p.set(key, query[key]);
  for (const key of LIST_KEYS)
    if (!sameList(query[key], defaults[key])) p.set(key, query[key].join(","));
  return p;
}

/** Rebuild a stored/untrusted query object into a valid IssueQuery (saved views). */
export function normalizeIssueQuery(raw: unknown): IssueQuery {
  if (!raw || typeof raw !== "object") return DEFAULT_QUERY;
  const r = raw as Partial<IssueQuery> & { sort?: Partial<IssueQuery["sort"]> };
  const p = new URLSearchParams();
  if (r.view) p.set("view", r.view);
  if (r.group) p.set("group", r.group);
  if (r.sort?.field) p.set("sort", `${r.sort.field}:${r.sort.dir ?? "desc"}`);
  p.set("q", r.q ?? "");
  if (r.done) p.set("done", r.done);
  if (r.due) p.set("due", r.due);
  if (r.decision !== undefined) p.set("decision", r.decision ? "1" : "0");
  for (const key of ["target_from", "target_to", "start_from", "start_to"] as const)
    if (r[key]) p.set(key, r[key]!);
  for (const key of LIST_KEYS) if (Array.isArray(r[key])) p.set(key, r[key]!.join(","));
  return parseIssueQuery(p, DEFAULT_QUERY);
}

/** Number of active filters (excludes view, group, sort). */
export function activeFilterCount(query: IssueQuery, defaults: IssueQuery = DEFAULT_QUERY): number {
  let n = 0;
  if (query.q.trim()) n++;
  for (const key of LIST_KEYS) if (query[key].length > 0) n++;
  if (query.due !== "any") n++;
  if (query.decision) n++;
  if (query.target_from || query.target_to) n++;
  if (query.start_from || query.start_to) n++;
  if (query.done !== defaults.done && query.done === "show") n++;
  return n;
}

export function isDefaultQuery(query: IssueQuery, defaults: IssueQuery = DEFAULT_QUERY): boolean {
  return serializeIssueQuery(query, defaults).toString() === "";
}

// --- Product -------------------------------------------------------------

export const productOf = (name: string): string | null => splitProduct(name).product;
export const stripProduct = (name: string): string => splitProduct(name).title.trim();

/** Design-token colour for a canonical state key. */
export const STATE_KEY_COLOR: Record<string, string> = {
  backlog: "var(--state-backlog)",
  todo: "var(--state-unstarted)",
  in_progress: "var(--state-started)",
  needs_you: "var(--state-needs-you)",
  need_review: "var(--state-review)",
  done: "var(--state-completed)",
  cancelled: "var(--state-cancelled)",
};

/** data-state-group for .state-badge: canonical review / needs-you keys win over the raw group. */
export function badgeGroup(key: string | null | undefined, group: string | null | undefined) {
  if (key === "needs_you") return "needs-you";
  if (key === "need_review") return "review";
  return group ?? "backlog";
}

// --- Issue facets --------------------------------------------------------

export interface QueryState {
  id: string;
  name: string;
  group: string;
  sequence?: number;
  color?: string;
  key?: string | null;
}

export interface QueryIssue {
  id: string;
  name: string;
  sequence_id: number;
  state_id: string | null;
  priority: string | null;
  created_at: string;
  updated_at: string;
  start_date: string | null;
  target_date: string | null;
  module_ids?: string[];
  is_decision?: boolean | number | null;
  state?: {
    id: string;
    name: string;
    color?: string;
    group: string;
    key?: string | null;
  } | null;
  labels?: { id: string; name: string; color?: string }[];
  assignees?: {
    id: string;
    email?: string;
    username?: string;
    display_name?: string;
  }[];
}

export interface QueryContext {
  states?: QueryState[];
  /** "Now" override for tests. */
  today?: Date;
}

export const dateKey = (d: Date) => format(d, "yyyy-MM-dd");
const day = (v: string | null | undefined) => (v ? v.slice(0, 10) : null);

function stateOf(issue: QueryIssue, byId?: Map<string, QueryState>) {
  const full = issue.state_id ? byId?.get(issue.state_id) : undefined;
  return {
    key: issue.state?.key ?? full?.key ?? null,
    group: issue.state?.group ?? full?.group ?? null,
  };
}

export const isClosedGroup = (group: string | null | undefined) =>
  group === "completed" || group === "cancelled";

export function stateKeyOf(issue: QueryIssue, byId?: Map<string, QueryState>): string | null {
  const { key, group } = stateOf(issue, byId);
  if (key) return key;
  switch (group) {
    case "backlog":
      return "backlog";
    case "unstarted":
      return "todo";
    case "started":
      return "in_progress";
    case "completed":
      return "done";
    case "cancelled":
      return "cancelled";
    default:
      return null;
  }
}

export type DueBucket = "overdue" | "today" | "week" | "later" | "none";

export interface DueRef {
  today: string;
  weekEnd: string;
}

export function dueRef(now: Date = new Date()): DueRef {
  return {
    today: dateKey(now),
    weekEnd: dateKey(endOfWeek(now, { weekStartsOn: 1 })),
  };
}

/** Bucket by target_date. Closed issues never count as overdue. */
export function dueBucket(
  issue: QueryIssue,
  ref: DueRef,
  byId?: Map<string, QueryState>,
): DueBucket {
  const target = day(issue.target_date);
  if (!target) return "none";
  if (target < ref.today) return isClosedGroup(stateOf(issue, byId).group) ? "later" : "overdue";
  if (target === ref.today) return "today";
  if (target <= ref.weekEnd) return "week";
  return "later";
}

export const DUE_BUCKET_LABEL: Record<DueBucket, string> = {
  overdue: "Overdue",
  today: "Today",
  week: "This week",
  later: "Later",
  none: "No date",
};
const DUE_ORDER: DueBucket[] = ["overdue", "today", "week", "later", "none"];

export const isOverdue = (issue: QueryIssue, ref: DueRef, byId?: Map<string, QueryState>) =>
  dueBucket(issue, ref, byId) === "overdue" && !!day(issue.target_date);

// --- Filtering -----------------------------------------------------------

export function applyIssueQuery<T extends QueryIssue>(
  issues: T[],
  query: IssueQuery,
  me: string | null,
  ctx: QueryContext = {},
): T[] {
  const byId = ctx.states ? new Map(ctx.states.map((s) => [s.id, s])) : undefined;
  const ref = dueRef(ctx.today);
  const q = query.q.trim().toLowerCase();
  const assigneeSet = new Set(query.assignee.map((a) => (a === "me" && me ? me : a)));
  const hasState = query.state.length > 0;

  const result = issues.filter((issue) => {
    if (q && !issue.name.toLowerCase().includes(q)) return false;

    if (hasState) {
      const key = stateKeyOf(issue, byId);
      if (!key || !query.state.includes(key)) return false;
    } else if (query.done === "hide" && isClosedGroup(stateOf(issue, byId).group)) {
      return false;
    }

    if (query.priority.length > 0 && !query.priority.includes(issue.priority || "none"))
      return false;

    if (assigneeSet.size > 0) {
      const ids = (issue.assignees ?? []).map((a) => a.id);
      const match =
        (assigneeSet.has("none") && ids.length === 0) || ids.some((id) => assigneeSet.has(id));
      if (!match) return false;
    }

    if (query.label.length > 0) {
      const ids = (issue.labels ?? []).map((l) => l.id);
      if (!ids.some((id) => query.label.includes(id))) return false;
    }

    if (query.product.length > 0) {
      const product = productOf(issue.name);
      if (!product || !query.product.includes(product)) return false;
    }

    if (query.module.length > 0) {
      if (!(issue.module_ids ?? []).some((id) => query.module.includes(id))) return false;
    }

    if (query.decision && !issue.is_decision) return false;

    if (query.due !== "any") {
      const bucket = dueBucket(issue, ref, byId);
      if (query.due === "none" && bucket !== "none") return false;
      if (query.due === "overdue" && bucket !== "overdue") return false;
      if (query.due === "today" && bucket !== "today") return false;
      if (query.due === "week" && bucket !== "today" && bucket !== "week") return false;
    }

    const target = day(issue.target_date);
    if (query.target_from && (!target || target < query.target_from)) return false;
    if (query.target_to && (!target || target > query.target_to)) return false;
    const start = day(issue.start_date);
    if (query.start_from && (!start || start < query.start_from)) return false;
    if (query.start_to && (!start || start > query.start_to)) return false;

    return true;
  });

  return sortIssues(result, query.sort, ctx.states);
}

// --- Sorting -------------------------------------------------------------

const PRIORITY_RANK: Record<string, number> = {
  urgent: 4,
  high: 3,
  medium: 2,
  low: 1,
  none: 0,
};

/** Workflow order: state group, then sequence, then canonical key, then name. */
export function compareStates(a: QueryState, b: QueryState): number {
  const g = (GROUP_ORDER[a.group] ?? 9) - (GROUP_ORDER[b.group] ?? 9);
  if (g) return g;
  const s = (a.sequence ?? 0) - (b.sequence ?? 0);
  if (s) return s;
  const ka = STATE_KEYS.indexOf((a.key ?? "") as StateKey);
  const kb = STATE_KEYS.indexOf((b.key ?? "") as StateKey);
  if (ka !== kb) return (ka < 0 ? 99 : ka) - (kb < 0 ? 99 : kb);
  return a.name.localeCompare(b.name);
}

export const sortStates = <S extends QueryState>(states: S[]): S[] =>
  [...states].sort(compareStates);

export function sortIssues<T extends QueryIssue>(
  issues: T[],
  sort: IssueQuery["sort"],
  states?: QueryState[],
): T[] {
  const sign = sort.dir === "asc" ? 1 : -1;
  const stateRank = new Map<string, number>();
  if (sort.field === "state" && states)
    sortStates(states).forEach((s, i) => stateRank.set(s.id, i));

  const cmp = (a: T, b: T): number => {
    switch (sort.field) {
      case "updated_at":
      case "created_at":
        return (new Date(a[sort.field]).getTime() - new Date(b[sort.field]).getTime()) * sign;
      case "sequence_id":
        return (a.sequence_id - b.sequence_id) * sign;
      case "priority":
        return (
          ((PRIORITY_RANK[a.priority || "none"] ?? 0) -
            (PRIORITY_RANK[b.priority || "none"] ?? 0)) *
          sign
        );
      case "name":
        return a.name.localeCompare(b.name) * sign;
      case "state":
        return (
          ((stateRank.get(a.state_id ?? "") ?? 99) - (stateRank.get(b.state_id ?? "") ?? 99)) * sign
        );
      case "target_date":
      case "start_date": {
        // Undated issues sink to the bottom whichever way you sort.
        const av = day(a[sort.field]);
        const bv = day(b[sort.field]);
        if (!av && !bv) return 0;
        if (!av) return 1;
        if (!bv) return -1;
        return av < bv ? -sign : av > bv ? sign : 0;
      }
    }
  };
  return [...issues].sort((a, b) => cmp(a, b) || b.sequence_id - a.sequence_id);
}

// --- Grouping ------------------------------------------------------------

export interface IssueGroup<T> {
  key: string;
  label: string;
  color?: string;
  issues: T[];
}

export interface GroupContext {
  states?: QueryState[];
  me?: string | null;
  modules?: { id: string; name: string }[];
  today?: Date;
}

const memberName = (a: { display_name?: string; username?: string; email?: string }) =>
  a.display_name || a.username || a.email || "Unknown";

/**
 * Partition (already filtered + sorted) issues into ordered groups. Issues
 * with several assignees/labels/modules land under the FIRST one so a row
 * never appears twice. Empty groups are dropped.
 */
export function groupIssues<T extends QueryIssue>(
  issues: T[],
  by: GroupBy,
  ctx: GroupContext = {},
): IssueGroup<T>[] {
  if (by === "none") return [{ key: "all", label: "All issues", issues }];

  const groups = new Map<string, IssueGroup<T>>();
  const order: string[] = [];
  const put = (key: string, label: string, issue: T, color?: string) => {
    let g = groups.get(key);
    if (!g) {
      g = { key, label, color, issues: [] };
      groups.set(key, g);
    }
    g.issues.push(issue);
  };

  const byId = ctx.states ? new Map(ctx.states.map((s) => [s.id, s])) : undefined;
  const ref = dueRef(ctx.today);

  for (const issue of issues) {
    switch (by) {
      case "state": {
        const st = issue.state_id ? byId?.get(issue.state_id) : undefined;
        if (st) put(st.id, st.name, issue, st.color);
        else if (issue.state) put(issue.state.id, issue.state.name, issue, issue.state.color);
        else put("none", "No state", issue);
        break;
      }
      case "priority": {
        const p = issue.priority || "none";
        put(p, p === "none" ? "No priority" : p.charAt(0).toUpperCase() + p.slice(1), issue);
        break;
      }
      case "product": {
        const product = productOf(issue.name);
        put(product ?? "none", product ?? "No product", issue);
        break;
      }
      case "label": {
        const l = issue.labels?.[0];
        if (l) put(l.id, l.name, issue, l.color);
        else put("none", "No label", issue);
        break;
      }
      case "assignee": {
        const a = issue.assignees?.[0];
        if (a) put(a.id, a.id === ctx.me ? "Me" : memberName(a), issue);
        else put("none", "Unassigned", issue);
        break;
      }
      case "module": {
        const mid = issue.module_ids?.[0];
        const mod = mid ? ctx.modules?.find((m) => m.id === mid) : undefined;
        if (mod) put(mod.id, mod.name, issue);
        else put("none", "No module", issue);
        break;
      }
      case "due": {
        const b = dueBucket(issue, ref, byId);
        put(b, DUE_BUCKET_LABEL[b], issue);
        break;
      }
    }
  }

  order.push(...groups.keys());
  const rank = (g: IssueGroup<T>): [number, string] => {
    if (g.key === "none") return [1000, ""];
    switch (by) {
      case "state": {
        const idx = ctx.states ? sortStates(ctx.states).findIndex((s) => s.id === g.key) : -1;
        return [idx < 0 ? 999 : idx, ""];
      }
      case "priority":
        return [-(PRIORITY_RANK[g.key] ?? 0), ""];
      case "due":
        return [DUE_ORDER.indexOf(g.key as DueBucket), ""];
      case "assignee":
        return [g.key === ctx.me ? -1 : 0, g.label];
      default:
        return [0, g.label];
    }
  };
  return order
    .map((k) => groups.get(k)!)
    .sort((a, b) => {
      const [ra, la] = rank(a);
      const [rb, lb] = rank(b);
      return ra - rb || la.localeCompare(lb);
    });
}

export interface FacetCounts {
  state: Record<string, number>;
  priority: Record<string, number>;
  product: Record<string, number>;
}

/** Facet counts over `issues` (typically the set before state/done filters). */
export function countFacets(issues: QueryIssue[], states?: QueryState[]): FacetCounts {
  const byId = states ? new Map(states.map((s) => [s.id, s])) : undefined;
  const out: FacetCounts = { state: {}, priority: {}, product: {} };
  for (const i of issues) {
    const k = stateKeyOf(i, byId);
    if (k) out.state[k] = (out.state[k] ?? 0) + 1;
    const p = i.priority || "none";
    out.priority[p] = (out.priority[p] ?? 0) + 1;
    const prod = productOf(i.name);
    if (prod) out.product[prod] = (out.product[prod] ?? 0) + 1;
  }
  return out;
}

// --- Presets -------------------------------------------------------------

export interface QueryPreset {
  id: string;
  name: string;
  query: IssueQuery;
}

const preset = (id: string, name: string, patch: Partial<IssueQuery>): QueryPreset => ({
  id,
  name,
  query: { ...DEFAULT_QUERY, view: "list", ...patch },
});

/** Built-in views (not stored; always present as tabs). */
export const PRESET_VIEWS: QueryPreset[] = [
  preset("today", "Today", {
    assignee: ["me"],
    due: "today",
    group: "due",
    sort: { field: "priority", dir: "desc" },
  }),
  preset("needs-you", "Needs You", {
    state: ["needs_you"],
    sort: { field: "target_date", dir: "asc" },
  }),
  preset("week", "This week", {
    due: "week",
    group: "due",
    sort: { field: "target_date", dir: "asc" },
  }),
  preset("joyofit", "JoyoFit open", {
    product: ["JoyoFit"],
    sort: { field: "target_date", dir: "asc" },
    group: "state",
  }),
  preset("joyorogo", "JoyoRogo open", {
    product: ["JoyoRogo"],
    sort: { field: "target_date", dir: "asc" },
    group: "state",
  }),
];

/** Do two queries describe the same filters, sort, group and layout? */
export function sameQuery(a: IssueQuery, b: IssueQuery): boolean {
  return (
    serializeIssueQuery(a, DEFAULT_QUERY).toString() ===
    serializeIssueQuery(b, DEFAULT_QUERY).toString()
  );
}

export interface DerivedOptions {
  assignees: { id: string; name: string }[];
  labels: { id: string; name: string; color?: string }[];
  products: string[];
  counts: FacetCounts;
}

/** Filter-chip options discovered from the issues themselves (cross-project pages). */
export function deriveFilterOptions(issues: QueryIssue[], states?: QueryState[]): DerivedOptions {
  const assignees = new Map<string, string>();
  const labels = new Map<string, { id: string; name: string; color?: string }>();
  const products = new Map<string, number>();
  for (const i of issues) {
    for (const a of i.assignees ?? []) assignees.set(a.id, memberName(a));
    for (const l of i.labels ?? []) labels.set(l.id, l);
    const p = productOf(i.name);
    if (p) products.set(p, (products.get(p) ?? 0) + 1);
  }
  return {
    assignees: [...assignees]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    labels: [...labels.values()].sort((a, b) => a.name.localeCompare(b.name)),
    products: [...products].sort((a, b) => b[1] - a[1]).map(([p]) => p),
    counts: countFacets(issues, states),
  };
}
