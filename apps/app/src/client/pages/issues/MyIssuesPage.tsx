import { useMemo } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useWindowSize } from "@/hooks/useWindowSize";
import MobileIssueList from "@/components/mobile/MobileIssueList";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type AllProject } from "@/lib/api";
import { useAuthStore } from "@/stores/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import CommentEditor from "@/components/editor/CommentEditor";
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
import { Skeleton } from "@/components/ui/skeleton";
import ProjectToolbar, { useVisibleColumns } from "@/components/projects/ProjectToolbar";
import ListView from "@/components/projects/views/ListView";
import type { ViewContext, ViewIssue, ViewState } from "@/components/projects/views/shared";
import { useIssueQuery } from "@/hooks/useIssueQuery";
import {
  MY_ISSUES_QUERY,
  applyIssueQuery,
  deriveFilterOptions,
  dueRef,
  groupIssues,
  sortStates,
  type SortField,
} from "@/lib/issueQuery";
import { Plus } from "@/lib/icons";
import { useWorkspaces } from "@/hooks/useWorkspaces";
import { toast } from "sonner";
import { useState } from "react";

type MyIssueRow = ViewIssue & {
  project_name?: string;
  workspace_slug?: string;
  workspace_name?: string;
};

const DESC_FIRST: SortField[] = ["updated_at", "created_at", "priority", "sequence_id"];

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

  // Members for @mention suggestions in the description editor.
  const { data: mentionMembers = [] } = useQuery({
    queryKey: ["project-members", effectiveWorkspaceSlug, effectiveProjectId],
    queryFn: () => api.listProjectMembers(effectiveWorkspaceSlug!, effectiveProjectId!),
    enabled: open && !!effectiveWorkspaceSlug && !!effectiveProjectId,
  });

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
            <CommentEditor
              value={description}
              onChange={setDescription}
              placeholder="Optional description"
              compact
              members={mentionMembers.map((m: any) => ({
                id: m.memberId,
                username: m.username || m.email?.split("@")[0] || m.memberId.slice(0, 8),
                display_name: m.displayName,
                email: m.email,
                avatar: m.avatar,
              }))}
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
  const qc = useQueryClient();
  const isAll = slug === "all";
  const me = useAuthStore((s) => s.user?.id ?? null);
  const { query, setQuery, reset } = useIssueQuery(MY_ISSUES_QUERY);
  const { columns, toggle: toggleColumn } = useVisibleColumns();
  const [searchParams, setSearchParams] = useSearchParams();
  const wsFilter = searchParams.get("ws") ?? "all";
  const projectFilter = searchParams.get("project") ?? "all";
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
  const { data: workspaces = [] } = useWorkspaces();

  const { data: projects = [] } = useQuery({
    queryKey: ["projects", slug],
    queryFn: () => api.listProjects(slug!),
    enabled: !!slug && !isAll,
  });

  // All projects across workspaces: options for the workspace/project pickers.
  const { data: allProjects = [] } = useQuery({
    queryKey: ["all-projects"],
    queryFn: () => api.listAllProjects(),
    enabled: isAll,
  });

  const {
    data: allIssues = [],
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["my-issues", slug, isAll ? "all" : projects.map((p: any) => p.id).join(",")],
    queryFn: async (): Promise<MyIssueRow[]> => {
      if (isAll) return api.listAllIssues() as unknown as Promise<MyIssueRow[]>;
      // A failing project must not silently vanish from the list: surface it.
      const perProject = await Promise.all(
        projects.map(async (project) => {
          const issues = await api.listIssues(slug, project.id);
          return issues.map((issue) => ({ ...issue, project_name: project.name }));
        }),
      );
      return perProject.flat() as MyIssueRow[];
    },
    enabled: !!slug && (isAll || projects.length > 0),
  });

  const workspaceSlugForFilter = useMemo(
    () => (wsFilter === "all" ? "all" : (workspaces.find((w) => w.id === wsFilter)?.slug ?? "all")),
    [wsFilter, workspaces],
  );

  const scoped = useMemo(
    () =>
      allIssues.filter(
        (i) =>
          (workspaceSlugForFilter === "all" || i.workspace_slug === workspaceSlugForFilter) &&
          (projectFilter === "all" || i.project_id === projectFilter),
      ),
    [allIssues, workspaceSlugForFilter, projectFilter],
  );

  // States differ per project, so the list reads each issue's embedded state.
  const states = useMemo<ViewState[]>(() => {
    const map = new Map<string, ViewState>();
    for (const i of allIssues)
      if (i.state)
        map.set(i.state.id, {
          id: i.state.id,
          name: i.state.name,
          color: i.state.color,
          group: i.state.group,
          key: i.state.key,
          sequence: 0,
        });
    return sortStates([...map.values()]);
  }, [allIssues]);
  const ctx = useMemo<ViewContext>(
    () => ({ states, stateById: new Map(states.map((s) => [s.id, s])), dueRef: dueRef() }),
    [states],
  );

  const filtered = useMemo(
    () => applyIssueQuery(scoped, query, me, { states }),
    [scoped, query, me, states],
  );
  const groups = useMemo(
    () => groupIssues(filtered, query.group, { states, me }),
    [filtered, query.group, states, me],
  );
  const options = useMemo(() => deriveFilterOptions(scoped, states), [scoped, states]);

  // A Project column only earns its width when more than one project is in play.
  const multiProject = isAll || new Set(scoped.map((i) => i.project_id)).size > 1;
  const projectLabel = (i: ViewIssue) => {
    const row = i as MyIssueRow;
    return isAll
      ? [row.workspace_name, row.project_name].filter(Boolean).join(" / ")
      : (row.project_name ?? "");
  };

  const createSubIssueMutation = useMutation({
    mutationFn: ({ parentId, name }: { parentId: string; name: string }) => {
      const parent = allIssues.find((i) => i.id === parentId);
      const wsSlug = isAll ? parent?.workspace_slug : slug;
      const projId = parent?.project_id ?? undefined;
      if (!wsSlug || !projId) throw new Error("Parent issue not found");
      return api.createIssue(wsSlug, projId, { name, parent_id: parentId, priority: "none" });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-issues"] });
      qc.invalidateQueries({ queryKey: ["mobile-issues"] });
      toast.success("Sub-issue created");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to create sub-issue"),
  });

  const onSort = (field: SortField) =>
    setQuery((q) => ({
      ...q,
      sort:
        q.sort.field === field
          ? { field, dir: q.sort.dir === "asc" ? "desc" : "asc" }
          : { field, dir: DESC_FIRST.includes(field) ? "desc" : "asc" },
    }));

  const workspacesWithProjects = useMemo(() => {
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
  }, [allProjects]);

  const scopePickers = isAll ? (
    <>
      <Select value={wsFilter} onValueChange={(v) => setScope({ ws: v, project: "all" })}>
        <SelectTrigger className="h-8 w-44 rounded-full text-xs" aria-label="Workspace">
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
      <Select value={projectFilter} onValueChange={(v) => setScope({ project: v })}>
        <SelectTrigger className="h-8 w-44 rounded-full text-xs" aria-label="Project">
          <SelectValue placeholder="All Projects" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Projects</SelectItem>
          {workspacesWithProjects
            .filter((w) => wsFilter === "all" || w.id === wsFilter)
            .flatMap((w) => w.projects)
            .map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
        </SelectContent>
      </Select>
    </>
  ) : null;

  const defaultWorkspaceSlug = isAll ? "" : slug;
  const defaultProjectId = isAll ? "" : (projects[0]?.id ?? "");

  return (
    <div className="-m-4 flex h-[calc(100dvh-3.5rem)] flex-col md:-m-6 lg:-m-8">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 pb-1 pt-4">
        <h1 className="text-xl font-semibold">My Issues</h1>
        <AddIssueDialog
          isAll={isAll}
          defaultWorkspaceSlug={defaultWorkspaceSlug}
          defaultProjectId={defaultProjectId}
          onCreated={() => {}}
        />
      </div>
      <ProjectToolbar
        query={query}
        defaults={MY_ISSUES_QUERY}
        setQuery={setQuery}
        onReset={reset}
        options={options}
        shown={filtered.length}
        total={scoped.length}
        allViewsLabel="My open work"
        columns={columns}
        onToggleColumn={toggleColumn}
        leading={scopePickers}
      />
      {isLoading ? (
        <div className="space-y-2 p-4" aria-busy="true" aria-label="Loading issues">
          {Array.from({ length: 10 }, (_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      ) : isError ? (
        <p className="p-6 text-sm text-destructive">Could not load issues. Reload to try again.</p>
      ) : (
        <ListView
          groups={groups}
          grouped={query.group !== "none"}
          ctx={ctx}
          moduleMap={new Map()}
          columns={columns}
          sort={query.sort}
          onSort={onSort}
          editable={false}
          quickAdd={false}
          projectLabel={multiProject ? projectLabel : undefined}
          onOpen={(i) =>
            navigate(
              `/${isAll ? (i as MyIssueRow).workspace_slug : slug}/projects/${i.project_id}/issues/${i.sequence_id}`,
            )
          }
          onCreate={(name, parentId) =>
            parentId && createSubIssueMutation.mutate({ parentId, name })
          }
          emptyHint={
            query.assignee.includes("me")
              ? "Nothing assigned to you matches. Clear the assignee filter to see everyone's issues."
              : "No issues match the current filters."
          }
        />
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
