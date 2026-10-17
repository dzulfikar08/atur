import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChevronDown, ChevronRight, GitBranch, Package, Plus, X } from "@/lib/icons";
import { buildHierarchicalRows, type TreeRow } from "@/lib/issueTree";
import type { Module } from "@/lib/api";
import {
  PRIORITIES,
  STATE_KEY_COLOR,
  badgeGroup,
  stripProduct,
  type IssueGroup,
  type IssueQuery,
  type SortField,
} from "@/lib/issueQuery";
import type { ListColumn } from "../ProjectToolbar";
import {
  Avatars,
  DueLabel,
  LabelChips,
  PriorityDot,
  ProductChip,
  StateBadge,
  shortAgo,
  type ViewContext,
  type ViewIssue,
} from "./shared";

export interface Person {
  id: string;
  name: string;
}

export interface IssuePatch {
  state_id?: string;
  priority?: string;
  target_date?: string | null;
  start_date?: string | null;
}

interface ListViewProps {
  groups: IssueGroup<ViewIssue>[];
  grouped: boolean;
  ctx: ViewContext;
  moduleMap: Map<string, Module>;
  columns: ListColumn[];
  sort: IssueQuery["sort"];
  onSort: (field: SortField) => void;
  /** Assignee choices for the bulk bar (editable mode). */
  people?: Person[];
  onOpen: (issue: ViewIssue) => void;
  /** Required when `editable`. */
  onPatch?: (issues: ViewIssue[], patch: IssuePatch) => void;
  onAssign?: (issues: ViewIssue[], memberId: string) => void;
  /** Create an issue. Omit to hide sub-issue creation. */
  onCreate?: (name: string, parentId?: string) => void;
  /** Inline state/priority editing, selection and bulk actions (single-project views only). */
  editable?: boolean;
  /** Show the top-level "Add issue…" row. */
  quickAdd?: boolean;
  /** Extra "Project" column (cross-project pages). */
  projectLabel?: (issue: ViewIssue) => string;
  emptyHint?: string;
}

const COL_W: Record<string, string> = {
  select: "w-9",
  project: "w-[120px]",
  id: "w-[60px]",
  product: "w-[96px]",
  state: "w-[124px]",
  priority: "w-[100px]",
  due: "w-[92px]",
  labels: "w-[148px]",
  assignee: "w-[84px]",
  module: "w-[128px]",
  points: "w-[56px]",
  updated: "w-[64px]",
};

const SELECT_TRIGGER =
  "h-7 w-full justify-start gap-1 border-none bg-transparent px-1.5 text-xs shadow-none focus-visible:ring-1 focus-visible:ring-offset-0 dark:bg-transparent";

const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  if (!el) return false;
  return (
    el.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) ||
    !!el.closest('[role="dialog"], [role="listbox"], [role="menu"]')
  );
};

