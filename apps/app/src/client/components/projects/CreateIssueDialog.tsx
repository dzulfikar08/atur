import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { apiFetch, type Module, type State } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import CommentEditor from "@/components/editor/CommentEditor";
import { GitBranch, Package, Plus, User, X } from "@/lib/icons";

const createIssueSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description_html: z.string().optional(),
  priority: z.string().optional(),
  state_id: z.string().optional(),
  assignee_ids: z.array(z.string()).optional(),
});

type CreateIssueForm = z.infer<typeof createIssueSchema>;

export interface CreateDialogMember {
  memberId: string;
  username?: string | null;
  email?: string | null;
  displayName?: string | null;
  avatar?: string | null;
}

/** "New Issue" dialog: title, description, parent, state, priority, assignees, modules. */
export default function CreateIssueDialog({
  slug,
  projectId,
  states,
  members,
  modules,
  open: createOpen,
  onOpenChange: setCreateOpen,
}: {
  slug: string;
  projectId: string;
  states: State[];
  members: CreateDialogMember[];
  modules: Module[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const [parentSearch, setParentSearch] = useState("");
  const [selectedParent, setSelectedParent] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [selectedModuleIds, setSelectedModuleIds] = useState<string[]>([]);
  const [selectedAssigneeIds, setSelectedAssigneeIds] = useState<string[]>([]);
  const memberMap = useMemo(() => new Map(members.map((m) => [m.memberId, m])), [members]);

  const { data: parentSearchResults = [], isLoading: parentSearchLoading } = useQuery({
    queryKey: ["parent-issue-search", slug, projectId, parentSearch],
    queryFn: () =>
      apiFetch<{
        results: { id: string; name: string; sequence_id: number }[];
      }>(
        `/workspaces/${slug}/projects/${projectId}/issues/?search=${encodeURIComponent(parentSearch)}&limit=10`,
      ).then((r) => (Array.isArray(r) ? r : r.results)),
    enabled: parentSearch.length >= 2,
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
    mutationFn: (
      data: CreateIssueForm & {
        parent_id?: string | null;
        module_ids?: string[];
      },
    ) =>
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

  return (
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
                assignee_ids: selectedAssigneeIds.length > 0 ? selectedAssigneeIds : undefined,
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
                                setSelectedAssigneeIds((prev) => prev.filter((id) => id !== mid))
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
                                setSelectedModuleIds((prev) => prev.filter((id) => id !== mid))
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
  );
}
