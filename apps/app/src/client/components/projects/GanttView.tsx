import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  addDays,
  differenceInCalendarDays,
  endOfWeek,
  format,
  getDay,
  isSameMonth,
  parseISO,
  startOfDay,
  startOfWeek,
} from "date-fns";
import { ChevronDown, ChevronRight } from "@/lib/icons";
import type { Issue, State } from "@/lib/api";
import { cn } from "@/lib/utils";
import { stateColor } from "@/lib/issueColors";
import { productColor, splitProduct } from "@/lib/product";

export type GanttGroupBy =
  | "none"
  | "state"
  | "priority"
  | "product"
  | "label"
  | "assignee"
  | "module"
  | "due";

export interface GanttViewProps {
  issues: Issue[];
  states: State[];
  groupBy: GanttGroupBy;
  onOpen: (seq: number) => void;
  onReschedule: (
    id: string,
    start: string | null,
    target: string | null,
  ) => void;
}

type Zoom = "day" | "week" | "month";

const PX_PER_DAY: Record<Zoom, number> = { day: 36, week: 14, month: 4.5 };
const LABEL_W = 300;
const ROW_H = 34;
const GROUP_H = 30;
const DRAG_THRESHOLD_PX = 3;
const ISO = "yyyy-MM-dd";

type KeyedState = State & { key?: string | null };

const PRIORITY_ORDER = ["urgent", "high", "medium", "low", "none"];
const STATE_GROUP_ORDER = [
  "backlog",
  "unstarted",
  "started",
  "completed",
  "cancelled",
];

/** Dates arrive as `YYYY-MM-DD` (sometimes with a time); read them as local days. */
const toDay = (value: string): Date => parseISO(value.slice(0, 10));
const toIso = (d: Date): string => format(d, ISO);

interface Span {
  start: Date | null;
  target: Date | null;
}

/** The day range a row occupies, or null when it has no dates. */
function bounds(span: Span): { from: Date; to: Date } | null {
  const { start, target } = span;
  if (!start && !target) return null;
  if (start && target) {
    return start <= target
      ? { from: start, to: target }
      : { from: target, to: start };
  }
  const only = (start ?? target)!;
  return { from: only, to: only };
}

interface Row {
  issue: Issue;
  state: KeyedState | undefined;
  span: Span;
  open: boolean;
}

interface Group {
  key: string;
  label: string;
  rows: Row[];
}

type DragMode = "move" | "start" | "end";

interface DragState {
  id: string;
  mode: DragMode;
  originX: number;
  moved: boolean;
  base: Span;
  current: Span;
}

function shift(d: Date | null, days: number): Date | null {
  return d ? addDays(d, days) : null;
}

/** Apply a drag delta to the dates the drag started from. */
function dragSpan(mode: DragMode, base: Span, delta: number): Span {
  if (mode === "move")
    return {
      start: shift(base.start, delta),
      target: shift(base.target, delta),
    };
  if (mode === "start") {
    // Dragging the left edge never passes the target.
    const start = shift(base.start, delta)!;
    return {
      start: base.target && start > base.target ? base.target : start,
      target: base.target,
    };
  }
  // Right edge: sets the target (creating it for start-only issues) and never
  // passes the start.
  const anchor = base.target ?? base.start!;
  const target = addDays(anchor, delta);
  return {
    start: base.start,
    target: base.start && target < base.start ? base.start : target,
  };
}

function dueBucket(target: Date | null, open: boolean, today: Date): string {
  if (!target) return "No date";
  const diff = differenceInCalendarDays(target, today);
  if (diff < 0 && open) return "Overdue";
  if (diff === 0) return "Today";
  if (diff <= 7 && diff > 0) return "This week";
  return diff < 0 ? "Earlier" : "Later";
}

const DUE_ORDER = [
  "Overdue",
  "Today",
  "This week",
  "Later",
  "Earlier",
  "No date",
];

