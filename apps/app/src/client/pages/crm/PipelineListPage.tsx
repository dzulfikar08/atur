import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { apiFetch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Plus, MoreHorizontal, Pencil, Trash2 } from "@/lib/icons";
import { toast } from "sonner";

export default function PipelineListPage() {
  const { slug } = useParams();
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const isAll = slug === "all";

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ["projects", slug],
    queryFn: () => (isAll ? api.listAllProjects() : api.listProjects(slug!)),
    enabled: !!slug,
  });

  const createMut = useMutation({
    mutationFn: (body: { name: string; description?: string }) =>
      apiFetch(`/workspaces/${slug}/projects/`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects", slug] });
      setCreateOpen(false);
      resetForm();
      toast.success("Pipeline created");
    },
    onError: () => toast.error("Failed to create pipeline"),
  });

  const updateMut = useMutation({
    mutationFn: (body: { name: string; description?: string }) =>
      api.updateProject(editing.workspace_slug || slug!, editing.id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects", slug] });
      setEditing(null);
      resetForm();
      toast.success("Pipeline updated");
    },
    onError: () => toast.error("Failed to update pipeline"),
  });

  const deleteMut = useMutation({
    mutationFn: ({ id, wsSlug }: { id: string; wsSlug: string }) => api.deleteProject(wsSlug, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects", slug] });
      setDeleteTarget(null);
      toast.success("Pipeline deleted");
    },
    onError: () => toast.error("Failed to delete pipeline"),
  });

  useEffect(() => {
    if (editing) {
      setName(editing.name ?? "");
      setDescription(editing.description ?? "");
    }
  }, [editing]);

  const resetForm = () => {
    setName("");
    setDescription("");
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Pipelines</h1>
          <p className="text-sm text-muted-foreground">
            Any project doubles as a sales pipeline. Open one to view its deal board.
          </p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          {!isAll && (
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="h-4 w-4 mr-1" /> New Pipeline
              </Button>
            </DialogTrigger>
          )}
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New pipeline</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium">Name</label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Q4 Sales Pipeline"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Description</label>
                <Input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Optional"
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setCreateOpen(false)}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  disabled={!name || createMut.isPending}
                  onClick={() => createMut.mutate({ name, description })}
                >
                  {createMut.isPending ? "Creating…" : "Create pipeline"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit pipeline</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium">Name</label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Pipeline name"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Description</label>
                <Input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Optional"
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  disabled={!name || updateMut.isPending}
                  onClick={() => updateMut.mutate({ name, description })}
                >
                  {updateMut.isPending ? "Saving…" : "Save changes"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete pipeline?</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              This action cannot be undone. Remove{" "}
              <span className="font-medium">{deleteTarget?.name || deleteTarget?.identifier}</span>?
            </p>
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="outline" size="sm" onClick={() => setDeleteTarget(null)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={deleteMut.isPending}
                onClick={() => {
                  if (deleteTarget)
                    deleteMut.mutate({
                      id: deleteTarget.id,
                      wsSlug: deleteTarget.workspace_slug || slug!,
                    });
                }}
              >
                {deleteMut.isPending ? "Deleting…" : "Delete"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {isLoading ? (
          [1, 2, 3].map((i) => (
            <div key={i} className="h-32 rounded-lg border bg-muted animate-pulse" />
          ))
        ) : projects.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No projects yet — create a pipeline first.
          </p>
        ) : (
          projects.map((p: any) => (
            <Card key={p.id} className="hover:shadow-md transition-shadow group">
              <CardContent className="p-4 flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <Link
                    to={`/${p.workspace_slug || slug}/crm/pipelines/${p.id}`}
                    className="font-medium hover:underline line-clamp-1"
                  >
                    {p.name}
                  </Link>
                  {p.identifier && (
                    <p className="text-xs text-muted-foreground mt-1">{p.identifier}</p>
                  )}
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditing(p);
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5 mr-2" /> Edit
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteTarget(p);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
