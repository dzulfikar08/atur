import { useMemo, useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { useWindowSize } from "@/hooks/useWindowSize";
import MobileIssueList from "@/components/mobile/MobileIssueList";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type Issue, type AllProject } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useNavigate } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { Plus, Search, Filter, X, ArrowUpDown, User } from "@/lib/icons";
import { useWorkspaces } from "@/hooks/useWorkspaces";
import { toast } from "sonner";

type MyIssueRow = Issue & {
  project_name?: string;
  workspace_slug?: string;
  workspace_name?: string;
};

const PRIORITIES = ["urgent", "high", "medium", "low", "none"];
const PRIORITY_DOT: Record<string, string> = {
  urgent: "bg-red-500",
  high: "bg-orange-500",
  medium: "bg-yellow-500",
  low: "bg-blue-500",
  none: "bg-gray-400",
};
const SORT_OPTIONS = [
  { value: "updated_at", label: "Updated" },
  { value: "created_at", label: "Created" },
  { value: "sequence_id", label: "ID" },
  { value: "priority", label: "Priority" },
  { value: "name", label: "Title" },
];

interface Filters {
  workspace: string; // workspace id, 'all'
  project: string; // project id, 'all'
  state: string; // state id, 'all'
  priority: string; // 'all' | priority
  assignee: string; // user id, 'all' | 'none'
  label: string; // label id, 'all'
  search: string;
  sortBy: string;
  sortDir: "asc" | "desc";
}

const FILTERS_DEFAULT: Filters = {
  workspace: "all",
  project: "all",
  state: "all",
  priority: "all",
  assignee: "all",
  label: "all",
  search: "",
  sortBy: "updated_at",
  sortDir: "desc",
};

