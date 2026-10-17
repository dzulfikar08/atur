import { useCallback, useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Card, CardContent } from "@/components/ui/card";
import { Bot, ChevronDown, ChevronRight, GitBranch, Package } from "@/lib/icons";
import type { Module } from "@/lib/api";
import { isClosedGroup, stateKeyOf, stripProduct, type IssueGroup } from "@/lib/issueQuery";
import {
  Avatars,
  DueLabel,
  LabelChips,
  PriorityDot,
  ProductChip,
  assigneeName,
  type ViewContext,
  type ViewIssue,
  type ViewState,
} from "./shared";

const COLUMN_W = "w-[272px] min-w-[272px]";

// Column dot: the state's own colour, falling back to the canonical group token.
const stateDot = (s: ViewState) => s.color || `var(--state-${s.group})`;

function Column({
  laneKey,
  state,
  issues,
  collapsed,
  onToggle,
  children,
}: {
  laneKey: string;
  state: ViewState;
  issues: ViewIssue[];
  collapsed: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `col:${laneKey}:${state.id}`,
    data: { stateId: state.id },
  });
  const wip =
    state.group === "started" ? issues.reduce((sum, i) => sum + (i.estimate_points ?? 0), 0) : 0;

  if (collapsed) {
    return (
      <button
        ref={setNodeRef}
        type="button"
        onClick={onToggle}
        aria-label={`Expand ${state.name} (${issues.length})`}
        className={`flex w-11 min-w-[44px] shrink-0 flex-col items-center gap-2 rounded-xl border bg-[var(--surface-card)] py-3 text-muted-foreground transition-colors hover:bg-[var(--surface-card-hover)] ${
          isOver ? "ring-2 ring-primary/50" : ""
        }`}
      >
        <ChevronRight className="h-3.5 w-3.5" />
        <span className="h-2 w-2 rounded-full" style={{ background: stateDot(state) }} />
        <span className="text-xs font-semibold">{issues.length}</span>
        <span className="text-xs font-medium [writing-mode:vertical-rl]">{state.name}</span>
      </button>
    );
  }

  return (
    <div
      ref={setNodeRef}
      className={`flex max-h-full min-h-0 ${COLUMN_W} shrink-0 flex-col rounded-xl transition-colors ${
        isOver ? "ring-2 ring-primary/50" : ""
      }`}
    >
      <div className="mb-2 flex items-center gap-2 px-1">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: stateDot(state) }} />
        <span className="truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {state.name}
        </span>
        <span className="rounded-full border bg-[var(--surface-elevated)] px-2 py-0.5 text-xs font-semibold leading-none text-muted-foreground">
          {issues.length}
          {wip > 0 ? ` · WIP ${wip}` : ""}
        </span>
        {isClosedGroup(state.group) && (
          <button
            type="button"
            onClick={onToggle}
            aria-label={`Collapse ${state.name}`}
            className="ml-auto text-muted-foreground hover:text-foreground"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <SortableContext items={issues.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        <div className="min-h-[56px] flex-1 space-y-2 overflow-y-auto pb-1">{children}</div>
      </SortableContext>
    </div>
  );
}

// Agent chip: only for bot assignees (users.is_bot). Humans get no chip.
function AgentChip({ issue, ctx }: { issue: ViewIssue; ctx: ViewContext }) {
  const bot = issue.assignees?.find((a) => a.is_bot);
  if (!bot) return null;
  const group = issue.state_id ? ctx.stateById.get(issue.state_id)?.group : issue.state?.group;
  const text =
    group === "completed"
      ? "done"
      : group === "started"
        ? "working"
        : group === "cancelled"
          ? "stopped"
          : "queued";
  return (
    <span className="ops-chip ops-chip-gray">
      <Bot className="h-3 w-3" />
      {assigneeName(bot)} · {text}
    </span>
  );
}

function CardBody({
  issue,
  ctx,
  moduleMap,
}: {
  issue: ViewIssue;
  ctx: ViewContext;
  moduleMap: Map<string, Module>;
}) {
  const modules = (issue.module_ids ?? [])
    .map((id) => moduleMap.get(id))
    .filter(Boolean) as Module[];
  return (
    <CardContent className="flex flex-col gap-2 p-3">
      <div className="flex items-center gap-2">
        {issue.parent_id && <GitBranch className="h-3 w-3 shrink-0 text-muted-foreground" />}
        <ProductChip name={issue.name} />
        <span className="font-ops-mono text-xs text-muted-foreground">
          #{String(issue.sequence_id).padStart(4, "0")}
        </span>
        <span className="ml-auto">
          <PriorityDot priority={issue.priority} />
        </span>
      </div>
      <p className="text-sm font-medium leading-[18px]">{stripProduct(issue.name)}</p>
      <AgentChip issue={issue} ctx={ctx} />
      {(issue.target_date || (issue.labels?.length ?? 0) > 0 || modules.length > 0) && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {issue.target_date && <DueLabel issue={issue} ctx={ctx} />}
          <LabelChips issue={issue} />
          {modules.slice(0, 1).map((m) => (
            <span key={m.id} className="ops-chip ops-chip-gray">
              <Package className="h-2.5 w-2.5" />
              {m.name}
            </span>
          ))}
        </div>
      )}
      {(issue.assignees?.length ?? 0) > 0 && <Avatars issue={issue} />}
    </CardContent>
  );
}

