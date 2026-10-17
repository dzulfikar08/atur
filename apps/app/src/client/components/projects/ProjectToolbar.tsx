import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import FilterBar, { type FilterOptions } from "@/components/issues/FilterBar";
import { Check, Save, Search, SlidersHorizontal, Trash2, X } from "@/lib/icons";
import {
  GROUP_BYS,
  PRESET_VIEWS,
  activeFilterCount,
  isDefaultQuery,
  sameQuery,
  type GroupBy,
  type IssueQuery,
  type SortField,
} from "@/lib/issueQuery";
import type { QueryPatch } from "@/hooks/useIssueQuery";
import type { SavedView } from "@/hooks/useSavedViews";
import type { UseMutationResult } from "@tanstack/react-query";

// --- Visible list columns (the Display popover's "Properties") ---------------

export const LIST_COLUMNS = [
  { id: "product", label: "Product" },
  { id: "state", label: "State" },
  { id: "priority", label: "Priority" },
  { id: "due", label: "Due" },
  { id: "labels", label: "Labels" },
  { id: "assignee", label: "Assignee" },
  { id: "module", label: "Module" },
  { id: "points", label: "Points" },
  { id: "updated", label: "Updated" },
] as const;
export type ListColumn = (typeof LIST_COLUMNS)[number]["id"];

const DEFAULT_COLUMNS: ListColumn[] = [
  "product",
  "state",
  "priority",
  "due",
  "labels",
  "assignee",
  "updated",
];
const COLUMNS_KEY = "atur.list-columns";

/** Visible list columns, remembered per browser. */
export function useVisibleColumns() {
  const [columns, setColumns] = useState<ListColumn[]>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(COLUMNS_KEY) ?? "null");
      if (Array.isArray(raw))
        return raw.filter((c): c is ListColumn => LIST_COLUMNS.some((x) => x.id === c));
    } catch {
      // Unreadable preference: fall back to the defaults.
    }
    return DEFAULT_COLUMNS;
  });
  const toggle = (id: ListColumn) =>
    setColumns((prev) => {
      const next = prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id];
      localStorage.setItem(COLUMNS_KEY, JSON.stringify(next));
      return next;
    });
  return { columns, toggle };
}

// --- Display popover -----------------------------------------------------------

const GROUP_LABEL: Record<GroupBy, string> = {
  none: "No grouping",
  state: "State",
  priority: "Priority",
  product: "Product",
  label: "Label",
  assignee: "Assignee",
  module: "Module",
  due: "Due date",
};

const SORT_LABEL: Record<SortField, string> = {
  updated_at: "Updated",
  created_at: "Created",
  sequence_id: "ID",
  priority: "Priority",
  target_date: "Target date",
  start_date: "Start date",
  name: "Title",
  state: "State",
};

