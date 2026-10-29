import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, apiFetch, ApiError } from "@/lib/api";
import type { WorkspaceLink, WorkspaceLinkPatch } from "@/lib/api";
import { useAuthStore } from "@/stores/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Link2, Pencil, Shield, Trash2 } from "@/lib/icons";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

interface Member {
  id: string;
  member_id: string;
  role: number;
  is_active: boolean;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true });
  } catch {
    return iso;
  }
}

// "none" sentinel for the Select — Radix forbids empty-string item values.
const AUTO_MERGE_NONE = "none";

function BindingEditDialog({
  link,
  onOpenChange,
}: {
  link: WorkspaceLink;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const [repoText, setRepoText] = useState((link.repo_urls ?? []).join("\n"));
  const [localPath, setLocalPath] = useState(link.local_path ?? "");
  const [defaultBranch, setDefaultBranch] = useState(link.default_branch ?? "");
  const [herdrWorkspace, setHerdrWorkspace] = useState(link.herdr_workspace ?? "");
  const [notes, setNotes] = useState(link.notes ?? "");
  // NULL mode means local-only (see services/workspaceLinks.ts) — saving writes
  // the explicit value so the row round-trips without nulls.
  const [mode, setMode] = useState<string>(link.mode ?? "local-only");
  const [autoMerge, setAutoMerge] = useState<string>(link.auto_merge ?? AUTO_MERGE_NONE);

  const saveMut = useMutation({
    mutationFn: () => {
      const repos = repoText
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      const body: WorkspaceLinkPatch = {
        repo_urls: repos.length > 0 ? repos : null,
        local_path: localPath.trim() || null,
        default_branch: defaultBranch.trim() || null,
        herdr_workspace: herdrWorkspace.trim() || null,
        notes: notes.trim() || null,
        mode: mode === "direct-PR" ? "direct-PR" : "local-only",
        auto_merge: autoMerge === "yolo" ? "yolo" : null,
      };
      return api.updateWorkspaceLink(link.workspace, body);
    },
    onSuccess: () => {
      toast.success(`Binding for ${link.workspace} saved`);
      qc.invalidateQueries({ queryKey: ["workspace-links"] });
      onOpenChange(false);
    },
    // Non-admins reach the dialog only via a stale page — the per-slug PUT is
    // owner-or-admin gated, so surface the 403 instead of pre-blocking.
    onError: (err) =>
      toast.error(`Failed to save binding for ${link.workspace}`, {
        description: err instanceof ApiError ? `${err.status}: ${err.message}` : undefined,
      }),
  });

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit binding — {link.workspace}</DialogTitle>
          <DialogDescription>
            Repos, checkout path, branch, and autonomy for this workspace's agents.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="binding-repos">Repo URLs (one per line)</Label>
            <Textarea
              id="binding-repos"
              value={repoText}
              onChange={(e) => setRepoText(e.target.value)}
              placeholder={"owner/repo-one\nowner/repo-two"}
              className="mt-1 font-mono text-sm"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="binding-local-path">Local path</Label>
              <Input
                id="binding-local-path"
                value={localPath}
                onChange={(e) => setLocalPath(e.target.value)}
                placeholder="/srv/workspace"
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="binding-branch">Default branch</Label>
              <Input
                id="binding-branch"
                value={defaultBranch}
                onChange={(e) => setDefaultBranch(e.target.value)}
                placeholder="main"
                className="mt-1"
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="binding-herdr">
                Terminal workspace (herdr workspace / Atur Terminal project)
              </Label>
              <Input
                id="binding-herdr"
                value={herdrWorkspace}
                onChange={(e) => setHerdrWorkspace(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <Label>Mode</Label>
              <Select value={mode} onValueChange={setMode}>
                <SelectTrigger className="mt-1 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="local-only">local-only</SelectItem>
                  <SelectItem value="direct-PR">direct-PR</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Auto-merge</Label>
              <Select value={autoMerge} onValueChange={setAutoMerge}>
                <SelectTrigger className="mt-1 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={AUTO_MERGE_NONE}>—</SelectItem>
                  <SelectItem value="yolo">yolo</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="binding-notes">Notes</Label>
              <Input
                id="binding-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="mt-1"
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" disabled={saveMut.isPending} onClick={() => saveMut.mutate()}>
            {saveMut.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RepoChips({ urls }: { urls: string[] | null }) {
  if (!urls || urls.length === 0) {
    return <span className="text-sm text-muted-foreground">—</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {urls.map((url) => (
        <Badge key={url} variant="secondary" className="font-mono text-xs break-all">
          {url}
        </Badge>
      ))}
    </div>
  );
}

function RowActions({
  link,
  onEdit,
  onDelete,
}: {
  link: WorkspaceLink;
  onEdit: (link: WorkspaceLink) => void;
  onDelete: (link: WorkspaceLink) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Edit binding for ${link.workspace}`}
        onClick={() => onEdit(link)}
      >
        <Pencil className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Delete binding for ${link.workspace}`}
        onClick={() => onDelete(link)}
      >
        <Trash2 className="h-4 w-4 text-destructive" />
      </Button>
    </div>
  );
}

export default function WorkspaceBindingsPage() {
  const { slug } = useParams<{ slug: string }>();
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<WorkspaceLink | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WorkspaceLink | null>(null);

  const { data, isLoading } = useQuery<{ results: WorkspaceLink[] }>({
    queryKey: ["workspace-links"],
    queryFn: () => api.listWorkspaceLinks(),
  });
  const links = data?.results ?? [];

  // Mirror of the per-slug admin gate (owner or active role >= 20 member — the
  // owner always holds a role-20 membership row). Rows in OTHER workspaces the
  // viewer admins stay editable; everything else 403s server-side and toasts.
  const { data: members = [] } = useQuery<Member[]>({
    queryKey: ["members", slug],
    queryFn: () =>
      apiFetch<{ results: Member[] }>(`/workspaces/${slug}/members/`).then((d) => d.results),
    enabled: !!slug,
  });
  const canEdit =
    !!user && members.some((m) => m.member_id === user.id && m.is_active && m.role >= 20);

  const deleteMut = useMutation({
    mutationFn: (target: WorkspaceLink) => api.deleteWorkspaceLink(target.workspace),
    onSuccess: (_data, target) => {
      toast.success(`Binding for ${target.workspace} deleted`);
      qc.invalidateQueries({ queryKey: ["workspace-links"] });
      setDeleteTarget(null);
    },
    onError: (err, target) =>
      toast.error(`Failed to delete binding for ${target.workspace}`, {
        description: err instanceof ApiError ? `${err.status}: ${err.message}` : undefined,
      }),
  });

  if (!slug) return null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Link
          to={`/${slug}/admin`}
          className="inline-flex items-center text-sm text-muted-foreground hover:underline"
        >
          <ArrowLeft className="mr-1 h-4 w-4" />
          Admin
        </Link>
        <div className="mt-2 flex items-center gap-3">
          <Shield className="h-6 w-6" />
          <h1 className="text-2xl font-bold">Workspace Bindings</h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Control-plane bindings: which repo(s), local checkout, branch, and terminal workspace
          (herdr workspace or Atur Terminal project) back each workspace's agents.
          {!canEdit && " Read-only — ask a workspace admin to make changes."}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Link2 className="h-4 w-4" />
            Bindings
          </CardTitle>
          <CardDescription>
            {links.length} {links.length === 1 ? "binding" : "bindings"} across all workspaces
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4">
                  <div className="h-4 w-28 animate-pulse rounded bg-muted" />
                  <div className="h-4 w-40 animate-pulse rounded bg-muted" />
                  <div className="h-4 w-16 animate-pulse rounded bg-muted" />
                </div>
              ))}
            </div>
          ) : links.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No bindings yet — agents seed them via set_workspace_link.
            </p>
          ) : (
            <>
              {/* Mobile: stacked cards — the table's overflow-auto wrapper
                  scrolls horizontally below md, so small screens get rows. */}
              <div className="md:hidden space-y-3">
                {links.map((link) => (
                  <div key={link.workspace} className="rounded-lg border p-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm font-medium break-all">{link.workspace}</span>
                      <Badge variant="outline">{link.mode ?? "local-only"}</Badge>
                    </div>
                    <RepoChips urls={link.repo_urls} />
                    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <dt>Local path</dt>
                      <dd className="break-all font-mono">{link.local_path ?? "—"}</dd>
                      <dt>Branch</dt>
                      <dd className="break-all">{link.default_branch ?? "—"}</dd>
                      <dt>Terminal</dt>
                      <dd className="break-all">{link.herdr_workspace ?? "—"}</dd>
                      <dt>Auto-merge</dt>
                      <dd>{link.auto_merge ?? "—"}</dd>
                      <dt>Updated</dt>
                      <dd>{formatDate(link.updated_at)}</dd>
                    </dl>
                    {canEdit && (
                      <RowActions link={link} onEdit={setEditing} onDelete={setDeleteTarget} />
                    )}
                  </div>
                ))}
              </div>

              {/* Desktop: full table */}
              <div className="hidden md:block">
                <Table className="[&_th]:px-2 [&_td]:px-2">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Workspace</TableHead>
                      <TableHead>Repos</TableHead>
                      <TableHead>Mode</TableHead>
                      <TableHead>Local path</TableHead>
                      <TableHead>Branch</TableHead>
                      <TableHead>Terminal</TableHead>
                      <TableHead>Auto-merge</TableHead>
                      <TableHead>Updated</TableHead>
                      {canEdit && <TableHead className="w-24" />}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {links.map((link) => (
                      <TableRow key={link.workspace}>
                        <TableCell className="text-sm font-medium break-all">
                          {link.workspace}
                        </TableCell>
                        <TableCell>
                          <RepoChips urls={link.repo_urls} />
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <Badge variant="outline">{link.mode ?? "local-only"}</Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs break-words">
                          {link.local_path ?? "—"}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                          {link.default_branch ?? "—"}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                          {link.herdr_workspace ?? "—"}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {link.auto_merge ? (
                            <Badge variant="secondary">{link.auto_merge}</Badge>
                          ) : (
                            <span className="text-sm text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDate(link.updated_at)}
                        </TableCell>
                        {canEdit && (
                          <TableCell>
                            <RowActions
                              link={link}
                              onEdit={setEditing}
                              onDelete={setDeleteTarget}
                            />
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Edit dialog — keyed per row so form state resets between links */}
      {editing && (
        <BindingEditDialog
          key={editing.workspace}
          link={editing}
          onOpenChange={(o) => !o && setEditing(null)}
        />
      )}

      {/* Delete confirm */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete binding for {deleteTarget?.workspace}?</DialogTitle>
            <DialogDescription>
              Agents will no longer see repos, checkout path, or autonomy settings for this
              workspace.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={deleteMut.isPending}
              onClick={() => deleteTarget && deleteMut.mutate(deleteTarget)}
            >
              {deleteMut.isPending ? "Deleting…" : "Delete"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
