import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Package, Plus, X } from '@/lib/icons';
import { toast } from 'sonner';


interface ModuleData {
  id: string;
  name: string;
  description: string | null;
  status: string;
  start_date: string | null;
  target_date: string | null;
  created_at: string;
  updated_at: string;
}

interface ModuleIssue {
  id: string;
  issue_id: string;
  module_id: string;
  created_at: string;
  issue_detail?: { id: string; name: string; sequence_id: number; state_id: string | null; priority: string | null };
}

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  'planned': { bg: 'bg-blue-50 dark:bg-blue-950', text: 'text-blue-700 dark:text-blue-300' },
  'in-progress': { bg: 'bg-yellow-50 dark:bg-yellow-950', text: 'text-yellow-700 dark:text-yellow-300' },
  'completed': { bg: 'bg-green-50 dark:bg-green-950', text: 'text-green-700 dark:text-green-300' },
  'cancelled': { bg: 'bg-red-50 dark:bg-red-950', text: 'text-red-700 dark:text-red-300' },
  'paused': { bg: 'bg-gray-50 dark:bg-gray-950', text: 'text-gray-700 dark:text-gray-300' },
};

export default function ModuleDetailPage() {
  const { slug, projectId, moduleId } = useParams<{ slug: string; projectId: string; moduleId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [issueSearch, setIssueSearch] = useState('');

  const { data: mod, isLoading: modLoading } = useQuery({
    queryKey: ['module', slug, projectId, moduleId],
    queryFn: () => apiFetch<ModuleData>(`/workspaces/${slug}/projects/${projectId}/modules/${moduleId}/`),
    enabled: !!slug && !!projectId && !!moduleId,
  });

  const { data: moduleIssues = [], isLoading: issuesLoading } = useQuery({
    queryKey: ['module-issues', slug, projectId, moduleId],
    queryFn: () => apiFetch<{ results: ModuleIssue[] }>(`/workspaces/${slug}/projects/${projectId}/modules/${moduleId}/issues/`).then((d) => d.results)
      .catch(() => []),
    enabled: !!slug && !!projectId && !!moduleId,
  });

  const { data: states = [] } = useQuery({
    queryKey: ['states', slug, projectId],
    queryFn: () => apiFetch<{ results: { id: string; name: string; color?: string }[] }>(`/workspaces/${slug}/projects/${projectId}/states/`).then((d) => d.results)
      .catch(() => []),
    enabled: !!slug && !!projectId,
  });

  const { data: searchResults = [] } = useQuery({
    queryKey: ['issue-search', slug, projectId, issueSearch],
    queryFn: () =>
      apiFetch<{ results: { id: string; name: string; sequence_id: number }[] }>(
        `/workspaces/${slug}/projects/${projectId}/issues/?search=${encodeURIComponent(issueSearch)}&limit=10`
      ).then((r) => (Array.isArray(r) ? r : r.results)),
    enabled: !!slug && !!projectId && issueSearch.length >= 2,
  });

  const addIssue = useMutation({
    mutationFn: (issueId: string) =>
      apiFetch(`/workspaces/${slug}/projects/${projectId}/modules/${moduleId}/issues/`, {
        method: 'POST',
        body: JSON.stringify({ issue_id: issueId }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['module-issues', slug, projectId, moduleId] });
      setIssueSearch('');
      toast.success('Issue added to module');
    },
    onError: () => toast.error('Failed to add issue'),
  });

  const removeIssue = useMutation({
    mutationFn: (issueId: string) =>
      apiFetch(`/workspaces/${slug}/projects/${projectId}/modules/${moduleId}/issues/${issueId}/`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['module-issues', slug, projectId, moduleId] });
      toast.success('Issue removed');
    },
    onError: () => toast.error('Failed to remove issue'),
  });

  if (modLoading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-pulse text-muted-foreground">Loading module...</div></div>;
  }

  if (!mod) {
    return <div className="text-center py-16"><p className="text-muted-foreground">Module not found</p></div>;
  }

  const sc = STATUS_COLORS[mod.status] || STATUS_COLORS['planned'];
  const moduleIssueIds = new Set(moduleIssues.map((mi: any) => mi.issue_id || mi.issue_detail?.id));

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="icon" onClick={() => navigate(`/${slug}/projects/${projectId}/modules`)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <Package className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-xl font-bold">{mod.name}</h1>
        <Badge className={`${sc.bg} ${sc.text}`}>{mod.status}</Badge>
      </div>

      {mod.description && (
        <p className="text-sm text-muted-foreground mb-6">{mod.description}</p>
      )}

      {(mod.start_date || mod.target_date) && (
        <div className="flex gap-4 mb-6 text-sm text-muted-foreground">
          {mod.start_date && <span>Start: {new Date(mod.start_date).toLocaleDateString()}</span>}
          {mod.target_date && <span>Target: {new Date(mod.target_date).toLocaleDateString()}</span>}
        </div>
      )}

      {/* Add issue to module */}
      <div className="mb-6 space-y-2">
        <h3 className="text-sm font-medium">Add Issue</h3>
        <div className="relative">
          <Input
            placeholder="Search issues to add..."
            value={issueSearch}
            onChange={(e) => setIssueSearch(e.target.value)}
            className="h-9"
          />
          {issueSearch.length >= 2 && searchResults.length > 0 && (
            <div className="absolute top-full left-0 right-0 border rounded-md bg-background shadow-md z-10 mt-1 max-h-[200px] overflow-y-auto">
              {searchResults
                .filter((i: any) => !moduleIssueIds.has(i.id))
                .map((i: any) => (
                  <button
                    key={i.id}
                    className="w-full text-left p-2 text-sm hover:bg-muted/50 flex items-center justify-between"
                    onClick={() => addIssue.mutate(i.id)}
                  >
                    <span>
                      <span className="text-muted-foreground text-xs mr-2">#{String(i.sequence_id).padStart(4, '0')}</span>
                      {i.name}
                    </span>
                    <Plus className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                ))}
            </div>
          )}
        </div>
      </div>

      {/* Module issues list */}
      <div className="space-y-1">
        <h3 className="text-sm font-medium mb-2">Issues ({moduleIssues.length})</h3>
        {issuesLoading ? (
          <div className="animate-pulse text-sm text-muted-foreground">Loading...</div>
        ) : moduleIssues.length === 0 ? (
          <p className="text-sm text-muted-foreground italic py-4 text-center">No issues in this module</p>
        ) : (
          moduleIssues.map((mi: any) => {
            const issue = mi.issue_detail || mi;
            const st = states.find((s: any) => s.id === issue.state_id);
            return (
              <div
                key={mi.id || mi.issue_id}
                className="flex items-center gap-3 p-2.5 border rounded-md hover:bg-muted/30 transition-colors"
              >
                <span className="text-xs text-muted-foreground font-mono">
                  #{String(issue.sequence_id || '?').padStart(4, '0')}
                </span>
                <span
                  className="text-sm font-medium flex-1 cursor-pointer hover:underline"
                  onClick={() => issue.sequence_id && navigate(`/${slug}/projects/${projectId}/issues/${issue.sequence_id}`)}
                >
                  {issue.name}
                </span>
                {st && (
                  <span
                    className="text-xs px-2 py-0.5 rounded-full"
                    style={{ backgroundColor: (st.color || '#6b7280') + '20', color: st.color || '#6b7280' }}
                  >
                    {st.name}
                  </span>
                )}
                {issue.priority && issue.priority !== 'none' && (
                  <Badge variant="outline" className="text-[10px]">{issue.priority}</Badge>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground hover:text-destructive shrink-0"
                  onClick={() => removeIssue.mutate(mi.issue_id || issue.id)}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
