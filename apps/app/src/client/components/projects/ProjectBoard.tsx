import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, apiFetch, type Issue } from "@/lib/api";
import { useAuthStore } from "@/stores/auth";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Calendar,
  Columns3,
  GanttChart,
  List,
  Package,
  Settings,
  Table2,
  Timer,
} from "@/lib/icons";
import { useIssueQuery } from "@/hooks/useIssueQuery";
import { useSavedViews } from "@/hooks/useSavedViews";
import {
  DEFAULT_QUERY,
  applyIssueQuery,
  countFacets,
  dueRef,
  groupIssues,
  productOf,
  sortStates,
  type IssueGroup,
  type SortField,
  type ViewKind,
} from "@/lib/issueQuery";
import CreateIssueDialog from "./CreateIssueDialog";
import GanttView from "./GanttView";
import PeekDrawer, { peekSeq } from "./PeekDrawer";
import ProjectToolbar, { useVisibleColumns } from "./ProjectToolbar";
import BoardView from "./views/BoardView";
import CalendarView from "./views/CalendarView";
import ListView, { type IssuePatch } from "./views/ListView";
import SheetView from "./views/SheetView";
import type { ViewContext, ViewIssue, ViewState } from "./views/shared";

const VIEW_TABS: { value: ViewKind; label: string; icon: typeof List }[] = [
  { value: "board", label: "Board", icon: Columns3 },
  { value: "list", label: "List", icon: List },
  { value: "sheet", label: "Sheet", icon: Table2 },
  { value: "calendar", label: "Calendar", icon: Calendar },
  { value: "gantt", label: "Gantt", icon: GanttChart },
];

const DESC_FIRST: SortField[] = ["updated_at", "created_at", "priority", "sequence_id"];

