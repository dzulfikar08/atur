import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { ArrowLeft, MessageSquare, Calendar, Clock } from 'lucide-react';
import BottomSheet from './BottomSheet';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';

const STATE_COLORS: Record<string, string> = {
  backlog: 'bg-gray-100 text-gray-700',
  unstarted: 'bg-blue-100 text-blue-700',
  started: 'bg-yellow-100 text-yellow-700',
  completed: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-700',
};

interface Issue {
  id: string;
  name: string;
  sequence_id: number;
  description_html: string | null;
  description_stripped: string | null;
  state_id: string | null;
  priority: string | null;
  start_date: string | null;
  target_date: string | null;
  parent_id: string | null;
  created_at: string;
  updated_at: string;
  project_detail?: { name: string; identifier: string };
}

interface Comment {
  id: string;
  comment_stripped: string;
  created_at: string;
  actor_detail?: { display_name: string };
}

interface State {
  id: string;
  name: string;
  group: string;
}

export default function MobileIssueDetail() {
  const { slug, projectId, issueSeqId } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [commentText, setCommentText] = useState('');
  const [stateSheetOpen, setStateSheetOpen] = useState(false);
  const [prioritySheetOpen, setPrioritySheetOpen] = useState(false);

  const { data: issue, isLoading } = useQuery({
    queryKey: ['issue', slug, projectId, issueSeqId],
    queryFn: () => apiFetch<Issue>(`/workspaces/${slug}/projects/${projectId}/issues/${issueSeqId}/`),
    enabled: !!slug && !!projectId && !!issueSeqId,
  });

  const { data: comments = [] } = useQuery({
    queryKey: ['comments', slug, projectId, issueSeqId],
    queryFn: () => apiFetch<Comment[]>(`/workspaces/${slug}/projects/${projectId}/issues/${issueSeqId}/comments/`).catch(() => []),
    enabled: !!slug && !!projectId && !!issueSeqId,
  });

  const { data: states = [] } = useQuery({
    queryKey: ['states', slug, projectId],
    queryFn: () => apiFetch<State[]>(`/workspaces/${slug}/projects/${projectId}/states/`).catch(() => []),
    enabled: !!slug && !!projectId,
  });

  const updateMutation = useMutation({
    mutationFn: (data: Record<string, any>) =>
      apiFetch(`/workspaces/${slug}/projects/${projectId}/issues/${issueSeqId}/`, {
        method: 'PATCH', body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['issue', slug, projectId, issueSeqId] });
    },
  });

  const commentMutation = useMutation({
    mutationFn: (comment_html: string) =>
      apiFetch(`/workspaces/${slug}/projects/${projectId}/issues/${issueSeqId}/comments/`, {
        method: 'POST', body: JSON.stringify({ comment_html }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['comments', slug, projectId, issueSeqId] });
      setCommentText('');
      toast.success('Comment added');
    },
  });

  if (isLoading || !issue) {
    return <div className="flex items-center justify-center h-64"><div className="animate-pulse text-muted-foreground">Loading...</div></div>;
  }

  const currentState = states.find((s) => s.id === issue.state_id);
  const group = currentState?.group || 'backlog';

  return (
    <div className="flex flex-col h-full -m-4 md:-m-6 lg:-m-8">
      {/* Header */}
      <div className="shrink-0 border-b">
        <div className="flex items-center gap-2 px-3 py-2">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <span className="text-xs text-muted-foreground font-mono">
            {issue.project_detail?.identifier || 'PROJ'}-{String(issue.sequence_id).padStart(4, '0')}
          </span>
          <div className="flex-1" />
          {/* Tap to change state */}
          <button onClick={() => setStateSheetOpen(true)}>
            <Badge className={cn('text-[10px]', STATE_COLORS[group])} variant="secondary">
              {currentState?.name || 'Set State'}
            </Badge>
          </button>
          <button onClick={() => setPrioritySheetOpen(true)}>
            <Badge variant="outline" className="text-[10px]">
              {issue.priority || 'none'}
            </Badge>
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Title */}
        <h1 className="text-base font-semibold leading-tight">{issue.name}</h1>

        {/* Description */}
        {issue.description_stripped ? (
          <p className="text-sm text-foreground/80 whitespace-pre-wrap">{issue.description_stripped}</p>
        ) : (
          <p className="text-sm text-muted-foreground italic">No description</p>
        )}

        {/* Meta chips */}
        <div className="flex flex-wrap gap-2">
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Calendar className="h-3 w-3" />
            <span>Created {formatDistanceToNow(new Date(issue.created_at), { addSuffix: true })}</span>
          </div>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            <span>Updated {formatDistanceToNow(new Date(issue.updated_at), { addSuffix: true })}</span>
          </div>
        </div>

        {/* Divider */}
        <div className="border-t" />

        {/* Comments */}
        <div className="space-y-3">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
            <MessageSquare className="h-3 w-3" /> Comments ({comments.length})
          </h3>

          {comments.map((c) => (
            <div key={c.id} className="flex gap-2">
              <Avatar className="h-7 w-7 shrink-0">
                <AvatarFallback className="text-[10px]">
                  {c.actor_detail?.display_name?.charAt(0) || 'U'}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium">{c.actor_detail?.display_name || 'User'}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {formatDistanceToNow(new Date(c.created_at), { addSuffix: true })}
                  </span>
                </div>
                <p className="text-sm mt-0.5">{c.comment_stripped}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Floating comment bar */}
      <div className="shrink-0 border-t bg-background p-3 safe-area-bottom">
        <div className="flex items-center gap-2">
          <Textarea
            placeholder="Add a comment..."
            className="flex-1 min-h-[36px] max-h-[72px] text-sm resize-none"
            rows={1}
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
          />
          <Button
            size="sm"
            className="h-9 shrink-0"
            disabled={!commentText.trim() || commentMutation.isPending}
            onClick={() => commentMutation.mutate(commentText)}
          >
            Send
          </Button>
        </div>
      </div>

      {/* State sheet */}
      <BottomSheet open={stateSheetOpen} onClose={() => setStateSheetOpen(false)} title="Change State">
        <div className="space-y-1">
          {states.map((s) => (
            <button
              key={s.id}
              className={cn(
                'w-full text-left p-3 rounded-lg text-sm flex items-center gap-2 transition-colors',
                s.id === issue.state_id ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-muted/50'
              )}
              onClick={() => {
                updateMutation.mutate({ state_id: s.id });
                setStateSheetOpen(false);
              }}
            >
              <Badge className={cn('text-[10px]', STATE_COLORS[s.group])} variant="secondary">{s.name}</Badge>
              {s.id === issue.state_id && <span className="text-xs ml-auto">Current</span>}
            </button>
          ))}
        </div>
      </BottomSheet>

      {/* Priority sheet */}
      <BottomSheet open={prioritySheetOpen} onClose={() => setPrioritySheetOpen(false)} title="Change Priority">
        <div className="space-y-1">
          {['none', 'low', 'medium', 'high', 'urgent'].map((p) => (
            <button
              key={p}
              className={cn(
                'w-full text-left p-3 rounded-lg text-sm capitalize flex items-center gap-2 transition-colors',
                p === issue.priority ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-muted/50'
              )}
              onClick={() => {
                updateMutation.mutate({ priority: p });
                setPrioritySheetOpen(false);
              }}
            >
              {p}
              {p === issue.priority && <span className="text-xs ml-auto">Current</span>}
            </button>
          ))}
        </div>
      </BottomSheet>
    </div>
  );
}
