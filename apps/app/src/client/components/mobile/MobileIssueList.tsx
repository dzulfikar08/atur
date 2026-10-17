import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, api } from "@/lib/api";
import { buildHierarchicalRows } from "@/lib/issueTree";
import MobileIssueCard from "./MobileIssueCard";
import BottomSheet from "./BottomSheet";
import PullToRefreshIndicator from "./PullToRefreshIndicator";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import CommentEditor from "@/components/editor/CommentEditor";
import { useState, useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import FilterBar from "@/components/issues/FilterBar";
import { useAuthStore } from "@/stores/auth";
import { useIssueQuery } from "@/hooks/useIssueQuery";
import {
  DEFAULT_QUERY,
  MY_ISSUES_QUERY,
  PRESET_VIEWS,
  SORT_FIELDS,
  activeFilterCount as activeFilterCountOf,
  applyIssueQuery,
  deriveFilterOptions,
  sameQuery,
  sortStates,
  type QueryState,
  type SortField,
} from "@/lib/issueQuery";
import { Plus, Search, SlidersHorizontal } from "@/lib/icons";
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
  start_date: string | null;
  target_date: string | null;
  is_decision?: boolean | number | null;
  module_ids?: string[];
  project_name?: string;
  workspace_slug?: string;
  workspace_name?: string;
  state?: { id: string; name: string; color?: string; group: string; key?: string | null } | null;
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
  const { query, setQuery, reset } = useIssueQuery(projectId ? DEFAULT_QUERY : MY_ISSUES_QUERY);
  const me = useAuthStore((s) => s.user?.id ?? null);
  const [searchParams, setSearchParams] = useSearchParams();
  const filterWorkspace = searchParams.get("ws") ?? "all";
  const filterProject = searchParams.get("project") ?? "all";
  const setScope = (patch: { ws?: string; project?: string }) =>
    setSearchParams(
      (prev) => {
        const out = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(patch)) {
          if (v === "all") out.delete(k);
          else out.set(k, v);
        }
        return out;
      },
      { replace: true },
    );
  const [search, setSearch] = useState(query.q);
  useEffect(() => setSearch(query.q), [query.q]);
  useEffect(() => {
    if (search === query.q) return;
    const t = setTimeout(() => setQuery({ q: search }), 250);
    return () => clearTimeout(t);
  }, [search, query.q, setQuery]);
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
      }>(
        `/workspaces/${effectiveCreateWorkspaceSlug}/projects/${effectiveCreateProjectId}/members/`,
      )
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

  const scoped = useMemo(
    () =>
      allIssues.filter(
        (i) =>
          (!isAll || filterWorkspace === "all" || i.workspace_slug === filterWorkspace) &&
          (!isAll || filterProject === "all" || i.project_id === filterProject),
      ),
    [allIssues, isAll, filterWorkspace, filterProject],
  );
  const derivedStates = useMemo(() => {
    const map = new Map<string, QueryState>();
    for (const i of allIssues) if (i.state) map.set(i.state.id, { ...i.state, sequence: 0 });
    return sortStates([...map.values()]);
  }, [allIssues]);
  const filteredSorted = useMemo(
    () => applyIssueQuery(scoped, query, me, { states: derivedStates }),
    [scoped, query, me, derivedStates],
  );

  // Nest sub-issues under their parent card (indent + ↳ marker). Orphans
  // (parent filtered out) stay top-level but keep the marker.
  const hierarchical = useMemo(
    () =>
      buildHierarchicalRows(filteredSorted, new Set(), {
        sameTree: (p, c) => p.project_id === c.project_id,
      }).map((r) => ({
        ...r.issue,
        depth: r.depth,
        childCount: r.childCount,
        isSubIssue: r.isSubIssue,
      })),
    [filteredSorted],
  );

  const options = useMemo(
    () => deriveFilterOptions(scoped, derivedStates),
    [scoped, derivedStates],
  );

  const { pullDistance, isRefreshing, progress, pullHandlers } = usePullToRefresh({
    onRefresh: async () => {
      hapticMedium();
      await qc.invalidateQueries({ queryKey: ["mobile-issues", slug, projectId] });
      await qc.invalidateQueries({ queryKey: ["projects", slug] });
    },
  });

  const activeFilterCount =
    activeFilterCountOf(query, projectId ? DEFAULT_QUERY : MY_ISSUES_QUERY) +
    (isAll && filterWorkspace !== "all" ? 1 : 0) +
    (isAll && filterProject !== "all" ? 1 : 0);

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
          className="relative h-9 w-9 shrink-0"
          aria-label="Filters"
          onClick={() => setFilterOpen(true)}
        >
          <SlidersHorizontal className="h-4 w-4" />
          {activeFilterCount > 0 && (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-xs text-primary-foreground">
              {activeFilterCount}
            </span>
          )}
        </Button>
        <Button size="icon" className="h-9 w-9 shrink-0" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {/* Saved presets */}
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
        {[
          {
            id: "all",
            name: projectId ? "All" : "My open work",
            query: projectId ? DEFAULT_QUERY : MY_ISSUES_QUERY,
          },
          ...PRESET_VIEWS,
        ].map((t) => {
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
              <Select
                value={filterWorkspace}
                onValueChange={(v) => setScope({ ws: v, project: "all" })}
              >
                <SelectTrigger aria-label="Workspace">
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
              <Select value={filterProject} onValueChange={(v) => setScope({ project: v })}>
                <SelectTrigger aria-label="Project">
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
            </>
          )}
          <FilterBar {...options} query={query} onChange={(patch) => setQuery(patch)} />
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                Sort by
              </label>
              <Select
                value={query.sort.field}
                onValueChange={(v) => setQuery({ sort: { ...query.sort, field: v as SortField } })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SORT_FIELDS.map((f) => (
                    <SelectItem key={f} value={f}>
                      {f.replace(/_/g, " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                Order
              </label>
              <Select
                value={query.sort.dir}
                onValueChange={(v) =>
                  setQuery({ sort: { ...query.sort, dir: v as "asc" | "desc" } })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="desc">Descending</SelectItem>
                  <SelectItem value="asc">Ascending</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => {
                reset();
                setScope({ ws: "all", project: "all" });
              }}
            >
              Clear
            </Button>
            <Button className="flex-1" onClick={() => setFilterOpen(false)}>
              Apply
            </Button>
          </div>
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
