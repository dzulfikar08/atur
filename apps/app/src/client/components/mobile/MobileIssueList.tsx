import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, api } from "@/lib/api";
import MobileIssueCard from "./MobileIssueCard";
import BottomSheet from "./BottomSheet";
import PullToRefreshIndicator from "./PullToRefreshIndicator";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import CommentEditor from "@/components/editor/CommentEditor";
import { useState, useEffect, useMemo } from "react";
import { Plus, Search, SlidersHorizontal } from "@/lib/icons";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import usePullToRefresh from "@/hooks/usePullToRefresh";
import { hapticMedium } from "@/lib/haptics";
import { useWorkspaces } from "@/hooks/useWorkspaces";

interface Issue {
  id: string;
  name: string;
  sequence_id: number;
  state_id: string | null;
  parent_id: string | null;
  priority: string | null;
  project_id: string;
  created_at: string;
  updated_at: string;
  project_name?: string;
  workspace_slug?: string;
  workspace_name?: string;
  state?: { id: string; name: string; color?: string; group: string } | null;
  labels?: { id: string; name: string; color?: string }[];
  assignees?: {
    id: string;
    email?: string;
    username?: string;
    display_name?: string;
    avatar?: string | null;
  }[];
}

interface MobileIssueListProps {
  slug: string;
  projectId?: string;
}

