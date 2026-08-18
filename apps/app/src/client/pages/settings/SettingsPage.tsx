import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { apiOrigin, authHeaders } from "@/lib/native";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Settings, Users, Tag, Inbox, Trash2, AlertTriangle, Upload } from "@/lib/icons";
import { useState, useEffect, useRef } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function SettingsPage() {
  const { slug, projectId } = useParams();
  const qc = useQueryClient();
  const [tab, setTab] = useState("general");

  const { data: workspace, isLoading: wsLoading } = useQuery({
    queryKey: ["workspace", slug],
    queryFn: () => apiFetch<any>(`/workspaces/${slug}/`),
    enabled: !!slug,
  });

  const { data: members = [], isLoading: membersLoading } = useQuery({
    queryKey: ["members", slug],
    queryFn: () =>
      apiFetch<{ results: any[] }>(`/workspaces/${slug}/members/`).then((d) => d.results),
    enabled: !!slug,
  });

  const { data: labels = [], isLoading: labelsLoading } = useQuery({
    queryKey: ["labels", slug],
    queryFn: () =>
      apiFetch<{ results: any[] }>(`/workspaces/${slug}/projects/${projectId}/labels/`).then(
        (d) => d.results,
      ),
    enabled: !!slug && !!projectId,
  });

  const [wsName, setWsName] = useState("");
  const [labelName, setLabelName] = useState("");
  const [labelColor, setLabelColor] = useState("#3b82f6");

  const updateWsMutation = useMutation({
    mutationFn: (data: any) =>
      apiFetch(`/workspaces/${slug}/`, { method: "PATCH", body: JSON.stringify(data) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workspace", slug] });
      qc.invalidateQueries({ queryKey: ["workspaces"] });
      toast.success("Workspace updated");
    },
    onError: () => toast.error("Failed to update workspace"),
  });

  const createLabelMutation = useMutation({
    mutationFn: (data: any) =>
      apiFetch(`/workspaces/${slug}/projects/${projectId}/labels/`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["labels", slug] });
      setLabelName("");
      toast.success("Label created");
    },
    onError: () => toast.error("Failed to create label"),
  });

  // ── Invite members ──
  const [inviteEmail, setInviteEmail] = useState("");
  const inviteMutation = useMutation({
    mutationFn: (data: { email: string }) =>
      apiFetch(`/workspaces/${slug}/members/invite`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["members", slug] });
      setInviteEmail("");
      toast.success("Member invited");
    },
    onError: () => toast.error("Failed to invite member"),
  });

  // ── Workspace logo upload ──
  const navigate = useNavigate();
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const uploadLogo = async (file: File) => {
    setUploadingLogo(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`${apiOrigin || ""}/api/assets/upload/`, {
        method: "POST",
        body: fd,
        credentials: "include",
        headers: { ...authHeaders() },
      });
      if (!res.ok) throw new Error("upload failed");
      const uploaded = await res.json();
      await apiFetch(`/workspaces/${slug}/`, {
        method: "PATCH",
        body: JSON.stringify({ logo: uploaded.url }),
      });
      qc.invalidateQueries({ queryKey: ["workspace", slug] });
      qc.invalidateQueries({ queryKey: ["workspaces"] });
      toast.success("Icon updated");
    } catch {
      toast.error("Failed to upload icon");
    } finally {
      setUploadingLogo(false);
    }
  };

  // ── Delete workspace (danger zone) ──
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmSlug, setConfirmSlug] = useState("");
  const deleteWsMutation = useMutation({
    mutationFn: () => apiFetch(`/workspaces/${slug}/`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workspaces"] });
      qc.invalidateQueries({ queryKey: ["workspace", slug] });
      toast.success("Workspace deleted");
      navigate("/");
    },
    onError: () => toast.error("Failed to delete workspace"),
  });

  // ── Support portal config ──
  const [portalEnabled, setPortalEnabled] = useState(false);
  const [portalProjectId, setPortalProjectId] = useState<string>("");

  const { data: portalSettings } = useQuery({
    queryKey: ["portal-settings", slug],
    queryFn: () => apiFetch<any>(`/workspaces/${slug}/portal-settings/`),
    enabled: !!slug,
  });

  const { data: projects = [] } = useQuery({
    queryKey: ["portal-projects", slug],
    queryFn: () =>
      apiFetch<{ results: any[] }>(`/workspaces/${slug}/projects/`).then((d) => d.results),
    enabled: !!slug,
  });

  useEffect(() => {
    if (portalSettings) {
      setPortalEnabled(!!portalSettings.is_enabled);
      setPortalProjectId(portalSettings.support_project_id || "");
    }
  }, [portalSettings]);

  const savePortalMutation = useMutation({
    mutationFn: (data: any) =>
      apiFetch(`/workspaces/${slug}/portal-settings/`, {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portal-settings", slug] });
      toast.success("Portal settings saved");
    },
    onError: () => toast.error("Failed to save portal settings"),
  });

  if (wsLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-pulse text-muted-foreground">Loading settings...</div>
      </div>
    );
  }

  const ROLE_LABELS: Record<number, string> = {
    5: "Guest",
    10: "Viewer",
    15: "Member",
    20: "Admin",
  };

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Settings className="h-6 w-6" />
        <h1 className="text-2xl font-bold">Workspace Settings</h1>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="members">Members</TabsTrigger>
          <TabsTrigger value="labels">Labels</TabsTrigger>
          <TabsTrigger value="support">Support</TabsTrigger>
          <TabsTrigger value="danger" className="text-destructive">
            Danger
          </TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>General</CardTitle>
              <CardDescription>Update workspace name and details</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-4">
                <div className="h-16 w-16 rounded-lg border flex items-center justify-center overflow-hidden bg-muted">
                  {workspace?.logo ? (
                    <img src={workspace.logo} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-xl font-semibold text-muted-foreground">
                      {(workspace?.name || "W").charAt(0).toUpperCase()}
                    </span>
                  )}
                </div>
                <div>
                  <input
                    ref={logoInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) uploadLogo(f);
                      e.target.value = "";
                    }}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => logoInputRef.current?.click()}
                    disabled={uploadingLogo}
                  >
                    <Upload className="h-4 w-4 mr-1" />{" "}
                    {uploadingLogo ? "Uploading…" : "Upload icon"}
                  </Button>
                  <p className="text-xs text-muted-foreground mt-1">
                    PNG or JPG. Shown in the workspace switcher.
                  </p>
                </div>
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Workspace Name</label>
                <Input
                  value={wsName || workspace?.name || ""}
                  onChange={(e) => setWsName(e.target.value)}
                  placeholder="Workspace name"
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Slug</label>
                <Input value={workspace?.slug || ""} disabled />
              </div>
              <Button
                onClick={() => updateWsMutation.mutate({ name: wsName })}
                disabled={!wsName.trim() || updateWsMutation.isPending}
              >
                Save Changes
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="members" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-4 w-4" /> Members
              </CardTitle>
              <CardDescription>{members.length} members in this workspace</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2 mb-4">
                <Input
                  placeholder="Invite by email"
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  className="flex-1"
                />
                <Button
                  onClick={() => inviteMutation.mutate({ email: inviteEmail })}
                  disabled={!inviteEmail.trim() || inviteMutation.isPending}
                >
                  Invite
                </Button>
              </div>
              {membersLoading ? (
                <div className="animate-pulse text-sm text-muted-foreground">Loading...</div>
              ) : (
                <div className="space-y-3">
                  {members.map((m: any) => (
                    <div key={m.id} className="flex items-center justify-between py-2">
                      <div className="flex items-center gap-3">
                        <Avatar className="h-8 w-8">
                          {m.member?.avatar ? (
                            <AvatarImage
                              src={m.member.avatar}
                              alt={m.member?.display_name || m.member?.username || "User"}
                            />
                          ) : null}
                          <AvatarFallback className="text-xs">
                            {(m.member?.display_name || m.member?.username || "U").charAt(0)}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="text-sm font-medium">
                            {m.member?.display_name || m.member?.username}
                          </p>
                          <p className="text-xs text-muted-foreground">{m.member?.email}</p>
                        </div>
                      </div>
                      <Badge variant="secondary">{ROLE_LABELS[m.role] || `Role ${m.role}`}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="labels" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Tag className="h-4 w-4" /> Labels
              </CardTitle>
              <CardDescription>Manage workspace labels</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <Input
                  placeholder="Label name"
                  value={labelName}
                  onChange={(e) => setLabelName(e.target.value)}
                  className="flex-1"
                />
                <input
                  type="color"
                  value={labelColor}
                  onChange={(e) => setLabelColor(e.target.value)}
                  className="h-9 w-12 rounded border cursor-pointer"
                />
                <Button
                  onClick={() => createLabelMutation.mutate({ name: labelName, color: labelColor })}
                  disabled={!labelName.trim() || createLabelMutation.isPending}
                >
                  Add
                </Button>
              </div>

              {labelsLoading ? (
                <div className="animate-pulse text-sm text-muted-foreground">Loading...</div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {labels.map((l: any) => (
                    <Badge
                      key={l.id}
                      style={{
                        backgroundColor: l.color + "20",
                        color: l.color,
                        borderColor: l.color,
                      }}
                    >
                      {l.name}
                    </Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="support" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Inbox className="h-4 w-4" /> Support Portal
              </CardTitle>
              <CardDescription>
                Let customers sign in with an email code and submit tickets at{" "}
                <code>/portal/{slug}</code>. Tickets become issues in the selected project.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Enable customer portal</p>
                  <p className="text-xs text-muted-foreground">
                    Allow customers to sign in and submit tickets.
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={portalEnabled}
                  onChange={(e) => setPortalEnabled(e.target.checked)}
                  className="h-4 w-4"
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Support project</label>
                <Select
                  value={portalProjectId || "none"}
                  onValueChange={(v) => setPortalProjectId(v === "none" ? "" : v)}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Select a project…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No project</SelectItem>
                    {projects.map((p: any) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                onClick={() =>
                  savePortalMutation.mutate({
                    support_project_id: portalProjectId || null,
                    is_enabled: portalEnabled,
                  })
                }
                disabled={savePortalMutation.isPending}
              >
                Save Portal Settings
              </Button>
              <Button variant="outline" onClick={() => window.open(`/portal/${slug}`, "_blank")}>
                Open Portal
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="danger" className="mt-4 space-y-4">
          <Card className="border-destructive/40">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-destructive">
                <AlertTriangle className="h-4 w-4" /> Danger Zone
              </CardTitle>
              <CardDescription>Irreversible actions. Proceed with caution.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between rounded-md border border-destructive/40 p-4">
                <div>
                  <p className="text-sm font-medium">Delete this workspace</p>
                  <p className="text-xs text-muted-foreground">
                    All projects, issues, and members will be removed.
                  </p>
                </div>
                <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
                  <Trash2 className="h-4 w-4 mr-1" /> Delete
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
      <Dialog
        open={deleteOpen}
        onOpenChange={(o) => {
          setDeleteOpen(o);
          if (!o) setConfirmSlug("");
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete workspace</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This permanently deletes <strong>{workspace?.name}</strong> and all its data. Type the
            workspace slug <code>{slug}</code> to confirm.
          </p>
          <Input
            value={confirmSlug}
            onChange={(e) => setConfirmSlug(e.target.value)}
            placeholder={slug}
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={confirmSlug !== slug || deleteWsMutation.isPending}
              onClick={() => deleteWsMutation.mutate()}
            >
              {deleteWsMutation.isPending ? "Deleting…" : "Delete workspace"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
