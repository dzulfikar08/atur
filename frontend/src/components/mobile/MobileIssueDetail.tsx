import { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch, api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import CommentEditor from '@/components/editor/CommentEditor';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ArrowLeft, MessageSquare, Calendar, Clock, Link2, Plus, X, Trash2, Pencil, User, Bell } from '@/lib/icons';
import BottomSheet from './BottomSheet';
import CommentContent from '@/components/editor/CommentContent';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';
import { hapticMedium } from '@/lib/haptics';
import { useAuthStore } from '@/stores/auth';

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
  assignees?: { id: string; email?: string | null; username?: string | null; display_name?: string | null; avatar?: string | null }[];
  project_detail?: { name: string; identifier: string };
}

interface Comment {
  id: string;
  comment_stripped: string;
  comment_html: string;
  created_at: string;
  actor_id?: string;
  actor_detail?: { display_name: string };
}

interface State {
  id: string;
  name: string;
  group: string;
}

interface IssueRelation {
  id: string;
  issue_id: string;
  related_issue_id: string;
  relation_type: string;
  created_at: string;
}

const RELATION_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  blocks: { label: "Blocks", color: "bg-orange-100 text-orange-700" },
  is_blocked_by: { label: "Blocked by", color: "bg-red-100 text-red-700" },
  relates_to: { label: "Relates to", color: "bg-blue-100 text-blue-700" },
  duplicates: { label: "Duplicates", color: "bg-purple-100 text-purple-700" },
};

