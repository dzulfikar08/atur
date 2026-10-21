import { useState, useMemo, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, apiFetch, type Issue, type State } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import CommentEditor from "@/components/editor/CommentEditor";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useNavigate } from "react-router-dom";
import FilterBar from "@/components/issues/FilterBar";
import { useAuthStore } from "@/stores/auth";
import { useIssueQuery } from "@/hooks/useIssueQuery";
import {
  DEFAULT_QUERY,
  PRESET_VIEWS,
  activeFilterCount,
  applyIssueQuery,
  deriveFilterOptions,
  sameQuery,
  sortStates,
} from "@/lib/issueQuery";
import { ChevronDown, ChevronRight, Plus, SlidersHorizontal, Timer } from "@/lib/icons";
import MobileIssueCard from "./MobileIssueCard";
import BottomSheet from "./BottomSheet";
import PullToRefreshIndicator from "./PullToRefreshIndicator";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import usePullToRefresh from "@/hooks/usePullToRefresh";
import { hapticMedium } from "@/lib/haptics";
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  closestCorners,
  DragOverlay,
  useDroppable,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

const STATE_COLORS: Record<string, string> = {
  backlog: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  unstarted: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  started: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300",
  completed: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  cancelled: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
};

interface MobileProjectBoardProps {
  slug: string;
  projectId: string;
}

// --- Droppable Section ---
function DroppableSection({ stateId, children }: { stateId: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: stateId });

  return (
    <div
      ref={setNodeRef}
      className={`rounded-xl border overflow-hidden transition-colors ${
        isOver ? "ring-2 ring-primary/30 bg-muted/20" : ""
      }`}
    >
      {children}
    </div>
  );
}

// --- Sortable Issue Card Wrapper ---
function SortableMobileCard({
  issue,
  slug,
  projectId,
  states,
}: {
  issue: Issue;
  slug: string;
  projectId: string;
  states: State[];
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: issue.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 50 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={isDragging ? "touch-none" : ""}
      {...attributes}
      {...listeners}
    >
      <MobileIssueCard issue={issue} slug={slug} projectId={projectId} states={states} />
    </div>
  );
}

// --- Drag Overlay for Mobile ---
function MobileDragOverlayCard({ issue, states }: { issue: Issue; states: State[] }) {
  const state = states.find((s) => s.id === issue.state_id);
  const group = state?.group || "backlog";

  const STATE_DOT_COLORS: Record<string, string> = {
    backlog: "bg-gray-400",
    unstarted: "bg-blue-400",
    started: "bg-yellow-400",
    completed: "bg-emerald-400",
    cancelled: "bg-red-400",
  };

  return (
    <div className="w-[calc(100vw-32px)] max-w-sm shadow-2xl ring-2 ring-primary/30 rounded-xl border bg-card p-3.5 rotate-1">
      <div className="flex items-start gap-3">
        <div className={cn("h-2.5 w-2.5 rounded-full mt-1.5 shrink-0", STATE_DOT_COLORS[group])} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium leading-tight line-clamp-2">{issue.name}</p>
          <span className="text-xs text-muted-foreground font-mono">
            {String(issue.sequence_id).padStart(4, "0")}
          </span>
        </div>
      </div>
    </div>
  );
}

