import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, MessageSquare } from "@/lib/icons";
import { portalApi } from "@/lib/portalApi";

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function StateBadge({ name, color }: { name: string | null; color: string | null }) {
  if (!name) return null;
  return (
    <Badge variant="outline" style={color ? { borderColor: color, color } : undefined}>
      {name}
    </Badge>
  );
}

// Support tab: everything the signed-in person filed — tickets (support portal,
// widget bug reports, questions) and ideas they posted on a board with the same
// verified email.
export default function PortalTicketsPage() {
  const { slug } = useParams();
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ["portal-mine", slug],
    queryFn: () => portalApi.getMine(slug!),
    enabled: !!slug,
  });
  const overviewQ = useQuery({
    queryKey: ["portal-overview", slug],
    queryFn: () => portalApi.getOverview(slug!),
    enabled: !!slug,
  });

  const tickets = data?.tickets ?? [];
  const ideas = data?.ideas ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Your requests</h1>
          <p className="text-sm text-muted-foreground">
            Tickets, bug reports and ideas you have sent us.
          </p>
        </div>
        {overviewQ.data?.support_enabled && (
          <Button onClick={() => navigate(`/portal/${slug}/tickets/new`)}>
            <Plus className="mr-1 h-4 w-4" />
            New ticket
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="animate-pulse text-sm text-muted-foreground">Loading…</div>
      ) : (
        <>
          <section className="space-y-2" aria-label="Tickets">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Tickets ({tickets.length})
            </h2>
            {tickets.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center gap-2 py-10 text-center">
                  <MessageSquare className="h-8 w-8 text-muted-foreground" />
                  <p className="text-sm font-medium">No tickets yet</p>
                  <p className="text-xs text-muted-foreground">
                    Need help? Report a problem and our team will get back to you.
                  </p>
                </CardContent>
              </Card>
            ) : (
              tickets.map((t) => (
                <button
                  key={t.id}
                  onClick={() =>
                    navigate(
                      `/portal/${slug}/tickets/${t.sequence_id}?project=${encodeURIComponent(t.project_id)}`,
                    )
                  }
                  className="block w-full text-left"
                >
                  <Card className="transition-colors hover:bg-accent">
                    <CardContent className="flex items-center justify-between gap-3 py-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs text-muted-foreground">
                            #{t.sequence_id}
                          </span>
                          <span className="truncate font-medium">{t.name}</span>
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          Updated {fmtDate(t.updated_at)}
                        </p>
                      </div>
                      <StateBadge name={t.state_name} color={t.state_color} />
                    </CardContent>
                  </Card>
                </button>
              ))
            )}
          </section>

          {ideas.length > 0 && (
            <section className="space-y-2" aria-label="Ideas">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Ideas ({ideas.length})
              </h2>
              {ideas.map((i) => (
                <button
                  key={i.id}
                  onClick={() =>
                    navigate(
                      i.board_token
                        ? `/portal/${slug}/ideas?board=${encodeURIComponent(i.board_token)}&item=${i.id}`
                        : `/portal/${slug}/ideas`,
                    )
                  }
                  className="block w-full text-left"
                >
                  <Card className="transition-colors hover:bg-accent">
                    <CardContent className="flex items-center justify-between gap-3 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{i.name}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {i.board_title ? `${i.board_title} · ` : ""}
                          {fmtDate(i.created_at)}
                        </p>
                      </div>
                      <StateBadge name={i.state_name} color={i.state_color} />
                    </CardContent>
                  </Card>
                </button>
              ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}
