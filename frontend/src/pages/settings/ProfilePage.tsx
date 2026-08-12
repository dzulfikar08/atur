import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { User, Key, Plus, Trash2, Copy } from '@/lib/icons';
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useThemeStore } from "@/stores/theme";
import { useWorkspaceStore } from "@/stores/workspace";
import { useWorkspaces } from "@/hooks/useWorkspaces";
import { useNavigate, useParams } from "react-router-dom";
import { Building2, Check } from '@/lib/icons';
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "@/stores/auth";

const createKeySchema = z.object({
  name: z.string().min(1, "Name is required"),
  workspace_id: z.string().optional(),
});

type CreateKeyForm = z.infer<typeof createKeySchema>;

export default function ProfilePage() {
  const qc = useQueryClient();
  const { theme, setTheme } = useThemeStore();
  const { i18n } = useTranslation();
  const { data: workspaces = [] } = useWorkspaces();
  const { currentSlug, setCurrentSlug } = useWorkspaceStore();
  const navigate = useNavigate();
  const params = useParams<{ slug: string }>();
  const activeSlug = params.slug || currentSlug;
  const [createKeyOpen, setCreateKeyOpen] = useState(false);
  const [newKeyValue, setNewKeyValue] = useState<string | null>(null);

  const { data: user, isLoading } = useQuery({
    queryKey: ["me"],
    queryFn: () => apiFetch<any>("/users/me/"),
  });

  const { data: apiKeys = [], isLoading: keysLoading } = useQuery({
    queryKey: ["apiKeys"],
    queryFn: () => apiFetch<any[]>("/users/me/api-keys/"),
  });

  const [dispName, setDispName] = useState("");
  const [username, setUsername] = useState("");

  useEffect(() => {
    if (user) {
      setDispName(user.display_name || "");
      setUsername(user.username || "");
    }
  }, [user]);

  const updateProfileMutation = useMutation({
    mutationFn: (data: { display_name?: string; username?: string }) =>
      apiFetch("/users/me/", { method: "PATCH", body: JSON.stringify(data) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["me"] });
      useAuthStore.getState().fetchUser();
      toast.success("Profile updated");
    },
    onError: () => toast.error("Failed to update profile"),
  });

  const nameChanged = dispName !== (user?.display_name || "");
  const usernameChanged = username !== (user?.username || "");


  const form = useForm<CreateKeyForm>({
    resolver: zodResolver(createKeySchema),
    defaultValues: { name: "", workspace_id: "" },
  });

  const createKeyMutation = useMutation({
    mutationFn: (data: CreateKeyForm) =>
      apiFetch("/users/me/api-keys", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ["apiKeys"] });
      setNewKeyValue(res.key || null);
      form.reset();
      toast.success("API key created");
    },
    onError: () => toast.error("Failed to create API key"),
  });

  const deleteKeyMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/users/me/api-keys/${id}/`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["apiKeys"] });
      toast.success("API key revoked");
    },
  });

  if (isLoading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-pulse text-muted-foreground">Loading profile...</div></div>;
  }

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <User className="h-6 w-6" />
        <h1 className="text-2xl font-bold">Profile & Settings</h1>
      </div>

      <div className="space-y-6">
        {/* Profile info */}
        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
            <CardDescription>Your account information</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4">
              <Avatar className="h-16 w-16">
                <AvatarFallback className="text-xl">
                  {(user?.display_name || user?.username || "U").charAt(0)}
                </AvatarFallback>
              </Avatar>
              <div>
                <p className="text-lg font-semibold">{user?.display_name || user?.username}</p>
                <p className="text-sm text-muted-foreground">{user?.email}</p>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Display name</label>
              <Input value={dispName} onChange={(e) => setDispName(e.target.value)} placeholder="Your name" />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Username</label>
              <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="username" />
              <p className="text-xs text-muted-foreground mt-1">Used to sign in. Must be unique.</p>
            </div>
            <Button
              onClick={() => {
                const payload: Record<string, string> = {};
                if (nameChanged) payload.display_name = dispName;
                if (usernameChanged) payload.username = username;
                updateProfileMutation.mutate(payload);
              }}
              disabled={updateProfileMutation.isPending || (!nameChanged && !usernameChanged) || !username.trim()}
            >
              {updateProfileMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </CardContent>
        </Card>

        {/* Workspace Switcher */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-4 w-4" /> Workspaces
            </CardTitle>
            <CardDescription>Switch between your workspaces</CardDescription>
          </CardHeader>
          <CardContent>
            {workspaces.length === 0 ? (
              <p className="text-sm text-muted-foreground">No workspaces available</p>
            ) : (
              <div className="space-y-1">
                {workspaces.map((ws) => {
                  const isActive = ws.slug === activeSlug;
                  return (
                    <button
                      key={ws.id}
                      className={cn(
                        'w-full flex items-center gap-3 p-3 rounded-lg text-left transition-colors',
                        isActive ? 'bg-primary/10' : 'hover:bg-muted/50'
                      )}
                      onClick={() => {
                        setCurrentSlug(ws.slug);
                        navigate(`/${ws.slug}`);
                      }}
                    >
                      <div className={cn(
                        'h-8 w-8 rounded-lg overflow-hidden flex items-center justify-center text-xs font-semibold shrink-0',
                        isActive ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                      )}>
                        {ws.logo ? (
                          <img src={ws.logo} alt="" className="h-full w-full object-cover" />
                        ) : (
                          (ws.name[0] ?? '').toUpperCase()
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{ws.name}</p>
                        <p className="text-xs text-muted-foreground">{ws.slug}</p>
                      </div>
                      {isActive && <Check className="h-4 w-4 text-primary shrink-0" />}
                    </button>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Theme */}
        <Card>
          <CardHeader>
            <CardTitle>Appearance</CardTitle>
            <CardDescription>Customize how Atur looks</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3">
              <label className="text-sm font-medium">Theme</label>
              <Select value={theme} onValueChange={(v: any) => setTheme(v)}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="light">Light</SelectItem>
                  <SelectItem value="dark">Dark</SelectItem>
                  <SelectItem value="system">System</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-3 mt-4">
              <label className="text-sm font-medium">Language</label>
              <Select value={i18n.language?.startsWith('id') ? 'id' : 'en'} onValueChange={(lng) => i18n.changeLanguage(lng)}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="id">Bahasa Indonesia</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* API Keys */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Key className="h-4 w-4" /> API Keys
                </CardTitle>
                <CardDescription>Manage API keys for programmatic access</CardDescription>
              </div>
              <Dialog open={createKeyOpen} onOpenChange={(open) => { setCreateKeyOpen(open); if (!open) setNewKeyValue(null); }}>
                <DialogTrigger asChild>
                  <Button size="sm">
                    <Plus className="h-4 w-4 mr-1" /> New Key
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Create API Key</DialogTitle>
                  </DialogHeader>

                  {newKeyValue ? (
                    <div className="space-y-3">
                      <p className="text-sm text-muted-foreground">
                        Copy your API key now. You won't be able to see it again.
                      </p>
                      <div className="flex gap-2">
                        <Input value={newKeyValue} readOnly className="font-mono text-xs" />
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => {
                            navigator.clipboard.writeText(newKeyValue);
                            toast.success("Copied to clipboard");
                          }}
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                      </div>
                      <Button variant="outline" className="w-full" onClick={() => setCreateKeyOpen(false)}>
                        Done
                      </Button>
                    </div>
                  ) : (
                    <form onSubmit={form.handleSubmit((d) => createKeyMutation.mutate(d))} className="space-y-4">
                      <div>
                        <label className="text-sm font-medium mb-1 block">Name</label>
                        <Input placeholder="e.g. My CI/CD key" {...form.register("name")} />
                        {form.formState.errors.name && (
                          <p className="text-xs text-destructive mt-1">{form.formState.errors.name.message}</p>
                        )}
                      </div>
                      <div>
                        <label className="text-sm font-medium mb-1 block">Workspace (optional)</label>
                        <Select onValueChange={(v) => form.setValue("workspace_id", v)}>
                          <SelectTrigger>
                            <SelectValue placeholder="All workspaces" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All workspaces</SelectItem>
                            {workspaces.map((ws: any) => (
                              <SelectItem key={ws.id} value={ws.id}>{ws.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <Button type="submit" className="w-full" disabled={createKeyMutation.isPending}>
                        {createKeyMutation.isPending ? "Creating..." : "Create Key"}
                      </Button>
                    </form>
                  )}
                </DialogContent>
              </Dialog>
            </div>
          </CardHeader>
          <CardContent>
            {keysLoading ? (
              <div className="animate-pulse text-sm text-muted-foreground">Loading keys...</div>
            ) : apiKeys.length === 0 ? (
              <p className="text-sm text-muted-foreground">No API keys yet</p>
            ) : (
              <div className="space-y-3">
                {apiKeys.map((key: any) => (
                  <div key={key.id} className="flex items-center justify-between py-2 border-b last:border-0">
                    <div>
                      <p className="text-sm font-medium">{key.name}</p>
                      <p className="text-xs text-muted-foreground font-mono">{key.key_prefix}••••••</p>
                      {key.last_used_at && (
                        <p className="text-xs text-muted-foreground">
                          Last used: {new Date(key.last_used_at).toLocaleDateString()}
                        </p>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive"
                      onClick={() => deleteKeyMutation.mutate(key.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
