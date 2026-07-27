import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Plus, MessageSquare } from '@/lib/icons';
import { portalApi } from '@/lib/portalApi';

function fmtDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function PortalTicketsPage() {
  const { slug } = useParams();
  const navigate = useNavigate();

  const { data: tickets = [], isLoading } = useQuery({
    queryKey: ['portal-tickets', slug],
    queryFn: () => (slug ? portalApi.listTickets(slug) : Promise.resolve([])),
    enabled: !!slug,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Your tickets</h1>
          <p className="text-sm text-muted-foreground">Track and reply to your support requests.</p>
        </div>
        <Button onClick={() => navigate(`/portal/${slug}/tickets/new`)}>
          <Plus className="mr-1 h-4 w-4" />
          New ticket
        </Button>
      </div>

      {isLoading ? (
        <div className="animate-pulse text-sm text-muted-foreground">Loading…</div>
      ) : tickets.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-2 py-12 text-center">
            <MessageSquare className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">No tickets yet</p>
            <p className="text-xs text-muted-foreground">
              Need help? Create a ticket and our team will get back to you.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {tickets.map((t) => (
            <button
              key={t.id}
              onClick={() => navigate(`/portal/${slug}/tickets/${t.sequence_id}`)}
              className="block w-full text-left"
            >
              <Card className="transition-colors hover:bg-accent">
                <CardContent className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-muted-foreground">#{t.sequence_id}</span>
                      <span className="truncate font-medium">{t.name}</span>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Updated {fmtDate(t.updated_at)}
                    </p>
                  </div>
                  {t.state_name && (
                    <Badge
                      variant="outline"
                      style={
                        t.state_color
                          ? { borderColor: t.state_color, color: t.state_color }
                          : undefined
                      }
                    >
                      {t.state_name}
                    </Badge>
                  )}
                </CardContent>
              </Card>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
