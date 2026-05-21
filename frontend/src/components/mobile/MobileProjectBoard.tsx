import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, apiFetch, type Issue, type State } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { ChevronDown, ChevronRight, Plus, SlidersHorizontal } from 'lucide-react';
import MobileIssueCard from './MobileIssueCard';
import BottomSheet from './BottomSheet';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

const STATE_COLORS: Record<string, string> = {
  backlog: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  unstarted: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  started: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300',
  completed: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  cancelled: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
};

interface MobileProjectBoardProps {
  slug: string;
  projectId: string;
}

export default function MobileProjectBoard({ slug, projectId }: MobileProjectBoardProps) {
  const qc = useQueryClient();
  const [expandedStates, setExpandedStates] = useState<Set<string>>(new Set(['started', 'unstarted']));
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterPriority, setFilterPriority] = useState<string>('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');

  const { data: issues = [], isLoading } = useQuery({
    queryKey: ['issues', slug, projectId],
    queryFn: () => api.listIssues(slug, projectId),
    enabled: !!slug && !!projectId,
  });

  const { data: states = [] } = useQuery({
    queryKey: ['states', slug, projectId],
    queryFn: () => api.listStates(slug, projectId),
    enabled: !!slug && !!projectId,
  });

  const createMutation = useMutation({
    mutationFn: (data: { name: string; description_html?: string }) =>
      apiFetch(`/workspaces/${slug}/projects/${projectId}/issues`, {
        method: 'POST', body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['issues', slug, projectId] });
      setCreateOpen(false);
      setNewName('');
      setNewDesc('');
      toast.success('Issue created');
    },
    onError: () => toast.error('Failed to create issue'),
  });

  const filtered = useMemo(() => {
    return issues.filter((i) => {
      if (filterPriority !== 'all' && i.priority !== filterPriority) return false;
      return true;
    });
  }, [issues, filterPriority]);

  const grouped = useMemo(() => {
    const groups: { state: State; issues: Issue[] }[] = [];
    for (const state of states) {
      const stateIssues = filtered.filter((i) => i.state_id === state.id);
      groups.push({ state, issues: stateIssues });
    }
    return groups;
  }, [filtered, states]);

  function toggleState(groupId: string) {
    setExpandedStates((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }

  return (
    <div className="space-y-2">
      {/* Header actions */}
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" className="h-8 text-xs gap-1" onClick={() => setFilterOpen(true)}>
          <SlidersHorizontal className="h-3 w-3" /> Filter
        </Button>
        {filterPriority !== 'all' && (
          <Badge variant="secondary" className="text-xs gap-1 cursor-pointer" onClick={() => setFilterPriority('all')}>
            {filterPriority} ✕
          </Badge>
        )}
        <div className="flex-1" />
        <Button size="sm" className="h-8 text-xs gap-1" onClick={() => setCreateOpen(true)}>
          <Plus className="h-3 w-3" /> New
        </Button>
      </div>

      {/* State sections */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-20 rounded-xl border animate-pulse" />)}
        </div>
      ) : (
        grouped.map(({ state, issues: stateIssues }) => {
          const isExpanded = expandedStates.has(state.id);
          return (
            <div key={state.id} className="rounded-xl border overflow-hidden">
              {/* Section header */}
              <button
                className="w-full flex items-center gap-2 p-3 bg-muted/30 active:bg-muted/50 transition-colors"
                onClick={() => toggleState(state.id)}
              >
                {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                <Badge className={cn('text-[10px]', STATE_COLORS[state.group] || STATE_COLORS.backlog)} variant="secondary">
                  {state.name}
                </Badge>
                <span className="text-xs text-muted-foreground">{stateIssues.length}</span>
              </button>
              {/* Issues */}
              {isExpanded && (
                <div className="p-2 space-y-1.5">
                  {stateIssues.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-3">No issues</p>
                  ) : (
                    stateIssues.map((issue) => (
                      <MobileIssueCard
                        key={issue.id}
                        issue={issue}
                        slug={slug}
                        projectId={projectId}
                        states={states}
                      />
                    ))
                  )}
                </div>
              )}
            </div>
          );
        })
      )}

      {/* Filter sheet */}
      <BottomSheet open={filterOpen} onClose={() => setFilterOpen(false)} title="Filter">
        <div className="space-y-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Priority</label>
            <Select value={filterPriority} onValueChange={setFilterPriority}>
              <SelectTrigger><SelectValue /></SelectTrigger>
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

      {/* Create sheet */}
      <BottomSheet open={createOpen} onClose={() => setCreateOpen(false)} title="New Issue">
        <div className="space-y-3">
          <Input placeholder="Issue title" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <Textarea placeholder="Description (optional)" rows={3} value={newDesc} onChange={(e) => setNewDesc(e.target.value)} />
          <Button className="w-full" disabled={!newName.trim() || createMutation.isPending}
            onClick={() => createMutation.mutate({ name: newName, description_html: newDesc || undefined })}>
            {createMutation.isPending ? 'Creating...' : 'Create Issue'}
          </Button>
        </div>
      </BottomSheet>
    </div>
  );
}