export default function MobileProjectBoard({ slug, projectId }: MobileProjectBoardProps) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [expandedStates, setExpandedStates] = useState<Set<string>>(
    new Set(["started", "unstarted"]),
  );
  const [filterOpen, setFilterOpen] = useState(false);
  const { query, setQuery, reset } = useIssueQuery(DEFAULT_QUERY);
  const me = useAuthStore((s) => s.user?.id ?? null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newState, setNewState] = useState("");
  const [activeIssueId, setActiveIssueId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 5 },
    }),
  );

  const { data: issues = [], isLoading } = useQuery({
    queryKey: ["issues", slug, projectId],
    queryFn: () => api.listIssues(slug, projectId),
    enabled: !!slug && !!projectId,
  });

  const { data: states = [] } = useQuery({
    queryKey: ["states", slug, projectId],
    queryFn: () => api.listStates(slug, projectId),
    enabled: !!slug && !!projectId,
  });
  const { data: project } = useQuery({
    queryKey: ["project", slug, projectId],
    queryFn: () => api.getProject(slug, projectId),
    enabled: !!slug && !!projectId,
  });
  const identifier = project?.identifier;

  // Project members for @mention suggestions in the create-sheet description.
  const { data: members = [] } = useQuery({
    queryKey: ["project-members", slug, projectId],
    queryFn: () =>
      apiFetch<{
        results: {
          memberId: string;
          username?: string | null;
          email?: string | null;
          displayName?: string | null;
          avatar?: string | null;
        }[];
      }>(`/workspaces/${slug}/projects/${projectId}/members/`)
        .then((d) => d.results)
        .catch(() => []),
    enabled: !!slug && !!projectId,
  });

  const mentionMembers = useMemo(
    () =>
      members.map((m) => ({
        id: m.memberId,
        username: m.username || m.email?.split("@")[0] || m.memberId.slice(0, 8),
        display_name: m.displayName,
        email: m.email,
        avatar: m.avatar,
      })),
    [members],
  );

  const backlogStateId = states.find((s) => s.group === "backlog")?.id ?? states[0]?.id ?? "";
  useEffect(() => {
    if (!newState && backlogStateId) setNewState(backlogStateId);
  }, [backlogStateId, newState]);

  const createMutation = useMutation({
    mutationFn: (data: { name: string; description_html?: string; state_id?: string }) =>
      apiFetch(`/workspaces/${slug}/projects/${projectId}/issues`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["issues", slug, projectId] });
      setCreateOpen(false);
      setNewName("");
      setNewDesc("");
      setNewState(backlogStateId);
      toast.success("Issue created");
    },
    onError: () => toast.error("Failed to create issue"),
  });

  // Sections always list every state (completed ones start collapsed), so the
  // done filter is expressed by that collapse rather than by dropping the section.
  const filtered = useMemo(
    () => applyIssueQuery(issues, { ...query, done: "show" }, me, { states, identifier }),
    [issues, query, me, states, identifier],
  );
  const options = useMemo(
    () => ({
      ...deriveFilterOptions(issues, states),
      assignees: members.map((m) => ({
        id: m.memberId,
        name: m.displayName || m.username || m.email || m.memberId.slice(0, 8),
      })),
    }),
    [issues, states, members],
  );
  const activeFilters = activeFilterCount(query);

  const grouped = useMemo(() => {
    const groups: { state: State; issues: Issue[] }[] = [];
    for (const state of sortStates(states)) {
      const stateIssues = filtered.filter((i) => i.state_id === state.id);
      groups.push({ state, issues: stateIssues });
    }
    return groups;
  }, [filtered, states]);

  const activeIssue = useMemo(
    () => issues.find((i) => i.id === activeIssueId) ?? null,
    [issues, activeIssueId],
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveIssueId(event.active.id as string);
    hapticMedium();
  }, []);

  const handleDragOver = useCallback((_event: DragOverEvent) => {
    // Visual feedback handled by useDroppable isOver
  }, []);

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveIssueId(null);
      hapticMedium();

      if (!over) return;

      const issueId = active.id as string;
      const targetId = over.id as string;

      const draggedIssue = issues.find((i) => i.id === issueId);
      if (!draggedIssue) return;

      let newStateId: string | null = null;

      if (states.some((s) => s.id === targetId)) {
        newStateId = targetId;
      } else {
        const targetIssue = issues.find((i) => i.id === targetId);
        if (targetIssue) {
          newStateId = targetIssue.state_id;
        }
      }

      if (!newStateId || newStateId === draggedIssue.state_id) return;

      try {
        await apiFetch(
          `/workspaces/${slug}/projects/${projectId}/issues/${draggedIssue.sequence_id}/`,
          {
            method: "PATCH",
            body: JSON.stringify({ state_id: newStateId }),
          },
        );
        qc.invalidateQueries({ queryKey: ["issues", slug, projectId] });
        toast.success("Issue moved");
      } catch {
        toast.error("Failed to move issue");
        qc.invalidateQueries({ queryKey: ["issues", slug, projectId] });
      }
    },
    [issues, states, slug, projectId, qc],
  );

  const { pullDistance, isRefreshing, progress, pullHandlers } = usePullToRefresh({
    onRefresh: async () => {
      hapticMedium();
      await qc.invalidateQueries({ queryKey: ["issues", slug, projectId] });
      await qc.invalidateQueries({ queryKey: ["states", slug, projectId] });
    },
  });

  function toggleState(groupId: string) {
    setExpandedStates((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="space-y-2 overflow-y-auto" {...pullHandlers}>
        <PullToRefreshIndicator
          pullDistance={pullDistance}
          isRefreshing={isRefreshing}
          progress={progress}
        />
        {/* Header actions */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs gap-1"
            onClick={() => setFilterOpen(true)}
          >
            <SlidersHorizontal className="h-3 w-3" /> Filter
            {activeFilters > 0 ? ` · ${activeFilters}` : ""}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs gap-1"
            onClick={() => navigate(`/${slug}/projects/${projectId}/cycles`)}
          >
            <Timer className="h-3 w-3" /> Sprints
          </Button>
          <div className="flex-1" />
          <Button size="sm" className="h-8 text-xs gap-1" onClick={() => setCreateOpen(true)}>
            <Plus className="h-3 w-3" /> New
          </Button>
        </div>

        {/* State sections */}
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-20 rounded-xl border animate-pulse" />
            ))}
          </div>
        ) : (
          grouped.map(({ state, issues: stateIssues }) => {
            const isExpanded = expandedStates.has(state.id);
            return (
              <DroppableSection key={state.id} stateId={state.id}>
                {/* Section header */}
                <button
                  className="w-full flex items-center gap-2 p-3 bg-muted/30 active:bg-muted/50 transition-colors"
                  onClick={() => toggleState(state.id)}
                >
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                  <Badge
                    className={cn("text-[10px]", STATE_COLORS[state.group] || STATE_COLORS.backlog)}
                    variant="secondary"
                  >
                    {state.name}
                  </Badge>
                  <span className="text-xs text-muted-foreground">{stateIssues.length}</span>
                </button>
                {/* Issues */}
                {isExpanded && (
                  <div className="p-2 space-y-1.5">
                    {stateIssues.length === 0 ? (
                      <p className="text-xs text-muted-foreground text-center py-3">No issues</p>
                    ) : (
                      <SortableContext
                        items={stateIssues.map((i) => i.id)}
                        strategy={verticalListSortingStrategy}
                      >
                        {stateIssues.map((issue) => (
                          <SortableMobileCard
                            key={issue.id}
                            issue={issue}
                            slug={slug}
                            projectId={projectId}
                            states={states}
                          />
                        ))}
                      </SortableContext>
                    )}
                  </div>
                )}
              </DroppableSection>
            );
          })
        )}

        {/* Filter sheet */}
        <BottomSheet open={filterOpen} onClose={() => setFilterOpen(false)} title="Filter">
          <div className="space-y-4">
            <Input
              placeholder="Search issues…"
              aria-label="Search issues"
              defaultValue={query.q}
              onChange={(e) => setQuery({ q: e.target.value })}
            />
            <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
              {[{ id: "all", name: "All", query: DEFAULT_QUERY }, ...PRESET_VIEWS].map((t) => {
                const active = sameQuery({ ...t.query, view: "list" }, { ...query, view: "list" });
                return (
                  <button
                    key={t.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setQuery({ ...t.query, view: query.view })}
                    className={`h-8 shrink-0 rounded-full border px-3 text-xs font-medium ${
                      active ? "bg-accent text-foreground" : "text-muted-foreground"
                    }`}
                  >
                    {t.name}
                  </button>
                );
              })}
            </div>
            <FilterBar {...options} query={query} onChange={(patch) => setQuery(patch)} />
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={reset}>
                Clear
              </Button>
              <Button className="flex-1" onClick={() => setFilterOpen(false)}>
                Apply
              </Button>
            </div>
          </div>
        </BottomSheet>

        {/* Create sheet */}
        <BottomSheet open={createOpen} onClose={() => setCreateOpen(false)} title="New Issue">
          <div className="space-y-3">
            <Input
              placeholder="Issue title"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <CommentEditor
              value={newDesc}
              onChange={setNewDesc}
              placeholder="Description (optional)"
              compact
              members={mentionMembers}
            />
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                State
              </label>
              <Select value={newState} onValueChange={setNewState}>
                <SelectTrigger>
                  <SelectValue placeholder="Backlog" />
                </SelectTrigger>
                <SelectContent>
                  {states.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              className="w-full"
              disabled={!newName.trim() || createMutation.isPending}
              onClick={() =>
                createMutation.mutate({
                  name: newName,
                  description_html: newDesc || undefined,
                  state_id: newState || undefined,
                })
              }
            >
              {createMutation.isPending ? "Creating..." : "Create Issue"}
            </Button>
          </div>
        </BottomSheet>
      </div>
      <DragOverlay>
        {activeIssue ? <MobileDragOverlayCard issue={activeIssue} states={states} /> : null}
      </DragOverlay>
    </DndContext>
  );
}