export default function ListView({
  groups,
  grouped,
  ctx,
  moduleMap,
  columns,
  sort,
  onSort,
  people = [],
  onOpen,
  onPatch,
  onAssign,
  onCreate,
  editable = true,
  quickAdd = true,
  projectLabel,
  emptyHint,
}: ListViewProps) {
  const [collapsedParents, setCollapsedParents] = useState<Set<string>>(new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [cursor, setCursor] = useState<string | null>(null);
  const [subTarget, setSubTarget] = useState<string | null>(null);
  const [subName, setSubName] = useState("");
  const cursorRef = useRef<HTMLTableRowElement | null>(null);

  const show = (c: ListColumn) => columns.includes(c);
  // Empty module/points columns waste width: drop them when no row has a value.
  const hasModules = useMemo(
    () => groups.some((g) => g.issues.some((i) => (i.module_ids ?? []).length > 0)),
    [groups],
  );
  const hasPoints = useMemo(
    () => groups.some((g) => g.issues.some((i) => i.estimate_points != null)),
    [groups],
  );
  const showModule = show("module") && hasModules;
  const showPoints = show("points") && hasPoints;

  const rowGroups = useMemo(
    () =>
      groups.map((g) => ({
        ...g,
        rows: buildHierarchicalRows(g.issues, collapsedParents),
      })),
    [groups, collapsedParents],
  );
  const treeSlot = rowGroups.some((g) => g.rows.some((r) => r.childCount > 0 || r.isSubIssue));
  const visible = useMemo(
    () =>
      rowGroups.flatMap((g) =>
        grouped && collapsedGroups.has(g.key) ? [] : g.rows.map((r) => r.issue),
      ),
    [rowGroups, grouped, collapsedGroups],
  );

  // Drop selection/cursor for issues that left the filtered set.
  useEffect(() => {
    const ids = new Set(groups.flatMap((g) => g.issues.map((i) => i.id)));
    setSelected((prev) => {
      const next = new Set([...prev].filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
    setCursor((c) => (c && ids.has(c) ? c : null));
  }, [groups]);

  useEffect(() => {
    cursorRef.current?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  // j/k move, x selects, Enter opens, Esc clears.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      const idx = visible.findIndex((i) => i.id === cursor);
      if (e.key === "j" || e.key === "k") {
        e.preventDefault();
        const next = e.key === "j" ? Math.min(idx + 1, visible.length - 1) : Math.max(idx - 1, 0);
        setCursor(visible[Math.max(next, 0)]?.id ?? null);
      } else if (e.key === "x" && cursor && editable) {
        e.preventDefault();
        setSelected((prev) => {
          const next = new Set(prev);
          if (next.has(cursor)) next.delete(cursor);
          else next.add(cursor);
          return next;
        });
      } else if (e.key === "Enter" && idx >= 0) {
        e.preventDefault();
        onOpen(visible[idx]!);
      } else if (e.key === "Escape") {
        setSelected(new Set());
        setCursor(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, cursor, onOpen]);

  const toggleSet = (set: Set<string>, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  };

  const selectedIssues = useMemo(
    () => visible.filter((i) => selected.has(i.id)),
    [visible, selected],
  );
  const allSelected = visible.length > 0 && selectedIssues.length === visible.length;

  const colCount =
    2 +
    (editable ? 1 : 0) +
    (projectLabel ? 1 : 0) +
    (show("product") ? 1 : 0) +
    (show("state") ? 1 : 0) +
    (show("priority") ? 1 : 0) +
    (show("due") ? 1 : 0) +
    (show("labels") ? 1 : 0) +
    (show("assignee") ? 1 : 0) +
    (showModule ? 1 : 0) +
    (showPoints ? 1 : 0) +
    (show("updated") ? 1 : 0);

  const sortable = (label: string, field: SortField, cls = "") => (
    <button
      type="button"
      onClick={() => onSort(field)}
      className={`inline-flex items-center gap-1 hover:text-foreground ${cls}`}
    >
      {label}
      {sort.field === field && <span aria-hidden>{sort.dir === "asc" ? "↑" : "↓"}</span>}
    </button>
  );

  const renderRow = (row: TreeRow<ViewIssue>) => {
    const issue = row.issue;
    const isCursor = cursor === issue.id;
    const isSelected = selected.has(issue.id);
    return (
      <Fragment key={issue.id}>
        <tr
          ref={isCursor ? cursorRef : undefined}
          data-selected={isSelected}
          className={`group h-9 cursor-pointer border-t transition-colors hover:bg-muted/40 ${
            isSelected ? "bg-primary/5" : ""
          } ${isCursor ? "outline outline-1 -outline-offset-1 outline-ring/60" : ""}`}
          onClick={() => {
            setCursor(issue.id);
            onOpen(issue);
          }}
        >
          {editable && (
            <td className="px-2" onClick={(e) => e.stopPropagation()}>
              <input
                type="checkbox"
                aria-label={`Select ${issue.name}`}
                checked={isSelected}
                onChange={() => setSelected((prev) => toggleSet(prev, issue.id))}
                className="h-3.5 w-3.5 accent-[var(--primary)]"
              />
            </td>
          )}
          <td className="px-1 font-ops-mono text-xs text-muted-foreground">
            {String(issue.sequence_id).padStart(4, "0")}
          </td>
          {show("product") && (
            <td className="px-1">
              <ProductChip name={issue.name} />
            </td>
          )}
          <td className="max-w-0 px-1">
            <div className="flex items-center" style={{ paddingLeft: row.depth * 16 }}>
              {treeSlot && (
                <span className="flex w-5 shrink-0 items-center justify-center">
                  {row.childCount > 0 ? (
                    <button
                      type="button"
                      aria-label="Toggle sub-issues"
                      className="p-0.5 text-muted-foreground hover:text-foreground"
                      onClick={(e) => {
                        e.stopPropagation();
                        setCollapsedParents((prev) => toggleSet(prev, issue.id));
                      }}
                    >
                      {collapsedParents.has(issue.id) ? (
                        <ChevronRight className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5" />
                      )}
                    </button>
                  ) : row.isSubIssue ? (
                    <span className="text-xs text-muted-foreground">↳</span>
                  ) : null}
                </span>
              )}
              <span className="truncate text-sm font-medium">{stripProduct(issue.name)}</span>
              {row.childCount > 0 && (
                <span className="ml-2 inline-flex shrink-0 items-center gap-0.5 text-xs text-muted-foreground">
                  <GitBranch className="h-3 w-3" />
                  {row.childCount}
                </span>
              )}
              {!!issue.is_decision && (
                <span className="ml-2 shrink-0 rounded border px-1 text-xs text-muted-foreground">
                  Decision
                </span>
              )}
              {onCreate && (
                <button
                  type="button"
                  className="ml-1.5 shrink-0 text-muted-foreground opacity-0 hover:text-foreground focus:opacity-100 group-hover:opacity-100"
                  title="Add sub-issue"
                  onClick={(e) => {
                    e.stopPropagation();
                    setCollapsedParents((prev) => {
                      const next = new Set(prev);
                      next.delete(issue.id);
                      return next;
                    });
                    setSubTarget((prev) => (prev === issue.id ? null : issue.id));
                    setSubName("");
                  }}
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </td>
          {projectLabel && (
            <td className="truncate px-1 text-xs text-muted-foreground">{projectLabel(issue)}</td>
          )}
          {show("state") && (
            <td className="px-0.5" onClick={(e) => e.stopPropagation()}>
              {editable ? (
                <Select
                  value={issue.state_id ?? undefined}
                  onValueChange={(v) => onPatch?.([issue], { state_id: v })}
                >
                  <SelectTrigger className={SELECT_TRIGGER} aria-label="State">
                    <SelectValue placeholder="—" />
                  </SelectTrigger>
                  <SelectContent className="min-w-[10rem]">
                    {ctx.states.map((s) => (
                      <SelectItem key={s.id} value={s.id} className="text-xs">
                        <span className="state-badge" data-state-group={badgeGroup(s.key, s.group)}>
                          {s.name}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <span className="px-1.5">
                  <StateBadge issue={issue} ctx={ctx} />
                </span>
              )}
            </td>
          )}
          {show("priority") && (
            <td className="px-0.5" onClick={(e) => e.stopPropagation()}>
              {editable ? (
                <Select
                  value={issue.priority || "none"}
                  onValueChange={(v) => onPatch?.([issue], { priority: v })}
                >
                  <SelectTrigger className={SELECT_TRIGGER} aria-label="Priority">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="min-w-[8rem]">
                    {PRIORITIES.map((p) => (
                      <SelectItem key={p} value={p} className="text-xs capitalize">
                        <span className="flex items-center gap-2">
                          <span className="priority-dot" data-priority={p} />
                          {p}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <span className="flex items-center gap-2 px-1.5 text-xs capitalize">
                  <PriorityDot priority={issue.priority} />
                  {issue.priority || "none"}
                </span>
              )}
            </td>
          )}
          {show("due") && (
            <td className="px-1">
              <DueLabel issue={issue} ctx={ctx} />
            </td>
          )}
          {show("labels") && (
            <td className="px-1">
              <LabelChips issue={issue} />
            </td>
          )}
          {show("assignee") && (
            <td className="px-1">
              <Avatars issue={issue} />
            </td>
          )}
          {showModule && (
            <td className="px-1">
              <span className="flex flex-wrap gap-1">
                {(issue.module_ids ?? []).slice(0, 1).map((mid) => {
                  const mod = moduleMap.get(mid);
                  return mod ? (
                    <span key={mid} className="ops-chip ops-chip-gray">
                      <Package className="h-2.5 w-2.5" />
                      {mod.name}
                    </span>
                  ) : null;
                })}
              </span>
            </td>
          )}
          {showPoints && (
            <td className="px-1 text-xs text-muted-foreground">{issue.estimate_points ?? "—"}</td>
          )}
          {show("updated") && (
            <td
              className="px-1 text-xs text-muted-foreground"
              title={new Date(issue.updated_at).toLocaleString()}
            >
              {shortAgo(issue.updated_at)}
            </td>
          )}
        </tr>
        {subTarget === issue.id && (
          <tr className="border-t bg-muted/20">
            <td colSpan={colCount} className="p-1">
              <form
                className="flex items-center gap-2"
                style={{ paddingLeft: 60 + row.depth * 16 }}
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!subName.trim()) return;
                  onCreate?.(subName.trim(), issue.id);
                  setSubTarget(null);
                  setSubName("");
                }}
              >
                <Plus className="h-3.5 w-3.5 text-muted-foreground" />
                <input
                  autoFocus
                  value={subName}
                  onChange={(e) => setSubName(e.target.value)}
                  onKeyDown={(e) => e.key === "Escape" && setSubTarget(null)}
                  placeholder="Sub-issue name…"
                  className="flex-1 bg-transparent px-1 py-1 text-sm outline-none placeholder:text-muted-foreground"
                />
              </form>
            </td>
          </tr>
        )}
      </Fragment>
    );
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col p-4 pt-3">
      <div className="min-h-0 flex-1 overflow-auto rounded-lg border">
        <table className="w-full min-w-[720px] table-fixed text-sm">
          <colgroup>
            {editable && <col className={COL_W.select} />}
            <col className={COL_W.id} />
            {show("product") && <col className={COL_W.product} />}
            <col />
            {projectLabel && <col className={COL_W.project} />}
            {show("state") && <col className={COL_W.state} />}
            {show("priority") && <col className={COL_W.priority} />}
            {show("due") && <col className={COL_W.due} />}
            {show("labels") && <col className={COL_W.labels} />}
            {show("assignee") && <col className={COL_W.assignee} />}
            {showModule && <col className={COL_W.module} />}
            {showPoints && <col className={COL_W.points} />}
            {show("updated") && <col className={COL_W.updated} />}
          </colgroup>
          <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur">
            <tr className="h-8 text-left text-xs font-medium text-muted-foreground">
              {editable && (
                <th className="px-2">
                  <input
                    type="checkbox"
                    aria-label="Select all"
                    checked={allSelected}
                    onChange={() =>
                      setSelected(allSelected ? new Set() : new Set(visible.map((i) => i.id)))
                    }
                    className="h-3.5 w-3.5 accent-[var(--primary)]"
                  />
                </th>
              )}
              <th className="px-1">{sortable("ID", "sequence_id")}</th>
              {show("product") && <th className="px-1">Product</th>}
              <th className="px-1">{sortable("Title", "name")}</th>
              {projectLabel && <th className="px-1">Project</th>}
              {show("state") && <th className="px-1">{sortable("State", "state")}</th>}
              {show("priority") && <th className="px-1">{sortable("Priority", "priority")}</th>}
              {show("due") && <th className="px-1">{sortable("Due", "target_date")}</th>}
              {show("labels") && <th className="px-1">Labels</th>}
              {show("assignee") && <th className="px-1">Assignee</th>}
              {showModule && <th className="px-1">Module</th>}
              {showPoints && <th className="px-1">Pts</th>}
              {show("updated") && <th className="px-1">{sortable("Updated", "updated_at")}</th>}
            </tr>
          </thead>
          <tbody>
            {rowGroups.map((g) => (
              <Fragment key={g.key}>
                {grouped && (
                  <tr
                    className="h-8 cursor-pointer border-t bg-muted/40"
                    onClick={() => setCollapsedGroups((prev) => toggleSet(prev, g.key))}
                  >
                    <td colSpan={colCount} className="px-2">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        {collapsedGroups.has(g.key) ? (
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        )}
                        {g.color && (
                          <span className="h-2 w-2 rounded-full" style={{ background: g.color }} />
                        )}
                        {g.label}
                        <span className="text-xs font-normal text-muted-foreground">
                          {g.issues.length}
                        </span>
                      </div>
                    </td>
                  </tr>
                )}
                {!(grouped && collapsedGroups.has(g.key)) && g.rows.map(renderRow)}
              </Fragment>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={colCount} className="p-6 text-center text-sm text-muted-foreground">
                  {emptyHint ?? "No issues match the current filters."}
                </td>
              </tr>
            )}
            {quickAdd && onCreate && (
              <tr className="border-t">
                <td colSpan={colCount} className="p-1">
                  <form
                    className="flex items-center"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const input = e.currentTarget.elements.namedItem(
                        "quick-add",
                      ) as HTMLInputElement;
                      if (input.value.trim()) {
                        onCreate(input.value.trim());
                        input.value = "";
                      }
                    }}
                  >
                    <Plus className="mx-2 h-4 w-4 shrink-0 text-muted-foreground" />
                    <input
                      name="quick-add"
                      placeholder="Add issue…"
                      className="flex-1 bg-transparent px-1 py-1.5 text-sm outline-none placeholder:text-muted-foreground"
                    />
                  </form>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editable && onPatch && onAssign && selectedIssues.length > 0 && (
        <BulkBar
          issues={selectedIssues}
          ctx={ctx}
          people={people}
          onPatch={onPatch}
          onAssign={onAssign}
          onClear={() => setSelected(new Set())}
        />
      )}
    </div>
  );
}

function BulkBar({
  issues,
  ctx,
  people,
  onPatch,
  onAssign,
  onClear,
}: {
  issues: ViewIssue[];
  ctx: ViewContext;
  people: Person[];
  onPatch: NonNullable<ListViewProps["onPatch"]>;
  onAssign: NonNullable<ListViewProps["onAssign"]>;
  onClear: () => void;
}) {
  return (
    <div
      role="toolbar"
      aria-label="Bulk actions"
      className="absolute inset-x-0 bottom-6 z-20 mx-auto flex w-fit max-w-[calc(100%-2rem)] flex-wrap items-center gap-2 rounded-xl border bg-popover px-3 py-2 shadow-popover"
    >
      <span className="text-sm font-medium">{issues.length} selected</span>
      <Select value="" onValueChange={(v) => onPatch(issues, { state_id: v })}>
        <SelectTrigger className="h-8 w-32 text-xs" aria-label="Set state">
          <SelectValue placeholder="State…" />
        </SelectTrigger>
        <SelectContent>
          {ctx.states.map((s) => (
            <SelectItem key={s.id} value={s.id} className="text-xs">
              <span className="flex items-center gap-2">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{
                    background: s.color || STATE_KEY_COLOR[s.key ?? ""],
                  }}
                />
                {s.name}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value="" onValueChange={(v) => onPatch(issues, { priority: v })}>
        <SelectTrigger className="h-8 w-28 text-xs" aria-label="Set priority">
          <SelectValue placeholder="Priority…" />
        </SelectTrigger>
        <SelectContent>
          {PRIORITIES.map((p) => (
            <SelectItem key={p} value={p} className="text-xs capitalize">
              {p}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {people.length > 0 && (
        <Select value="" onValueChange={(v) => onAssign(issues, v)}>
          <SelectTrigger className="h-8 w-32 text-xs" aria-label="Assign to">
            <SelectValue placeholder="Assign to…" />
          </SelectTrigger>
          <SelectContent>
            {people.map((p) => (
              <SelectItem key={p.id} value={p.id} className="text-xs">
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <Input
        type="date"
        aria-label="Set due date"
        className="h-8 w-36 text-xs"
        value=""
        onChange={(e) => e.target.value && onPatch(issues, { target_date: e.target.value })}
      />
      <Button
        variant="ghost"
        size="sm"
        className="h-8 px-2 text-xs"
        onClick={() => onPatch(issues, { target_date: null })}
      >
        Clear due
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        aria-label="Clear selection"
        onClick={onClear}
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
