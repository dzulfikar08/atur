import { useState, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, api, type Issue, type State } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import { Plus, List, Columns3, Filter, GitBranch, X } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";

const createIssueSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description_html: z.string().optional(),
  priority: z.string().optional(),
});

type CreateIssueForm = z.infer<typeof createIssueSchema>;

const STATE_COLORS: Record<string, string> = {
  backlog: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  unstarted: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  started: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300",
  completed: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  cancelled: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
};

export default function ProjectBoard() {
  const { slug, projectId } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [view, setView] = useState<"board" | "list">("board");
  const [filterState, setFilterState] = useState<string>("all");
  const [filterPriority, setFilterPriority] = useState<string>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [parentSearch, setParentSearch] = useState("");
  const [selectedParent, setSelectedParent] = useState<{ id: string; name: string } | null>(null);

  const { data: parentSearchResults = [], isLoading: parentSearchLoading } = useQuery({
    queryKey: ["parent-issue-search", slug, projectId, parentSearch],
    queryFn: () =>
      apiFetch<{ results: { id: string; name: string; sequence_id: number }[] }>(
        `/workspaces/${slug}/projects/${projectId}/issues/?search=${encodeURIComponent(parentSearch)}&limit=10`
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

  const form = useForm<CreateIssueForm>({
    resolver: zodResolver(createIssueSchema),
    defaultValues: { name: "", description_html: "", priority: "none" },
  });

  const createMutation = useMutation({
    mutationFn: (data: CreateIssueForm & { parent_id?: string | null }) =>
      apiFetch(`/workspaces/${slug}/projects/${projectId}/issues`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["issues", slug, projectId] });
      setCreateOpen(false);
      form.reset();
      setSelectedParent(null);
      setParentSearch("");
      toast.success("Issue created");
    },
    onError: () => toast.error("Failed to create issue"),
  });

  const filteredIssues = useMemo(() => {
    return issues.filter((i) => {
      if (filterState !== "all" && i.state_id !== filterState) return false;
      if (filterPriority !== "all" && i.priority !== filterPriority) return false;
      return true;
    });
  }, [issues, filterState, filterPriority]);

  const groupedByState = useMemo(() => {
    const groups: Record<string, { state: State; issues: Issue[] }> = {};
    for (const state of states) {
      groups[state.id] = { state, issues: [] };
    }
    for (const issue of filteredIssues) {
      const sid = issue.state_id || "none";
      if (!groups[sid]) groups[sid] = { state: { id: sid, name: "No State", group: "backlog", sequence: 0 }, issues: [] };
      groups[sid].issues.push(issue);
    }
    return Object.values(groups).sort((a, b) => a.state.sequence - b.state.sequence);
  }, [filteredIssues, states]);

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
          <Tabs value={view} onValueChange={(v) => setView(v as any)}>
            <TabsList className="h-8">
              <TabsTrigger value="board" className="text-xs px-2">
                <Columns3 className="h-3 w-3 mr-1" /> Board
              </TabsTrigger>
              <TabsTrigger value="list" className="text-xs px-2">
                <List className="h-3 w-3 mr-1" /> List
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <Select value={filterState} onValueChange={setFilterState}>
            <SelectTrigger className="h-8 w-[130px] sm:w-[140px] text-xs">
              <Filter className="h-3 w-3 mr-1" />
              <SelectValue placeholder="State" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All States</SelectItem>
              {states.map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filterPriority} onValueChange={setFilterPriority}>
            <SelectTrigger className="h-8 w-[110px] sm:w-[120px] text-xs">
              <SelectValue placeholder="Priority" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Priority</SelectItem>
              {["urgent", "high", "medium", "low", "none"].map((p) => (
                <SelectItem key={p} value={p}>{p}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
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
              <form onSubmit={form.handleSubmit((d) => createMutation.mutate({ ...d, parent_id: selectedParent?.id || null }))} className="space-y-4">
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
                        <Textarea placeholder="Describe the issue..." rows={4} {...field} />
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
                            <div className="p-2 text-xs text-muted-foreground">No issues found</div>
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
                                <span className="text-muted-foreground text-xs">#{String(i.sequence_id).padStart(4, "0")}</span>
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
                            <SelectItem key={p} value={p}>{p}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit" className="w-full" disabled={createMutation.isPending}>
                  {createMutation.isPending ? "Creating..." : "Create Issue"}
                </Button>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      {view === "board" ? (
        <div className="flex gap-4 p-4 overflow-x-auto flex-1 snap-x">
          {groupedByState.map(({ state, issues: stateIssues }) => (
            <div key={state.id} className="min-w-[260px] sm:min-w-[280px] w-[260px] sm:w-[280px] flex-shrink-0 snap-start">
              <div className="flex items-center gap-2 mb-3">
                <Badge className={STATE_COLORS[state.group] || STATE_COLORS.backlog} variant="secondary">
                  {state.name}
                </Badge>
                <span className="text-xs text-muted-foreground">{stateIssues.length}</span>
              </div>
              <div className="space-y-2">
                {stateIssues.map((issue) => (
                  <Card
                    key={issue.id}
                    className="cursor-pointer hover:shadow-md transition-shadow"
                    onClick={() => navigate(`/${slug}/projects/${projectId}/issues/${issue.sequence_id}`)}
                  >
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
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="p-4">
          <div className="border rounded-lg overflow-x-auto">
            <table className="w-full text-sm min-w-[500px]">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left p-2 font-medium text-muted-foreground">ID</th>
                  <th className="text-left p-2 font-medium text-muted-foreground">Title</th>
                  <th className="text-left p-2 font-medium text-muted-foreground">State</th>
                  <th className="text-left p-2 font-medium text-muted-foreground">Priority</th>
                  <th className="text-left p-2 font-medium text-muted-foreground hidden sm:table-cell">Created</th>
                </tr>
              </thead>
              <tbody>
                {filteredIssues.map((issue) => (
                  <tr
                    key={issue.id}
                    className="border-t hover:bg-muted/30 cursor-pointer"
                    onClick={() => navigate(`/${slug}/projects/${projectId}/issues/${issue.sequence_id}`)}
                  >
                    <td className="p-2 text-muted-foreground">{String(issue.sequence_id).padStart(4, "0")}</td>
                    <td className="p-2 font-medium">{issue.name}</td>
                    <td className="p-2">
                      <Badge variant="secondary" className="text-xs">
                        {states.find(s => s.id === issue.state_id)?.name ?? "—"}
                      </Badge>
                    </td>
                    <td className="p-2">
                      <Badge variant="outline" className="text-xs">
                        {issue.priority || "none"}
                      </Badge>
                    </td>
                    <td className="p-2 text-muted-foreground text-xs hidden sm:table-cell">
                      {new Date(issue.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