function groupOf(
  row: Row,
  by: GanttGroupBy,
  today: Date,
): { key: string; label: string; order: number } {
  const { issue, state } = row;
  switch (by) {
    case "state": {
      const label = state?.name ?? "No state";
      const order = STATE_GROUP_ORDER.indexOf(state?.group ?? "");
      return { key: label, label, order: order < 0 ? 99 : order };
    }
    case "priority": {
      const p =
        issue.priority && PRIORITY_ORDER.includes(issue.priority)
          ? issue.priority
          : "none";
      return {
        key: p,
        label:
          p === "none" ? "No priority" : p.charAt(0).toUpperCase() + p.slice(1),
        order: PRIORITY_ORDER.indexOf(p),
      };
    }
    case "product": {
      const product = splitProduct(issue.name).product;
      return {
        key: product ?? "",
        label: product ?? "No product",
        order: product ? 0 : 99,
      };
    }
    case "label": {
      const name = issue.labels?.[0]?.name;
      return {
        key: name ?? "",
        label: name ?? "No label",
        order: name ? 0 : 99,
      };
    }
    case "assignee": {
      const a = issue.assignees?.[0];
      const name = a
        ? (a.display_name ?? a.username ?? a.email ?? "Assigned")
        : null;
      return {
        key: name ?? "",
        label: name ?? "Unassigned",
        order: name ? 0 : 99,
      };
    }
    case "due": {
      const label = dueBucket(row.span.target, row.open, today);
      return { key: label, label, order: DUE_ORDER.indexOf(label) };
    }
    default:
      return { key: "all", label: "", order: 0 };
  }
}

function compareRows(a: Row, b: Row): number {
  const ba = bounds(a.span)!;
  const bb = bounds(b.span)!;
  return (
    ba.from.getTime() - bb.from.getTime() ||
    ba.to.getTime() - bb.to.getTime() ||
    a.issue.sequence_id - b.issue.sequence_id
  );
}

