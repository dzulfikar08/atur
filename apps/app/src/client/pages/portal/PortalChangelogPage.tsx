import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { portalApi, type ChangelogEntry } from "@/lib/portalApi";

function monthKey(iso: string | null): string {
  if (!iso) return "Earlier";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Earlier";
  return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function fmtDay(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// Changelog tab: ideas that were completed on the workspace's boards, newest first.
export default function PortalChangelogPage() {
  const { slug } = useParams();
  const { data, isLoading } = useQuery({
    queryKey: ["portal-changelog", slug],
    queryFn: () => portalApi.getChangelog(slug!),
    enabled: !!slug,
  });

  if (isLoading) return <div className="animate-pulse text-sm text-muted-foreground">Loading…</div>;
  const entries = data ?? [];
  if (entries.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          Nothing shipped yet. Completed ideas will show up here.
        </CardContent>
      </Card>
    );
  }

  const groups = new Map<string, ChangelogEntry[]>();
  for (const e of entries) {
    const key = monthKey(e.completed_at);
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }

  return (
    <div className="space-y-6">
      {[...groups.entries()].map(([month, items]) => (
        <section key={month} aria-label={month}>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {month}
          </h2>
          <ul className="space-y-2">
            {items.map((e) => (
              <li key={e.id}>
                <Card>
                  <CardContent className="py-3">
                    <div className="flex items-start justify-between gap-3">
                      <p className="font-medium">{e.name}</p>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {fmtDay(e.completed_at)}
                      </span>
                    </div>
                    {e.description && (
                      <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-sm text-muted-foreground">
                        {e.description}
                      </p>
                    )}
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      {e.votes} {e.votes === 1 ? "vote" : "votes"}
                      {e.board_title ? ` · ${e.board_title}` : ""}
                    </p>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
