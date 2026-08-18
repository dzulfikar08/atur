import { useState, useMemo, useCallback, useEffect } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, api, type Issue, type State, type Module } from "@/lib/api";
import FilterBar, { type FilterState } from "@/components/issues/FilterBar";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import CommentEditor from "@/components/editor/CommentEditor";
import {
  Plus,
  List,
  Columns3,
  GitBranch,
  X,
  Timer,
  Settings,
  Package,
  Bookmark,
  Save,
  Trash2,
  Table2,
  Calendar,
  GanttChart,
  User,
} from "@/lib/icons";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import {
  formatDistanceToNow,
  format,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  startOfWeek,
  endOfWeek,
  isSameMonth,
  isSameDay,
  addMonths,
  subMonths,
  parseISO,
  isWithinInterval,
  differenceInDays,
  addDays,
} from "date-fns";
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCorners,
  DragOverlay,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useDroppable } from "@dnd-kit/core";

const createIssueSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description_html: z.string().optional(),
  priority: z.string().optional(),
  state_id: z.string().optional(),
  assignee_ids: z.array(z.string()).optional(),
});

type CreateIssueForm = z.infer<typeof createIssueSchema>;

const STATE_COLORS: Record<string, string> = {
  backlog: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  unstarted: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  started: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300",
  completed: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  cancelled: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
};

const PRIORITY_COLORS: Record<string, string> = {
  urgent: "text-red-600 bg-red-50 dark:bg-red-950",
  high: "text-orange-600 bg-orange-50 dark:bg-orange-950",
  medium: "text-yellow-600 bg-yellow-50 dark:bg-yellow-950",
  low: "text-blue-600 bg-blue-50 dark:bg-blue-950",
  none: "text-muted-foreground bg-muted",
};

// --- Droppable Column ---
function DroppableColumn({
  state,
  stateIssues,
  children,
}: {
  state: State;
  stateIssues: Issue[];
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: state.id });

  return (
    <div
      ref={setNodeRef}
      className={`min-w-[260px] sm:min-w-[280px] w-[260px] sm:w-[280px] flex-shrink-0 snap-start rounded-lg transition-colors ${
        isOver ? "bg-muted/40 ring-2 ring-primary/20" : ""
      }`}
    >
      <div className="flex items-center gap-2 mb-3">
        <Badge className={STATE_COLORS[state.group] || STATE_COLORS.backlog} variant="secondary">
          {state.name}
        </Badge>
        <span className="text-xs text-muted-foreground">{stateIssues.length}</span>
      </div>
      <SortableContext items={stateIssues.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        <div className="space-y-2 min-h-[60px]">{children}</div>
      </SortableContext>
    </div>
  );
}