function AddIssueDialog({
  isAll,
  defaultWorkspaceSlug,
  defaultProjectId,
  onCreated,
}: {
  isAll: boolean;
  defaultWorkspaceSlug?: string;
  defaultProjectId?: string;
  onCreated: () => void;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [workspaceSlug, setWorkspaceSlug] = useState(defaultWorkspaceSlug ?? "");
  const [projectId, setProjectId] = useState(defaultProjectId ?? "");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const { data: workspaces = [] } = useWorkspaces({ enabled: open });

  // When the dialog opens from the "all" workspace, pre-select the first
  // workspace so the user only has to pick a project.
  const effectiveWorkspaceSlug = isAll
    ? workspaceSlug || workspaces[0]?.slug || ""
    : defaultWorkspaceSlug || "";

  const { data: projects = [] } = useQuery({
    queryKey: ["projects", effectiveWorkspaceSlug],
    queryFn: () => api.listProjects(effectiveWorkspaceSlug),
    enabled: open && !!effectiveWorkspaceSlug,
  });

  // Keep the selected project in sync when the workspace changes.
  const effectiveProjectId = useMemo(() => {
    if (!projectId) return "";
    if (projects.some((p) => p.id === projectId)) return projectId;
    return "";
  }, [projectId, projects]);

  const selectedWorkspace = workspaces.find((w) => w.slug === effectiveWorkspaceSlug);

  const createMutation = useMutation({
    mutationFn: (data: { name: string; description_html?: string }) => {
      if (!effectiveWorkspaceSlug || !effectiveProjectId) {
        throw new Error("Select a workspace and project");
      }
      return api.createIssue(effectiveWorkspaceSlug, effectiveProjectId, data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-issues"] });
      qc.invalidateQueries({ queryKey: ["issues", effectiveWorkspaceSlug, effectiveProjectId] });
      setOpen(false);
      setName("");
      setDescription("");
      setProjectId("");
      toast.success("Issue created");
      onCreated();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to create issue"),
  });

  const canSubmit = name.trim().length > 0 && !!effectiveProjectId;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="h-4 w-4 mr-1" /> Add Issue
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Issue</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {isAll && (
            <div className="space-y-1.5">
              <Label>Workspace</Label>
              <Select
                value={effectiveWorkspaceSlug}
                onValueChange={(v) => {
                  setWorkspaceSlug(v);
                  setProjectId("");
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select workspace" />
                </SelectTrigger>
                <SelectContent>
                  {workspaces.map((w) => (
                    <SelectItem key={w.id} value={w.slug}>
                      {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Project</Label>
            <Select
              value={effectiveProjectId}
              onValueChange={setProjectId}
              disabled={!effectiveWorkspaceSlug}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={
                    effectiveWorkspaceSlug ? "Select project" : "Select a workspace first"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Title</Label>
            <Input
              placeholder="Issue title"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea
              placeholder="Optional description"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <Button
            className="w-full"
            disabled={!canSubmit || createMutation.isPending}
            onClick={() =>
              createMutation.mutate({ name, description_html: description || undefined })
            }
          >
            {createMutation.isPending ? "Creating..." : "Create Issue"}
          </Button>
        </div>
        {selectedWorkspace && !effectiveProjectId && (
          <p className="text-xs text-muted-foreground">
            Creating in {selectedWorkspace.name} — pick a project to continue.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DesktopMyIssues({ slug }: { slug: string }) {
  const navigate = useNavigate();
  const isAll = slug === "all";
  const [filters, setFilters] = useState<Filters>(FILTERS_DEFAULT);
  const [searchInput, setSearchInput] = useState("");
  const { data: workspaces = [] } = useWorkspaces();

  // Debounce search input into filters.search.
  useEffect(() => {
    const t = setTimeout(() => setFilters((f) => ({ ...f, search: searchInput })), 250);
    return () => clearTimeout(t);
  }, [searchInput]);

  const { data: projects = [] } = useQuery({
    queryKey: ["projects", slug],
    queryFn: () => api.listProjects(slug!),
    enabled: !!slug && !isAll,
  });

  // All projects across workspaces — used to build the workspace/project
  // filter options on the "All Workspaces" view.
  const { data: allProjects = [] } = useQuery({
    queryKey: ["all-projects"],
    queryFn: () => api.listAllProjects(),
    enabled: isAll,
  });

  const { data: allIssues = [], isLoading } = useQuery({
    queryKey: ["my-issues", slug, isAll ? "all" : projects.map((p: any) => p.id).join(",")],
    queryFn: async (): Promise<MyIssueRow[]> => {
      if (isAll) return api.listAllIssues() as unknown as Promise<MyIssueRow[]>;
      const settled = await Promise.all(
        projects.map(async (project) => {
          try {
            const issues = await api.listIssues(slug, project.id);
            return issues.map((issue) => ({ ...issue, project_name: project.name }));
          } catch {
            return [] as MyIssueRow[];
          }
        }),
      );
      return settled.flat();
    },
    enabled: !!slug && (isAll || projects.length > 0),
  });

  const workspacesWithProjects = useMemo(() => {
    if (!isAll) return [];
    const map = new Map<string, { id: string; name: string; projects: AllProject[] }>();
    for (const p of allProjects) {
      const w = map.get(p.workspace_id) ?? {
        id: p.workspace_id,
        name: p.workspace_name,
        projects: [],
      };
      w.projects.push(p);
      map.set(p.workspace_id, w);
    }
    return [...map.values()];
  }, [allProjects, isAll]);

  const filterOptions = useMemo(() => {
    if (!isAll) return [];
    return workspacesWithProjects.map((w) => ({
      ...w,
      projects: w.projects.map((p) => ({
        id: p.id,
        name: p.name,
        workspace_slug: p.workspace_slug,
      })),
    }));
  }, [workspacesWithProjects, isAll]);

  // Map a selected workspace id to its slug for the client-side filter check
  // (issue rows carry workspace_slug).
  const filterWorkspaceSlug = useMemo(() => {
    if (filters.workspace === "all") return "all";
    return workspaces.find((w) => w.id === filters.workspace)?.slug ?? "all";
  }, [filters.workspace, workspaces]);

  // Distinct states/assignees/labels across the fetched issues.
  const stateOptions = useMemo(() => {
    const map = new Map<string, { id: string; name: string; group: string; color?: string }>();
    for (const i of allIssues) {
      if (i.state)
        map.set(i.state.id, {
          id: i.state.id,
          name: i.state.name,
          group: i.state.group,
          color: i.state.color,
        });
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [allIssues]);

  const assigneeOptions = useMemo(() => {
    const map = new Map<string, { id: string; display_name?: string; email?: string }>();
    for (const i of allIssues) {
      for (const a of i.assignees ?? []) {
        map.set(a.id, { id: a.id, display_name: a.display_name, email: a.email });
      }
    }
    return [...map.values()].sort((a, b) =>
      (a.display_name || a.email || "").localeCompare(b.display_name || b.email || ""),
    );
  }, [allIssues]);

  const labelOptions = useMemo(() => {
    const map = new Map<string, { id: string; name: string; color?: string }>();
    for (const i of allIssues) {
      for (const l of i.labels ?? []) {
        map.set(l.id, { id: l.id, name: l.name, color: l.color });
      }
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [allIssues]);

  const update = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));

  const activeFilterCount = [
    filters.workspace !== "all",
    filters.project !== "all",
    filters.state !== "all",
    filters.priority !== "all",
    filters.assignee !== "all",
    filters.label !== "all",
    filters.search.trim() !== "",
  ].filter(Boolean).length;

  const filteredIssues = useMemo(() => {
    const priorityOrder: Record<string, number> = {
      urgent: 4,
      high: 3,
      medium: 2,
      low: 1,
      none: 0,
    };
    const q = filters.search.trim().toLowerCase();

    let result = allIssues.filter((issue: any) => {
      if (filters.workspace !== "all" && issue.workspace_slug !== filterWorkspaceSlug) return false;
      if (filters.project !== "all" && issue.project_id !== filters.project) return false;
      if (filters.state !== "all" && issue.state_id !== filters.state) return false;
      if (filters.priority !== "all" && issue.priority !== filters.priority) return false;
      if (filters.assignee !== "all") {
        const ids = (issue.assignees ?? []).map((a: any) => a.id);
        if (filters.assignee === "none") {
          if (ids.length > 0) return false;
        } else if (!ids.includes(filters.assignee)) {
          return false;
        }
      }
      if (filters.label !== "all") {
        const ids = (issue.labels ?? []).map((l: any) => l.id);
        if (!ids.includes(filters.label)) return false;
      }
      if (q && !issue.name.toLowerCase().includes(q)) return false;
      return true;
    });

    result.sort((a: any, b: any) => {
      let cmp = 0;
      if (filters.sortBy === "updated_at")
        cmp = new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime();
      else if (filters.sortBy === "created_at")
        cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      else if (filters.sortBy === "sequence_id") cmp = a.sequence_id - b.sequence_id;
      else if (filters.sortBy === "priority")
        cmp =
          (priorityOrder[a.priority || "none"] || 0) - (priorityOrder[b.priority || "none"] || 0);
      else if (filters.sortBy === "name") cmp = a.name.localeCompare(b.name);
      return filters.sortDir === "desc" ? -cmp : cmp;
    });
    return result;
  }, [allIssues, filters, filterWorkspaceSlug]);

  const defaultWorkspaceSlug = isAll ? "" : slug;
  const defaultProjectId = isAll ? "" : (projects[0]?.id ?? "");

  const clearAll = () => {
    setFilters(FILTERS_DEFAULT);
    setSearchInput("");
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">My Issues</h1>
        <AddIssueDialog
          isAll={isAll}
          defaultWorkspaceSlug={defaultWorkspaceSlug}
          defaultProjectId={defaultProjectId}
          onCreated={() => {}}
        />
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search issues..."
          className="pl-9"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
      </div>

      {/* Filters row */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {isAll && (
          <>
            <Select
              value={filters.workspace}
              onValueChange={(v) => update({ workspace: v, project: "all" })}
            >
              <SelectTrigger className="w-44 h-8 text-xs">
                <SelectValue placeholder="All Workspaces" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Workspaces</SelectItem>
                {workspaces.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filters.project} onValueChange={(v) => update({ project: v })}>
              <SelectTrigger className="w-44 h-8 text-xs">
                <SelectValue placeholder="All Projects" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Projects</SelectItem>
                {filterOptions
                  .filter((w) => filters.workspace === "all" || w.id === filters.workspace)
                  .flatMap((w) => w.projects.map((p) => ({ ...p, workspace_name: w.name })))
                  .map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </>
        )}

        {/* State filter */}
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant={filters.state !== "all" ? "secondary" : "outline"}
              size="sm"
              className="h-8 text-xs gap-1"
            >
              <Filter className="h-3 w-3" />
              State
              {filters.state !== "all" && (
                <Badge variant="secondary" className="h-4 px-1 text-[10px] ml-0.5">
                  {stateOptions.find((s) => s.id === filters.state)?.name?.slice(0, 8) || "..."}
                </Badge>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-48 p-1" align="start">
            <button
              className={`w-full text-left px-3 py-1.5 text-sm rounded-sm hover:bg-accent ${filters.state === "all" ? "bg-accent font-medium" : ""}`}
              onClick={() => update({ state: "all" })}
            >
              All States
            </button>
            {stateOptions.map((s) => (
              <button
                key={s.id}
                className={`w-full text-left px-3 py-1.5 text-sm rounded-sm hover:bg-accent flex items-center gap-2 ${filters.state === s.id ? "bg-accent font-medium" : ""}`}
                onClick={() => update({ state: s.id })}
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: s.color || "#6b7280" }}
                />
                {s.name}
              </button>
            ))}
          </PopoverContent>
        </Popover>

        {/* Priority filter */}
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant={filters.priority !== "all" ? "secondary" : "outline"}
              size="sm"
              className="h-8 text-xs gap-1"
            >
              Priority
              {filters.priority !== "all" && (
                <Badge variant="secondary" className="h-4 px-1 text-[10px] ml-0.5">
                  {filters.priority}
                </Badge>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-40 p-1" align="start">
            <button
              className={`w-full text-left px-3 py-1.5 text-sm rounded-sm hover:bg-accent ${filters.priority === "all" ? "bg-accent font-medium" : ""}`}
              onClick={() => update({ priority: "all" })}
            >
              All Priority
            </button>
            {PRIORITIES.map((p) => (
              <button
                key={p}
                className={`w-full text-left px-3 py-1.5 text-sm rounded-sm hover:bg-accent flex items-center gap-2 ${filters.priority === p ? "bg-accent font-medium" : ""}`}
                onClick={() => update({ priority: p })}
              >
                <span className={`h-2 w-2 rounded-full ${PRIORITY_DOT[p] || "bg-gray-400"}`} />
                {p}
              </button>
            ))}
          </PopoverContent>
        </Popover>

        {/* Assignee filter */}
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant={filters.assignee !== "all" ? "secondary" : "outline"}
              size="sm"
              className="h-8 text-xs gap-1"
            >
              <User className="h-3 w-3" />
              Assignee
              {filters.assignee !== "all" && (
                <Badge variant="secondary" className="h-4 px-1 text-[10px] ml-0.5">
                  {filters.assignee === "none"
                    ? "None"
                    : (
                        assigneeOptions.find((a) => a.id === filters.assignee)?.display_name ||
                        "..."
                      )?.slice(0, 8)}
                </Badge>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-48 p-1" align="start">
            <button
              className={`w-full text-left px-3 py-1.5 text-sm rounded-sm hover:bg-accent ${filters.assignee === "all" ? "bg-accent font-medium" : ""}`}
              onClick={() => update({ assignee: "all" })}
            >
              All Assignees
            </button>
            <button
              className={`w-full text-left px-3 py-1.5 text-sm rounded-sm hover:bg-accent ${filters.assignee === "none" ? "bg-accent font-medium" : ""}`}
              onClick={() => update({ assignee: "none" })}
            >
              Unassigned
            </button>
            {assigneeOptions.map((a) => (
              <button
                key={a.id}
                className={`w-full text-left px-3 py-1.5 text-sm rounded-sm hover:bg-accent flex items-center gap-2 ${filters.assignee === a.id ? "bg-accent font-medium" : ""}`}
                onClick={() => update({ assignee: a.id })}
              >
                <span className="h-5 w-5 rounded-full bg-muted flex items-center justify-center text-[10px] font-medium">
                  {(a.display_name || a.email || "?").charAt(0).toUpperCase()}
                </span>
                <span className="truncate">{a.display_name || a.email}</span>
              </button>
            ))}
          </PopoverContent>
        </Popover>

        {/* Label filter */}
        {labelOptions.length > 0 && (
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant={filters.label !== "all" ? "secondary" : "outline"}
                size="sm"
                className="h-8 text-xs gap-1"
              >
                Label
                {filters.label !== "all" && (
                  <Badge variant="secondary" className="h-4 px-1 text-[10px] ml-0.5">
                    {labelOptions.find((l) => l.id === filters.label)?.name?.slice(0, 10) || "..."}
                  </Badge>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-48 p-1" align="start">
              <button
                className={`w-full text-left px-3 py-1.5 text-sm rounded-sm hover:bg-accent ${filters.label === "all" ? "bg-accent font-medium" : ""}`}
                onClick={() => update({ label: "all" })}
              >
                All Labels
              </button>
              {labelOptions.map((l) => (
                <button
                  key={l.id}
                  className={`w-full text-left px-3 py-1.5 text-sm rounded-sm hover:bg-accent flex items-center gap-2 ${filters.label === l.id ? "bg-accent font-medium" : ""}`}
                  onClick={() => update({ label: l.id })}
                >
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: l.color || "#6b7280" }}
                  />
                  {l.name}
                </button>
              ))}
            </PopoverContent>
          </Popover>
        )}

        {/* Sort */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 text-xs gap-1">
              <ArrowUpDown className="h-3 w-3" />
              Sort
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-44 p-1" align="start">
            {SORT_OPTIONS.map((s) => (
              <button
                key={s.value}
                className={`w-full text-left px-3 py-1.5 text-sm rounded-sm hover:bg-accent flex items-center justify-between ${filters.sortBy === s.value ? "bg-accent font-medium" : ""}`}
                onClick={() => {
                  update({
                    sortBy: s.value,
                    sortDir:
                      filters.sortBy === s.value && filters.sortDir === "asc" ? "desc" : "asc",
                  });
                }}
              >
                {s.label}
                {filters.sortBy === s.value && (
                  <span className="text-[10px] text-muted-foreground">
                    {filters.sortDir === "asc" ? "ASC" : "DESC"}
                  </span>
                )}
              </button>
            ))}
          </PopoverContent>
        </Popover>

        {/* Clear */}
        {activeFilterCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs text-muted-foreground"
            onClick={clearAll}
          >
            <X className="h-3 w-3 mr-0.5" />
            Clear
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-pulse text-muted-foreground">Loading issues...</div>
        </div>
      ) : filteredIssues.length === 0 ? (
        <p className="text-muted-foreground">No issues found</p>
      ) : (
        <div className="border rounded-lg overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left p-2 font-medium text-muted-foreground">ID</th>
                <th className="text-left p-2 font-medium text-muted-foreground">Title</th>
                <th className="text-left p-2 font-medium text-muted-foreground hidden sm:table-cell">
                  Project
                </th>
                {isAll && (
                  <th className="text-left p-2 font-medium text-muted-foreground hidden md:table-cell">
                    Workspace
                  </th>
                )}
                <th className="text-left p-2 font-medium text-muted-foreground hidden lg:table-cell">
                  State
                </th>
                <th className="text-left p-2 font-medium text-muted-foreground">Priority</th>
                <th className="text-left p-2 font-medium text-muted-foreground hidden md:table-cell">
                  Assignees
                </th>
                <th className="text-left p-2 font-medium text-muted-foreground hidden md:table-cell">
                  Updated
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredIssues.map((issue) => (
                <tr
                  key={issue.id}
                  className="border-t hover:bg-muted/30 cursor-pointer"
                  onClick={() =>
                    navigate(
                      `/${isAll ? issue.workspace_slug : slug}/projects/${issue.project_id}/issues/${issue.sequence_id}`,
                    )
                  }
                >
                  <td className="p-2 text-muted-foreground">
                    {String(issue.sequence_id).padStart(4, "0")}
                  </td>
                  <td className="p-2 font-medium max-w-[240px]">
                    <div className="truncate">{issue.name}</div>
                    {issue.labels && issue.labels.length > 0 && (
                      <div className="flex gap-1 mt-1 flex-wrap">
                        {issue.labels.slice(0, 2).map((l) => (
                          <Badge
                            key={l.id}
                            variant="outline"
                            className="text-[10px] h-4 px-1.5"
                            style={{ borderColor: l.color || undefined }}
                          >
                            {l.name}
                          </Badge>
                        ))}
                        {issue.labels.length > 2 && (
                          <span className="text-[10px] text-muted-foreground">
                            +{issue.labels.length - 2}
                          </span>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="p-2 text-muted-foreground hidden sm:table-cell">
                    {issue.project_name}
                  </td>
                  {isAll && (
                    <td className="p-2 text-muted-foreground hidden md:table-cell">
                      {issue.workspace_name}
                    </td>
                  )}
                  <td className="p-2 hidden lg:table-cell">
                    {issue.state ? (
                      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: issue.state.color || "#6b7280" }}
                        />
                        {issue.state.name}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground/60">—</span>
                    )}
                  </td>
                  <td className="p-2">
                    <Badge variant="outline" className="text-xs">
                      {issue.priority || "none"}
                    </Badge>
                  </td>
                  <td className="p-2 hidden md:table-cell">
                    {(issue.assignees ?? []).length > 0 ? (
                      <div className="flex -space-x-1.5">
                        {(issue.assignees ?? []).slice(0, 3).map((a) => (
                          <span
                            key={a.id}
                            title={a.display_name || a.email || a.username || ""}
                            className="h-5 w-5 rounded-full bg-muted border border-background flex items-center justify-center text-[9px] font-medium text-muted-foreground"
                          >
                            {(a.display_name || a.email || a.username || "?")
                              .charAt(0)
                              .toUpperCase()}
                          </span>
                        ))}
                        {(issue.assignees ?? []).length > 3 && (
                          <span className="h-5 w-5 rounded-full bg-muted border border-background flex items-center justify-center text-[9px] text-muted-foreground">
                            +{(issue.assignees ?? []).length - 3}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground/60">—</span>
                    )}
                  </td>
                  <td className="p-2 text-muted-foreground text-xs hidden md:table-cell">
                    {formatDistanceToNow(new Date(issue.updated_at), { addSuffix: true })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function MyIssuesPage() {
  const { slug } = useParams();
  const { width } = useWindowSize();

  if (!slug) return null;

  if (width < 768) {
    return (
      <div>
        <h1 className="text-lg font-semibold mb-3">My Issues</h1>
        <MobileIssueList slug={slug} />
      </div>
    );
  }

  return <DesktopMyIssues slug={slug} />;
}
