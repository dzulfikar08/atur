import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, type PaneListItem } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw, Code2 } from "@/lib/icons";

/** agent_status → badge variant. Unknown statuses stay muted (outline). */
function statusVariant(status: string | null) {
  switch (status) {
    case "running":
    case "working":
    case "active":
      return "default" as const;
    case "idle":
      return "secondary" as const;
    case "exited":
    case "dead":
    case "error":
      return "destructive" as const;
    default:
      return "outline" as const;
  }
}

function PaneCard({ pane }: { pane: PaneListItem }) {
  return (
    <Link
      to={`/panes/${encodeURIComponent(pane.pane_id)}`}
      className="block rounded-lg border bg-card p-4 transition-colors hover:bg-accent/50"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{pane.title ?? pane.pane_id}</p>
          <p className="mt-1 truncate text-xs text-muted-foreground">{pane.cwd ?? "—"}</p>
        </div>
        <Code2 className="h-4 w-4 shrink-0 text-muted-foreground" />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <Badge variant="outline">{pane.workspace_label}</Badge>
        {pane.agent && <Badge variant="outline">{pane.agent}</Badge>}
        {pane.agent_status && (
          <Badge variant={statusVariant(pane.agent_status)}>{pane.agent_status}</Badge>
        )}
        <span className="ml-auto font-mono text-xs text-muted-foreground">{pane.pane_id}</span>
      </div>
    </Link>
  );
}

export default function PanesPage() {
  const panesQuery = useQuery({
    queryKey: ["panes"],
    queryFn: api.listPanes,
    refetchInterval: 10_000,
  });
  const panes = panesQuery.data?.panes ?? [];

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between border-b pb-4">
        <h1 className="text-lg font-semibold">Panes</h1>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => panesQuery.refetch()}
          disabled={panesQuery.isFetching}
        >
          <RefreshCw className={`h-4 w-4 ${panesQuery.isFetching ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto pt-4">
        {panesQuery.isLoading ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="h-28 animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
        ) : panesQuery.isError ? (
          <div className="flex h-64 flex-col items-center justify-center gap-3 rounded-lg border border-dashed">
            <Code2 className="h-8 w-8 text-muted-foreground" />
            <p className="font-medium">Execution plane unreachable</p>
            <p className="max-w-sm text-center text-sm text-muted-foreground">
              Couldn&apos;t reach the local herdr bridge. Make sure the bridge daemon is running,
              then try again.
            </p>
            <Button variant="outline" size="sm" onClick={() => panesQuery.refetch()}>
              Retry
            </Button>
          </div>
        ) : panes.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center gap-2 rounded-lg border border-dashed">
            <Code2 className="h-8 w-8 text-muted-foreground" />
            <p className="font-medium">No panes online</p>
            <p className="text-sm text-muted-foreground">
              Panes appear here once the herdr execution plane has open terminals.
            </p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {panes.map((pane) => (
              <PaneCard key={pane.pane_id} pane={pane} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
