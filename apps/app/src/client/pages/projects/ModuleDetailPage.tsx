import { Fragment, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { api, apiFetch, type Issue } from "@/lib/api";
import { buildHierarchicalRows, type TreeRow } from "@/lib/issueTree";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, ChevronDown, ChevronRight, GitBranch, Package, Plus, X } from "@/lib/icons";
import { toast } from "sonner";

interface ModuleData {
  id: string;
  name: string;
  description: string | null;
  status: string;
  start_date: string | null;
  target_date: string | null;
  created_at: string;
  updated_at: string;
}

interface StateOption {
  id: string;
  name: string;
  color?: string;
  sequence?: number;
}

// Module status → state-group token (same palette as issue states).
const MODULE_STATUS_GROUP: Record<string, string> = {
  planned: "unstarted",
  "in-progress": "started",
  completed: "completed",
  cancelled: "cancelled",
  paused: "backlog",
};

export default function ModuleDetailPage() {
  const { slug, projectId, moduleId } = useParams<{
    slug: string;
    projectId: string;
    moduleId: string;
  }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [issueSearch, setIssueSearch] = useState("");
  const [collapsedParents, setCollapsedParents] = useState<Set<string>>(new Set());
  const [groupBy, setGroupBy] = useState<"state" | "none">("none");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [subIssueName, setSubIssueName] = useState("");

  const { data: mod, isLoading: modLoading } = useQuery({
    queryKey: ["module", slug, projectId, moduleId],
    queryFn: () =>
      apiFetch<ModuleData>(`/workspaces/${slug}/projects/${projectId}/modules/${moduleId}/`),
    enabled: !!slug && !!projectId && !!moduleId,
  });

  // Enriched rows (state/labels/assignees/module_ids) — the module issues
  // endpoint runs them through enrichIssues server-side.
  const {
    data: moduleIssues = [],
    isLoading: issuesLoading,
    isError: issuesError,
  } = useQuery({
    queryKey: ["module-issues", slug, projectId, moduleId],
    queryFn: () =>
      apiFetch<{ results: Issue[] }>(
        `/workspaces/${slug}/projects/${projectId}/modules/${moduleId}/issues/`,
      ).then((d) => d.results),
    enabled: !!slug && !!projectId && !!moduleId,
  });

  const { data: states = [] } = useQuery({
    queryKey: ["states", slug, projectId],
    queryFn: () =>
      apiFetch<{ results: StateOption[] }>(`/workspaces/${slug}/projects/${projectId}/states/`)
        .then((d) => d.results)
        .catch(() => []),
    enabled: !!slug && !!projectId,
  });

  const { data: searchResults = [] } = useQuery({
    queryKey: ["issue-search", slug, projectId, issueSearch],
    queryFn: () =>
      apiFetch<{ results: { id: string; name: string; sequence_id: number }[] }>(
        `/workspaces/${slug}/projects/${projectId}/issues/?search=${encodeURIComponent(issueSearch)}&limit=10`,
      ).then((r) => (Array.isArray(r) ? r : r.results)),
    enabled: !!slug && !!projectId && issueSearch.length >= 2,
  });

  const invalidateIssues = () =>
    qc.invalidateQueries({ queryKey: ["module-issues", slug, projectId, moduleId] });

  const addIssue = useMutation({
    mutationFn: (issueId: string) =>
      apiFetch(`/workspaces/${slug}/projects/${projectId}/modules/${moduleId}/issues/`, {
        method: "POST",
        body: JSON.stringify({ issue_id: issueId }),
      }),
    onSuccess: () => {
      invalidateIssues();
      setIssueSearch("");
      toast.success("Issue added to module");
    },
    onError: () => toast.error("Failed to add issue"),
  });

  const removeIssue = useMutation({
    mutationFn: (issueId: string) =>
      apiFetch(`/workspaces/${slug}/projects/${projectId}/modules/${moduleId}/issues/${issueId}/`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      invalidateIssues();
      toast.success("Issue removed");
    },
    onError: () => toast.error("Failed to remove issue"),
  });

  const createSubIssue = useMutation({
    mutationFn: async ({ parentId, name }: { parentId: string; name: string }) => {
      const created = await api.createIssue(slug!, projectId!, {
        name,
        parent_id: parentId,
        priority: "none",
      });
      // A sub-issue created here must ALSO be linked into this module — the
      // module issues endpoint joins module_issues, so an unlinked issue
      // would be invisible in the view it was created from.
      await apiFetch(`/workspaces/${slug}/projects/${projectId}/modules/${moduleId}/issues/`, {
        method: "POST",
        body: JSON.stringify({ issue_id: created.id }),
      });
      return created;
    },
    onSuccess: () => {
      invalidateIssues();
      setAddingTo(null);
      setSubIssueName("");
    },
    onError: () => toast.error("Failed to create sub-issue"),
  });

  const toggleCollapse = (id: string) =>
    setCollapsedParents((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleGroup = (id: string) =>
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const openQuickAdd = (issueId: string) => {
    setCollapsedParents((prev) => {
      const next = new Set(prev);
      next.delete(issueId);
      return next;
    });
    setAddingTo((prev) => (prev === issueId ? null : issueId));
    setSubIssueName("");
  };

  // Single project view — default sameTree (no project check needed).
  const rows = useMemo(
    () => buildHierarchicalRows(moduleIssues, collapsedParents),
    [moduleIssues, collapsedParents],
  );

  const stateMap = useMemo(() => new Map(states.map((s) => [s.id, s])), [states]);

  // Group-by-state sections in state.sequence order; rows whose state is
  // missing fall into a trailing "No state" section.
  const stateGroups = useMemo(() => {
    if (groupBy !== "state") return [] as { state: StateOption | null; rows: TreeRow<Issue>[] }[];
    const groups = new Map<string, { state: StateOption | null; rows: TreeRow<Issue>[] }>();
    for (const st of states) groups.set(st.id, { state: st, rows: [] });
    const untyped: { state: StateOption | null; rows: TreeRow<Issue>[] } = {
      state: null,
      rows: [],
    };
    for (const row of rows) {
      const st = row.issue.state_id ? stateMap.get(row.issue.state_id) : undefined;
      if (st) groups.get(st.id)!.rows.push(row);
      else untyped.rows.push(row);
    }
    return [...groups.values(), ...(untyped.rows.length ? [untyped] : [])].filter(
      (g) => g.rows.length > 0,
    );
  }, [groupBy, rows, states, stateMap]);

  if (modLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-pulse text-muted-foreground">Loading module...</div>
      </div>
    );
  }

  if (!mod) {
    return (
      <div className="text-center py-16">
        <p className="text-muted-foreground">Module not found</p>
      </div>
    );
  }

  const moduleIssueIds = new Set(moduleIssues.map((i) => i.id));

  const issueUrl = (issue: Issue) => `/${slug}/projects/${projectId}/issues/${issue.sequence_id}`;

  const renderRow = (row: TreeRow<Issue>) => {
    const issue = row.issue;
    const st = issue.state_id ? stateMap.get(issue.state_id) : undefined;
    const isAdding = addingTo === issue.id;
    return (
      <Fragment key={issue.id}>
        <tr
          className="border-b hover:bg-muted/30 transition-colors group cursor-pointer"
          onClick={() => issue.sequence_id && navigate(issueUrl(issue))}
        >
          <td className="p-2 text-xs text-muted-foreground font-mono">
            #{String(issue.sequence_id || "?").padStart(4, "0")}
          </td>
          <td className="p-2">
            <div className="flex items-center" style={{ paddingLeft: row.depth * 18 }}>
              <span className="w-[22px] shrink-0 flex items-center justify-center">
                {row.childCount > 0 ? (
                  <button
                    type="button"
                    aria-label="Toggle sub-issues"
                    className="p-0.5 text-muted-foreground hover:text-foreground"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleCollapse(issue.id);
                    }}
                  >
                    {collapsedParents.has(issue.id) ? (
                      <ChevronRight className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5" />
                    )}
                  </button>
                ) : row.isSubIssue ? (
                  <span className="text-muted-foreground text-xs">↳</span>
                ) : null}
              </span>
              <span className="text-sm font-medium truncate">{issue.name}</span>
              {row.childCount > 0 && (
                <Badge variant="outline" className="ml-2 text-xs gap-0.5 shrink-0">
                  <GitBranch className="h-2.5 w-2.5" />
                  {row.childCount}
                </Badge>
              )}
              <button
                className="ml-1.5 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground shrink-0"
                title="Add sub-issue"
                onClick={(e) => {
                  e.stopPropagation();
                  openQuickAdd(issue.id);
                }}
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
          </td>
          <td className="p-2">
            {st && (
              <span
                className="text-xs px-2 py-0.5 rounded-full whitespace-nowrap"
                style={{
                  backgroundColor: (st.color || "#6b7280") + "20",
                  color: st.color || "#6b7280",
                }}
              >
                {st.name}
              </span>
            )}
          </td>
          <td className="p-2">
            {issue.priority && issue.priority !== "none" && (
              <span
                className="priority-text text-xs font-medium"
                data-priority={issue.priority}
              >
                {issue.priority}
              </span>
            )}
          </td>
          <td className="p-2">
            <div className="flex -space-x-1.5">
              {(issue.assignees ?? []).slice(0, 3).map((a) => (
                <span
                  key={a.id}
                  title={a.display_name || a.username || a.email || a.id}
                  className="h-5 w-5 rounded-full bg-muted border border-background flex items-center justify-center text-xs font-medium"
                >
                  {(a.display_name || a.username || a.email || "?").charAt(0).toUpperCase()}
                </span>
              ))}
              {(issue.assignees ?? []).length > 3 && (
                <span className="h-5 w-5 rounded-full bg-muted border border-background flex items-center justify-center text-xs">
                  +{issue.assignees!.length - 3}
                </span>
              )}
            </div>
          </td>
          <td className="p-2 text-xs text-muted-foreground whitespace-nowrap">
            {issue.updated_at
              ? formatDistanceToNow(new Date(issue.updated_at), { addSuffix: true })
              : ""}
          </td>
          <td className="p-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground hover:text-destructive shrink-0 opacity-0 group-hover:opacity-100"
              title="Remove from module"
              onClick={(e) => {
                e.stopPropagation();
                removeIssue.mutate(issue.id);
              }}
            >
              <X className="h-3 w-3" />
            </Button>
          </td>
        </tr>
        {isAdding && (
          <tr>
            <td />
            <td colSpan={6}>
              <form
                className="flex items-center gap-2 py-1"
                style={{ paddingLeft: (row.depth + 1) * 18 + 22 }}
                onSubmit={(e) => {
                  e.preventDefault();
                  if (subIssueName.trim())
                    createSubIssue.mutate({ parentId: issue.id, name: subIssueName.trim() });
                }}
              >
                <Plus className="h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  autoFocus
                  placeholder="Sub-issue name…"
                  value={subIssueName}
                  onChange={(e) => setSubIssueName(e.target.value)}
                  className="h-7 text-sm"
                  onClick={(e) => e.stopPropagation()}
                />
              </form>
            </td>
          </tr>
        )}
      </Fragment>
    );
  };

  const tableHead = (
    <thead className="bg-muted/50">
      <tr className="text-left text-xs text-muted-foreground">
        <th className="p-2 font-medium w-16">ID</th>
        <th className="p-2 font-medium">Title</th>
        <th className="p-2 font-medium w-28">State</th>
        <th className="p-2 font-medium w-20">Priority</th>
        <th className="p-2 font-medium w-24">Assignees</th>
        <th className="p-2 font-medium w-28">Updated</th>
        <th className="p-2 w-8" />
      </tr>
    </thead>
  );

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate(`/${slug}/projects/${projectId}/modules`)}
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <Package className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-xl font-bold">{mod.name}</h1>
        <span className="state-badge" data-state-group={MODULE_STATUS_GROUP[mod.status] ?? "backlog"}>
          {mod.status}
        </span>
      </div>

      {mod.description && <p className="text-sm text-muted-foreground mb-6">{mod.description}</p>}

      {(mod.start_date || mod.target_date) && (
        <div className="flex gap-4 mb-6 text-sm text-muted-foreground">
          {mod.start_date && <span>Start: {new Date(mod.start_date).toLocaleDateString()}</span>}
          {mod.target_date && <span>Target: {new Date(mod.target_date).toLocaleDateString()}</span>}
        </div>
      )}

      {/* Add issue to module */}
      <div className="mb-6 space-y-2">
        <h3 className="text-sm font-medium">Add Issue</h3>
        <div className="relative">
          <Input
            placeholder="Search issues to add..."
            value={issueSearch}
            onChange={(e) => setIssueSearch(e.target.value)}
            className="h-9"
          />
          {issueSearch.length >= 2 && searchResults.length > 0 && (
            <div className="absolute top-full left-0 right-0 border rounded-md bg-background shadow-md z-10 mt-1 max-h-[200px] overflow-y-auto">
              {searchResults
                .filter((i) => !moduleIssueIds.has(i.id))
                .map((i) => (
                  <button
                    key={i.id}
                    className="w-full text-left p-2 text-sm hover:bg-muted/50 flex items-center justify-between"
                    onClick={() => addIssue.mutate(i.id)}
                  >
                    <span>
                      <span className="text-muted-foreground text-xs mr-2">
                        #{String(i.sequence_id).padStart(4, "0")}
                      </span>
                      {i.name}
                    </span>
                    <Plus className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                ))}
            </div>
          )}
        </div>
      </div>

      {/* Issues table — sub-issue tree + optional state grouping */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">Issues ({moduleIssues.length})</h3>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setGroupBy((g) => (g === "state" ? "none" : "state"))}
            >
              Group: {groupBy === "state" ? "State" : "None"}
            </Button>
            {rows.some((r) => r.childCount > 0) && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() =>
                  setCollapsedParents((prev) =>
                    prev.size > 0
                      ? new Set()
                      : new Set(rows.filter((r) => r.childCount > 0).map((r) => r.issue.id)),
                  )
                }
              >
                {collapsedParents.size > 0 ? "Expand all" : "Collapse all"}
              </Button>
            )}
          </div>
        </div>

        {issuesLoading ? (
          <div className="animate-pulse text-sm text-muted-foreground">Loading...</div>
        ) : issuesError ? (
          <p className="text-sm text-destructive italic py-4 text-center">
            Failed to load module issues
          </p>
        ) : moduleIssues.length === 0 ? (
          <p className="text-sm text-muted-foreground italic py-4 text-center">
            No issues in this module
          </p>
        ) : groupBy === "state" ? (
          <div className="space-y-4">
            {stateGroups.map((g) => {
              const key = g.state?.id ?? "none";
              return (
                <div key={key} className="border rounded-lg overflow-hidden">
                  <button
                    className="w-full flex items-center gap-2 px-3 py-2 bg-muted/40 text-sm font-medium text-left"
                    onClick={() => toggleGroup(key)}
                  >
                    {collapsedGroups.has(key) ? (
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    )}
                    {g.state && (
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: g.state.color || "#6b7280" }}
                      />
                    )}
                    <span>{g.state?.name ?? "No state"}</span>
                    <span className="text-muted-foreground text-xs">{g.rows.length}</span>
                  </button>
                  {!collapsedGroups.has(key) && (
                    <table className="w-full text-sm">
                      {tableHead}
                      <tbody>{g.rows.map((row) => renderRow(row))}</tbody>
                    </table>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              {tableHead}
              <tbody>{rows.map((row) => renderRow(row))}</tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
