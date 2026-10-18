import { useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { portalApi } from "@/lib/portalApi";
import { usePortalAuthStore } from "@/stores/portalAuth";
import { FeedbackBoardView } from "@/pages/feedback/FeedbackPortalPage";

// Ideas tab: the workspace's public feedback boards. ?board=<token> picks one
// (old /feedback/:token links land here), ?item=<id> opens an idea.
export default function PortalIdeasPage() {
  const { slug } = useParams();
  const [search, setSearch] = useSearchParams();
  const customer = usePortalAuthStore((s) => s.customer);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["portal-overview", slug],
    queryFn: () => portalApi.getOverview(slug!),
    enabled: !!slug,
    retry: false,
  });

  if (isLoading) return <div className="animate-pulse text-sm text-muted-foreground">Loading…</div>;
  if (isError || !data) {
    return <p className="text-sm text-muted-foreground">This portal could not be found.</p>;
  }
  if (data.boards.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          No idea boards are open yet.
        </CardContent>
      </Card>
    );
  }

  const wanted = search.get("board");
  const board = data.boards.find((b) => b.token === wanted) ?? data.boards[0];
  if (!board) return null;

  return (
    <div className="space-y-4">
      {data.boards.length > 1 && (
        <div role="tablist" aria-label="Boards" className="flex flex-wrap gap-2">
          {data.boards.map((b) => (
            <button
              key={b.token}
              role="tab"
              aria-selected={b.token === board.token}
              onClick={() => setSearch({ board: b.token }, { replace: true })}
              className={
                b.token === board.token
                  ? "rounded-full border px-3 py-1 text-xs font-medium text-white"
                  : "rounded-full border border-border bg-background px-3 py-1 text-xs text-muted-foreground hover:text-foreground"
              }
              style={
                b.token === board.token
                  ? { background: b.brand_color, borderColor: b.brand_color }
                  : undefined
              }
            >
              {b.title}
            </button>
          ))}
        </div>
      )}
      <FeedbackBoardView
        key={board.token}
        token={board.token}
        initialItemId={search.get("item")}
        defaultEmail={customer?.email ?? ""}
      />
    </div>
  );
}
