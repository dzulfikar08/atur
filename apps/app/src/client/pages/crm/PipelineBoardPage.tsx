import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type Deal, type DealCurrencyTotal, type State } from "@/lib/api";
import { formatCurrencyTotals, isOpenGroup, money } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Plus, ChevronDown, ChevronRight } from "@/lib/icons";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
  useDraggable,
  useDroppable,
  type DragEndEvent,
} from "@dnd-kit/core";
import { DealFormDialog } from "./DealFormDialog";

// A deal with no issue activity for 14+ days gets the amber "stale" dot.
const STALE_MS = 14 * 24 * 60 * 60 * 1000;

function isOverdue(deal: Deal) {
  if (!deal.expected_close_at) return false;
  return new Date(deal.expected_close_at).getTime() < Date.now();
}

function isStale(deal: Deal) {
  if (!deal.issue_updated_at) return false;
  return Date.now() - new Date(deal.issue_updated_at).getTime() > STALE_MS;
}

function closeDateLabel(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function DealCard({
  deal,
  openStage,
  onClick,
}: {
  deal: Deal;
  openStage: boolean;
  onClick: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: deal.issue_id,
  });
  const style: React.CSSProperties = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    opacity: isDragging ? 0.4 : 1,
  };
  const overdue = openStage && isOverdue(deal);
  // Company is the joined customer; fall back to the deal title itself.
  const company = deal.customer_name ?? deal.name;
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex cursor-grab select-none flex-col gap-2 rounded-xl border border-border/80 bg-[var(--surface-elevated)] px-[15px] py-[14px] transition-colors hover:border-border active:cursor-grabbing"
      {...listeners}
      {...attributes}
      onClick={onClick}
    >
      <div className="flex items-center gap-2">
        <span className="truncate text-sm font-bold text-foreground">{company}</span>
        {openStage && isStale(deal) && (
          <span
            title="No updates in 14+ days"
            className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--state-amber)]"
          />
        )}
        <span className="flex-1" />
        <span className="shrink-0 font-ops-mono text-[12px] font-bold text-[var(--state-green)]">
          {money(deal.amount_cents, deal.currency)}
        </span>
      </div>
      {deal.customer_name && deal.customer_name !== deal.name && (
        <p className="truncate text-[12.5px] text-muted-foreground">{deal.name}</p>
      )}
      {deal.expected_close_at && (
        <span
          className={cn(
            "w-fit rounded-md px-[9px] py-1 font-ops-mono text-[10.5px]",
            overdue
              ? "bg-destructive/10 text-destructive"
              : "bg-[var(--surface-card-hover)] text-muted-foreground",
          )}
        >
          close {closeDateLabel(deal.expected_close_at)}
        </span>
      )}
    </div>
  );
}

