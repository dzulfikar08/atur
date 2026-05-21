import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Clock, RefreshCw, Link2, CheckCircle2, XCircle } from 'lucide-react';
import { toast } from 'sonner';

interface ClockifyStatus {
  configured: boolean;
  user_name: string | null;
  user_email: string | null;
}

interface ClockifySetupResponse {
  configured: boolean;
  user_name: string;
  user_email: string;
}

interface SyncResponse {
  pushed: number;
  pulled: number;
}

interface TimeEntry {
  id: string;
  issue_id: string;
  workspace_id: string;
  user_id: string;
  duration_seconds: number;
  description: string | null;
  started_at: string;
  ended_at: string;
  clockify_id: string | null;
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function ClockifyIntegrationPage() {
  const { slug } = useParams<{ slug: string }>();
  const qc = useQueryClient();
  const [apiKey, setApiKey] = useState('');

  // Fetch status
  const { data: status, isLoading: statusLoading } = useQuery<ClockifyStatus>({
    queryKey: ['clockify-status', slug],
    queryFn: () => apiFetch(`/workspaces/${slug}/integrations/clockify/status`),
    enabled: !!slug,
  });

  // Fetch recent time entries
  const { data: timeEntries = [], isLoading: entriesLoading } = useQuery<TimeEntry[]>({
    queryKey: ['time-entries', slug],
    queryFn: () => apiFetch(`/workspaces/${slug}/integrations/time-entries`),
    enabled: !!slug,
  });

  // Setup mutation
  const setupMutation = useMutation<ClockifySetupResponse, Error, string>({
    mutationFn: (key: string) =>
      apiFetch(`/workspaces/${slug}/integrations/clockify/setup`, {
        method: 'POST',
        body: JSON.stringify({ api_key: key }),
      }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['clockify-status', slug] });
      setApiKey('');
      toast.success(`Connected as ${data.user_name}`);
    },
    onError: () => toast.error('Failed to connect Clockify. Check your API key.'),
  });

  // Sync mutation
  const syncMutation = useMutation<SyncResponse, Error, void>({
    mutationFn: () =>
      apiFetch(`/workspaces/${slug}/integrations/clockify/sync`, { method: 'POST' }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['time-entries', slug] });
      toast.success(`Sync complete: ${data.pushed} pushed, ${data.pulled} pulled`);
    },
    onError: () => toast.error('Sync failed. Please try again.'),
  });

  if (!slug) return null;

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Clock className="h-6 w-6" />
        <h1 className="text-2xl font-bold">Clockify Integration</h1>
      </div>

      {/* Status Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Link2 className="h-4 w-4" />
            Connection Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          {statusLoading ? (
            <div className="space-y-2">
              <div className="h-5 w-48 animate-pulse rounded bg-muted" />
              <div className="h-4 w-32 animate-pulse rounded bg-muted" />
            </div>
          ) : status?.configured ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                <span className="font-medium text-emerald-500">Connected</span>
              </div>
              <div className="text-sm text-muted-foreground">
                <p>{status.user_name}</p>
                <p>{status.user_email}</p>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <XCircle className="h-5 w-5 text-muted-foreground" />
              <span className="text-muted-foreground">Not connected</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Setup Form */}
      {!status?.configured && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Connect Clockify</CardTitle>
            <CardDescription>
              Enter your Clockify API key to connect your account. You can find it in
              Clockify Profile Settings.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="api-key">API Key</Label>
              <div className="flex gap-2">
                <Input
                  id="api-key"
                  type="password"
                  placeholder="Enter your Clockify API key"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  className="flex-1"
                />
                <Button
                  onClick={() => setupMutation.mutate(apiKey)}
                  disabled={!apiKey.trim() || setupMutation.isPending}
                >
                  {setupMutation.isPending ? 'Connecting...' : 'Connect'}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Sync & Actions */}
      {status?.configured && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sync</CardTitle>
            <CardDescription>
              Sync time entries between Clockify and your workspace.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              onClick={() => syncMutation.mutate()}
              disabled={syncMutation.isPending}
              className="gap-2"
            >
              <RefreshCw className={`h-4 w-4 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
              {syncMutation.isPending ? 'Syncing...' : 'Sync Now'}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Recent Time Entries */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent Time Entries</CardTitle>
          <CardDescription>
            {timeEntries.length} {timeEntries.length === 1 ? 'entry' : 'entries'} recorded
          </CardDescription>
        </CardHeader>
        <CardContent>
          {entriesLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4">
                  <div className="h-4 w-24 animate-pulse rounded bg-muted" />
                  <div className="h-4 w-16 animate-pulse rounded bg-muted" />
                  <div className="h-4 flex-1 animate-pulse rounded bg-muted" />
                </div>
              ))}
            </div>
          ) : timeEntries.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No time entries yet. Sync your Clockify data or start tracking.
            </p>
          ) : (
            <div className="overflow-x-auto -mx-6 px-6 md:mx-0 md:px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead className="hidden sm:table-cell">Started</TableHead>
                  <TableHead className="hidden md:table-cell">Clockify</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {timeEntries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="max-w-[200px] sm:max-w-[250px] truncate">
                      {entry.description || <span className="text-muted-foreground">No description</span>}
                    </TableCell>
                    <TableCell className="font-mono text-sm whitespace-nowrap">
                      {formatDuration(entry.duration_seconds)}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap hidden sm:table-cell">
                      {formatDate(entry.started_at)}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {entry.clockify_id ? (
                        <Badge variant="outline" className="text-xs gap-1">
                          <CheckCircle2 className="h-3 w-3" /> Synced
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="text-xs">Local</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
