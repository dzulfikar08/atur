import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, type PaneListItem } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { RefreshCw, Code2 } from "@/lib/icons";
import { cn } from "@/lib/utils";

// Agent statuses that count as an attached, working session.
const LIVE_STATUS: Record<string, true> = { running: true, working: true, active: true };

function PaneCard({ pane }: { pane: PaneListItem }) {
  const live = pane.agent_status !== null && pane.agent_status in LIVE_STATUS;
  const context = [pane.workspace_label, pane.cwd].filter(Boolean).join(" · ");
  return (
    <Link
      to={`/panes/${encodeURIComponent(pane.pane_id)}`}
      className="group flex flex-col overflow-hidden rounded-xl border border-border/80 bg-[var(--surface-elevated)] transition-colors hover:border-border hover:bg-[var(--surface-card-hover)]/60"
    >
      <div className="flex items-center gap-2 border-b border-border/80 bg-[var(--surface-card)] px-[13px] py-[9px]">
        <span
          className={cn(
            "h-[7px] w-[7px] shrink-0 rounded-full",
            live ? "bg-[var(--state-green)]" : "bg-muted-foreground/50",
          )}
        />
        <span className="truncate font-ops-mono text-[11.5px] font-bold text-foreground">
          {pane.pane_id}
        </span>
        {context && (
          <span className="hidden min-w-0 truncate font-ops-mono text-[11px] text-muted-foreground sm:block">
            {context}
          </span>
        )}
        <span
          className={cn(
            "ml-auto shrink-0 font-ops-mono text-[10.5px] font-semibold",
            live ? "text-[var(--state-green)]" : "text-muted-foreground",
          )}
        >
          {live ? "live" : (pane.agent_status ?? "idle")}
        </span>
      </div>
      <div className="flex min-h-[84px] flex-1 flex-col gap-[5px] px-[15px] py-[13px]">
        <p className="truncate font-ops-mono text-[11.5px] leading-[17px] text-foreground">
          <span className="text-[var(--state-green)]">❯</span>{" "}
          {pane.title ?? (pane.agent ? `${pane.agent} session` : "shell")}
        </p>
        <p className="truncate font-ops-mono text-[11.5px] leading-[17px] text-muted-foreground">
          └─ open pane for live output
        </p>
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
    <div className="-m-4 flex h-full flex-col md:-m-6 lg:-m-8">
      {/* TopBar */}
      <div className="flex shrink-0 items-center gap-3.5 border-b px-4 py-3 md:px-6 md:py-[13px]">
        <h1 className="text-[15px] font-bold">Live panes</h1>
        <span className="ops-chip ops-chip-green">
          <span className="ops-dot" />
          {panes.filter((p) => p.agent_status !== null && p.agent_status in LIVE_STATUS).length}{" "}
          attached
        </span>
        <span className="flex-1" />
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => panesQuery.refetch()}
          disabled={panesQuery.isFetching}
        >
          <RefreshCw className={cn("h-4 w-4", panesQuery.isFetching && "animate-spin")} />
        </Button>
      </div>

      {/* Pane grid: 2 columns on desktop, 1 on mobile */}
      <div className="flex-1 overflow-auto p-4 md:px-6 md:py-[18px]">
        {panesQuery.isLoading ? (
          <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="h-36 animate-pulse rounded-xl bg-muted" />
            ))}
          </div>
        ) : panesQuery.isError ? (
          <div className="flex h-64 flex-col items-center justify-center gap-3 rounded-xl border border-dashed bg-[var(--surface-elevated)]">
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
          <div className="flex h-64 flex-col items-center justify-center gap-2 rounded-xl border border-dashed bg-[var(--surface-elevated)]">
            <Code2 className="h-8 w-8 text-muted-foreground" />
            <p className="font-medium">No panes online</p>
            <p className="text-sm text-muted-foreground">
              Panes appear here once the herdr execution plane has open terminals.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
            {panes.map((pane) => (
              <PaneCard key={pane.pane_id} pane={pane} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