function Column({
  state,
  deals,
  totals,
  terminal,
  collapsed,
  onToggle,
  onDealClick,
}: {
  state: State;
  deals: Deal[];
  totals: DealCurrencyTotal[];
  terminal: boolean;
  collapsed: boolean;
  onToggle: () => void;
  onDealClick: (deal: Deal) => void;
}) {
  // Droppable stays active even when collapsed: dragging out of Won/Lost
  // reopens the deal, dragging in closes it.
  const { setNodeRef, isOver } = useDroppable({ id: state.id });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "min-w-[260px] w-[260px] flex-shrink-0 rounded-lg p-3 transition-colors",
        isOver ? "bg-muted/40 ring-2 ring-primary/20" : "",
        terminal ? "opacity-70" : "",
      )}
    >
      <div className="flex items-center justify-between mb-2.5">
        <button
          className="flex items-center gap-2 text-left"
          onClick={onToggle}
          disabled={!terminal}
        >
          {terminal &&
            (collapsed ? (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            ))}
          <span
            className="h-[9px] w-[9px] rounded-full"
            style={{ backgroundColor: state.color || "var(--muted-foreground)" }}
          />
          <span className="font-ops-mono text-[11.5px] font-bold uppercase tracking-[1px] text-muted-foreground">
            {state.name}
          </span>
          <span className="font-ops-mono text-[11px] text-muted-foreground/70">{deals.length}</span>
        </button>
        <span
          className="font-ops-mono text-[11px] text-muted-foreground"
          title={totals.map((t) => `${t.currency}: ${t.count}`).join(", ")}
        >
          {formatCurrencyTotals(totals)}
        </span>
      </div>
      {!collapsed && (
        <div className="space-y-2.5 min-h-[60px]">
          {deals.map((d) => (
            <DealCard key={d.id} deal={d} openStage={!terminal} onClick={() => onDealClick(d)} />
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "green" | "danger" }) {
  return (
    <span className="flex items-center gap-[7px]">
      <span className="font-ops-mono text-[11px] text-muted-foreground">{label}</span>
      <span
        className={cn(
          "truncate font-ops-mono text-[12.5px] font-bold",
          tone === "green" && "text-[var(--state-green)]",
          tone === "danger" && "text-destructive",
        )}
      >
        {value}
      </span>
    </span>
  );
}

export default function PipelineBoardPage() {
  const { slug, projectId } = useParams();
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Deal | null>(null);
  // Terminal (Won/Lost) columns start collapsed; expansion persists for the session.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const { data: deals = [], isLoading } = useQuery({
    queryKey: ["deals", slug, projectId],
    queryFn: () => api.listDeals(slug!, projectId!),
    enabled: !!slug && !!projectId,
  });
  const { data: states = [] } = useQuery({
    queryKey: ["states", slug, projectId],
    queryFn: () => api.listStates(slug!, projectId!),
    enabled: !!slug && !!projectId,
  });
  const { data: stats } = useQuery({
    queryKey: ["deal-stats", slug, projectId],
    queryFn: () => api.listDealStats(slug!, projectId!),
    enabled: !!slug && !!projectId,
  });
  const { data: contacts = [] } = useQuery({
    queryKey: ["contacts-all", slug],
    queryFn: () => api.listContacts(slug!),
    enabled: !!slug,
  });

  // Terminal columns render last, dimmed + collapsed by default.
  const { openStates, terminalStates } = useMemo(
    () => ({
      openStates: states.filter((s) => isOpenGroup(s.group)),
      terminalStates: states.filter((s) => !isOpenGroup(s.group)),
    }),
    [states],
  );

  const stageTotals = useMemo(() => {
    const m = new Map<string, DealCurrencyTotal[]>();
    for (const row of stats?.by_stage ?? []) {
      const key = row.state_id ?? "__none";
      const list = m.get(key) ?? [];
      list.push({ currency: row.currency, total_cents: row.total_cents, count: row.count });
      m.set(key, list);
    }
    return m;
  }, [stats]);

  const grouped = useMemo(() => {
    const g: Record<string, Deal[]> = {};
    for (const s of states) g[s.id] = [];
    for (const d of deals) {
      const sid = d.state_id || "__none";
      if (!g[sid]) g[sid] = [];
      g[sid].push(d);
    }
    return g;
  }, [deals, states]);

  const moveMut = useMutation({
    mutationFn: ({ issueId, stateId }: { issueId: string; stateId: string }) =>
      api.moveDealStage(slug!, projectId!, issueId, stateId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["deals", slug, projectId] });
      qc.invalidateQueries({ queryKey: ["deal-stats", slug, projectId] });
      toast.success("Deal moved");
    },
    onError: () => {
      toast.error("Failed to move deal");
      qc.invalidateQueries({ queryKey: ["deals", slug, projectId] });
    },
  });

  const handleDragEnd = (e: DragEndEvent) => {
    const issueId = e.active.id as string;
    const target = e.over?.id as string | undefined;
    if (!target) return;
    const deal = deals.find((d) => d.issue_id === issueId);
    if (!deal || deal.state_id === target) return;
    moveMut.mutate({ issueId, stateId: target });
  };

  const totals = stats?.totals;
  const openCount = (totals?.open ?? []).reduce((n, t) => n + t.count, 0);
  const overdueCount = deals.filter((d) => isOpenGroup(d.state_group) && isOverdue(d)).length;

  if (isLoading) return <p className="text-muted-foreground">Loading pipeline…</p>;

  return (
    <div className="flex flex-col h-full -m-4 md:-m-6 lg:-m-8">
      <div className="flex shrink-0 flex-wrap items-center gap-4 border-b px-4 py-3 md:px-6 md:py-[13px]">
        <h1 className="text-[15px] font-bold">Pipeline</h1>
        <div className="flex flex-wrap items-center gap-[18px]">
          <Stat label="open value" value={totals ? formatCurrencyTotals(totals.open) : "—"} />
          <Stat
            label="won this month"
            value={totals ? formatCurrencyTotals(totals.won_this_month) : "—"}
            tone="green"
          />
          <Stat label="active deals" value={totals ? String(openCount) : "—"} />
          <Stat
            label="overdue"
            value={totals ? String(overdueCount) : "—"}
            tone={overdueCount > 0 ? "danger" : undefined}
          />
        </div>
        <span className="flex-1" />
        <Button
          size="sm"
          onClick={() => setCreateOpen(true)}
          className="gap-[7px] rounded-[9px] bg-foreground px-3.5 font-bold text-background hover:bg-foreground/90"
        >
          <Plus className="h-3.5 w-3.5" /> New deal
        </Button>
      </div>

      {states.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">
          This project has no states yet. Add stages (e.g. Lead, Qualified, Won) to use it as a
          pipeline.
        </p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={handleDragEnd}>
          <div className="flex gap-3.5 px-4 py-4 overflow-x-auto flex-1 md:px-6 md:py-[18px]">
            {openStates.map((s) => (
              <Column
                key={s.id}
                state={s}
                deals={grouped[s.id] ?? []}
                totals={stageTotals.get(s.id) ?? []}
                terminal={false}
                collapsed={false}
                onToggle={() => {}}
                onDealClick={setEditing}
              />
            ))}
            {terminalStates.map((s) => (
              <Column
                key={s.id}
                state={s}
                deals={grouped[s.id] ?? []}
                totals={stageTotals.get(s.id) ?? []}
                terminal
                collapsed={!expanded[s.id]}
                onToggle={() => setExpanded((e) => ({ ...e, [s.id]: !e[s.id] }))}
                onDealClick={setEditing}
              />
            ))}
          </div>
        </DndContext>
      )}

      <DealFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        mode="create"
        slug={slug!}
        projectId={projectId!}
        contacts={contacts}
      />
      <DealFormDialog
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(null)}
        mode="edit"
        slug={slug!}
        projectId={projectId!}
        deal={editing}
        contacts={contacts}
      />
    </div>
  );
}
