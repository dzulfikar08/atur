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
import { Zap, RefreshCw, ExternalLink } from "@/lib/icons";

interface PolarSettings {
  workspace_id: string;
  // Masked hint from the API — never the full value (secrets are write-only).
  access_token: string | null;
  webhook_secret: string | null;
  pipeline_project_id: string | null;
  default_state_id: string | null;
  webhook_enabled: number;
  last_synced_at: string | null;
}

interface PolarLink {
  id: string;
  polar_type: string;
  polar_id: string;
  last_event: string | null;
  created_at: string | null;
}

interface Project {
  id: string;
  name: string;
}

interface State {
  id: string;
  name: string;
  group: string;
}

export default function PolarIntegrationPage() {
  const { slug } = useParams<{ slug: string }>();
  const qc = useQueryClient();

  const [accessToken, setAccessToken] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [pipelineProjectId, setPipelineProjectId] = useState("");
  const [defaultStateId, setDefaultStateId] = useState("");

  const { data: settings, isLoading: settingsLoading } = useQuery({
    queryKey: ["polar-settings", slug],
    queryFn: () => apiFetch<PolarSettings>(`/workspaces/${slug}/polar/settings`),
    enabled: !!slug,
  });

  const { data: projects = [] } = useQuery({
    queryKey: ["projects", slug],
    queryFn: () =>
      apiFetch<{ results: Project[] }>(`/workspaces/${slug}/projects/`).then((d) => d.results),
    enabled: !!slug,
  });

  const selectedProjectId = pipelineProjectId || settings?.pipeline_project_id || "";

  const { data: states = [] } = useQuery({
    queryKey: ["polar-states", slug, selectedProjectId],
    queryFn: () =>
      apiFetch<{ results: State[] }>(`/workspaces/${slug}/projects/${selectedProjectId}/states/`).then(
        (d) => d.results,
      ),
    enabled: !!slug && !!selectedProjectId,
  });

  const { data: linksData } = useQuery({
    queryKey: ["polar-links", slug],
    queryFn: () => apiFetch<{ results: PolarLink[] }>(`/workspaces/${slug}/polar/links`),
    enabled: !!slug,
  });
  const links: PolarLink[] = linksData?.results ?? [];

  const saveMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      apiFetch<PolarSettings>(`/workspaces/${slug}/polar/settings`, {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["polar-settings", slug] });
      toast.success("Polar settings saved");
    },
    onError: (err: Error) => toast.error(err.message || "Failed to save settings"),
  });

  const syncMutation = useMutation({
    mutationFn: () =>
      apiFetch<{
        ok: boolean;
        customers: number;
        subscriptions: number;
        orders: number;
        truncated: boolean;
      }>(`/workspaces/${slug}/polar/sync`, { method: "POST" }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["polar-links", slug] });
      qc.invalidateQueries({ queryKey: ["polar-settings", slug] });
      toast.success(
        `Synced ${r.customers} customers, ${r.subscriptions} subscriptions, ${r.orders} orders` +
          (r.truncated
            ? " — capped at 500 per type, tail not fetched (webhooks keep things current)"
            : ""),
      );
    },
    onError: (err: Error) => toast.error(err.message || "Sync failed"),
  });

  function handleSave() {
    const body: Record<string, unknown> = {
      pipeline_project_id: pipelineProjectId || settings?.pipeline_project_id || null,
      default_state_id: defaultStateId || settings?.default_state_id || null,
    };
    if (accessToken.trim()) body.access_token = accessToken.trim();
    if (webhookSecret.trim()) body.webhook_secret = webhookSecret.trim();
    saveMutation.mutate(body);
  }

  function handleEnableWebhook() {
    saveMutation.mutate({ webhook_enabled: !(settings?.webhook_enabled === 1) });
  }

  const webhookUrl = slug
    ? `${window.location.origin}/webhooks/polar/${slug}`
    : "";

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Zap className="h-6 w-6" />
        <h1 className="text-2xl font-bold">Polar Integration</h1>
      </div>

      {/* Credentials */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>API Credentials</CardTitle>
          <CardDescription>
            Enter your Polar organization's access token and webhook secret to import
            customers, subscriptions, and orders into the CRM.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {settingsLoading ? (
            <div className="animate-pulse space-y-3">
              <div className="h-9 rounded bg-muted" />
              <div className="h-9 rounded bg-muted" />
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="polar-token">Access Token</Label>
                <Input
                  id="polar-token"
                  type="password"
                  placeholder={
                    settings?.access_token ? "•••••••• (stored — leave blank to keep)" : "pol_..."
                  }
                  value={accessToken}
                  onChange={(e) => setAccessToken(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="polar-secret">Webhook Secret</Label>
                <Input
                  id="polar-secret"
                  type="password"
                  placeholder={
                    settings?.webhook_secret ? "•••••••• (stored — leave blank to keep)" : "whsec_..."
                  }
                  value={webhookSecret}
                  onChange={(e) => setWebhookSecret(e.target.value)}
                />
              </div>

              {/* Pipeline target */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Pipeline Project</Label>
                  <Select
                    value={selectedProjectId || "__none__"}
                    onValueChange={(v) => setPipelineProjectId(v === "__none__" ? "" : v)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select a pipeline..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Auto (CRM/deal/pipeline)</SelectItem>
                      {projects.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Default Stage</Label>
                  <Select
                    value={defaultStateId || settings?.default_state_id || ""}
                    onValueChange={setDefaultStateId}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Auto (first 'started' state)" />
                    </SelectTrigger>
                    <SelectContent>
                      {states.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name} ({s.group})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Button onClick={handleSave} disabled={saveMutation.isPending}>
                {saveMutation.isPending ? "Saving..." : "Save Settings"}
              </Button>

              <Separator />

              {/* Webhook + sync */}
              <div className="space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">Webhook Receiver</span>
                      <Badge variant={settings?.webhook_enabled === 1 ? "default" : "secondary"}>
                        {settings?.webhook_enabled === 1 ? "Enabled" : "Disabled"}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground break-all">
                      {webhookUrl}
                      <a
                        href="https://polar.sh/docs/integrate/webhooks/endpoints"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 ml-1 hover:underline"
                      >
                        <ExternalLink className="h-3 w-3" /> docs
                      </a>
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleEnableWebhook}
                    disabled={
                      saveMutation.isPending ||
                      (!settings?.webhook_secret && settings?.webhook_enabled !== 1)
                    }
                  >
                    {settings?.webhook_enabled === 1 ? "Disable" : "Enable"}
                  </Button>
                </div>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-1">
                    <span className="text-sm font-medium">Sync Now</span>
                    <p className="text-xs text-muted-foreground">
                      Backfill customers, subscriptions, and orders from Polar.
                      {settings?.last_synced_at ? (
                        <> Last synced {new Date(settings.last_synced_at).toLocaleString()}.</>
                      ) : null}
                    </p>
                  </div>
                  <Button onClick={() => syncMutation.mutate()} disabled={syncMutation.isPending || !settings?.access_token}>
                    {syncMutation.isPending ? (
                      <span className="flex items-center gap-2">
                        <RefreshCw className="h-4 w-4 animate-spin" /> Syncing...
                      </span>
                    ) : (
                      <span className="flex items-center gap-2">
                        <RefreshCw className="h-4 w-4" /> Sync Now
                      </span>
                    )}
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Imported entities */}
      <Card>
        <CardHeader>
          <CardTitle>Imported from Polar</CardTitle>
          <CardDescription>Recent customers, subscriptions, and orders synced into the CRM.</CardDescription>
        </CardHeader>
        <CardContent>
          {links.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing imported yet. Enable the webhook or run a manual sync.
            </p>
          ) : (
            <ul className="space-y-2">
              {links.map((l) => (
                <li key={l.id} className="flex items-center justify-between text-sm">
                  <span className="truncate">
                    <Badge variant="outline" className="mr-2">{l.polar_type}</Badge>
                    {l.polar_id}
                  </span>
                  <span className="text-muted-foreground ml-2">
                    {l.last_event ?? "—"} · {l.created_at ? new Date(l.created_at).toLocaleDateString() : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