export default function GanttView({
  issues,
  states,
  groupBy,
  onOpen,
  onReschedule,
}: GanttViewProps) {
  const [zoom, setZoom] = useState<Zoom>("week");
  const [showDone, setShowDone] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [trayOpen, setTrayOpen] = useState(true);
  // Dates shown while a drag is in flight and until fresh issues arrive.
  const [overrides, setOverrides] = useState<Record<string, Span>>({});
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const today = useMemo(() => startOfDay(new Date()), []);
  const px = PX_PER_DAY[zoom];

  useEffect(() => setOverrides({}), [issues]);

  const stateById = useMemo(
    () => new Map(states.map((s) => [s.id, s as KeyedState])),
    [states],
  );

  const { scheduled, unscheduled } = useMemo(() => {
    const scheduled: Row[] = [];
    const unscheduled: Row[] = [];
    for (const issue of issues) {
      const state =
        (issue.state_id ? stateById.get(issue.state_id) : undefined) ??
        issue.state ??
        undefined;
      const open = !(
        state?.group === "completed" ||
        state?.group === "cancelled" ||
        issue.completed_at
      );
      if (!open && !showDone) continue;
      const override = overrides[issue.id];
      const span: Span = override ?? {
        start: issue.start_date ? toDay(issue.start_date) : null,
        target: issue.target_date ? toDay(issue.target_date) : null,
      };
      const row: Row = {
        issue,
        state: state as KeyedState | undefined,
        span,
        open,
      };
      (bounds(span) ? scheduled : unscheduled).push(row);
    }
    return { scheduled, unscheduled };
  }, [issues, stateById, showDone, overrides]);

  const groups = useMemo<Group[]>(() => {
    const map = new Map<string, Group & { order: number }>();
    for (const row of scheduled) {
      const g = groupOf(row, groupBy, today);
      const entry = map.get(g.key) ?? {
        key: g.key,
        label: g.label,
        rows: [],
        order: g.order,
      };
      entry.rows.push(row);
      map.set(g.key, entry);
    }
    const list = [...map.values()].sort(
      (a, b) => a.order - b.order || a.label.localeCompare(b.label),
    );
    for (const g of list) g.rows.sort(compareRows);
    return list;
  }, [scheduled, groupBy, today]);

  // Timeline range: every scheduled day plus today, with a little air around it.
  const { rangeStart, totalDays } = useMemo(() => {
    let min = today;
    let max = today;
    for (const row of scheduled) {
      const b = bounds(row.span)!;
      if (b.from < min) min = b.from;
      if (b.to > max) max = b.to;
    }
    const start = startOfWeek(addDays(min, -7), { weekStartsOn: 1 });
    const end = endOfWeek(addDays(max, 21), { weekStartsOn: 1 });
    return {
      rangeStart: start,
      totalDays: differenceInCalendarDays(end, start) + 1,
    };
  }, [scheduled, today]);

  const dayX = (d: Date) => differenceInCalendarDays(d, rangeStart) * px;
  const todayX = dayX(today);
  const timelineW = totalDays * px;

  // Land with today in view (left third) whenever zoom or range changes.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el)
      el.scrollLeft = Math.max(
        todayX - el.clientWidth * 0.3 + LABEL_W * 0.3,
        0,
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, totalDays]);

  const jumpToToday = () => {
    const el = scrollRef.current;
    el?.scrollTo({
      left: Math.max(todayX - el.clientWidth * 0.3, 0),
      behavior: "smooth",
    });
  };

  // ── Header ticks ──
  const months = useMemo(() => {
    const out: { key: string; label: string; x: number; w: number }[] = [];
    let cursor = rangeStart;
    for (let i = 0; i < totalDays;) {
      let span = 0;
      while (i + span < totalDays && isSameMonth(addDays(cursor, span), cursor))
        span++;
      out.push({
        key: format(cursor, "yyyy-MM"),
        label: format(cursor, zoom === "month" ? "MMM yyyy" : "MMMM yyyy"),
        x: i * px,
        w: span * px,
      });
      cursor = addDays(cursor, span);
      i += span;
    }
    return out;
  }, [rangeStart, totalDays, px, zoom]);

  const ticks = useMemo(() => {
    if (zoom === "month") return [];
    const out: {
      key: number;
      label: string;
      weekend: boolean;
      x: number;
      w: number;
    }[] = [];
    const step = zoom === "day" ? 1 : 7;
    for (let i = 0; i < totalDays; i += step) {
      const d = addDays(rangeStart, i);
      const dow = getDay(d);
      out.push({
        key: i,
        label: zoom === "day" ? format(d, "d") : format(d, "MMM d"),
        weekend: zoom === "day" && (dow === 0 || dow === 6),
        x: i * px,
        w: step * px,
      });
    }
    return out;
  }, [zoom, totalDays, rangeStart, px]);

  const headerH = zoom === "month" ? 28 : 52;
  // Faint weekly gridlines on every timeline cell; Monday is the rangeStart.
  const gridStyle: React.CSSProperties = {
    width: timelineW,
    backgroundImage:
      "linear-gradient(to right, var(--border) 1px, transparent 1px)",
    backgroundSize: `${(zoom === "month" ? 7 : zoom === "week" ? 7 : 1) * px}px 100%`,
  };

  // ── Drag ──
  const beginDrag = (e: React.PointerEvent, row: Row, mode: DragMode) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const state: DragState = {
      id: row.issue.id,
      mode,
      originX: e.clientX,
      moved: false,
      base: row.span,
      current: row.span,
    };
    dragRef.current = state;
    setDrag(state);
  };

  const moveDrag = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.originX;
    if (!d.moved && Math.abs(dx) < DRAG_THRESHOLD_PX) return;
    const next = {
      ...d,
      moved: true,
      current: dragSpan(d.mode, d.base, Math.round(dx / px)),
    };
    dragRef.current = next;
    setDrag(next);
  };

  const endDrag = (e: React.PointerEvent, row: Row, cancelled = false) => {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    setDrag(null);
    if (cancelled) return;
    if (!d.moved) return onOpen(row.issue.sequence_id);
    const { start, target } = d.current;
    const changed =
      start?.getTime() !== d.base.start?.getTime() ||
      target?.getTime() !== d.base.target?.getTime();
    if (!changed) return;
    setOverrides((o) => ({ ...o, [row.issue.id]: d.current }));
    onReschedule(
      row.issue.id,
      start ? toIso(start) : null,
      target ? toIso(target) : null,
    );
  };

  const spanOf = (row: Row): Span =>
    drag?.id === row.issue.id ? drag.current : row.span;

  const renderBar = (row: Row) => {
    const span = spanOf(row);
    const b = bounds(span)!;
    const color = stateColor(row.state);
    const overdue = row.open && !!span.target && span.target < today;
    const accent = overdue ? "var(--priority-urgent)" : color;
    const { title } = splitProduct(row.issue.name);
    const milestone = !!span.target && !span.start;
    const dragging = drag?.id === row.issue.id && drag.moved;
    const left = dayX(b.from);
    const width = (differenceInCalendarDays(b.to, b.from) + 1) * px;
    const range = `${format(b.from, "MMM d")}${b.to > b.from ? ` – ${format(b.to, "MMM d")}` : ""}`;

    const handlers = {
      onPointerMove: moveDrag,
      onPointerUp: (e: React.PointerEvent) => endDrag(e, row),
      onPointerCancel: (e: React.PointerEvent) => endDrag(e, row, true),
    };

    if (milestone) {
      return (
        <div
          className="absolute top-0 flex h-full items-center"
          style={{ left: left + px / 2 - 8 }}
        >
          <div
            role="button"
            tabIndex={0}
            aria-label={`${title}, due ${range}`}
            title={`${row.issue.name}\nDue ${range}`}
            onPointerDown={(e) => beginDrag(e, row, "move")}
            onKeyDown={(e) =>
              e.key === "Enter" && onOpen(row.issue.sequence_id)
            }
            {...handlers}
            className={cn(
              "size-4 shrink-0 rotate-45 cursor-grab touch-none rounded-[3px] border-2 outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
              dragging && "cursor-grabbing",
            )}
            style={{
              borderColor: accent,
              background: `color-mix(in oklab, ${accent} 35%, var(--background))`,
            }}
          />
          <span className="ml-2 select-none whitespace-nowrap text-[length:var(--text-meta)] text-muted-foreground">
            {title}
          </span>
        </div>
      );
    }

    const inside = width >= 110;
    const editable = !!row.span.start;
    return (
      <div className="absolute top-0 flex h-full items-center" style={{ left }}>
        <div
          role="button"
          tabIndex={0}
          aria-label={`${title}, ${range}`}
          title={`${row.issue.name}\n${range}`}
          onPointerDown={(e) => beginDrag(e, row, "move")}
          onKeyDown={(e) => e.key === "Enter" && onOpen(row.issue.sequence_id)}
          {...handlers}
          className={cn(
            "relative flex h-6 cursor-grab touch-none items-center overflow-hidden rounded-md border-l-[3px] pl-2 pr-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
            dragging && "cursor-grabbing shadow-md",
          )}
          style={{
            width: Math.max(width, 6),
            borderLeftColor: accent,
            background: `color-mix(in oklab, ${accent} 22%, var(--background))`,
          }}
        >
          {editable && (
            <span
              aria-hidden
              onPointerDown={(e) => beginDrag(e, row, "start")}
              {...handlers}
              className="absolute inset-y-0 left-0 z-10 w-1.5 cursor-ew-resize"
            />
          )}
          {inside && (
            <span className="truncate text-[length:var(--text-meta)] font-medium text-foreground">
              {title}
            </span>
          )}
          <span
            aria-hidden
            onPointerDown={(e) => beginDrag(e, row, "end")}
            {...handlers}
            className="absolute inset-y-0 right-0 z-10 w-1.5 cursor-ew-resize"
          />
        </div>
        {!inside && (
          <span className="ml-2 select-none whitespace-nowrap text-[length:var(--text-meta)] text-muted-foreground">
            {title}
          </span>
        )}
      </div>
    );
  };

  const renderLabel = (row: Row) => {
    const { product, title } = splitProduct(row.issue.name);
    return (
      <div
        className="sticky left-0 z-20 flex shrink-0 items-center gap-2 border-r border-border bg-background px-3"
        style={{ width: LABEL_W }}
      >
        <span
          className="priority-dot"
          data-priority={row.issue.priority ?? "none"}
        />
        {product && (
          <span
            className="product-chip shrink-0"
            style={
              { "--badge-c": productColor(product) } as React.CSSProperties
            }
          >
            {product}
          </span>
        )}
        <button
          onClick={() => onOpen(row.issue.sequence_id)}
          title={row.issue.name}
          className="min-w-0 flex-1 truncate text-left text-[length:var(--text-row)] text-foreground hover:underline"
        >
          {title}
        </button>
      </div>
    );
  };

  const empty = scheduled.length === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2 text-[length:var(--text-meta)]">
        <div
          role="group"
          aria-label="Zoom"
          className="inline-flex rounded-md border border-border p-0.5"
        >
          {(["day", "week", "month"] as const).map((z) => (
            <button
              key={z}
              onClick={() => setZoom(z)}
              aria-pressed={zoom === z}
              className={cn(
                "h-6 rounded px-2.5 font-medium capitalize transition-colors",
                zoom === z
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {z}
            </button>
          ))}
        </div>
        <button
          onClick={jumpToToday}
          className="h-7 rounded-md border border-border px-2.5 font-medium text-foreground hover:bg-accent"
        >
          Today
        </button>
        <label className="ml-1 inline-flex cursor-pointer items-center gap-1.5 text-muted-foreground">
          <input
            type="checkbox"
            checked={showDone}
            onChange={(e) => setShowDone(e.target.checked)}
            className="size-3.5 accent-[var(--primary)]"
          />
          Show completed
        </label>
        <span className="ml-auto text-muted-foreground">
          {scheduled.length} scheduled
          {unscheduled.length > 0 && ` · ${unscheduled.length} unscheduled`} ·
          drag a bar to reschedule
        </span>
      </div>

      {empty ? (
        <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-border py-16 text-sm text-muted-foreground">
          No open issues with dates to show.
        </div>
      ) : (
        <div
          ref={scrollRef}
          className="min-h-0 flex-1 overflow-auto rounded-lg border border-border bg-background"
        >
          <div
            className="relative"
            style={{ width: LABEL_W + timelineW, minWidth: "100%" }}
          >
            {/* Today line sits under the sticky label column. */}
            <div
              aria-hidden
              className="pointer-events-none absolute bottom-0 top-0 z-10 w-px bg-[var(--priority-urgent)]"
              style={{ left: LABEL_W + todayX + px / 2 }}
            />

            {/* Sticky header */}
            <div
              className="sticky top-0 z-30 flex border-b border-border bg-background"
              style={{ height: headerH }}
            >
              <div
                className="sticky left-0 z-20 flex shrink-0 items-end border-r border-border bg-background px-3 pb-1.5 text-[length:var(--text-meta)] font-medium text-muted-foreground"
                style={{ width: LABEL_W }}
              >
                Issue
              </div>
              <div className="relative shrink-0" style={{ width: timelineW }}>
                {months.map((m) => (
                  <div
                    key={m.key}
                    className="absolute top-0 flex h-7 items-center border-l border-border px-2 text-[length:var(--text-meta)] font-semibold text-foreground"
                    style={{ left: m.x, width: m.w }}
                  >
                    <span className="whitespace-nowrap">{m.label}</span>
                  </div>
                ))}
                {ticks.map((t) => (
                  <div
                    key={t.key}
                    className={cn(
                      "absolute bottom-0 flex h-6 items-center justify-center border-l border-border text-[length:var(--text-meta)] tabular-nums",
                      t.weekend
                        ? "bg-muted/60 text-muted-foreground/70"
                        : "text-muted-foreground",
                    )}
                    style={{ left: t.x, width: t.w }}
                  >
                    {t.label}
                  </div>
                ))}
                <div
                  className="absolute z-10 -translate-x-1/2 rounded-sm bg-[var(--priority-urgent)] px-1 text-[10px] font-semibold leading-4 text-white"
                  style={{ left: todayX + px / 2, bottom: 0 }}
                >
                  Today
                </div>
              </div>
            </div>

            {groups.map((group) => {
              const isCollapsed = collapsed.has(group.key);
              const headed = groupBy !== "none";
              return (
                <section key={group.key}>
                  {headed && (
                    <div
                      className="sticky z-20 flex border-b border-border bg-muted/50"
                      style={{ top: headerH, height: GROUP_H }}
                    >
                      <button
                        onClick={() =>
                          setCollapsed((prev) => {
                            const next = new Set(prev);
                            if (!next.delete(group.key)) next.add(group.key);
                            return next;
                          })
                        }
                        aria-expanded={!isCollapsed}
                        className="sticky left-0 z-20 flex items-center gap-1.5 bg-muted px-3 text-left text-[length:var(--text-meta)] font-semibold text-foreground"
                        style={{ width: LABEL_W }}
                      >
                        {isCollapsed ? (
                          <ChevronRight className="size-3.5" />
                        ) : (
                          <ChevronDown className="size-3.5" />
                        )}
                        <span className="truncate">{group.label}</span>
                        <span className="font-normal tabular-nums text-muted-foreground">
                          {group.rows.length}
                        </span>
                      </button>
                    </div>
                  )}
                  {!isCollapsed &&
                    group.rows.map((row) => (
                      <div
                        key={row.issue.id}
                        className="flex border-b border-border/60 hover:bg-accent/30"
                        style={{ height: ROW_H }}
                      >
                        {renderLabel(row)}
                        <div className="relative shrink-0" style={gridStyle}>
                          {renderBar(row)}
                        </div>
                      </div>
                    ))}
                </section>
              );
            })}
          </div>
        </div>
      )}

      {/* Unscheduled tray */}
      {unscheduled.length > 0 && (
        <section className="shrink-0 rounded-lg border border-border bg-[var(--surface-elevated)]">
          <button
            onClick={() => setTrayOpen((o) => !o)}
            aria-expanded={trayOpen}
            className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-[length:var(--text-meta)] font-semibold text-foreground"
          >
            {trayOpen ? (
              <ChevronDown className="size-3.5" />
            ) : (
              <ChevronRight className="size-3.5" />
            )}
            Unscheduled
            <span className="font-normal tabular-nums text-muted-foreground">
              {unscheduled.length}
            </span>
          </button>
          {trayOpen && (
            <ul className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto border-t border-border p-2">
              {unscheduled.map((row) => {
                const { product, title } = splitProduct(row.issue.name);
                return (
                  <li
                    key={row.issue.id}
                    className="group inline-flex max-w-[320px] items-center gap-1.5 rounded-md border border-border bg-background py-0.5 pl-2 pr-0.5"
                  >
                    <span
                      className="priority-dot"
                      data-priority={row.issue.priority ?? "none"}
                    />
                    {product && (
                      <span
                        className="product-chip shrink-0"
                        style={
                          {
                            "--badge-c": productColor(product),
                          } as React.CSSProperties
                        }
                      >
                        {product}
                      </span>
                    )}
                    <button
                      onClick={() => onOpen(row.issue.sequence_id)}
                      title={row.issue.name}
                      className="min-w-0 truncate text-[length:var(--text-meta)] text-foreground hover:underline"
                    >
                      {title}
                    </button>
                    <button
                      onClick={() => {
                        const day = { start: today, target: today };
                        setOverrides((o) => ({ ...o, [row.issue.id]: day }));
                        onReschedule(row.issue.id, toIso(today), toIso(today));
                      }}
                      title="Schedule for today"
                      className="shrink-0 rounded px-1.5 text-[length:var(--text-meta)] font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      + Today
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
