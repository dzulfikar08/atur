import { useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Settings, Users, Tag } from '@/lib/icons';
import { useState } from "react";

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
    queryFn: () => apiFetch<any[]>(`/workspaces/${slug}/members/`),
    enabled: !!slug,
  });

  const { data: labels = [], isLoading: labelsLoading } = useQuery({
    queryKey: ["labels", slug],
    queryFn: () => apiFetch<any[]>(`/workspaces/${slug}/projects/${projectId}/labels/`),
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
      toast.success("Workspace updated");
    },
    onError: () => toast.error("Failed to update workspace"),
  });

  const createLabelMutation = useMutation({
    mutationFn: (data: any) =>
      apiFetch(`/workspaces/${slug}/projects/${projectId}/labels/`, { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["labels", slug] });
      setLabelName("");
      toast.success("Label created");
    },
    onError: () => toast.error("Failed to create label"),
  });

  if (wsLoading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-pulse text-muted-foreground">Loading settings...</div></div>;
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
        </TabsList>

        <TabsContent value="general" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>General</CardTitle>
              <CardDescription>Update workspace name and details</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
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
              {membersLoading ? (
                <div className="animate-pulse text-sm text-muted-foreground">Loading...</div>
              ) : (
                <div className="space-y-3">
                  {members.map((m: any) => (
                    <div key={m.id} className="flex items-center justify-between py-2">
                      <div className="flex items-center gap-3">
                        <Avatar className="h-8 w-8">
                          <AvatarFallback className="text-xs">
                            {(m.member?.display_name || m.member?.username || "U").charAt(0)}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="text-sm font-medium">{m.member?.display_name || m.member?.username}</p>
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
                    <Badge key={l.id} style={{ backgroundColor: l.color + "20", color: l.color, borderColor: l.color }}>
                      {l.name}
                    </Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