export default function MobileIssueList({ slug, projectId }: MobileIssueListProps) {
  const qc = useQueryClient();
  const [filterOpen, setFilterOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [filterState, setFilterState] = useState<string>("all");
  const [filterPriority, setFilterPriority] = useState<string>("all");
  const [filterWorkspace, setFilterWorkspace] = useState<string>("all");
  const [filterProject, setFilterProject] = useState<string>("all");
  const [filterAssignee, setFilterAssignee] = useState<string>("all");
  const [filterLabel, setFilterLabel] = useState<string>("all");
  const [filterSortBy, setFilterSortBy] = useState<string>("updated_at");
  const [filterSortDir, setFilterSortDir] = useState<"asc" | "desc">("desc");
  const [search, setSearch] = useState("");
  const [newIssueName, setNewIssueName] = useState("");
  const [newIssueDesc, setNewIssueDesc] = useState("");
  const [newIssueState, setNewIssueState] = useState("");
  const [createWorkspaceSlug, setCreateWorkspaceSlug] = useState("");
  const [createProjectId, setCreateProjectId] = useState("");

  const isAll = slug === "all";

  const { data: workspaces = [] } = useWorkspaces();
  const { data: projects = [] } = useQuery({
    queryKey: ["projects", slug],
    queryFn: () => api.listProjects(slug),
    enabled: !!slug && !projectId && !isAll,
  });

  // Workspace + project for the create sheet. On a single workspace the slug is
  // implied; on "All Workspaces" the user picks a workspace first.
  const effectiveCreateWorkspaceSlug = projectId ? slug : isAll ? createWorkspaceSlug : slug;
  const effectiveCreateProjectId = projectId || createProjectId;

  const { data: createProjects = [] } = useQuery({
    queryKey: ["projects", effectiveCreateWorkspaceSlug],
    queryFn: () => api.listProjects(effectiveCreateWorkspaceSlug!),
    enabled: createOpen && !!effectiveCreateWorkspaceSlug && !projectId,
  });

  const { data: createStates = [] } = useQuery({
    queryKey: ["states", effectiveCreateWorkspaceSlug, effectiveCreateProjectId],
    queryFn: () => api.listStates(effectiveCreateWorkspaceSlug!, effectiveCreateProjectId!),
    enabled: createOpen && !!effectiveCreateWorkspaceSlug && !!effectiveCreateProjectId,
  });

  // Project members for @mention suggestions in the create-sheet description.
  const { data: createMembers = [] } = useQuery({
    queryKey: ["project-members", effectiveCreateWorkspaceSlug, effectiveCreateProjectId],
    queryFn: () =>
      apiFetch<{
        results: {
          memberId: string;
          username?: string | null;
          email?: string | null;
          displayName?: string | null;
          avatar?: string | null;
        }[];
      }>(`/workspaces/${effectiveCreateWorkspaceSlug}/projects/${effectiveCreateProjectId}/members/`)
        .then((d) => d.results)
        .catch(() => []),
    enabled: createOpen && !!effectiveCreateWorkspaceSlug && !!effectiveCreateProjectId,
  });

  const createMentionMembers = useMemo(
    () =>
      createMembers.map((m) => ({
        id: m.memberId,
        username: m.username || m.email?.split("@")[0] || m.memberId.slice(0, 8),
        display_name: m.displayName,
        email: m.email,
        avatar: m.avatar,
      })),
    [createMembers],
  );

  // States for the cards shown on a project board view.
  const { data: states = [] } = useQuery({
    queryKey: ["states", slug, projectId],
    queryFn: () => api.listStates(slug!, projectId!),
    enabled: !!slug && !!projectId,
  });

  // All projects across workspaces — powers the workspace/project filters on
  // the "All Workspaces" view.
  const { data: allProjects = [] } = useQuery({
    queryKey: ["all-projects"],
    queryFn: () => api.listAllProjects(),
    enabled: isAll,
  });

  const backlogStateId =
    createStates.find((s) => s.group === "backlog")?.id ?? createStates[0]?.id ?? "";
  useEffect(() => {
    if (!newIssueState && backlogStateId) setNewIssueState(backlogStateId);
  }, [backlogStateId, newIssueState]);

  const { data: allIssues = [], isLoading } = useQuery({
    queryKey: [
      "mobile-issues",
      slug,
      projectId,
      isAll ? "all" : projects.map((p) => p.id).join(","),
    ],
    queryFn: async (): Promise<Issue[]> => {
      if (isAll) return api.listAllIssues();
      if (projectId) {
        const issues = await api.listIssues(slug!, projectId);
        return issues.map((i: any) => ({ ...i }));
      }
      const results: Issue[] = [];
      for (const project of projects) {
        try {
          const issues = await apiFetch<{ results: Issue[] }>(
            `/workspaces/${slug}/projects/${project.id}/issues/?limit=100`,
          ).then((r) => r.results);
          for (const issue of issues) {
            results.push({ ...issue, project_name: project.name });
          }
        } catch {}
      }
      return results;
    },
    enabled: !!slug && (isAll || (projectId ? true : projects.length > 0)),
  });

  const createMutation = useMutation({
    mutationFn: (data: { name: string; description_html?: string; state_id?: string }) => {
      if (!effectiveCreateProjectId) throw new Error("Select a project first");
      return apiFetch(
        `/workspaces/${effectiveCreateWorkspaceSlug}/projects/${effectiveCreateProjectId}/issues`,
        {
          method: "POST",
          body: JSON.stringify(data),
        },
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mobile-issues", slug, projectId] });
      qc.invalidateQueries({ queryKey: ["my-issues"] });
      setCreateOpen(false);
      setNewIssueName("");
      setNewIssueDesc("");
      setNewIssueState(backlogStateId);
      setCreateProjectId("");
      if (isAll) setCreateWorkspaceSlug("");
      toast.success("Issue created");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to create issue"),
  });

  const filtered = allIssues.filter((i) => {
    if (filterState !== "all" && i.state_id !== filterState) return false;
    if (filterPriority !== "all" && i.priority !== filterPriority) return false;
    if (isAll && filterWorkspace !== "all" && i.workspace_slug !== filterWorkspace) return false;
    if (isAll && filterProject !== "all" && i.project_id !== filterProject) return false;
    if (filterAssignee !== "all") {
      const ids = (i.assignees ?? []).map((a) => a.id);
      if (filterAssignee === "none") {
        if (ids.length > 0) return false;
      } else if (!ids.includes(filterAssignee)) {
        return false;
      }
    }
    if (filterLabel !== "all") {
      const ids = (i.labels ?? []).map((l) => l.id);
      if (!ids.includes(filterLabel)) return false;
    }
    if (search) {
      const q = search.toLowerCase();
      const stateName = i.state?.name?.toLowerCase() ?? "";
      if (!i.name.toLowerCase().includes(q) && !stateName.includes(q)) return false;
    }
    return true;
  });

  const priorityOrder: Record<string, number> = { urgent: 4, high: 3, medium: 2, low: 1, none: 0 };
  const filteredSorted = [...filtered].sort((a, b) => {
    let cmp = 0;
    if (filterSortBy === "updated_at")
      cmp = new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime();
    else if (filterSortBy === "created_at")
      cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    else if (filterSortBy === "sequence_id") cmp = a.sequence_id - b.sequence_id;
    else if (filterSortBy === "priority")
      cmp = (priorityOrder[a.priority || "none"] || 0) - (priorityOrder[b.priority || "none"] || 0);
    else if (filterSortBy === "name") cmp = a.name.localeCompare(b.name);
    return filterSortDir === "desc" ? -cmp : cmp;
  });

  // Nest sub-issues under their parent card (indent + ↳ marker). Orphans
  // (parent filtered out) stay top-level but keep the marker.
  const hierarchical = useMemo(() => {
    const byId = new Map(filteredSorted.map((i) => [i.id, i]));
    const childrenOf = new Map<string, Issue[]>();
    const roots: Issue[] = [];
    for (const issue of filteredSorted) {
      const parent = issue.parent_id ? byId.get(issue.parent_id) : undefined;
      if (parent && parent.id !== issue.id && parent.project_id === issue.project_id) {
        const list = childrenOf.get(parent.id);
        if (list) list.push(issue);
        else childrenOf.set(parent.id, [issue]);
      } else {
        roots.push(issue);
      }
    }
    const rows: (Issue & { depth: number; childCount: number; isSubIssue: boolean })[] = [];
    const walk = (issue: Issue, depth: number, stack: Set<string>) => {
      if (stack.has(issue.id)) return; // cycle guard
      const children = childrenOf.get(issue.id) ?? [];
      rows.push({
        ...issue,
        depth,
        childCount: children.length,
        isSubIssue: depth > 0 || (!!issue.parent_id && !byId.get(issue.parent_id)),
      });
      const next = new Set(stack);
      next.add(issue.id);
      for (const child of children) walk(child, depth + 1, next);
    };
    for (const root of roots) walk(root, 0, new Set());
    return rows;
  }, [filteredSorted]);

  // Distinct assignees / labels across the fetched issues (for the filter sheet).
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

  const { pullDistance, isRefreshing, progress, pullHandlers } = usePullToRefresh({
    onRefresh: async () => {
      hapticMedium();
      await qc.invalidateQueries({ queryKey: ["mobile-issues", slug, projectId] });
      await qc.invalidateQueries({ queryKey: ["projects", slug] });
    },
  });

  const activeFilterCount = [
    filterState !== "all",
    filterPriority !== "all",
    isAll && filterWorkspace !== "all",
    isAll && filterProject !== "all",
    filterAssignee !== "all",
    filterLabel !== "all",
  ].filter(Boolean).length;

  return (
    <div className="space-y-3 overflow-y-auto" {...pullHandlers}>
      <PullToRefreshIndicator
        pullDistance={pullDistance}
        isRefreshing={isRefreshing}
        progress={progress}
      />
      {/* Search + Actions bar */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search issues..."
            className="h-9 pl-8 text-sm rounded-lg"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Button
          variant="outline"
          size="icon"
          className="h-9 w-9 shrink-0"
          onClick={() => setFilterOpen(true)}
        >
          <SlidersHorizontal className="h-4 w-4" />
        </Button>
        <Button size="icon" className="h-9 w-9 shrink-0" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {/* Active filters */}
      {activeFilterCount > 0 && (
        <div className="flex gap-1.5 flex-wrap">
          {filterState !== "all" && (
            <Badge
              variant="secondary"
              className="text-xs gap-1 cursor-pointer"
              onClick={() => setFilterState("all")}
            >
              {stateOptions.find((s) => s.id === filterState)?.name || "State"} ✕
            </Badge>
          )}
          {filterPriority !== "all" && (
            <Badge
              variant="secondary"
              className="text-xs gap-1 cursor-pointer"
              onClick={() => setFilterPriority("all")}
            >
              {filterPriority} ✕
            </Badge>
          )}
          {filterAssignee !== "all" && (
            <Badge
              variant="secondary"
              className="text-xs gap-1 cursor-pointer"
              onClick={() => setFilterAssignee("all")}
            >
              {filterAssignee === "none"
                ? "Unassigned"
                : assigneeOptions.find((a) => a.id === filterAssignee)?.display_name ||
                  assigneeOptions.find((a) => a.id === filterAssignee)?.email ||
                  "Assignee"}{" "}
              ✕
            </Badge>
          )}
          {filterLabel !== "all" && (
            <Badge
              variant="secondary"
              className="text-xs gap-1 cursor-pointer"
              onClick={() => setFilterLabel("all")}
            >
              {labelOptions.find((l) => l.id === filterLabel)?.name || "Label"} ✕
            </Badge>
          )}
          {isAll && filterWorkspace !== "all" && (
            <Badge
              variant="secondary"
              className="text-xs gap-1 cursor-pointer"
              onClick={() => {
                setFilterWorkspace("all");
                setFilterProject("all");
              }}
            >
              {workspaces.find((w) => w.slug === filterWorkspace)?.name || filterWorkspace} ✕
            </Badge>
          )}
          {isAll && filterProject !== "all" && (
            <Badge
              variant="secondary"
              className="text-xs gap-1 cursor-pointer"
              onClick={() => setFilterProject("all")}
            >
              {allProjects.find((p) => p.id === filterProject)?.name || "Project"} ✕
            </Badge>
          )}
        </div>
      )}

      {/* Issue count */}
      <p className="text-xs text-muted-foreground">
        {isLoading ? "Loading..." : `${filteredSorted.length} issues`}
      </p>

      {/* Card list */}
      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-16 rounded-xl border bg-card animate-pulse" />
          ))}
        </div>
      ) : filteredSorted.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">No issues found</div>
      ) : (
        <div className="space-y-2">
          {hierarchical.map((issue) => (
            <MobileIssueCard
              key={issue.id}
              issue={issue}
              slug={issue.workspace_slug || slug}
              projectId={projectId || issue.project_id}
              states={states}
              depth={issue.depth}
              childCount={issue.childCount}
              isSubIssue={issue.isSubIssue}
            />
          ))}
        </div>
      )}

      {/* Filter bottom sheet */}
      <BottomSheet open={filterOpen} onClose={() => setFilterOpen(false)} title="Filters">
        <div className="space-y-4">
          {isAll && (
            <>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                  Workspace
                </label>
                <Select
                  value={filterWorkspace}
                  onValueChange={(v) => {
                    setFilterWorkspace(v);
                    setFilterProject("all");
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="All Workspaces" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Workspaces</SelectItem>
                    {workspaces.map((w) => (
                      <SelectItem key={w.id} value={w.slug}>
                        {w.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                  Project
                </label>
                <Select value={filterProject} onValueChange={setFilterProject}>
                  <SelectTrigger>
                    <SelectValue placeholder="All Projects" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Projects</SelectItem>
                    {allProjects
                      .filter(
                        (p) => filterWorkspace === "all" || p.workspace_slug === filterWorkspace,
                      )
                      .map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          )}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">State</label>
            <Select value={filterState} onValueChange={setFilterState}>
              <SelectTrigger>
                <SelectValue placeholder="All States" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All States</SelectItem>
                {stateOptions.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              Priority
            </label>
            <Select value={filterPriority} onValueChange={setFilterPriority}>
              <SelectTrigger>
                <SelectValue placeholder="All Priority" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Priority</SelectItem>
                {["urgent", "high", "medium", "low", "none"].map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              Assignee
            </label>
            <Select value={filterAssignee} onValueChange={setFilterAssignee}>
              <SelectTrigger>
                <SelectValue placeholder="All Assignees" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Assignees</SelectItem>
                <SelectItem value="none">Unassigned</SelectItem>
                {assigneeOptions.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.display_name || a.email || a.id.slice(0, 8)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {labelOptions.length > 0 && (
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                Label
              </label>
              <Select value={filterLabel} onValueChange={setFilterLabel}>
                <SelectTrigger>
                  <SelectValue placeholder="All Labels" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Labels</SelectItem>
                  {labelOptions.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              Sort by
            </label>
            <Select value={filterSortBy} onValueChange={(v) => setFilterSortBy(v)}>
              <SelectTrigger>
                <SelectValue placeholder="Updated" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="updated_at">Updated</SelectItem>
                <SelectItem value="created_at">Created</SelectItem>
                <SelectItem value="sequence_id">ID</SelectItem>
                <SelectItem value="priority">Priority</SelectItem>
                <SelectItem value="name">Title</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Order</label>
            <Select
              value={filterSortDir}
              onValueChange={(v) => setFilterSortDir(v as "asc" | "desc")}
            >
              <SelectTrigger>
                <SelectValue placeholder="Descending" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="desc">Descending</SelectItem>
                <SelectItem value="asc">Ascending</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button className="w-full" onClick={() => setFilterOpen(false)}>
            Apply
          </Button>
        </div>
      </BottomSheet>

      {/* Create bottom sheet */}
      <BottomSheet open={createOpen} onClose={() => setCreateOpen(false)} title="New Issue">
        <div className="space-y-3">
          {isAll && (
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                Workspace
              </label>
              <Select
                value={createWorkspaceSlug}
                onValueChange={(v) => {
                  setCreateWorkspaceSlug(v);
                  setCreateProjectId("");
                  setNewIssueState("");
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
          {!projectId && (
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                Project
              </label>
              <Select
                value={createProjectId}
                onValueChange={(v) => {
                  setCreateProjectId(v);
                  setNewIssueState("");
                }}
                disabled={!effectiveCreateWorkspaceSlug}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      effectiveCreateWorkspaceSlug ? "Select project" : "Select a workspace first"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {createProjects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <Input
            placeholder="Issue title"
            value={newIssueName}
            onChange={(e) => setNewIssueName(e.target.value)}
          />
          <CommentEditor
            value={newIssueDesc}
            onChange={setNewIssueDesc}
            placeholder="Description (optional)"
            compact
            members={createMentionMembers}
          />
          {effectiveCreateProjectId && (
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                State
              </label>
              <Select value={newIssueState} onValueChange={setNewIssueState}>
                <SelectTrigger>
                  <SelectValue placeholder="Backlog" />
                </SelectTrigger>
                <SelectContent>
                  {createStates.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <Button
            className="w-full"
            disabled={!newIssueName.trim() || !effectiveCreateProjectId || createMutation.isPending}
            onClick={() =>
              createMutation.mutate({
                name: newIssueName,
                description_html: newIssueDesc || undefined,
                state_id: newIssueState || undefined,
              })
            }
          >
            {createMutation.isPending ? "Creating..." : "Create Issue"}
          </Button>
        </div>
      </BottomSheet>
    </div>
  );
}