export default function MobileIssueDetail() {
  const { slug, projectId, issueSeqId } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);
  const [commentText, setCommentText] = useState('');
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editCommentText, setEditCommentText] = useState('');
  const [commentSort, setCommentSort] = useState<'newest' | 'oldest'>('newest');
  const [stateSheetOpen, setStateSheetOpen] = useState(false);
  const [prioritySheetOpen, setPrioritySheetOpen] = useState(false);
  const [assigneeSheetOpen, setAssigneeSheetOpen] = useState(false);

  const { data: issue, isLoading } = useQuery({
    queryKey: ['issue', slug, projectId, issueSeqId],
    queryFn: () => apiFetch<Issue>(`/workspaces/${slug}/projects/${projectId}/issues/${issueSeqId}/`),
    enabled: !!slug && !!projectId && !!issueSeqId,
  });

  const { data: comments = [] } = useQuery({
    queryKey: ['comments', slug, projectId, issueSeqId],
    queryFn: () => apiFetch<{ results: Comment[] }>(`/workspaces/${slug}/projects/${projectId}/issues/${issueSeqId}/comments/`).then((d) => d.results).catch(() => []),
    enabled: !!slug && !!projectId && !!issueSeqId,
  });

  const sortedComments = useMemo(() => {
    const list = [...comments];
    list.sort((a, b) => {
      const t = (v: string) => new Date(v).getTime();
      return commentSort === 'oldest' ? t(a.created_at) - t(b.created_at) : t(b.created_at) - t(a.created_at);
    });
    return list;
  }, [comments, commentSort]);

  const { data: states = [] } = useQuery({
    queryKey: ['states', slug, projectId],
    queryFn: () => apiFetch<{ results: State[] }>(`/workspaces/${slug}/projects/${projectId}/states/`).then((d) => d.results).catch(() => []),
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

  // --- Assignees ---
  const { data: members = [] } = useQuery({
    queryKey: ['project-members', slug, projectId],
    queryFn: () =>
      apiFetch<{ results: { memberId: string; username?: string | null; email?: string | null; displayName?: string | null; avatar?: string | null }[] }>(
        `/workspaces/${slug}/projects/${projectId}/members/`
      ).then((d) => d.results).catch(() => []),
    enabled: !!slug && !!projectId,
  });

  const currentAssigneeIds = new Set((issue?.assignees ?? []).map((a) => a.id));

  const addAssigneeMutation = useMutation({
    mutationFn: (assigneeId: string) =>
      api.addAssignee(slug!, projectId!, Number(issueSeqId!), assigneeId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['issue', slug, projectId, issueSeqId] });
      qc.invalidateQueries({ queryKey: ['issues', slug, projectId] });
      qc.invalidateQueries({ queryKey: ['my-issues'] });
      toast.success('Assignee added');
    },
    onError: () => toast.error('Failed to assign user'),
  });

  const removeAssigneeMutation = useMutation({
    mutationFn: (assigneeId: string) =>
      api.removeAssignee(slug!, projectId!, Number(issueSeqId!), assigneeId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['issue', slug, projectId, issueSeqId] });
      qc.invalidateQueries({ queryKey: ['issues', slug, projectId] });
      qc.invalidateQueries({ queryKey: ['my-issues'] });
      toast.success('Assignee removed');
    },
    onError: () => toast.error('Failed to unassign user'),
  });

  const toggleAssignee = (assigneeId: string) => {
    if (currentAssigneeIds.has(assigneeId)) {
      removeAssigneeMutation.mutate(assigneeId);
    } else {
      addAssigneeMutation.mutate(assigneeId);
    }
  };

  // --- Followers ---
  const { data: subscribersData } = useQuery({
    queryKey: ['subscribers', slug, projectId, issueSeqId],
    queryFn: () =>
      api.listSubscribers(slug!, projectId!, issueSeqId!).catch(() => ({ results: [] })),
    enabled: !!slug && !!projectId && !!issueSeqId,
  });
  const subscribed = (subscribersData?.results ?? []).some((s) => s.user?.id === currentUser?.id);
  const followerCount = (subscribersData?.results ?? []).length;

  const followMutation = useMutation({
    mutationFn: () => api.followIssue(slug!, projectId!, issueSeqId!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['subscribers', slug, projectId, issueSeqId] });
      toast.success("You'll get notified about activity on this issue");
    },
    onError: () => toast.error('Failed to follow issue'),
  });

  const unfollowMutation = useMutation({
    mutationFn: () => api.unfollowIssue(slug!, projectId!, issueSeqId!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['subscribers', slug, projectId, issueSeqId] });
      toast.success('Unfollowed — you\'ll no longer get notified');
    },
    onError: () => toast.error('Failed to unfollow issue'),
  });

  // Workspace members in the shape the mention picker expects.
  const mentionMembers = useMemo(
    () =>
      members.map((m) => ({
        id: m.memberId,
        username: m.username || m.email?.split('@')[0] || m.memberId.slice(0, 8),
        display_name: m.displayName,
        email: m.email,
        avatar: m.avatar,
      })),
    [members]
  );

  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const deleteIssueMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/workspaces/${slug}/projects/${projectId}/issues/${issueSeqId}/`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['issues', slug, projectId] });
      qc.invalidateQueries({ queryKey: ['my-issues'] });
      toast.success('Issue deleted');
      navigate(`/${slug}/projects/${projectId}`);
    },
    onError: () => toast.error('Failed to delete issue'),
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

  const editCommentMutation = useMutation({
    mutationFn: ({ commentId, comment_html }: { commentId: string; comment_html: string }) =>
      apiFetch(`/workspaces/${slug}/projects/${projectId}/issues/${issueSeqId}/comments/${commentId}/`, {
        method: 'PATCH', body: JSON.stringify({ comment_html }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['comments', slug, projectId, issueSeqId] });
      setEditingCommentId(null);
      setEditCommentText('');
      toast.success('Comment updated');
    },
    onError: () => toast.error('Failed to update comment'),
  });

  const startEditComment = (c: Comment) => {
    setEditingCommentId(c.id);
    setEditCommentText(c.comment_html);
  };

  // --- Relations ---
  const [relationSheetOpen, setRelationSheetOpen] = useState(false);
  const [relationSearch, setRelationSearch] = useState('');
  const [relationType, setRelationType] = useState('relates_to');
  const [selectedRelatedIssue, setSelectedRelatedIssue] = useState<{ id: string; name: string } | null>(null);

  const { data: relations = [] } = useQuery({
    queryKey: ['relations', slug, projectId, issueSeqId],
    queryFn: () => apiFetch<{ results: IssueRelation[] }>(`/workspaces/${slug}/projects/${projectId}/issues/${issueSeqId}/relations/`).then((d) => d.results).catch(() => []),
    enabled: !!slug && !!projectId && !!issueSeqId,
  });

  const relatedIssueIds = relations.map((r) => r.related_issue_id);
  const { data: relatedIssues = [] } = useQuery({
    queryKey: ['related-issues', slug, projectId, relatedIssueIds.join(',')],
    queryFn: async () => {
      if (relatedIssueIds.length === 0) return [];
      const all = await apiFetch<{ results: { id: string; name: string; sequence_id: number }[] }>(
        `/workspaces/${slug}/projects/${projectId}/issues/?limit=500`
      ).then((r) => (Array.isArray(r) ? r : r.results));
      return all.filter((i) => relatedIssueIds.includes(i.id));
    },
    enabled: !!slug && !!projectId && relatedIssueIds.length > 0,
  });
  const relatedIssueMap = new Map(relatedIssues.map((i) => [i.id, i]));

  const { data: relationSearchResults = [] } = useQuery({
    queryKey: ['issue-search-rel', slug, projectId, relationSearch],
    queryFn: () =>
      apiFetch<{ results: { id: string; name: string; sequence_id: number }[] }>(
        `/workspaces/${slug}/projects/${projectId}/issues/?search=${encodeURIComponent(relationSearch)}&limit=10`
      ).then((r) => (Array.isArray(r) ? r : r.results).filter((i) => String(i.sequence_id) !== String(issueSeqId))),
    enabled: !!slug && !!projectId && relationSearch.length >= 2,
  });

  const addRelationMutation = useMutation({
    mutationFn: ({ related_issue_id, relation_type }: { related_issue_id: string; relation_type: string }) =>
      apiFetch(`/workspaces/${slug}/projects/${projectId}/issues/${issueSeqId}/relations/`, {
        method: 'POST', body: JSON.stringify({ related_issue_id, relation_type }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['relations', slug, projectId, issueSeqId] });
      setSelectedRelatedIssue(null);
      setRelationSearch('');
      setRelationSheetOpen(false);
      toast.success('Relation added');
    },
    onError: () => toast.error('Failed to add relation'),
  });

  const deleteRelationMutation = useMutation({
    mutationFn: (relationId: string) =>
      apiFetch(`/workspaces/${slug}/projects/${projectId}/issues/${issueSeqId}/relations/${relationId}/`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['relations', slug, projectId, issueSeqId] });
      toast.success('Relation removed');
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
          <button
            onClick={() => setConfirmDeleteOpen(true)}
            className="flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:text-destructive"
            aria-label="Delete issue"
          >
            <Trash2 className="h-4 w-4" />
          </button>
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
        {issue.description_html ? (
          <div className="text-sm"><CommentContent html={issue.description_html} /></div>
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

        {/* Assignees */}
        <div className="flex items-center gap-2">
          <button
            className="flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs text-muted-foreground hover:bg-muted/50 transition-colors"
            onClick={() => setAssigneeSheetOpen(true)}
          >
            <User className="h-3 w-3" />
            {(issue.assignees ?? []).length === 0 ? (
              <span>Assignees</span>
            ) : (
              <span className="flex -space-x-1.5">
                {(issue.assignees ?? []).slice(0, 3).map((a) => (
                  <span
                    key={a.id}
                    className="h-5 w-5 rounded-full bg-muted border border-background flex items-center justify-center text-[9px] font-medium text-muted-foreground"
                  >
                    {(a.display_name || a.email || a.username || '?').charAt(0).toUpperCase()}
                  </span>
                ))}
                {(issue.assignees ?? []).length > 3 && (
                  <span className="h-5 w-5 rounded-full bg-muted border border-background flex items-center justify-center text-[9px] text-muted-foreground">
                    +{(issue.assignees ?? []).length - 3}
                  </span>
                )}
              </span>
            )}
          </button>
          {currentUser && !currentAssigneeIds.has(currentUser.id) && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={() => addAssigneeMutation.mutate(currentUser.id)}
              disabled={addAssigneeMutation.isPending}
            >
              <User className="h-3 w-3" /> Assign to me
            </Button>
          )}
          <Button
            variant={subscribed ? "secondary" : "outline"}
            size="sm"
            className="h-7 text-xs gap-1"
            onClick={() => (subscribed ? unfollowMutation.mutate() : followMutation.mutate())}
            disabled={followMutation.isPending || unfollowMutation.isPending}
          >
            <Bell className="h-3 w-3" />
            {subscribed ? "Following" : "Follow"}
            {followerCount > 0 && (
              <span className="text-muted-foreground text-[10px]">{followerCount}</span>
            )}
          </Button>
        </div>

        {/* Divider */}
        <div className="border-t" />

        {/* Relations */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
              <Link2 className="h-3 w-3" /> Relations ({relations.length})
            </h3>
            <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2" onClick={() => setRelationSheetOpen(true)}>
              <Plus className="h-3 w-3 mr-0.5" /> Add
            </Button>
          </div>
          {relations.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">No relations</p>
          ) : (
            <div className="space-y-1.5">
              {relations.map((rel) => {
                const relInfo = RELATION_TYPE_LABELS[rel.relation_type] || { label: rel.relation_type, color: 'bg-gray-100 text-gray-700' };
                const related = relatedIssueMap.get(rel.related_issue_id);
                return (
                  <div key={rel.id} className="flex items-center gap-2 p-2 rounded-lg bg-muted/30">
                    <Badge className={cn('text-[9px] shrink-0', relInfo.color)} variant="secondary">{relInfo.label}</Badge>
                    <span className="text-xs flex-1 truncate">
                      {related ? `#${related.sequence_id} ${related.name}` : '...'}
                    </span>
                    <Button variant="ghost" size="icon" className="h-5 w-5 shrink-0 text-muted-foreground" onClick={() => deleteRelationMutation.mutate(rel.id)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="border-t" />

        {/* Comments */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
              <MessageSquare className="h-3 w-3" /> Comments ({comments.length})
            </h3>
            <button
              className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground rounded px-1 py-0.5"
              onClick={() => setCommentSort(commentSort === 'newest' ? 'oldest' : 'newest')}
            >
              {commentSort === 'newest' ? 'Newest first' : 'Earliest first'}
            </button>
          </div>

          {sortedComments.map((c) => {
            const isMine = c.actor_id === currentUser?.id;
            return (
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
                  {isMine && editingCommentId !== c.id && (
                    <button
                      className="ml-auto p-1 rounded text-muted-foreground hover:text-foreground"
                      onClick={() => startEditComment(c)}
                      aria-label="Edit comment"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                  )}
                </div>
                {editingCommentId === c.id ? (
                  <div className="mt-1.5 space-y-2">
                    <CommentEditor
                      value={editCommentText}
                      onChange={setEditCommentText}
                      placeholder="Edit comment..."
                      resetKey={editingCommentId}
                      members={mentionMembers}
                    />
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        className="h-8"
                        disabled={!editCommentText.replace(/<[^>]*>/g, '').trim() || editCommentMutation.isPending}
                        onClick={() => editCommentMutation.mutate({ commentId: c.id, comment_html: editCommentText })}
                      >
                        {editCommentMutation.isPending ? 'Saving...' : 'Save'}
                      </Button>
                      <Button size="sm" variant="ghost" className="h-8" onClick={() => { setEditingCommentId(null); setEditCommentText(''); }}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-0.5"><CommentContent html={c.comment_html} /></div>
                )}
              </div>
            </div>
            );
          })}
        </div>
      </div>

      {/* Floating comment bar */}
      <div className="shrink-0 border-t bg-background p-3 safe-area-bottom">
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <CommentEditor
              value={commentText}
              onChange={setCommentText}
              placeholder="Add a comment..."
              onSubmit={() => {
                if (commentText.replace(/<[^>]*>/g, '').trim() && !commentMutation.isPending) {
                  commentMutation.mutate(commentText);
                }
              }}
              members={mentionMembers}
            />
          </div>
          <Button
            size="sm"
            className="h-9 shrink-0"
            disabled={!commentText.replace(/<[^>]*>/g, '').trim() || commentMutation.isPending}
            onClick={() => commentMutation.mutate(commentText)}
          >
            {commentMutation.isPending ? '...' : 'Send'}
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
                hapticMedium();
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
                hapticMedium();
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

      {/* Assignee sheet */}
      <BottomSheet open={assigneeSheetOpen} onClose={() => setAssigneeSheetOpen(false)} title="Assignees">
        <div className="space-y-1">
          {members.map((m) => {
            const isAssigned = currentAssigneeIds.has(m.memberId);
            return (
              <button
                key={m.memberId}
                className={cn(
                  'w-full text-left p-3 rounded-lg text-sm flex items-center gap-2 transition-colors',
                  isAssigned ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-muted/50'
                )}
                onClick={() => {
                  hapticMedium();
                  toggleAssignee(m.memberId);
                }}
              >
                <span className="h-6 w-6 rounded-full bg-muted flex items-center justify-center text-[10px] font-medium shrink-0">
                  {(m.displayName || m.username || m.email || '?').charAt(0).toUpperCase()}
                </span>
                <span className="flex-1 truncate">{m.displayName || m.username || m.email}</span>
                {isAssigned && <span className="text-xs ml-auto">Assigned</span>}
              </button>
            );
          })}
          {currentUser && !currentAssigneeIds.has(currentUser.id) && (
            <Button
              variant="outline"
              size="sm"
              className="w-full h-8 text-xs gap-1"
              onClick={() => { hapticMedium(); addAssigneeMutation.mutate(currentUser.id); }}
              disabled={addAssigneeMutation.isPending}
            >
              <User className="h-3 w-3" /> Assign to me
            </Button>
          )}
        </div>
      </BottomSheet>

      {/* Add Relation sheet */}
      <BottomSheet open={relationSheetOpen} onClose={() => { setRelationSheetOpen(false); setSelectedRelatedIssue(null); setRelationSearch(''); }} title="Add Relation">
        <div className="space-y-3">
          {!selectedRelatedIssue ? (
            <>
              <input
                type="text"
                placeholder="Search issues..."
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={relationSearch}
                onChange={(e) => setRelationSearch(e.target.value)}
                autoFocus
              />
              {relationSearch.length >= 2 && (
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {relationSearchResults.map((i) => (
                    <button
                      key={i.id}
                      className="w-full text-left p-2 rounded-lg text-sm hover:bg-muted/50"
                      onClick={() => { setSelectedRelatedIssue({ id: i.id, name: i.name }); setRelationSearch(''); }}
                    >
                      <span className="text-muted-foreground font-mono text-xs">#{i.sequence_id}</span> {i.name}
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/50">
                <span className="text-sm flex-1 truncate">{selectedRelatedIssue.name}</span>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setSelectedRelatedIssue(null)}>
                  <X className="h-3 w-3" />
                </Button>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Relation Type</label>
                <div className="grid grid-cols-2 gap-1.5">
                  {Object.entries(RELATION_TYPE_LABELS).map(([key, { label, color }]) => (
                    <button
                      key={key}
                      className={cn('p-2 rounded-lg text-xs text-center transition-colors', color, relationType === key && 'ring-2 ring-primary')}
                      onClick={() => setRelationType(key)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <Button
                className="w-full"
                disabled={addRelationMutation.isPending}
                onClick={() => addRelationMutation.mutate({ related_issue_id: selectedRelatedIssue.id, relation_type: relationType })}
              >
                {addRelationMutation.isPending ? 'Adding...' : 'Add Relation'}
              </Button>
            </>
          )}
        </div>
      </BottomSheet>

      <Dialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete issue?</DialogTitle>
            <DialogDescription>
              This will permanently delete{" "}
              {issue.project_detail?.identifier || 'PROJ'}-{String(issue.sequence_id).padStart(4, '0')}{" "}
              "{issue.name}" and all of its data. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDeleteOpen(false)} disabled={deleteIssueMutation.isPending}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => deleteIssueMutation.mutate()} disabled={deleteIssueMutation.isPending}>
              {deleteIssueMutation.isPending ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
