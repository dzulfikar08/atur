import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ArrowLeft, Plus, Package, Trash2 } from "@/lib/icons";
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

  return (
    <div className="max-w-5xl mx-auto">
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
            return (
              <Card
                key={m.id}
                className="cursor-pointer hover:shadow-md transition-shadow group"
                onClick={() => navigate(`/${slug}/projects/${projectId}/modules/${m.id}`)}
              >
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium truncate">{m.name}</h3>
                      {m.description && (
                        <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                          {m.description}
                        </p>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive shrink-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`Delete module "${m.name}"?`)) deleteModule.mutate(m.id);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>

                  <Badge className={`${sc?.bg ?? ""} ${sc?.text ?? ""} text-xs`}>{m.status}</Badge>

                  {(m.start_date || m.target_date) && (
                    <div className="flex gap-3 text-xs text-muted-foreground">
                      {m.start_date && (
                        <span>From {new Date(m.start_date).toLocaleDateString()}</span>
                      )}
                      {m.target_date && (
                        <span>Due {new Date(m.target_date).toLocaleDateString()}</span>
                      )}
                    </div>
                  )}

                  <p className="text-xs text-muted-foreground">
                    Updated {formatDistanceToNow(new Date(m.updated_at), { addSuffix: true })}
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
