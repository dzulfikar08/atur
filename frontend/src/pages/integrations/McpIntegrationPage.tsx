import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Bot, Copy, Key, Plus, FileCode } from '@/lib/icons';
import { toast } from 'sonner';

interface ApiKey {
  id: string;
  label: string | null;
  is_active: boolean | number;
  created_at: string;
  last_used_at?: string | null;
}

const MCP_URL = 'https://diatur.com/mcp';
const PLACEHOLDER = '<YOUR_API_KEY>';

function maskKey(id: string) {
  const tail = id.replace(/-/g, '').slice(-6);
  return `pk_live_••••${tail}`;
}

export default function McpIntegrationPage() {
  const qc = useQueryClient();
  const [newKey, setNewKey] = useState<string | null>(null);

  const { data: apiKeys = [] } = useQuery<ApiKey[]>({
    queryKey: ['apiKeys'],
    queryFn: () => apiFetch<ApiKey[]>('/users/me/api-keys/'),
  });

  const createKeyMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ id: string; key: string; label: string | null; created_at: string }>(
        '/users/me/api-keys',
        { method: 'POST', body: JSON.stringify({ label: 'MCP / AI' }) },
      ),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['apiKeys'] });
      setNewKey(res.key);
      toast.success('API key created — copy it now, it won’t be shown again.');
    },
    onError: () => toast.error('Failed to create API key'),
  });

  // Commands embed the freshly-minted key when available; otherwise a placeholder
  // so the page is still useful as a reference before generating a key.
  const keyForCommands = newKey ?? PLACEHOLDER;
  const claudeCommand = `claude mcp add --scope user --transport http atur ${MCP_URL} --header "X-API-Key: ${keyForCommands}"`;
  const cursorConfig = JSON.stringify(
    { mcpServers: { atur: { url: MCP_URL, headers: { 'X-API-Key': keyForCommands } } } },
    null,
    2,
  );

  const copy = (text: string, what: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${what} copied to clipboard`);
  };

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Bot className="h-6 w-6" />
        <div>
          <h1 className="text-2xl font-bold">MCP / AI Integration</h1>
          <p className="text-sm text-muted-foreground">
            Control Atur from Claude Code, Cursor, and other MCP-aware AI editors.
          </p>
        </div>
      </div>

      {/* API key */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Key className="h-4 w-4" /> API Key
          </CardTitle>
          <CardDescription>
            Generate a key, then paste it into the install commands below. Keys are hashed at
            rest; this page shows the full value only once.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {newKey ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium text-emerald-600 dark:text-emerald-500">
                <span>• New key — copy it now</span>
              </div>
              <div className="flex gap-2">
                <Input value={newKey} readOnly className="font-mono text-xs" />
                <Button variant="outline" size="icon" onClick={() => copy(newKey, 'API key')}>
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ) : (
            <Button onClick={() => createKeyMutation.mutate()} disabled={createKeyMutation.isPending}>
              <Plus className="h-4 w-4 mr-1" />
              {createKeyMutation.isPending ? 'Generating…' : 'Generate API key'}
            </Button>
          )}

          {apiKeys.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Your keys</p>
              {apiKeys.map((k) => (
                <div key={k.id} className="flex items-center justify-between rounded-md border px-3 py-2">
                  <div className="min-w-0">
                    <p className="font-mono text-xs truncate">{maskKey(k.id)}</p>
                    <p className="text-xs text-muted-foreground">
                      {k.label ?? 'untitled'} · created {new Date(k.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  {k.id === apiKeys[apiKeys.length - 1]?.id && newKey && (
                    <Badge variant="outline" className="text-xs">just created</Badge>
                  )}
                </div>
              ))}
              <p className="text-xs text-muted-foreground pt-1">
                Revoke keys from <span className="font-medium">Profile → API Keys</span>.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Claude Code */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <FileCode className="h-4 w-4" /> Claude Code
          </CardTitle>
          <CardDescription>
            Run once. Installs at user scope so Atur is available in every project. Restart
            Claude Code after installing.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs leading-relaxed">
            <code>{claudeCommand}</code>
          </pre>
          <Button variant="outline" size="sm" onClick={() => copy(claudeCommand, 'Claude Code command')}>
            <Copy className="h-4 w-4 mr-1" /> Copy command
          </Button>
        </CardContent>
      </Card>

      {/* Cursor */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <FileCode className="h-4 w-4" /> Cursor
          </CardTitle>
          <CardDescription>
            Save as <code className="text-xs">~/.cursor/mcp.json</code> (or <code className="text-xs">.cursor/mcp.json</code> in a project).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs leading-relaxed">
            <code>{cursorConfig}</code>
          </pre>
          <Button variant="outline" size="sm" onClick={() => copy(cursorConfig, 'Cursor config')}>
            <Copy className="h-4 w-4 mr-1" /> Copy JSON
          </Button>
        </CardContent>
      </Card>

      {!newKey && (
        <p className="text-xs text-muted-foreground">
          The commands above use <code>{PLACEHOLDER}</code>. Generate a key to get a ready-to-paste
          command with the key embedded.
        </p>
      )}
    </div>
  );
}