function BoardCard({
  issue,
  ctx,
  moduleMap,
  onOpen,
}: {
  issue: ViewIssue;
  ctx: ViewContext;
  moduleMap: Map<string, Module>;
  onOpen: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: issue.id,
  });
  const key = stateKeyOf(issue, ctx.stateById);
  const flagged = key === "needs_you" || key === "need_review";
  return (
    <Card
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
        zIndex: isDragging ? 50 : undefined,
      }}
      className={`cursor-pointer select-none rounded-xl bg-[var(--surface-elevated)] shadow-none transition-colors duration-150 hover:bg-[var(--surface-card-hover)] ${
        flagged ? "border-[color:var(--state-needs-you)]/50" : ""
      } ${isDragging ? "ring-2 ring-primary/30" : ""}`}
      onClick={onOpen}
      {...attributes}
      {...listeners}
    >
      <CardBody issue={issue} ctx={ctx} moduleMap={moduleMap} />
    </Card>
  );
}

interface BoardViewProps {
  /** Swimlanes: one lane = no lane header. Each lane's issues are further split into state columns. */
  lanes: IssueGroup<ViewIssue>[];
  swimlanes: boolean;
  ctx: ViewContext;
  moduleMap: Map<string, Module>;
  /** Completed/cancelled columns start expanded (the "Show completed" toggle). */
  expandClosed: boolean;
  onOpen: (issue: ViewIssue) => void;
  onMove: (issue: ViewIssue, stateId: string) => void;
}

export default function BoardView({
  lanes,
  swimlanes,
  ctx,
  moduleMap,
  expandClosed,
  onOpen,
  onMove,
}: BoardViewProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  // Columns the user flipped away from the default (closed → expanded, or back).
  const [flipped, setFlipped] = useState<Set<string>>(new Set());
  const [collapsedLanes, setCollapsedLanes] = useState<Set<string>>(new Set());

  const allIssues = useMemo(() => lanes.flatMap((l) => l.issues), [lanes]);
  const active = activeId ? (allIssues.find((i) => i.id === activeId) ?? null) : null;

  const isCollapsed = (s: ViewState) =>
    isClosedGroup(s.group) && (expandClosed ? flipped.has(s.id) : !flipped.has(s.id));
  const flip = (id: string) =>
    setFlipped((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const handleDragStart = useCallback((e: DragStartEvent) => setActiveId(String(e.active.id)), []);

  const handleDragEnd = useCallback(
    (e: DragEndEvent) => {
      setActiveId(null);
      const { active: a, over } = e;
      if (!over) return;
      const issue = allIssues.find((i) => i.id === a.id);
      if (!issue) return;
      const overData = over.data.current as { stateId?: string } | undefined;
      const stateId =
        overData?.stateId ?? allIssues.find((i) => i.id === over.id)?.state_id ?? null;
      if (stateId && stateId !== issue.state_id) onMove(issue, stateId);
    },
    [allIssues, onMove],
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
        <div className="flex h-full min-w-max flex-col gap-4">
          {lanes.map((lane) => {
            const laneCollapsed = swimlanes && collapsedLanes.has(lane.key);
            const byState = new Map<string, ViewIssue[]>();
            for (const i of lane.issues) {
              const id = i.state_id ?? "none";
              byState.set(id, [...(byState.get(id) ?? []), i]);
            }
            return (
              <section key={lane.key} className={swimlanes ? "" : "flex min-h-0 flex-1 flex-col"}>
                {swimlanes && (
                  <button
                    type="button"
                    className="mb-2 flex items-center gap-2 text-sm font-medium"
                    onClick={() =>
                      setCollapsedLanes((prev) => {
                        const next = new Set(prev);
                        if (next.has(lane.key)) next.delete(lane.key);
                        else next.add(lane.key);
                        return next;
                      })
                    }
                  >
                    {laneCollapsed ? (
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    )}
                    {lane.color && (
                      <span className="h-2 w-2 rounded-full" style={{ background: lane.color }} />
                    )}
                    {lane.label}
                    <span className="text-xs font-normal text-muted-foreground">
                      {lane.issues.length}
                    </span>
                  </button>
                )}
                {!laneCollapsed && (
                  <div className="flex min-h-0 flex-1 gap-3">
                    {ctx.states.map((state) => (
                      <Column
                        key={state.id}
                        laneKey={lane.key}
                        state={state}
                        issues={byState.get(state.id) ?? []}
                        collapsed={isCollapsed(state)}
                        onToggle={() => flip(state.id)}
                      >
                        {(byState.get(state.id) ?? []).map((issue) => (
                          <BoardCard
                            key={issue.id}
                            issue={issue}
                            ctx={ctx}
                            moduleMap={moduleMap}
                            onOpen={() => onOpen(issue)}
                          />
                        ))}
                      </Column>
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </div>
      <DragOverlay>
        {active ? (
          <Card className="w-[272px] rotate-2 rounded-xl bg-[var(--surface-elevated)] shadow-xl ring-2 ring-primary/30">
            <CardBody issue={active} ctx={ctx} moduleMap={moduleMap} />
          </Card>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