export default function ProjectBoard() {
  const { slug, projectId } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const me = useAuthStore((s) => s.user?.id ?? null);
  const { query, setQuery, reset } = useIssueQuery(DEFAULT_QUERY);
  const saved = useSavedViews(slug, projectId);
  const { columns, toggle: toggleColumn } = useVisibleColumns();
  const enabled = !!slug && !!projectId;

  // ?new=1 (command palette, `c` shortcut) opens the create dialog, then is stripped.
  const [createOpen, setCreateOpen] = useState(false);
  const wantsNew = searchParams.get("new") === "1";
  useEffect(() => {
    if (!wantsNew) return;
    setCreateOpen(true);
    setSearchParams(
      (prev) => {
        const out = new URLSearchParams(prev);
        out.delete("new");
        return out;
      },
      { replace: true },
    );
  }, [wantsNew, setSearchParams]);
  const issuesKey = useMemo(() => ["issues", slug, projectId], [slug, projectId]);

  const { data: issues = [], isLoading } = useQuery({
    queryKey: issuesKey,
    queryFn: () => api.listIssues(slug!, projectId!) as Promise<ViewIssue[]>,
    enabled,
  });
  const { data: rawStates = [] } = useQuery({
    queryKey: ["states", slug, projectId],
    queryFn: () => api.listStates(slug!, projectId!),
    enabled,
  });
  const { data: modules = [] } = useQuery({
    queryKey: ["modules", slug, projectId],
    queryFn: () => api.listModules(slug!, projectId!),
    enabled,
  });
  const { data: labels = [] } = useQuery({
    queryKey: ["labels", slug, projectId],
    queryFn: () => api.listLabels(slug!, projectId!),
    enabled,
  });
  const { data: project } = useQuery({
    queryKey: ["project", slug, projectId],
    queryFn: () => api.getProject(slug!, projectId!),
    enabled,
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
    enabled,
  });

  const moduleMap = useMemo(() => new Map(modules.map((m) => [m.id, m])), [modules]);
  const ctx = useMemo<ViewContext>(() => {
    const states = sortStates(rawStates as ViewState[]);
    return {
      states,
      stateById: new Map(states.map((s) => [s.id, s])),
      dueRef: dueRef(),
    };
  }, [rawStates]);

  const view = query.view;
  // The board always shows every column (done/cancelled collapsed unless
  // "Show completed"), so the done filter is applied as column collapse there.
  const filtered = useMemo(
    () =>
      applyIssueQuery(issues, view === "board" ? { ...query, done: "show" } : query, me, {
        states: ctx.states,
      }),
    [issues, query, view, me, ctx.states],
  );
  const visibleCount = useMemo(
    () =>
      view === "board"
        ? applyIssueQuery(issues, query, me, { states: ctx.states }).length
        : filtered.length,
    [issues, query, view, me, ctx.states, filtered],
  );

  const groups = useMemo<IssueGroup<ViewIssue>[]>(
    () => groupIssues(filtered, query.group, { states: ctx.states, me, modules }),
    [filtered, query.group, ctx.states, me, modules],
  );

  const options = useMemo(() => {
    const productCounts = new Map<string, number>();
    for (const i of issues) {
      const p = productOf(i.name);
      if (p) productCounts.set(p, (productCounts.get(p) ?? 0) + 1);
    }
    return {
      assignees: members.map((m) => ({
        id: m.memberId,
        name: m.displayName || m.username || m.email || m.memberId.slice(0, 8),
      })),
      labels,
      products: [...productCounts].sort((a, b) => b[1] - a[1]).map(([p]) => p),
      modules: modules.map((m) => ({ id: m.id, name: m.name })),
      counts: countFacets(issues, ctx.states),
    };
  }, [issues, members, labels, modules, ctx.states]);

  // ---- mutations (optimistic: patch the cached list, roll back by refetch on failure) ----

  const editCache = useCallback(
    (ids: Set<string>, edit: (i: ViewIssue) => ViewIssue) =>
      qc.setQueryData<ViewIssue[]>(issuesKey, (old) =>
        old?.map((i) => (ids.has(i.id) ? edit(i) : i)),
      ),
    [qc, issuesKey],
  );

  const patchIssues = useCallback(
    async (targets: ViewIssue[], patch: IssuePatch, message?: string) => {
      if (!slug || !projectId || targets.length === 0) return;
      await qc.cancelQueries({ queryKey: issuesKey });
      const next = patch.state_id ? ctx.stateById.get(patch.state_id) : undefined;
      editCache(new Set(targets.map((t) => t.id)), (i) => ({
        ...i,
        ...patch,
        updated_at: new Date().toISOString(),
        ...(next
          ? {
              state: {
                id: next.id,
                name: next.name,
                color: next.color,
                group: next.group,
                key: next.key,
              },
            }
          : {}),
      }));
      const results = await Promise.allSettled(
        targets.map((t) =>
          apiFetch(`/workspaces/${slug}/projects/${projectId}/issues/${t.sequence_id}/`, {
            method: "PATCH",
            body: JSON.stringify(patch),
          }),
        ),
      );
      const failed = results.filter((r) => r.status === "rejected").length;
      if (failed > 0) {
        toast.error(
          failed === targets.length ? "Failed to update issue" : `${failed} updates failed`,
        );
        qc.invalidateQueries({ queryKey: issuesKey });
      } else if (message) {
        toast.success(message);
      }
      qc.invalidateQueries({ queryKey: ["my-issues"], refetchType: "none" });
    },
    [slug, projectId, qc, issuesKey, ctx.stateById, editCache],
  );

  const assignIssues = useCallback(
    async (targets: ViewIssue[], memberId: string) => {
      if (!slug || !projectId) return;
      const m = members.find((x) => x.memberId === memberId);
      const todo = targets.filter((t) => !(t.assignees ?? []).some((a) => a.id === memberId));
      if (!m || todo.length === 0) return;
      editCache(new Set(todo.map((t) => t.id)), (i) => ({
        ...i,
        assignees: [
          ...(i.assignees ?? []),
          {
            id: memberId,
            email: m.email ?? undefined,
            username: m.username ?? undefined,
            display_name: m.displayName ?? undefined,
            avatar: m.avatar,
          },
        ],
      }));
      const results = await Promise.allSettled(
        todo.map((t) => api.addAssignee(slug, projectId, t.sequence_id, memberId)),
      );
      if (results.some((r) => r.status === "rejected")) {
        toast.error("Failed to assign");
        qc.invalidateQueries({ queryKey: issuesKey });
      }
    },
    [slug, projectId, members, qc, issuesKey, editCache],
  );

  const quickCreate = useMutation({
    mutationFn: ({ name, parentId }: { name: string; parentId?: string }) => {
      const first = ctx.states.find((s) => s.group === "backlog") ?? ctx.states[0];
      return api.createIssue(slug!, projectId!, {
        name,
        description_html: "",
        priority: "none",
        state_id: first?.id,
        parent_id: parentId ?? null,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: issuesKey });
      qc.invalidateQueries({ queryKey: ["my-issues"] });
      toast.success("Issue created");
    },
    onError: () => toast.error("Failed to create issue"),
  });

  // ---- peek drawer (?peek=JOYO-42) ----

  const identifier = project?.identifier ?? "";
  const peekedSeq = peekSeq(searchParams.get("peek"));
  const openPeek = useCallback(
    (seq: number) =>
      setSearchParams(
        (prev) => {
          const out = new URLSearchParams(prev);
          out.set("peek", `${identifier || "ISSUE"}-${seq}`);
          return out;
        },
        { replace: false },
      ),
    [setSearchParams, identifier],
  );
  const closePeek = useCallback(
    () =>
      setSearchParams(
        (prev) => {
          if (!prev.has("peek")) return prev;
          const out = new URLSearchParams(prev);
          out.delete("peek");
          return out;
        },
        { replace: true },
      ),
    [setSearchParams],
  );
  const onOpen = useCallback((i: Issue) => openPeek(i.sequence_id), [openPeek]);

  const onSort = (field: SortField) =>
    setQuery((q) => ({
      ...q,
      sort:
        q.sort.field === field
          ? { field, dir: q.sort.dir === "asc" ? "desc" : "asc" }
          : { field, dir: DESC_FIRST.includes(field) ? "desc" : "asc" },
    }));

  const bots = useMemo(() => {
    const ids = new Set<string>();
    for (const i of issues) for (const a of i.assignees ?? []) if (a.is_bot) ids.add(a.id);
    return ids.size;
  }, [issues]);

  if (!slug || !projectId) return null;

  const swimlanes = query.group !== "none" && query.group !== "state";
  const lanes: IssueGroup<ViewIssue>[] = swimlanes
    ? groups
    : [{ key: "all", label: "All issues", issues: filtered }];

  return (
    <div className="-m-4 flex h-[calc(100dvh-7rem)] flex-col md:-m-6 md:h-[calc(100dvh-3.5rem)] lg:-m-8">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <Tabs value={view} onValueChange={(v) => setQuery({ view: v as ViewKind })}>
            <TabsList className="h-8 rounded-[9px] bg-[var(--surface-elevated)] p-[3px] ring-0">
              {VIEW_TABS.map(({ value, label, icon: Icon }) => (
                <TabsTrigger
                  key={value}
                  value={value}
                  className="rounded-[7px] px-2 text-xs data-[state=active]:bg-[var(--surface-card-hover)]"
                >
                  <Icon className="mr-1 h-3 w-3" /> {label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 rounded-full text-xs"
            onClick={() => navigate(`/${slug}/projects/${projectId}/cycles`)}
          >
            <Timer className="h-3.5 w-3.5" /> Sprints
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 rounded-full text-xs"
            onClick={() => navigate(`/${slug}/projects/${projectId}/modules`)}
          >
            <Package className="h-3.5 w-3.5" /> Modules
          </Button>
        </div>
        <div className="flex items-center gap-2">
          {bots > 0 && (
            <span className="ops-chip ops-chip-green">
              <span className="ops-dot" />
              {bots} agent{bots === 1 ? "" : "s"} on this board
            </span>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-label="Project settings"
            onClick={() => navigate(`/${slug}/projects/${projectId}/settings`)}
          >
            <Settings className="h-4 w-4" />
          </Button>
          <CreateIssueDialog
            slug={slug}
            projectId={projectId}
            states={rawStates}
            members={members}
            modules={modules}
            open={createOpen}
            onOpenChange={setCreateOpen}
          />
        </div>
      </div>

      <ProjectToolbar
        query={query}
        defaults={DEFAULT_QUERY}
        setQuery={setQuery}
        onReset={reset}
        options={options}
        shown={visibleCount}
        total={issues.length}
        saved={saved}
        columns={columns}
        onToggleColumn={toggleColumn}
      />

      {isLoading ? (
        <div className="space-y-2 p-4" aria-busy="true" aria-label="Loading issues">
          {Array.from({ length: 10 }, (_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      ) : (
        <>
          {view === "board" && (
            <BoardView
              lanes={lanes}
              swimlanes={swimlanes}
              ctx={ctx}
              moduleMap={moduleMap}
              expandClosed={
                query.done === "show" || query.state.some((k) => k === "done" || k === "cancelled")
              }
              onOpen={onOpen}
              onMove={(issue, stateId) =>
                patchIssues([issue], { state_id: stateId }, "Issue moved")
              }
            />
          )}
          {view === "list" && (
            <ListView
              groups={groups}
              grouped={query.group !== "none"}
              ctx={ctx}
              moduleMap={moduleMap}
              columns={columns}
              sort={query.sort}
              onSort={onSort}
              people={options.assignees}
              onOpen={onOpen}
              onPatch={patchIssues}
              onAssign={assignIssues}
              onCreate={(name, parentId) => quickCreate.mutate({ name, parentId })}
            />
          )}
          {view === "sheet" && (
            <SheetView issues={filtered} ctx={ctx} onOpen={onOpen} onPatch={patchIssues} />
          )}
          {view === "calendar" && <CalendarView issues={filtered} ctx={ctx} onOpen={onOpen} />}
          {view === "gantt" && (
            <GanttView
              issues={filtered}
              states={ctx.states}
              groupBy={query.group}
              onOpen={openPeek}
              onReschedule={(id, start, target) => {
                const issue = issues.find((i) => i.id === id);
                if (issue)
                  patchIssues([issue], {
                    start_date: start,
                    target_date: target,
                  });
              }}
            />
          )}
        </>
      )}

      <PeekDrawer
        slug={slug}
        projectId={projectId}
        identifier={identifier || "ISSUE"}
        seq={peekedSeq}
        onClose={closePeek}
        onOpenFull={(seq) => navigate(`/${slug}/projects/${projectId}/issues/${seq}`)}
      />
    </div>
  );
}