function DisplayPopover({
  query,
  onChange,
  columns,
  onToggleColumn,
}: {
  query: IssueQuery;
  onChange: (patch: Partial<IssueQuery>) => void;
  columns: ListColumn[];
  onToggleColumn: (id: ListColumn) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 rounded-full px-3 text-xs">
          <SlidersHorizontal className="h-3.5 w-3.5" /> Display
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-3 p-3">
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Group by</p>
          <Select value={query.group} onValueChange={(v) => onChange({ group: v as GroupBy })}>
            <SelectTrigger className="h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {GROUP_BYS.map((g) => (
                <SelectItem key={g} value={g}>
                  {GROUP_LABEL[g]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Sort by</p>
          <div className="flex gap-1.5">
            <Select
              value={query.sort.field}
              onValueChange={(v) => onChange({ sort: { ...query.sort, field: v as SortField } })}
            >
              <SelectTrigger className="h-8 flex-1 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(SORT_LABEL) as SortField[]).map((f) => (
                  <SelectItem key={f} value={f}>
                    {SORT_LABEL[f]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              className="h-8 w-16 text-xs"
              onClick={() =>
                onChange({
                  sort: {
                    ...query.sort,
                    dir: query.sort.dir === "asc" ? "desc" : "asc",
                  },
                })
              }
            >
              {query.sort.dir === "asc" ? "Asc" : "Desc"}
            </Button>
          </div>
        </div>
        {query.view === "list" && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Properties</p>
            <div className="flex flex-wrap gap-1">
              {LIST_COLUMNS.map((c) => {
                const on = columns.includes(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => onToggleColumn(c.id)}
                    className={`inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs ${
                      on
                        ? "border-primary/40 bg-primary/10 text-foreground"
                        : "text-muted-foreground"
                    }`}
                  >
                    {on && <Check className="h-3 w-3" />}
                    {c.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

// --- Saved-view tabs -----------------------------------------------------------

interface SavedViewsApi {
  views: SavedView[];
  save: UseMutationResult<unknown, Error, { name: string; query: IssueQuery }>;
  update: UseMutationResult<unknown, Error, { id: string; name?: string; query?: IssueQuery }>;
  remove: UseMutationResult<unknown, Error, string>;
}

/** Compare ignoring the layout tab, so a preset stays "active" on board/list/gantt. */
const sameFilters = (a: IssueQuery, b: IssueQuery) =>
  sameQuery({ ...a, view: "list" }, { ...b, view: "list" });

function ViewTabs({
  query,
  defaults,
  onApply,
  saved,
  allLabel,
}: {
  query: IssueQuery;
  defaults: IssueQuery;
  onApply: (q: IssueQuery, keepLayout: boolean) => void;
  saved?: SavedViewsApi;
  allLabel: string;
}) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  // The saved view the user last opened: a modified query then offers "Update".
  const [appliedId, setAppliedId] = useState<string | null>(null);

  const tabs = useMemo(
    () => [
      { id: "all", name: allLabel, query: defaults, saved: false },
      ...PRESET_VIEWS.map((p) => ({ ...p, saved: false })),
      ...(saved?.views ?? []).map((v) => ({ ...v, saved: true })),
    ],
    [allLabel, defaults, saved?.views],
  );
  const active = tabs.find((t) => sameFilters(t.query, query));
  const appliedSaved = saved?.views.find((v) => v.id === appliedId);
  const modified = !active && !isDefaultQuery(query, defaults);

  const submitName = () => {
    const trimmed = name.trim();
    if (!trimmed || !saved) return;
    saved.save.mutate({ name: trimmed, query }, { onSuccess: () => setNaming(false) });
    setName("");
  };

  return (
    <div className="flex flex-wrap items-center gap-1">
      {tabs.map((t) => {
        const isActive = active?.id === t.id;
        return (
          <span
            key={t.id}
            className={`group inline-flex h-7 items-center rounded-md text-xs font-medium transition-colors ${
              isActive
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
            }`}
          >
            <button
              type="button"
              aria-pressed={isActive}
              className="h-7 px-2.5"
              onClick={() => {
                setAppliedId(t.saved ? t.id : null);
                onApply(t.query, !t.saved);
              }}
            >
              {t.name}
            </button>
            {t.saved && saved && (
              <button
                type="button"
                aria-label={`Delete view ${t.name}`}
                className="mr-1 hidden h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-destructive group-hover:inline-flex"
                onClick={() => saved.remove.mutate(t.id)}
              >
                <Trash2 className="h-3 w-3" />
              </button>
            )}
          </span>
        );
      })}
      {saved && modified && !naming && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-xs"
          onClick={() => setNaming(true)}
        >
          <Save className="h-3 w-3" /> Save view
        </Button>
      )}
      {saved && appliedSaved && modified && !naming && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-xs"
          onClick={() => saved.update.mutate({ id: appliedSaved.id, query })}
        >
          <Save className="h-3 w-3" /> Update “{appliedSaved.name}”
        </Button>
      )}
      {saved && naming && (
        <form
          className="flex items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            submitName();
          }}
        >
          <Input
            autoFocus
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setNaming(false)}
            placeholder="View name"
            className="h-7 w-40 text-xs"
          />
          <Button type="submit" size="sm" className="h-7 px-2 text-xs" disabled={!name.trim()}>
            Save
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            aria-label="Cancel"
            onClick={() => setNaming(false)}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </form>
      )}
    </div>
  );
}

// --- Toolbar -------------------------------------------------------------------

interface ProjectToolbarProps {
  query: IssueQuery;
  defaults: IssueQuery;
  setQuery: (patch: QueryPatch) => void;
  onReset: () => void;
  options: FilterOptions;
  shown: number;
  total: number;
  saved?: SavedViewsApi;
  allViewsLabel?: string;
  columns: ListColumn[];
  onToggleColumn: (id: ListColumn) => void;
  /** Extra controls rendered at the start of the filter row (e.g. workspace/project pickers). */
  leading?: ReactNode;
}

/** One toolbar for the project board/list/… and My Issues: views, search, filters, display. */
export default function ProjectToolbar({
  query,
  defaults,
  setQuery,
  onReset,
  options,
  shown,
  total,
  saved,
  allViewsLabel = "All issues",
  columns,
  onToggleColumn,
  leading,
}: ProjectToolbarProps) {
  const [search, setSearch] = useState(query.q);

  // URL → input (reset, saved view, back/forward).
  useEffect(() => setSearch(query.q), [query.q]);
  // input → URL, debounced.
  useEffect(() => {
    if (search === query.q) return;
    const t = setTimeout(() => setQuery({ q: search }), 250);
    return () => clearTimeout(t);
  }, [search, query.q, setQuery]);

  const filtersActive = activeFilterCount(query, defaults) > 0;
  const dirty = !isDefaultQuery({ ...query, view: defaults.view }, defaults);

  return (
    <div className="space-y-2 border-b px-4 py-2">
      <ViewTabs
        query={query}
        defaults={defaults}
        allLabel={allViewsLabel}
        saved={saved}
        onApply={(q, keepLayout) => setQuery(keepLayout ? { ...q, view: query.view } : q)}
      />
      <div className="flex flex-wrap items-center gap-1.5">
        {leading}
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            data-issue-search
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search issues…"
            aria-label="Search issues"
            className="h-8 w-52 rounded-full pl-8 text-sm"
          />
        </div>
        <FilterBar {...options} query={query} onChange={(patch) => setQuery(patch)} />
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground" aria-live="polite">
            {filtersActive || shown !== total ? `${shown} of ${total}` : `${total}`} issue
            {total === 1 ? "" : "s"}
          </span>
          {dirty && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1 px-2 text-xs text-muted-foreground"
              onClick={onReset}
            >
              <X className="h-3 w-3" /> Clear
            </Button>
          )}
          <DisplayPopover
            query={query}
            onChange={(patch) => setQuery(patch)}
            columns={columns}
            onToggleColumn={onToggleColumn}
          />
        </div>
      </div>
    </div>
  );
}
