import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch, api } from '@/lib/api';
import MobileIssueCard from './MobileIssueCard';
import BottomSheet from './BottomSheet';
import PullToRefreshIndicator from './PullToRefreshIndicator';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useState, useEffect } from 'react';
import { Plus, Search, SlidersHorizontal } from '@/lib/icons';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import usePullToRefresh from '@/hooks/usePullToRefresh';
import { hapticMedium } from '@/lib/haptics';

interface Issue {
  id: string;
  name: string;
  sequence_id: number;
  state_id: string | null;
  priority: string | null;
  project_id: string;
  created_at: string;
  updated_at: string;
  project_name?: string;
  workspace_slug?: string;
  workspace_name?: string;
}

interface MobileIssueListProps {
  slug: string;
  projectId?: string;
}

export default function MobileIssueList({ slug, projectId }: MobileIssueListProps) {
  const qc = useQueryClient();
  const [filterOpen, setFilterOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [filterState, setFilterState] = useState<string>('all');
  const [filterPriority, setFilterPriority] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [newIssueName, setNewIssueName] = useState('');
  const [newIssueDesc, setNewIssueDesc] = useState('');
  const [newIssueState, setNewIssueState] = useState('');

  const isAll = slug === 'all';

  const { data: projects = [] } = useQuery({
    queryKey: ['projects', slug],
    queryFn: () => api.listProjects(slug),
    enabled: !!slug && !projectId && !isAll,
  });

  const { data: states = [] } = useQuery({
    queryKey: ['states', slug, projectId],
    queryFn: () => api.listStates(slug!, projectId!),
    enabled: !!slug && !!projectId,
  });

  const backlogStateId = states.find((s) => s.group === 'backlog')?.id ?? states[0]?.id ?? '';
  useEffect(() => {
    if (!newIssueState && backlogStateId) setNewIssueState(backlogStateId);
  }, [backlogStateId, newIssueState]);

  const { data: allIssues = [], isLoading } = useQuery({
    queryKey: ['mobile-issues', slug, projectId, isAll ? 'all' : projects.map((p) => p.id).join(',')],
    queryFn: async (): Promise<Issue[]> => {
      if (isAll) return api.listAllIssues();
      if (projectId) {
        const issues = await api.listIssues(slug!, projectId);
        return issues.map((i: any) => ({ ...i }));
      }
      const results: Issue[] = [];
      for (const project of projects) {
        try {
          const issues = await apiFetch<{ results: Issue[] }>(
            `/workspaces/${slug}/projects/${project.id}/issues/?limit=100`
          ).then((r) => r.results);
          for (const issue of issues) {
            results.push({ ...issue, project_name: project.name });
          }
        } catch {}
      }
      return results;
    },
    enabled: !!slug && (isAll || (projectId ? true : projects.length > 0)),
  });

  const createMutation = useMutation({
    mutationFn: (data: { name: string; description_html?: string; state_id?: string }) =>
      apiFetch(`/workspaces/${slug}/projects/${projectId}/issues`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mobile-issues', slug, projectId] });
      setCreateOpen(false);
      setNewIssueName('');
      setNewIssueDesc('');
      setNewIssueState(backlogStateId);
      toast.success('Issue created');
    },
    onError: () => toast.error('Failed to create issue'),
  });

  const filtered = allIssues.filter((i) => {
    if (filterState !== 'all' && i.state_id !== filterState) return false;
    if (filterPriority !== 'all' && i.priority !== filterPriority) return false;
    if (search && !i.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const { pullDistance, isRefreshing, progress, pullHandlers } = usePullToRefresh({
    onRefresh: async () => {
      hapticMedium();
      await qc.invalidateQueries({ queryKey: ['mobile-issues', slug, projectId] });
      await qc.invalidateQueries({ queryKey: ['projects', slug] });
    },
  });

  return (
    <div
      className="space-y-3 overflow-y-auto"
      {...pullHandlers}
    >
      <PullToRefreshIndicator pullDistance={pullDistance} isRefreshing={isRefreshing} progress={progress} />
      {/* Search + Actions bar */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search issues..."
            className="h-9 pl-8 text-sm rounded-lg"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Button variant="outline" size="icon" className="h-9 w-9 shrink-0" onClick={() => setFilterOpen(true)}>
          <SlidersHorizontal className="h-4 w-4" />
        </Button>
        {projectId && (
          <Button size="icon" className="h-9 w-9 shrink-0" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Active filters */}
      {(filterState !== 'all' || filterPriority !== 'all') && (
        <div className="flex gap-1.5 flex-wrap">
          {filterState !== 'all' && (
            <Badge variant="secondary" className="text-xs gap-1 cursor-pointer" onClick={() => setFilterState('all')}>
              {states.find((s) => s.id === filterState)?.name || 'State'} ✕
            </Badge>
          )}
          {filterPriority !== 'all' && (
            <Badge variant="secondary" className="text-xs gap-1 cursor-pointer" onClick={() => setFilterPriority('all')}>
              {filterPriority} ✕
            </Badge>
          )}
        </div>
      )}

      {/* Issue count */}
      <p className="text-xs text-muted-foreground">
        {isLoading ? 'Loading...' : `${filtered.length} issues`}
      </p>

      {/* Card list */}
      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-16 rounded-xl border bg-card animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">
          No issues found
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((issue) => (
            <MobileIssueCard
              key={issue.id}
              issue={issue}
              slug={issue.workspace_slug || slug}
              projectId={projectId || issue.project_id}
              states={states}
            />
          ))}
        </div>
      )}

      {/* Filter bottom sheet */}
      <BottomSheet open={filterOpen} onClose={() => setFilterOpen(false)} title="Filters">
        <div className="space-y-4">
          {projectId && (
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">State</label>
              <Select value={filterState} onValueChange={setFilterState}>
                <SelectTrigger><SelectValue placeholder="All States" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All States</SelectItem>
                  {states.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Priority</label>
            <Select value={filterPriority} onValueChange={setFilterPriority}>
              <SelectTrigger><SelectValue placeholder="All Priority" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Priority</SelectItem>
                {['urgent', 'high', 'medium', 'low', 'none'].map((p) => (
                  <SelectItem key={p} value={p}>{p}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button className="w-full" onClick={() => setFilterOpen(false)}>Apply</Button>
        </div>
      </BottomSheet>

      {/* Create bottom sheet */}
      <BottomSheet open={createOpen} onClose={() => setCreateOpen(false)} title="New Issue">
        <div className="space-y-3">
          <Input
            placeholder="Issue title"
            value={newIssueName}
            onChange={(e) => setNewIssueName(e.target.value)}
          />
          <Textarea
            placeholder="Description (optional)"
            rows={3}
            value={newIssueDesc}
            onChange={(e) => setNewIssueDesc(e.target.value)}
          />
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">State</label>
            <Select value={newIssueState} onValueChange={setNewIssueState}>
              <SelectTrigger><SelectValue placeholder="Backlog" /></SelectTrigger>
              <SelectContent>
                {states.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            className="w-full"
            disabled={!newIssueName.trim() || createMutation.isPending}
            onClick={() => createMutation.mutate({ name: newIssueName, description_html: newIssueDesc || undefined, state_id: newIssueState || undefined })}
          >
            {createMutation.isPending ? 'Creating...' : 'Create Issue'}
          </Button>
        </div>
      </BottomSheet>
    </div>
  );
}