// --- Sortable Issue Card ---
function SortableIssueCard({
  issue,
  onClick,
  moduleMap,
}: {
  issue: Issue;
  onClick: () => void;
  moduleMap: Map<string, Module>;
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

  const issueModules = (issue.module_ids ?? [])
    .map((mid) => moduleMap.get(mid))
    .filter(Boolean) as Module[];

  return (
    <Card
      ref={setNodeRef}
      style={style}
      className={`cursor-pointer transition-shadow select-none duration-200 hover:shadow-elevated ${
        isDragging ? "shadow-lg ring-2 ring-primary/30" : ""
      }`}
      onClick={onClick}
      {...attributes}
      {...listeners}
    >
      <CardContent className="p-3">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{issue.name}</p>
            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
              {issue.parent_id && <GitBranch className="h-3 w-3" />}
              {String(issue.sequence_id).padStart(4, "0")}
            </p>
          </div>
          {issue.priority && issue.priority !== "none" && (
            <Badge variant="outline" className="text-[10px] ml-2 shrink-0">
              {issue.priority}
            </Badge>
          )}
        </div>
        {issueModules.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {issueModules.map((m) => (
              <Badge key={m.id} variant="secondary" className="text-[10px] gap-1">
                <Package className="h-2.5 w-2.5" />
                {m.name}
              </Badge>
            ))}
          </div>
        )}
        {(issue.assignees ?? []).length > 0 && (
          <div className="flex -space-x-1.5 mt-2">
            {(issue.assignees ?? []).slice(0, 3).map((a) => (
              <span
                key={a.id}
                title={a.display_name || a.email || a.username || ""}
                className="h-5 w-5 rounded-full bg-muted border border-background flex items-center justify-center text-[9px] font-medium text-muted-foreground"
              >
                {(a.display_name || a.email || a.username || "?").charAt(0).toUpperCase()}
              </span>
            ))}
            {(issue.assignees ?? []).length > 3 && (
              <span className="h-5 w-5 rounded-full bg-muted border border-background flex items-center justify-center text-[9px] text-muted-foreground">
                +{(issue.assignees ?? []).length - 3}
              </span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// --- Drag Overlay Card ---
function DragOverlayCard({ issue, moduleMap }: { issue: Issue; moduleMap: Map<string, Module> }) {
  const issueModules = (issue.module_ids ?? [])
    .map((mid) => moduleMap.get(mid))
    .filter(Boolean) as Module[];

  return (
    <Card className="shadow-xl ring-2 ring-primary/30 rotate-2 w-[260px] sm:w-[280px]">
      <CardContent className="p-3">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{issue.name}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {String(issue.sequence_id).padStart(4, "0")}
            </p>
          </div>
          {issue.priority && issue.priority !== "none" && (
            <Badge variant="outline" className="text-[10px] ml-2 shrink-0">
              {issue.priority}
            </Badge>
          )}
        </div>
        {issueModules.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {issueModules.map((m) => (
              <Badge key={m.id} variant="secondary" className="text-[10px] gap-1">
                <Package className="h-2.5 w-2.5" />
                {m.name}
              </Badge>
            ))}
          </div>
        )}
        {(issue.assignees ?? []).length > 0 && (
          <div className="flex -space-x-1.5 mt-2">
            {(issue.assignees ?? []).slice(0, 3).map((a) => (
              <span
                key={a.id}
                title={a.display_name || a.email || a.username || ""}
                className="h-5 w-5 rounded-full bg-muted border border-background flex items-center justify-center text-[9px] font-medium text-muted-foreground"
              >
                {(a.display_name || a.email || a.username || "?").charAt(0).toUpperCase()}
              </span>
            ))}
            {(issue.assignees ?? []).length > 3 && (
              <span className="h-5 w-5 rounded-full bg-muted border border-background flex items-center justify-center text-[9px] text-muted-foreground">
                +{(issue.assignees ?? []).length - 3}
              </span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function ProjectBoard() {
  const { slug, projectId } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const viewParam = searchParams.get("view");
  const view = (
    ["board", "list", "sheet", "calendar", "gantt"].includes(viewParam ?? "") ? viewParam : "board"
  ) as "board" | "list" | "sheet" | "calendar" | "gantt";
  const setView = (v: string) => {
    const params = new URLSearchParams(searchParams);
    if (v === "board") params.delete("view");
    else params.set("view", v);
    setSearchParams(params, { replace: true });
  };
  const [filters, setFilters] = useState<FilterState>({
    stateId: "all",
    priority: "all",
    moduleId: "all",
    sortBy: "created_at",
    sortDir: "desc",
  });
  const [createOpen, setCreateOpen] = useState(false);
  const [parentSearch, setParentSearch] = useState("");
  const [selectedParent, setSelectedParent] = useState<{ id: string; name: string } | null>(null);
  const [selectedModuleIds, setSelectedModuleIds] = useState<string[]>([]);
  const [selectedAssigneeIds, setSelectedAssigneeIds] = useState<string[]>([]);
  const [activeIssueId, setActiveIssueId] = useState<string | null>(null);
  const [viewName, setViewName] = useState("");
  const [viewsOpen, setViewsOpen] = useState(false);
  const [calMonth, setCalMonth] = useState(new Date());

  // Saved views
  const { data: savedViews = [] } = useQuery({
    queryKey: ["views", slug, projectId],
    queryFn: () => api.listViews(slug!, projectId!),
    enabled: !!slug && !!projectId,
  });

  const saveViewMutation = useMutation({
    mutationFn: (name: string) =>
      api.createView(slug!, projectId!, {
        name,
        query: { filters, layout: view },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["views", slug, projectId] });
      setViewName("");
      toast.success("View saved");
    },
    onError: () => toast.error("Failed to save view"),
  });

  const deleteViewMutation = useMutation({
    mutationFn: (id: string) => api.deleteView(slug!, projectId!, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["views", slug, projectId] });
      toast.success("View deleted");
    },
  });

  const loadView = (v: any) => {
    if (v.query?.filters) setFilters(v.query.filters as FilterState);
    if (v.query?.layout) setView(v.query.layout);
    setViewsOpen(false);
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const { data: parentSearchResults = [], isLoading: parentSearchLoading } = useQuery({
    queryKey: ["parent-issue-search", slug, projectId, parentSearch],
    queryFn: () =>
      apiFetch<{ results: { id: string; name: string; sequence_id: number }[] }>(
        `/workspaces/${slug}/projects/${projectId}/issues/?search=${encodeURIComponent(parentSearch)}&limit=10`,
      ).then((r) => (Array.isArray(r) ? r : r.results)),
    enabled: !!slug && !!projectId && parentSearch.length >= 2,
  });

  const { data: issues = [], isLoading: issuesLoading } = useQuery({
    queryKey: ["issues", slug, projectId],
    queryFn: () => api.listIssues(slug!, projectId!),
    enabled: !!slug && !!projectId,
  });

  const { data: states = [] } = useQuery({
    queryKey: ["states", slug, projectId],
    queryFn: () => api.listStates(slug!, projectId!),
    enabled: !!slug && !!projectId,
  });

  const { data: modules = [] } = useQuery({
    queryKey: ["modules", slug, projectId],
    queryFn: () => api.listModules(slug!, projectId!),
    enabled: !!slug && !!projectId,
  });

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

  const moduleMap = useMemo(() => new Map(modules.map((m) => [m.id, m])), [modules]);
  const memberMap = useMemo(() => new Map(members.map((m) => [m.memberId, m])), [members]);

  // Project members in the shape the mention picker expects.
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

  const form = useForm<CreateIssueForm>({
    resolver: zodResolver(createIssueSchema),
    defaultValues: {
      name: "",
      description_html: "",
      priority: "none",
      state_id: "",
      assignee_ids: [],
    },
  });

  const backlogStateId = states.find((s) => s.group === "backlog")?.id ?? states[0]?.id ?? "";
  useEffect(() => {
    if (!form.getValues("state_id") && backlogStateId) {
      form.setValue("state_id", backlogStateId);
    }
  }, [backlogStateId, form]);

  const createMutation = useMutation({
    mutationFn: (data: CreateIssueForm & { parent_id?: string | null; module_ids?: string[] }) =>
      apiFetch(`/workspaces/${slug}/projects/${projectId}/issues`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["issues", slug, projectId] });
      qc.invalidateQueries({ queryKey: ["my-issues"] });
      setCreateOpen(false);
      form.reset();
      setSelectedParent(null);
      form.setValue("state_id", backlogStateId);
      setParentSearch("");
      setSelectedModuleIds([]);
      setSelectedAssigneeIds([]);
      toast.success("Issue created");
    },
    onError: () => toast.error("Failed to create issue"),
  });

  const filteredIssues = useMemo(() => {
    const priorityOrder: Record<string, number> = {
      urgent: 4,
      high: 3,
      medium: 2,
      low: 1,
      none: 0,
    };
    let result = issues.filter((i) => {
      if (filters.stateId !== "all" && i.state_id !== filters.stateId) return false;
      if (filters.priority !== "all" && i.priority !== filters.priority) return false;
      if (filters.moduleId !== "all" && !(i.module_ids ?? []).includes(filters.moduleId))
        return false;
      return true;
    });
    // Sort
    result.sort((a, b) => {
      let cmp = 0;
      if (filters.sortBy === "updated_at")
        cmp = new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime();
      else if (filters.sortBy === "created_at")
        cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      else if (filters.sortBy === "sequence_id") cmp = a.sequence_id - b.sequence_id;
      else if (filters.sortBy === "priority")
        cmp =
          (priorityOrder[a.priority || "none"] || 0) - (priorityOrder[b.priority || "none"] || 0);
      return filters.sortDir === "desc" ? -cmp : cmp;
    });
    return result;
  }, [
    issues,
    filters.stateId,
    filters.priority,
    filters.moduleId,
    filters.sortBy,
    filters.sortDir,
  ]);

  const groupedByState = useMemo(() => {
    const groups: Record<string, { state: State; issues: Issue[] }> = {};
    for (const state of states) {
      groups[state.id] = { state, issues: [] };
    }
    for (const issue of filteredIssues) {
      const sid = issue.state_id || "none";
      if (!groups[sid])
        groups[sid] = {
          state: { id: sid, name: "No State", group: "backlog", sequence: 0 },
          issues: [],
        };
      groups[sid].issues.push(issue);
    }
    return Object.values(groups).sort((a, b) => a.state.sequence - b.state.sequence);
  }, [filteredIssues, states]);

  const activeIssue = useMemo(
    () => issues.find((i) => i.id === activeIssueId) ?? null,
    [issues, activeIssueId],
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveIssueId(event.active.id as string);
  }, []);

  const handleDragOver = useCallback((_event: DragOverEvent) => {
    // No-op; visual feedback comes from useDroppable isOver
  }, []);

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveIssueId(null);

      if (!over || !slug || !projectId) return;

      const issueId = active.id as string;
      const targetId = over.id as string;

      const draggedIssue = issues.find((i) => i.id === issueId);
      if (!draggedIssue) return;

      // Find the target state. `over.id` could be a state column id or another issue id.
      let newStateId: string | null = null;

      // Check if dropped directly on a state column
      if (states.some((s) => s.id === targetId)) {
        newStateId = targetId;
      } else {
        // Dropped on an issue card — find the state of that issue
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

  // Inline PATCH helper for sheet-view cells: centralizes field name + error handling.
  const patchIssue = useCallback(
    async (seqId: number, patch: Record<string, unknown>) => {
      if (!slug || !projectId) return;
      try {
        await apiFetch(`/workspaces/${slug}/projects/${projectId}/issues/${seqId}/`, {
          method: "PATCH",
          body: JSON.stringify(patch),
        });
        qc.invalidateQueries({ queryKey: ["issues", slug, projectId] });
      } catch {
        toast.error("Failed to update issue");
        qc.invalidateQueries({ queryKey: ["issues", slug, projectId] });
      }
    },
    [slug, projectId, qc],
  );

  if (issuesLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-pulse text-muted-foreground">Loading issues...</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b">
        <div className="flex flex-wrap items-center gap-2">
          <Tabs value={view} onValueChange={setView}>
            <TabsList className="h-8">
              <TabsTrigger value="board" className="text-xs px-2">
                <Columns3 className="h-3 w-3 mr-1" /> Board
              </TabsTrigger>
              <TabsTrigger value="list" className="text-xs px-2">
                <List className="h-3 w-3 mr-1" /> List
              </TabsTrigger>
              <TabsTrigger value="sheet" className="text-xs px-2">
                <Table2 className="h-3 w-3 mr-1" /> Sheet
              </TabsTrigger>
              <TabsTrigger value="calendar" className="text-xs px-2">
                <Calendar className="h-3 w-3 mr-1" /> Calendar
              </TabsTrigger>
              <TabsTrigger value="gantt" className="text-xs px-2">
                <GanttChart className="h-3 w-3 mr-1" /> Gantt
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={() => navigate(`/${slug}/projects/${projectId}/cycles`)}
          >
            <Timer className="h-3.5 w-3.5" /> Sprints
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={() => navigate(`/${slug}/projects/${projectId}/modules`)}
          >
            <Package className="h-3.5 w-3.5" /> Modules
          </Button>
          <FilterBar
            filters={filters}
            onChange={setFilters}
            states={states}
            modules={modules.map((m) => ({ id: m.id, name: m.name }))}
          />
          <Popover open={viewsOpen} onOpenChange={setViewsOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 text-xs gap-1">
                <Bookmark className="h-3 w-3" />
                Views {savedViews.length > 0 && `(${savedViews.length})`}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 p-2" align="start">
              {/* Save current view */}
              <div className="flex gap-1 mb-2">
                <Input
                  placeholder="View name..."
                  value={viewName}
                  onChange={(e) => setViewName(e.target.value)}
                  className="h-7 text-xs"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && viewName.trim())
                      saveViewMutation.mutate(viewName.trim());
                  }}
                />
                <Button
                  size="sm"
                  className="h-7 text-xs px-2"
                  disabled={!viewName.trim()}
                  onClick={() => saveViewMutation.mutate(viewName.trim())}
                >
                  <Save className="h-3 w-3" />
                </Button>
              </div>
              {/* Saved views list */}
              {savedViews.length === 0 ? (
                <p className="text-xs text-muted-foreground py-2 text-center">No saved views</p>
              ) : (
                <div className="space-y-0.5">
                  {savedViews.map((v: any) => (
                    <div key={v.id} className="flex items-center gap-1 group">
                      <button
                        className="flex-1 text-left px-2 py-1.5 text-sm rounded hover:bg-accent truncate"
                        onClick={() => loadView(v)}
                      >
                        <Bookmark className="h-3 w-3 inline mr-1 text-muted-foreground" />
                        {v.name}
                      </button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                        onClick={() => deleteViewMutation.mutate(v.id)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </PopoverContent>
          </Popover>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => navigate(`/${slug}/projects/${projectId}/settings`)}
          >
            <Settings className="h-4 w-4" />
          </Button>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="h-4 w-4 mr-1" /> New Issue
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Create Issue</DialogTitle>
              </DialogHeader>
              <Form {...form}>
                <form
                  onSubmit={form.handleSubmit((d) =>
                    createMutation.mutate({
                      ...d,
                      state_id: d.state_id || undefined,
                      parent_id: selectedParent?.id || null,
                      module_ids: selectedModuleIds.length > 0 ? selectedModuleIds : undefined,
                      assignee_ids:
                        selectedAssigneeIds.length > 0 ? selectedAssigneeIds : undefined,
                    }),
                  )}
                  className="space-y-4"
                >
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Title</FormLabel>
                        <FormControl>
                          <Input placeholder="Issue title" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="description_html"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Description</FormLabel>
                        <FormControl>
                          <CommentEditor
                            value={field.value ?? ""}
                            onChange={field.onChange}
                            placeholder="Describe the issue... Type / for commands"
                            members={mentionMembers}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div>
                    <label className="text-sm font-medium mb-1 block flex items-center gap-1">
                      <GitBranch className="h-3 w-3" /> Parent Issue
                      <span className="text-muted-foreground font-normal">(optional)</span>
                    </label>
                    {selectedParent ? (
                      <div className="flex items-center gap-2 p-2 border rounded-md bg-muted/30">
                        <GitBranch className="h-3 w-3 text-muted-foreground shrink-0" />
                        <span className="text-sm flex-1 truncate">{selectedParent.name}</span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5"
                          onClick={() => {
                            setSelectedParent(null);
                            setParentSearch("");
                          }}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ) : (
                      <>
                        <Input
                          placeholder="Search for parent issue..."
                          value={parentSearch}
                          onChange={(e) => setParentSearch(e.target.value)}
                          className="h-8 text-sm"
                        />
                        {parentSearch.length >= 2 && (
                          <div className="mt-1 border rounded-md max-h-[200px] overflow-y-auto">
                            {parentSearchLoading ? (
                              <div className="p-2 text-xs text-muted-foreground">Searching...</div>
                            ) : parentSearchResults.length === 0 ? (
                              <div className="p-2 text-xs text-muted-foreground">
                                No issues found
                              </div>
                            ) : (
                              parentSearchResults.map((i) => (
                                <button
                                  key={i.id}
                                  type="button"
                                  className="w-full text-left p-2 text-sm hover:bg-muted/50 transition-colors flex items-center gap-2"
                                  onClick={() => {
                                    setSelectedParent({ id: i.id, name: i.name });
                                    setParentSearch("");
                                  }}
                                >
                                  <span className="text-muted-foreground text-xs">
                                    #{String(i.sequence_id).padStart(4, "0")}
                                  </span>
                                  <span className="truncate">{i.name}</span>
                                </button>
                              ))
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                  <FormField
                    control={form.control}
                    name="state_id"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>State</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Backlog" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {states.map((s) => (
                              <SelectItem key={s.id} value={s.id}>
                                {s.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="priority"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Priority</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {["none", "low", "medium", "high", "urgent"].map((p) => (
                              <SelectItem key={p} value={p}>
                                {p}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  {members.length > 0 && (
                    <div>
                      <label className="text-sm font-medium mb-1 block flex items-center gap-1">
                        <User className="h-3 w-3" /> Assignees
                        <span className="text-muted-foreground font-normal">(optional)</span>
                      </label>
                      <div className="space-y-1">
                        {selectedAssigneeIds.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {selectedAssigneeIds.map((mid) => {
                              const mem = memberMap.get(mid);
                              return mem ? (
                                <Badge key={mid} variant="secondary" className="text-xs gap-1">
                                  {mem.displayName || mem.username || mem.email}
                                  <button
                                    type="button"
                                    className="ml-0.5 hover:text-destructive"
                                    onClick={() =>
                                      setSelectedAssigneeIds((prev) =>
                                        prev.filter((id) => id !== mid),
                                      )
                                    }
                                  >
                                    <X className="h-3 w-3" />
                                  </button>
                                </Badge>
                              ) : null;
                            })}
                          </div>
                        )}
                        <Select
                          value=""
                          onValueChange={(v) => {
                            if (v && !selectedAssigneeIds.includes(v)) {
                              setSelectedAssigneeIds((prev) => [...prev, v]);
                            }
                          }}
                        >
                          <SelectTrigger className="h-8 text-sm">
                            <SelectValue placeholder="Add assignee..." />
                          </SelectTrigger>
                          <SelectContent>
                            {members
                              .filter((m) => !selectedAssigneeIds.includes(m.memberId))
                              .map((m) => (
                                <SelectItem key={m.memberId} value={m.memberId}>
                                  {m.displayName || m.username || m.email}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  )}
                  {modules.length > 0 && (
                    <div>
                      <label className="text-sm font-medium mb-1 block flex items-center gap-1">
                        <Package className="h-3 w-3" /> Modules
                        <span className="text-muted-foreground font-normal">(optional)</span>
                      </label>
                      <div className="space-y-1">
                        {selectedModuleIds.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {selectedModuleIds.map((mid) => {
                              const mod = modules.find((m) => m.id === mid);
                              return mod ? (
                                <Badge key={mid} variant="secondary" className="text-xs gap-1">
                                  {mod.name}
                                  <button
                                    type="button"
                                    className="ml-0.5 hover:text-destructive"
                                    onClick={() =>
                                      setSelectedModuleIds((prev) =>
                                        prev.filter((id) => id !== mid),
                                      )
                                    }
                                  >
                                    <X className="h-3 w-3" />
                                  </button>
                                </Badge>
                              ) : null;
                            })}
                          </div>
                        )}
                        <Select
                          value=""
                          onValueChange={(v) => {
                            if (!selectedModuleIds.includes(v)) {
                              setSelectedModuleIds((prev) => [...prev, v]);
                            }
                          }}
                        >
                          <SelectTrigger className="h-8 text-sm">
                            <SelectValue placeholder="Add to module..." />
                          </SelectTrigger>
                          <SelectContent>
                            {modules
                              .filter((m) => !selectedModuleIds.includes(m.id))
                              .map((m) => (
                                <SelectItem key={m.id} value={m.id}>
                                  {m.name}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  )}
                  <Button type="submit" className="w-full" disabled={createMutation.isPending}>
                    {createMutation.isPending ? "Creating..." : "Create Issue"}
                  </Button>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {view === "board" && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
          <div className="flex gap-4 p-4 overflow-x-auto flex-1 snap-x">
            {groupedByState.map(({ state, issues: stateIssues }) => (
              <DroppableColumn key={state.id} state={state} stateIssues={stateIssues}>
                {stateIssues.map((issue) => (
                  <SortableIssueCard
                    key={issue.id}
                    issue={issue}
                    moduleMap={moduleMap}
                    onClick={() =>
                      navigate(`/${slug}/projects/${projectId}/issues/${issue.sequence_id}`)
                    }
                  />
                ))}
              </DroppableColumn>
            ))}
          </div>
          <DragOverlay>
            {activeIssue ? <DragOverlayCard issue={activeIssue} moduleMap={moduleMap} /> : null}
          </DragOverlay>
        </DndContext>
      )}

      {view === "list" && (
        <div className="p-4">
          <div className="border rounded-lg overflow-x-auto">
            <table className="w-full text-sm min-w-[600px]">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left p-2 font-medium text-muted-foreground w-16">ID</th>
                  <th className="text-left p-2 font-medium text-muted-foreground">Title</th>
                  <th className="text-left p-2 font-medium text-muted-foreground w-28">State</th>
                  <th className="text-left p-2 font-medium text-muted-foreground w-24">Priority</th>
                  <th className="text-left p-2 font-medium text-muted-foreground w-28">Module</th>
                  <th className="text-left p-2 font-medium text-muted-foreground w-16">Pts</th>
                  <th className="text-left p-2 font-medium text-muted-foreground hidden md:table-cell w-24">
                    Updated
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredIssues.map((issue) => {
                  const st = states.find((s) => s.id === issue.state_id);
                  return (
                    <tr
                      key={issue.id}
                      className="border-t hover:bg-muted/30 cursor-pointer transition-colors"
                      onClick={() =>
                        navigate(`/${slug}/projects/${projectId}/issues/${issue.sequence_id}`)
                      }
                    >
                      <td className="p-2 text-muted-foreground text-xs font-mono">
                        {String(issue.sequence_id).padStart(4, "0")}
                      </td>
                      <td className="p-2 font-medium max-w-xs truncate">{issue.name}</td>
                      <td className="p-2">
                        <span
                          className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full"
                          style={{
                            backgroundColor: (st?.color || "#6b7280") + "20",
                            color: st?.color || "#6b7280",
                          }}
                        >
                          <span
                            className="h-1.5 w-1.5 rounded-full"
                            style={{ backgroundColor: st?.color || "#6b7280" }}
                          />
                          {st?.name ?? "—"}
                        </span>
                      </td>
                      <td className="p-2">
                        <span
                          className={`text-xs font-medium px-2 py-0.5 rounded ${PRIORITY_COLORS[issue.priority || "none"] || PRIORITY_COLORS.none}`}
                        >
                          {issue.priority || "none"}
                        </span>
                      </td>
                      <td className="p-2">
                        {(issue.module_ids ?? []).length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {(issue.module_ids ?? []).map((mid) => {
                              const mod = moduleMap.get(mid);
                              return mod ? (
                                <Badge
                                  key={mid}
                                  variant="secondary"
                                  className="text-[10px] gap-0.5"
                                >
                                  <Package className="h-2.5 w-2.5" />
                                  {mod.name}
                                </Badge>
                              ) : null;
                            })}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="p-2 text-muted-foreground text-xs">
                        {issue.estimate_points != null ? issue.estimate_points : "—"}
                      </td>
                      <td className="p-2 text-muted-foreground text-xs hidden md:table-cell">
                        {formatDistanceToNow(new Date(issue.updated_at), { addSuffix: true })}
                      </td>
                    </tr>
                  );
                })}
                {/* Inline quick-add row */}
                <tr className="border-t">
                  <td colSpan={7} className="p-1">
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const fd = new FormData(e.currentTarget);
                        const name = fd.get("quick-add") as string;
                        if (name.trim()) {
                          createMutation.mutate({
                            name: name.trim(),
                            description_html: "",
                            priority: "none",
                            state_id: backlogStateId || undefined,
                          });
                          e.currentTarget.reset();
                        }
                      }}
                      className="flex items-center"
                    >
                      <Plus className="h-4 w-4 text-muted-foreground mx-2 shrink-0" />
                      <input
                        name="quick-add"
                        placeholder="Add issue..."
                        className="flex-1 bg-transparent text-sm py-1.5 px-1 outline-none placeholder:text-muted-foreground"
                      />
                    </form>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {view === "sheet" && (
        <div className="p-4 overflow-auto flex-1">
          <table className="w-full text-sm border-collapse min-w-[800px]">
            <thead>
              <tr className="bg-muted/50 border-b">
                <th className="text-left p-2 font-medium text-muted-foreground w-16 sticky top-0 bg-muted/50">
                  ID
                </th>
                <th className="text-left p-2 font-medium text-muted-foreground sticky top-0 bg-muted/50 min-w-[200px]">
                  Title
                </th>
                <th className="text-left p-2 font-medium text-muted-foreground w-32 sticky top-0 bg-muted/50">
                  State
                </th>
                <th className="text-left p-2 font-medium text-muted-foreground w-28 sticky top-0 bg-muted/50">
                  Priority
                </th>
                <th className="text-left p-2 font-medium text-muted-foreground w-32 sticky top-0 bg-muted/50">
                  Start
                </th>
                <th className="text-left p-2 font-medium text-muted-foreground w-32 sticky top-0 bg-muted/50">
                  Target
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredIssues.map((issue) => {
                const st = states.find((s) => s.id === issue.state_id);
                return (
                  <tr
                    key={issue.id}
                    className="border-b hover:bg-muted/20 cursor-pointer group"
                    onClick={() =>
                      navigate(`/${slug}/projects/${projectId}/issues/${issue.sequence_id}`)
                    }
                  >
                    <td className="p-2 text-xs font-mono text-muted-foreground">
                      {String(issue.sequence_id).padStart(4, "0")}
                    </td>
                    <td className="p-2 font-medium">{issue.name}</td>
                    <td className="p-1" onClick={(e) => e.stopPropagation()}>
                      <Select
                        value={issue.state_id ?? undefined}
                        onValueChange={(v) => patchIssue(issue.sequence_id, { state_id: v })}
                      >
                        <SelectTrigger
                          className="h-7 w-full justify-start gap-1 border-none bg-transparent px-2 text-xs shadow-none focus-visible:ring-1 focus-visible:ring-offset-0 dark:bg-transparent"
                          style={{ color: st?.color || "#6b7280" }}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="min-w-[10rem]">
                          {states.map((s) => (
                            <SelectItem key={s.id} value={s.id} className="text-xs">
                              <span style={{ color: s.color }}>{s.name}</span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="p-1" onClick={(e) => e.stopPropagation()}>
                      <Select
                        value={issue.priority || "none"}
                        onValueChange={(v) => patchIssue(issue.sequence_id, { priority: v })}
                      >
                        <SelectTrigger
                          className={`h-7 w-full justify-start gap-1 rounded border-none px-2 text-xs shadow-none focus-visible:ring-1 focus-visible:ring-offset-0 ${PRIORITY_COLORS[issue.priority || "none"]}`}
                        >
                          <SelectValue className="capitalize" />
                        </SelectTrigger>
                        <SelectContent className="min-w-[8rem]">
                          {["urgent", "high", "medium", "low", "none"].map((p) => (
                            <SelectItem key={p} value={p} className="text-xs capitalize">
                              {p}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="p-1" onClick={(e) => e.stopPropagation()}>
                      <DatePicker
                        value={issue.start_date}
                        onChange={(v) => patchIssue(issue.sequence_id, { start_date: v })}
                      />
                    </td>
                    <td className="p-1" onClick={(e) => e.stopPropagation()}>
                      <DatePicker
                        value={issue.target_date}
                        onChange={(v) => patchIssue(issue.sequence_id, { target_date: v })}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {view === "calendar" && (
        <div className="flex-1 overflow-auto p-4">
          {/* Month navigation */}
          <div className="flex items-center justify-between mb-4">
            <Button variant="ghost" size="sm" onClick={() => setCalMonth(subMonths(calMonth, 1))}>
              ← Prev
            </Button>
            <h3 className="text-sm font-semibold">{format(calMonth, "MMMM yyyy")}</h3>
            <Button variant="ghost" size="sm" onClick={() => setCalMonth(addMonths(calMonth, 1))}>
              Next →
            </Button>
          </div>
          {/* Calendar grid */}
          {(() => {
            const monthStart = startOfMonth(calMonth);
            const monthEnd = endOfMonth(calMonth);
            const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
            const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
            const days = eachDayOfInterval({ start: gridStart, end: gridEnd });
            const today = new Date();
            const issuesWithDates = filteredIssues.filter((i) => i.start_date || i.target_date);

            return (
              <div className="border rounded-lg overflow-hidden">
                {/* Day headers */}
                <div className="grid grid-cols-7 bg-muted/50">
                  {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
                    <div
                      key={d}
                      className="p-2 text-center text-xs font-medium text-muted-foreground border-r last:border-r-0"
                    >
                      {d}
                    </div>
                  ))}
                </div>
                {/* Weeks */}
                {Array.from({ length: Math.ceil(days.length / 7) }, (_, weekIdx) => (
                  <div key={weekIdx} className="grid grid-cols-7 border-t">
                    {days.slice(weekIdx * 7, weekIdx * 7 + 7).map((day) => {
                      const dayIssues = issuesWithDates.filter((i) => {
                        const start = i.start_date ? parseISO(i.start_date) : null;
                        const end = i.target_date ? parseISO(i.target_date) : null;
                        if (start && end) return isWithinInterval(day, { start, end });
                        if (start) return isSameDay(day, start);
                        if (end) return isSameDay(day, end);
                        return false;
                      });
                      const inMonth = isSameMonth(day, calMonth);

                      return (
                        <div
                          key={day.toISOString()}
                          className={`min-h-[100px] border-r last:border-r-0 p-1 ${
                            !inMonth ? "bg-muted/20" : ""
                          } ${isSameDay(day, today) ? "bg-primary/5" : ""}`}
                        >
                          <div
                            className={`text-xs mb-1 px-1 ${
                              isSameDay(day, today)
                                ? "font-bold text-primary"
                                : inMonth
                                  ? "text-foreground"
                                  : "text-muted-foreground/50"
                            }`}
                          >
                            {format(day, "d")}
                          </div>
                          <div className="space-y-0.5">
                            {dayIssues.slice(0, 3).map((issue) => {
                              const st = states.find((s) => s.id === issue.state_id);
                              return (
                                <button
                                  key={issue.id}
                                  className="w-full text-left text-[10px] leading-tight px-1 py-0.5 rounded truncate hover:bg-muted/50 transition-colors"
                                  style={{
                                    borderLeft: `2px solid ${st?.color || "#6b7280"}`,
                                    backgroundColor: (st?.color || "#6b7280") + "10",
                                  }}
                                  onClick={() =>
                                    navigate(
                                      `/${slug}/projects/${projectId}/issues/${issue.sequence_id}`,
                                    )
                                  }
                                  title={issue.name}
                                >
                                  {issue.name}
                                </button>
                              );
                            })}
                            {dayIssues.length > 3 && (
                              <div className="text-[10px] text-muted-foreground px-1">
                                +{dayIssues.length - 3} more
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      )}

      {view === "gantt" &&
        (() => {
          const issuesWithDates = filteredIssues.filter((i) => i.start_date || i.target_date);
          if (issuesWithDates.length === 0) {
            return (
              <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
                No issues with date ranges to display.
              </div>
            );
          }
          // Calculate date range
          const allDates = issuesWithDates.flatMap((i) => [
            i.start_date ? parseISO(i.start_date) : new Date(),
            i.target_date ? parseISO(i.target_date) : new Date(),
          ]);
          const rangeStart = subMonths(new Date(Math.min(...allDates.map(Number))), 0);
          const rangeEnd = addMonths(new Date(Math.max(...allDates.map(Number))), 0);
          const totalDays = Math.max(differenceInDays(rangeEnd, rangeStart), 1);
          const today = new Date();
          const todayOffset = differenceInDays(today, rangeStart);
          const PADDING = 2;

          return (
            <div className="flex-1 overflow-auto p-4">
              <div className="border rounded-lg overflow-hidden">
                {/* Header with date markers */}
                <div className="flex border-b bg-muted/50">
                  <div className="w-48 sm:w-64 shrink-0 p-2 text-xs font-medium text-muted-foreground border-r">
                    Issue
                  </div>
                  <div className="flex-1 relative h-6 min-w-[400px]">
                    {(() => {
                      const markers: React.ReactNode[] = [];
                      const step = totalDays <= 31 ? 1 : totalDays <= 90 ? 7 : 14;
                      for (let d = 0; d <= totalDays; d += step) {
                        const date = addDays(rangeStart, d);
                        const pct = (d / totalDays) * 100;
                        markers.push(
                          <span
                            key={d}
                            className="absolute text-[10px] text-muted-foreground"
                            style={{ left: `${pct}%`, top: 4 }}
                          >
                            {format(date, "MMM d")}
                          </span>,
                        );
                      }
                      return markers;
                    })()}
                  </div>
                </div>
                {/* Rows */}
                {issuesWithDates.map((issue) => {
                  const st = states.find((s) => s.id === issue.state_id);
                  const start = issue.start_date ? parseISO(issue.start_date) : rangeStart;
                  const end = issue.target_date ? parseISO(issue.target_date) : start;
                  const offset = Math.max(differenceInDays(start, rangeStart) - PADDING, 0);
                  const duration = Math.max(differenceInDays(end, start) + 1, 1);
                  const leftPct = (offset / totalDays) * 100;
                  const widthPct = Math.max((duration / totalDays) * 100, 1);

                  return (
                    <div
                      key={issue.id}
                      className="flex items-center border-b last:border-b-0 hover:bg-muted/20 transition-colors"
                    >
                      <div className="w-48 sm:w-64 shrink-0 p-2 border-r truncate">
                        <button
                          className="text-xs font-medium truncate text-left hover:underline"
                          onClick={() =>
                            navigate(`/${slug}/projects/${projectId}/issues/${issue.sequence_id}`)
                          }
                        >
                          {String(issue.sequence_id).padStart(4, "0")} {issue.name}
                        </button>
                      </div>
                      <div className="flex-1 relative h-10 min-w-[400px]">
                        {/* Today line */}
                        {todayOffset >= 0 && todayOffset <= totalDays && (
                          <div
                            className="absolute top-0 bottom-0 w-px bg-red-400 z-10"
                            style={{ left: `${(todayOffset / totalDays) * 100}%` }}
                          />
                        )}
                        {/* Bar */}
                        <div
                          className="absolute top-2 h-6 rounded-md flex items-center px-2 cursor-pointer hover:opacity-80 transition-opacity"
                          style={{
                            left: `${leftPct}%`,
                            width: `${widthPct}%`,
                            backgroundColor: (st?.color || "#6366f1") + "80",
                            borderLeft: `3px solid ${st?.color || "#6366f1"}`,
                          }}
                          onClick={() =>
                            navigate(`/${slug}/projects/${projectId}/issues/${issue.sequence_id}`)
                          }
                          title={issue.name}
                        >
                          {widthPct > 5 && (
                            <span className="text-[10px] font-medium text-white truncate">
                              {issue.name}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}
    </div>
  );
}
