import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { GitBranch, RefreshCw, Trash2, ExternalLink, Puzzle } from "@/lib/icons";

// --- Types ---

interface GitHubIntegration {
  id: string;
  workspace_id: string;
  github_repo_owner: string;
  github_repo_name: string;
  access_token: string;
  webhook_secret: string;
  sync_enabled: boolean;
  project_id: string | null;
  last_synced_at: string | null;
}

interface Project {
  id: string;
  name: string;
  slug: string;
}

// --- Page ---

export default function GitHubIntegrationPage() {
  const { slug } = useParams<{ slug: string }>();
  const qc = useQueryClient();

  // Form state
  const [repoOwner, setRepoOwner] = useState("");
  const [repoName, setRepoName] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [projectId, setProjectId] = useState<string>("");

  // Fetch integrations
  const { data: integrations = [], isLoading: integrationsLoading } = useQuery({
    queryKey: ["github-integrations", slug],
    queryFn: () => apiFetch<GitHubIntegration[]>(`/workspaces/${slug}/integrations/github`),
    enabled: !!slug,
  });

  // Fetch projects for dropdown
  const { data: projects = [] } = useQuery({
    queryKey: ["projects", slug],
    queryFn: () =>
      apiFetch<{ results: Project[] }>(`/workspaces/${slug}/projects/`).then((d) => d.results),
    enabled: !!slug,
  });

  // Connect mutation
  const connectMutation = useMutation({
    mutationFn: (data: {
      repo_owner: string;
      repo_name: string;
      access_token: string;
      project_id?: string;
    }) =>
      apiFetch<GitHubIntegration>(`/workspaces/${slug}/integrations/github/connect`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["github-integrations", slug] });
      setRepoOwner("");
      setRepoName("");
      setAccessToken("");
      setProjectId("");
      toast.success("GitHub repository connected successfully");
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to connect repository");
    },
  });

  // Disconnect mutation
  const disconnectMutation = useMutation({
    mutationFn: (integrationId: string) =>
      apiFetch<{ message: string }>(`/workspaces/${slug}/integrations/github/${integrationId}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["github-integrations", slug] });
      toast.success("Repository disconnected");
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to disconnect repository");
    },
  });

  // Sync mutation
  const syncMutation = useMutation({
    mutationFn: (integrationId: string) =>
      apiFetch<{ created: number; updated: number }>(
        `/workspaces/${slug}/integrations/github/${integrationId}/sync`,
        { method: "POST" },
      ),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["github-integrations", slug] });
      toast.success(`Sync complete: ${result.created} created, ${result.updated} updated`);
    },
    onError: (err: Error) => {
      toast.error(err.message || "Sync failed");
    },
  });

  function handleConnect() {
    if (!repoOwner.trim() || !repoName.trim() || !accessToken.trim()) {
      toast.error("Please fill in all required fields");
      return;
    }
    const body: Record<string, string> = {
      repo_owner: repoOwner.trim(),
      repo_name: repoName.trim(),
      access_token: accessToken.trim(),
    };
    if (projectId && projectId !== "__none__") {
      body.project_id = projectId;
    }
    connectMutation.mutate(body as any);
  }

  function formatLastSynced(dateStr: string | null): string {
    if (!dateStr) return "Never";
    const date = new Date(dateStr);
    return date.toLocaleString();
  }

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <GitBranch className="h-6 w-6" />
        <h1 className="text-2xl font-bold">GitHub Integration</h1>
      </div>

      {/* Connect form card */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Puzzle className="h-4 w-4" />
            Connect a Repository
          </CardTitle>
          <CardDescription>
            Link a GitHub repository to sync issues with your workspace.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="repo-owner">Repository Owner</Label>
              <Input
                id="repo-owner"
                placeholder="e.g. octocat"
                value={repoOwner}
                onChange={(e) => setRepoOwner(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="repo-name">Repository Name</Label>
              <Input
                id="repo-name"
                placeholder="e.g. my-project"
                value={repoName}
                onChange={(e) => setRepoName(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="access-token">Personal Access Token</Label>
            <Input
              id="access-token"
              type="password"
              placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="project-select">Project (optional)</Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger id="project-select" className="w-full">
                <SelectValue placeholder="Select a project..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">No project</SelectItem>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={handleConnect} disabled={connectMutation.isPending}>
            {connectMutation.isPending ? (
              <span className="flex items-center gap-2">
                <RefreshCw className="h-4 w-4 animate-spin" />
                Connecting...
              </span>
            ) : (
              "Connect"
            )}
          </Button>
        </CardContent>
      </Card>

      <Separator className="my-6" />

      {/* Connected repositories */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Connected Repositories</h2>

        {integrationsLoading ? (
          <div className="space-y-3">
            {[1, 2].map((i) => (
              <Card key={i}>
                <CardContent className="p-4">
                  <div className="animate-pulse flex items-center justify-between">
                    <div className="space-y-2">
                      <div className="h-4 w-48 rounded bg-muted" />
                      <div className="h-3 w-32 rounded bg-muted" />
                    </div>
                    <div className="h-8 w-20 rounded bg-muted" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : integrations.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground">
              <GitBranch className="h-10 w-10 mx-auto mb-3 opacity-40" />
              <p>No repositories connected yet.</p>
              <p className="text-sm mt-1">Use the form above to connect your first repository.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {integrations.map((integration) => {
              const linkedProject = projects.find((p) => p.id === integration.project_id);
              const isSyncing = syncMutation.isPending && syncMutation.variables === integration.id;

              return (
                <Card key={integration.id}>
                  <CardContent className="p-4">
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <GitBranch className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <span className="font-medium truncate">
                            {integration.github_repo_owner}/{integration.github_repo_name}
                          </span>
                          <a
                            href={`https://github.com/${integration.github_repo_owner}/${integration.github_repo_name}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-muted-foreground hover:text-foreground"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                          <span>Last synced: {formatLastSynced(integration.last_synced_at)}</span>
                          {linkedProject && <Badge variant="secondary">{linkedProject.name}</Badge>}
                          <Badge variant={integration.sync_enabled ? "default" : "secondary"}>
                            {integration.sync_enabled ? "Sync On" : "Sync Off"}
                          </Badge>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => syncMutation.mutate(integration.id)}
                          disabled={isSyncing}
                        >
                          {isSyncing ? (
                            <RefreshCw className="h-4 w-4 animate-spin" />
                          ) : (
                            <RefreshCw className="h-4 w-4" />
                          )}
                          <span className="ml-1.5 hidden sm:inline">Sync Now</span>
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => disconnectMutation.mutate(integration.id)}
                          disabled={disconnectMutation.isPending}
                        >
                          <Trash2 className="h-4 w-4" />
                          <span className="ml-1.5 hidden sm:inline">Disconnect</span>
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
