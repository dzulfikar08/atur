import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DatePicker } from "@/components/ui/date-picker";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  ArrowLeft,
  Plus,
  Package,
  Trash2,
  Info,
  Pencil,
  ClipboardCopy,
  Copy,
  Check,
  ChevronDown,
  Layers,
} from "@/lib/icons";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

interface Module {
  id: string;
  name: string;
  description: string | null;
  status: string;
  start_date: string | null;
  target_date: string | null;
  sort_order: number;
  project: string;
  workspace: string;
  lead: string | null;
  created_at: string;
  updated_at: string;
}

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  planned: { bg: "bg-blue-50 dark:bg-blue-950", text: "text-blue-700 dark:text-blue-300" },
  "in-progress": {
    bg: "bg-yellow-50 dark:bg-yellow-950",
    text: "text-yellow-700 dark:text-yellow-300",
  },
  paused: { bg: "bg-gray-50 dark:bg-gray-950", text: "text-gray-700 dark:text-gray-300" },
  completed: { bg: "bg-green-50 dark:bg-green-950", text: "text-green-700 dark:text-green-300" },
  cancelled: { bg: "bg-red-50 dark:bg-red-950", text: "text-red-700 dark:text-red-300" },
};

export default function ModulesPage() {
  const { slug, projectId } = useParams<{ slug: string; projectId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [startDate, setStartDate] = useState("");
  const [targetDate, setTargetDate] = useState("");

  const { data: modules = [], isLoading } = useQuery({
    queryKey: ["modules", slug, projectId],
    queryFn: () =>
      apiFetch<{ results: Module[] }>(`/workspaces/${slug}/projects/${projectId}/modules/`).then(
        (d) => d.results,
      ),
    enabled: !!slug && !!projectId,
  });

  const createModule = useMutation({
    mutationFn: (data: Record<string, string>) =>
      apiFetch(`/workspaces/${slug}/projects/${projectId}/modules/`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["modules", slug, projectId] });
      setCreateOpen(false);
      setName("");
      setDesc("");
      setStartDate("");
      setTargetDate("");
      toast.success("Module created");
    },
    onError: () => toast.error("Failed to create module"),
  });

  const deleteModule = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/workspaces/${slug}/projects/${projectId}/modules/${id}/`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["modules", slug, projectId] });
      toast.success("Module deleted");
    },
    onError: () => toast.error("Failed to delete module"),
  });

  const [tipsOpen, setTipsOpen] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{
    name: string;
    description: string;
    status: string;
    start_date: string | null;
    target_date: string | null;
  } | null>(null);

  const updateModule = useMutation({
    mutationFn: (params: {
      id: string;
      body: {
        name: string;
        description?: string | null;
        status?: string;
        start_date?: string | null;
        target_date?: string | null;
      };
    }) =>
      apiFetch(`/workspaces/${slug}/projects/${projectId}/modules/${params.id}/`, {
        method: "PATCH",
        body: JSON.stringify(params.body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["modules", slug, projectId] });
      setEditingId(null);
      setDraft(null);
      toast.success("Module updated");
    },
    onError: () => toast.error("Failed to update module"),
  });

  const startEdit = (m: Module) => {
    setDraft({
      name: m.name,
      description: m.description ?? "",
      status: m.status,
      start_date: m.start_date,
      target_date: m.target_date,
    });
    setEditingId(m.id);
  };

  const cancelEdit = () => {
    setDraft(null);
    setEditingId(null);
  };

  const save = () => {
    if (!draft || !editingId) return;
    updateModule.mutate({
      id: editingId,
      body: {
        name: draft.name,
        description: draft.description || null,
        status: draft.status,
        start_date: draft.start_date,
        target_date: draft.target_date,
      },
    });
  };

  const copyId = (id: string) => {
    navigator.clipboard.writeText(id);
    toast.success("Module ID copied");
  };

  const copySummary = (m: Module) => {
    const summary = [
      `Module: ${m.name}`,
      `ID: ${m.id}`,
      `Status: ${m.status}`,
      m.start_date ? `Start: ${new Date(m.start_date).toLocaleDateString()}` : null,
      m.target_date ? `Target: ${new Date(m.target_date).toLocaleDateString()}` : null,
    ]
      .filter(Boolean)
      .join("\n");
    navigator.clipboard.writeText(summary);
    toast.success("Module summary copied");
  };

  return (
    <TooltipProvider>
    <div className="max-w-5xl mx-auto">
      {/* Tips card — what a Module is */}
      <Card className="mb-6">
        <button
          type="button"
          className="w-full flex items-center justify-between gap-3 p-3 text-left"
          onClick={() => setTipsOpen((v) => !v)}
        >
          <span className="flex items-center gap-2 text-sm font-medium">
            <Info className="h-4 w-4 text-muted-foreground" />
            What is a Module?
          </span>
          <ChevronDown
            className={`h-4 w-4 text-muted-foreground transition-transform ${tipsOpen ? "" : "-rotate-90"}`}
          />
        </button>
        {tipsOpen && (
          <CardContent className="pb-4 space-y-2 text-sm text-muted-foreground">
            <p>
              A Module is a <strong>grouping bucket for issues</strong> inside a project — a
              workstream, feature area, or release slice. Hierarchy:{" "}
              <strong>Project → Module → Issues</strong>.
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                <strong>Workstreams</strong> — e.g. "Mobile", "Backend", "Marketing" inside one
                project.
              </li>
              <li>
                <strong>Release slices</strong> — a module per milestone with start/target dates
                (e.g. "Q3 Release").
              </li>
              <li>
                <strong>Feature verticals</strong> — "Auth", "Payments", "Notifications" to track
                each area's status at a glance.
              </li>
              <li>
                <strong>Team ownership</strong> — group issues by squad or owner.
              </li>
            </ul>
            <p className="text-xs">
              Tip: a <strong>Sprint</strong> is a short time-box (2 weeks) of issues you're
              working now; a <strong>Module</strong> is a permanent grouping inside the project.
              Use modules to organize, sprints to schedule.
            </p>
          </CardContent>
        )}
      </Card>

      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate(`/${slug}/projects/${projectId}`)}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <Package className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-xl font-bold">Modules</h1>
          <Badge variant="secondary">{modules.length}</Badge>
        </div>

        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="h-4 w-4 mr-1" /> New Module
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Create Module</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-1 block">Name</label>
                <Input
                  placeholder="Module name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Description</label>
                <Input
                  placeholder="Description"
                  value={desc}
                  onChange={(e) => setDesc(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium mb-1 block">Start Date</label>
                  <DatePicker value={startDate || null} onChange={(v) => setStartDate(v || "")} />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Target Date</label>
                  <DatePicker value={targetDate || null} onChange={(v) => setTargetDate(v || "")} />
                </div>
              </div>
              <Button
                className="w-full"
                disabled={!name.trim() || createModule.isPending}
                onClick={() => {
                  if (startDate && targetDate && startDate > targetDate) {
                    toast.error("Start date must be before target date");
                    return;
                  }
                  createModule.mutate({
                    name,
                    description: desc,
                    status: "planned",
                    ...(startDate && { start_date: startDate }),
                    ...(targetDate && { target_date: targetDate }),
                  });
                }}
              >
                Create Module
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-pulse text-muted-foreground">Loading modules...</div>
        </div>
      ) : modules.length === 0 ? (
        <div className="text-center py-16">
          <Package className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-medium mb-1">No modules yet</h3>
          <p className="text-muted-foreground text-sm mb-4">
            Create a module to group related issues together
          </p>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> Create Module
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {modules.map((m) => {
            const sc = STATUS_COLORS[m.status] || STATUS_COLORS["planned"];
            const isEditing = editingId === m.id;
            return (
              <Card
                key={m.id}
                className="cursor-pointer hover:shadow-md transition-shadow group"
                onClick={() => !isEditing && navigate(`/${slug}/projects/${projectId}/modules/${m.id}`)}
              >
                <CardContent className="p-4 space-y-3">
                  {isEditing ? (
                    <div className="space-y-3" onClick={(e) => e.stopPropagation()}>
                      <Input
                        value={draft?.name ?? ""}
                        onChange={(e) => setDraft((d) => (d ? { ...d, name: e.target.value } : d))}
                        placeholder="Module name"
                      />
                      <Textarea
                        value={draft?.description ?? ""}
                        onChange={(e) =>
                          setDraft((d) => (d ? { ...d, description: e.target.value } : d))
                        }
                        rows={2}
                        placeholder="Description"
                      />
                      <Select
                        value={draft?.status ?? "planned"}
                        onValueChange={(v) => setDraft((d) => (d ? { ...d, status: v } : d))}
                      >
                        <SelectTrigger className="h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.keys(STATUS_COLORS).map((s) => (
                            <SelectItem key={s} value={s}>
                              {s}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <div className="flex flex-wrap items-end gap-3">
                        <div>
                          <label className="text-xs font-medium text-muted-foreground">
                            Start date
                          </label>
                          <DatePicker
                            value={draft?.start_date ?? null}
                            onChange={(v) => setDraft((d) => (d ? { ...d, start_date: v } : d))}
                          />
                        </div>
                        <div>
                          <label className="text-xs font-medium text-muted-foreground">
                            Target date
                          </label>
                          <DatePicker
                            value={draft?.target_date ?? null}
                            onChange={(v) => setDraft((d) => (d ? { ...d, target_date: v } : d))}
                          />
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          onClick={save}
                          disabled={updateModule.isPending || !draft?.name.trim()}
                        >
                          <Check className="h-4 w-4 mr-1" /> Save
                        </Button>
                        <Button size="sm" variant="ghost" onClick={cancelEdit}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <h3 className="font-medium truncate">{m.name}</h3>
                          {m.description && (
                            <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                              {m.description}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-0.5 shrink-0">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-foreground"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  copyId(m.id);
                                }}
                              >
                                <ClipboardCopy className="h-3.5 w-3.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Copy Module ID (for MCP calls)</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-foreground"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  copySummary(m);
                                }}
                              >
                                <Copy className="h-3.5 w-3.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Copy module summary</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-foreground"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  startEdit(m);
                                }}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Edit module</TooltipContent>
                          </Tooltip>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (confirm(`Delete module "${m.name}"?`)) deleteModule.mutate(m.id);
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>

                      <Badge className={`${sc?.bg ?? ""} ${sc?.text ?? ""} text-xs`}>
                        {m.status}
                      </Badge>

                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1 font-mono">
                          <Layers className="h-3 w-3" />
                          {m.id}
                        </span>
                        {m.start_date && <span>From {new Date(m.start_date).toLocaleDateString()}</span>}
                        {m.target_date && <span>Due {new Date(m.target_date).toLocaleDateString()}</span>}
                      </div>

                      <p className="text-xs text-muted-foreground">
                        Updated {formatDistanceToNow(new Date(m.updated_at), { addSuffix: true })}
                      </p>
                    </>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
    </TooltipProvider>
  );
}
