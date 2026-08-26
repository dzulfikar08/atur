import { useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, api, type ProjectFolder } from "@/lib/api";
import ProjectCard from "@/components/projects/ProjectCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Plus,
  Search,
  Pencil,
  ChevronDown,
  ChevronRight,
  FolderKanban,
  MoreHorizontal,
} from "@/lib/icons";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { useEffect, useMemo, useState } from "react";

const createProjectSchema = z.object({
  name: z.string().min(1, "Name is required"),
  identifier: z.string().min(1, "Identifier is required").max(12, "Max 12 chars"),
  description: z.string().optional(),
});

type CreateProjectForm = z.infer<typeof createProjectSchema>;

const editProjectSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
});

type EditProjectForm = z.infer<typeof editProjectSchema>;

const FOLDER_COLORS = ["#3B82F6", "#22C55E", "#F59E0B", "#EF4444", "#8B5CF6", "#6b7280"];

export default function ProjectsPage() {
  const { slug } = useParams();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [editFolderId, setEditFolderId] = useState<string>("__none__");
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  const [folderDialog, setFolderDialog] = useState<
    { mode: "create" } | { mode: "edit"; folder: ProjectFolder } | null
  >(null);
  const [folderName, setFolderName] = useState("");
  const [folderColor, setFolderColor] = useState(FOLDER_COLORS[0]);

  const isAll = slug === "all";

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ["projects", slug],
    queryFn: () =>
      isAll
        ? api.listAllProjects()
        : apiFetch<{ results: any[] }>(`/workspaces/${slug}/projects/`).then((d) => d.results),
    enabled: !!slug,
  });

  // Folders are workspace-scoped — the /all aggregator stays flat.
  const { data: folders = [] } = useQuery({
    queryKey: ["folders", slug],
    queryFn: () => api.listFolders(slug!),
    enabled: !!slug && !isAll,
  });

  const form = useForm<CreateProjectForm>({
    resolver: zodResolver(createProjectSchema),
    defaultValues: { name: "", identifier: "", description: "" },
  });

  const createMutation = useMutation({
    mutationFn: (data: CreateProjectForm) =>
      apiFetch(`/workspaces/${slug}/projects/`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects", slug] });
      setCreateOpen(false);
      form.reset();
      toast.success("Project created");
    },
    onError: () => toast.error("Failed to create project"),
  });

  const editForm = useForm<EditProjectForm>({
    resolver: zodResolver(editProjectSchema),
    defaultValues: { name: "", description: "" },
  });

  useEffect(() => {
    if (editing) {
      editForm.reset({ name: editing.name ?? "", description: editing.description ?? "" });
      setEditFolderId(editing.folder_id ?? "__none__");
    }
  }, [editing, editForm]);

  const editMutation = useMutation({
    mutationFn: (data: EditProjectForm) =>
      apiFetch(`/workspaces/${slug}/projects/${editing.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          ...data,
          folderId: editFolderId === "__none__" ? null : editFolderId,
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects", slug] });
      setEditing(null);
      toast.success("Project updated");
    },
    onError: () => toast.error("Failed to update project"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/workspaces/${slug}/projects/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects", slug] });
      toast.success("Project deleted");
    },
  });

  const invalidateFolders = () => {
    qc.invalidateQueries({ queryKey: ["folders", slug] });
    qc.invalidateQueries({ queryKey: ["projects", slug] });
  };

  const createFolderMutation = useMutation({
    mutationFn: () => api.createFolder(slug!, { name: folderName.trim(), color: folderColor }),
    onSuccess: () => {
      invalidateFolders();
      setFolderDialog(null);
      toast.success("Folder created");
    },
    onError: () => toast.error("Failed to create folder"),
  });

  const updateFolderMutation = useMutation({
    mutationFn: (f: ProjectFolder) =>
      api.updateFolder(slug!, f.id, { name: folderName.trim(), color: folderColor }),
    onSuccess: () => {
      invalidateFolders();
      setFolderDialog(null);
      toast.success("Folder updated");
    },
    onError: () => toast.error("Failed to update folder"),
  });

  const deleteFolderMutation = useMutation({
    mutationFn: (id: string) => api.deleteFolder(slug!, id),
    onSuccess: () => {
      invalidateFolders();
      toast.success("Folder deleted — its projects moved to No folder");
    },
    onError: () => toast.error("Failed to delete folder"),
  });

  const openFolderDialog = (mode: { mode: "create" } | { mode: "edit"; folder: ProjectFolder }) => {
    setFolderName(mode.mode === "edit" ? mode.folder.name : "");
    setFolderColor(mode.mode === "edit" ? mode.folder.color || FOLDER_COLORS[0] : FOLDER_COLORS[0]);
    setFolderDialog(mode);
  };

  const filtered = projects.filter(
    (p: any) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.identifier?.toLowerCase().includes(search.toLowerCase()),
  );

  // Sections: folders by sort_order, projects under folder_id, then "No folder".
  // In /all mode (or with zero folders) everything renders flat as before.
  const sections = useMemo(() => {
    if (isAll || folders.length === 0)
      return [
        {
          key: "__flat__",
          label: null as string | null,
          folder: null as ProjectFolder | null,
          projects: filtered,
        },
      ];
    const folderMap = new Map(folders.map((f) => [f.id, f]));
    const groups = new Map<string, ProjectFolder | null>();
    const byFolder = new Map<string, any[]>();
    const none: any[] = [];
    for (const f of [...folders].sort((a, b) => a.sort_order - b.sort_order)) {
      groups.set(f.id, f);
      byFolder.set(f.id, []);
    }
    for (const p of filtered) {
      const fid = p.folder_id;
      // A folder_id pointing at a deleted folder renders under No folder.
      if (fid && folderMap.has(fid)) byFolder.get(fid)!.push(p);
      else none.push(p);
    }
    const out = [...groups.entries()].map(([id, folder]) => ({
      key: id,
      label: folder!.name,
      folder,
      projects: byFolder.get(id)!,
    }));
    if (none.length)
      out.push({ key: "__none__", label: "No folder", folder: null, projects: none });
    return out;
  }, [filtered, folders, isAll]);

  const toggleFolder = (id: string) =>
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const projectGrid = (list: any[]) => (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {list.map((project: any) => (
        <ProjectCard
          key={project.id}
          project={project}
          slug={isAll ? project.workspace_slug : slug!}
          {...(!isAll && {
            onDelete: (id: string) => deleteMutation.mutate(id),
            onEdit: (p: any) => setEditing(p),
          })}
        />
      ))}
    </div>
  );

  return (
    <div className="p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold">Projects</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {projects.length} project{projects.length === 1 ? "" : "s"}
            {!isAll &&
              folders.length > 0 &&
              ` · ${folders.length} folder${folders.length === 1 ? "" : "s"}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!isAll && (
            <Button variant="outline" onClick={() => openFolderDialog({ mode: "create" })}>
              <FolderKanban className="h-4 w-4 mr-2" /> New Folder
            </Button>
          )}
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            {!isAll && (
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-2" /> New Project
                </Button>
              </DialogTrigger>
            )}
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create Project</DialogTitle>
              </DialogHeader>
              <Form {...form}>
                <form
                  onSubmit={form.handleSubmit((d) => createMutation.mutate(d))}
                  className="space-y-4"
                >
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Name</FormLabel>
                        <FormControl>
                          <Input placeholder="Project name" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="identifier"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Identifier</FormLabel>
                        <FormControl>
                          <Input placeholder="PROJ" maxLength={12} {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="description"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Description</FormLabel>
                        <FormControl>
                          <Textarea placeholder="Optional description" rows={3} {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button type="submit" className="w-full" disabled={createMutation.isPending}>
                    {createMutation.isPending ? "Creating..." : "Create Project"}
                  </Button>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
          <Dialog
            open={!!editing}
            onOpenChange={(o) => {
              if (!o) setEditing(null);
            }}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Edit Project</DialogTitle>
              </DialogHeader>
              <Form {...editForm}>
                <form
                  onSubmit={editForm.handleSubmit((d) => editMutation.mutate(d))}
                  className="space-y-4"
                >
                  <FormField
                    control={editForm.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Name</FormLabel>
                        <FormControl>
                          <Input placeholder="Project name" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={editForm.control}
                    name="description"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Description</FormLabel>
                        <FormControl>
                          <Textarea placeholder="Optional description" rows={3} {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  {folders.length > 0 && (
                    <div>
                      <label className="text-sm font-medium mb-1 block">Folder</label>
                      <Select value={editFolderId} onValueChange={setEditFolderId}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">No folder</SelectItem>
                          {folders.map((f) => (
                            <SelectItem key={f.id} value={f.id}>
                              {f.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  <Button type="submit" className="w-full" disabled={editMutation.isPending}>
                    <Pencil className="h-4 w-4 mr-2" />
                    {editMutation.isPending ? "Saving..." : "Save Changes"}
                  </Button>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
          {/* Folder create/rename dialog */}
          <Dialog
            open={!!folderDialog}
            onOpenChange={(o) => {
              if (!o) setFolderDialog(null);
            }}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle>
                  {folderDialog?.mode === "edit" ? "Rename Folder" : "New Folder"}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium mb-1 block">Name</label>
                  <Input
                    autoFocus
                    placeholder="Folder name"
                    value={folderName}
                    onChange={(e) => setFolderName(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Color</label>
                  <div className="flex gap-2">
                    {FOLDER_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        aria-label={`Color ${c}`}
                        className={`h-6 w-6 rounded-full border-2 ${folderColor === c ? "border-foreground" : "border-transparent"}`}
                        style={{ backgroundColor: c }}
                        onClick={() => setFolderColor(c)}
                      />
                    ))}
                  </div>
                </div>
                <Button
                  className="w-full"
                  disabled={!folderName.trim()}
                  onClick={() => {
                    if (folderDialog?.mode === "edit")
                      updateFolderMutation.mutate(folderDialog.folder);
                    else createFolderMutation.mutate();
                  }}
                >
                  {folderDialog?.mode === "edit" ? "Save" : "Create Folder"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search projects..."
          className="pl-9"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-32 rounded-lg border bg-muted animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <p className="text-muted-foreground mb-2">No projects found</p>
          {!isAll && (
            <Button variant="outline" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-2" /> Create your first project
            </Button>
          )}
        </div>
      ) : sections.length === 1 && sections[0]!.key === "__flat__" ? (
        projectGrid(filtered)
      ) : (
        <div className="space-y-6">
          {sections.map((s) => {
            const collapsed = collapsedFolders.has(s.key);
            const isRealFolder = s.key !== "__none__";
            return (
              <section key={s.key}>
                <div className="flex items-center gap-2 mb-3">
                  <button
                    type="button"
                    aria-label={`Toggle folder ${s.label}`}
                    className="flex items-center gap-2 text-sm font-medium"
                    onClick={() => toggleFolder(s.key)}
                  >
                    {collapsed ? (
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    )}
                    <FolderKanban className="h-4 w-4 text-muted-foreground" />
                    {s.label}
                    <Badge variant="secondary" className="text-[10px]">
                      {s.projects.length}
                    </Badge>
                  </button>
                  {isRealFolder && s.folder && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-6 w-6">
                          <MoreHorizontal className="h-3.5 w-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        <DropdownMenuItem
                          onClick={() => openFolderDialog({ mode: "edit", folder: s.folder! })}
                        >
                          Rename
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={() => deleteFolderMutation.mutate(s.folder!.id)}
                        >
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
                {!collapsed &&
                  (s.projects.length > 0 ? (
                    projectGrid(s.projects)
                  ) : (
                    <p className="text-xs text-muted-foreground italic pl-6">Empty folder</p>
                  ))}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
