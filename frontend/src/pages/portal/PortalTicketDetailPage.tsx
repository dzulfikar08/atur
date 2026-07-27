import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, MessageSquare } from '@/lib/icons';
import { toast } from 'sonner';
import { ApiError, portalApi } from '@/lib/portalApi';
import CommentContent from '@/components/editor/CommentContent';

function fmtDateTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const PRIORITY_COLOR: Record<string, string> = {
  urgent: '#ef4444',
  high: '#f97316',
  medium: '#f59e0b',
  low: '#3b82f6',
  none: '#6b7280',
};

export default function PortalTicketDetailPage() {
  const { slug, seqId } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const seq = Number(seqId);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['portal-ticket', slug, seq],
    queryFn: () => portalApi.getTicket(slug!, seq),
    enabled: !!slug && !!seqId,
  });

  const sendReply = async () => {
    if (!slug || !reply.trim()) return;
    setSending(true);
    try {
      await portalApi.addComment(slug, seq, reply.trim());
      setReply('');
      qc.invalidateQueries({ queryKey: ['portal-ticket', slug, seq] });
      toast.success('Reply sent');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to send reply');
    } finally {
      setSending(false);
    }
  };

  if (isLoading) {
    return <div className="animate-pulse text-sm text-muted-foreground">Loading…</div>;
  }

  if (!data) {
    return <div className="text-sm text-muted-foreground">Ticket not found.</div>;
  }

  const { ticket, issue, assignees, comments } = data;
  const thread = [...comments].reverse(); // backend returns newest-first

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={() => navigate(`/portal/${slug}`)}>
        <ArrowLeft className="mr-1 h-4 w-4" />
        All tickets
      </Button>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground">#{ticket.sequence_id}</span>
          <h1 className="text-xl font-bold">{issue.name}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {ticket.state_name && (
            <Badge
              variant="outline"
              style={
                ticket.state_color
                  ? { borderColor: ticket.state_color, color: ticket.state_color }
                  : undefined
              }
            >
              {ticket.state_name}
            </Badge>
          )}
          <Badge variant="outline" style={{ color: PRIORITY_COLOR[ticket.priority ?? 'none'] }}>
            {ticket.priority ?? 'none'} priority
          </Badge>
          {assignees.length > 0 && (
            <span className="text-muted-foreground">
              Assigned to {assignees.map((a) => a.display_name || a.email).join(', ')}
            </span>
          )}
        </div>
      </div>

      {issue.description_html && (
        <Card>
          <CardContent className="pt-4">
            <CommentContent html={issue.description_html} />
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
          <MessageSquare className="h-4 w-4" />
          Conversation ({thread.length})
        </h2>

        {thread.length === 0 ? (
          <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            No replies yet. Use the box below to add details.
          </p>
        ) : (
          <div className="space-y-3">
            {thread.map((c) => (
              <div
                key={c.id}
                className={`rounded-lg border p-3 ${
                  c.is_customer ? 'border-primary/30 bg-primary/5' : 'border-border bg-background'
                }`}
              >
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs font-medium">
                    {c.actor_name || c.actor_email || 'Unknown'}
                    {c.is_customer ? ' (you)' : ' (support)'}
                  </span>
                  <span className="text-xs text-muted-foreground">{fmtDateTime(c.created_at)}</span>
                </div>
                <CommentContent html={c.comment_html || ''} />
              </div>
            ))}
          </div>
        )}

        <Card>
          <CardContent className="space-y-2 pt-4">
            <Textarea
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder="Write a reply…"
              rows={4}
            />
            <div className="flex justify-end">
              <Button onClick={sendReply} disabled={!reply.trim() || sending}>
                {sending ? 'Sending…' : 'Send reply'}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
