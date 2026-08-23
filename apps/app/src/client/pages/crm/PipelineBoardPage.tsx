import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type Deal, type DealCurrencyTotal, type State } from "@/lib/api";
import { formatCurrencyTotals, isOpenGroup, money } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
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
  return (
    <Card
      ref={setNodeRef}
      style={style}
      className="cursor-grab active:cursor-grabbing hover:shadow-md select-none"
      {...listeners}
      {...attributes}
      onClick={onClick}
    >
      <CardContent className="p-3">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-medium truncate">{deal.name}</p>
          {openStage && isStale(deal) && (
            <span
              title="No updates in 14+ days"
              className="mt-1 h-2 w-2 shrink-0 rounded-full bg-amber-500"
            />
          )}
        </div>
        {deal.customer_name && (
          <p className="text-xs text-muted-foreground mt-0.5 truncate">{deal.customer_name}</p>
        )}
        <div className="flex items-center justify-between mt-1.5">
          <p className="text-xs font-medium">{money(deal.amount_cents, deal.currency)}</p>
          {deal.expected_close_at && (
            <span
              className={cn(
                "text-[11px] px-1.5 py-0.5 rounded",
                overdue ? "text-destructive bg-destructive/10" : "text-muted-foreground",
              )}
            >
              {closeDateLabel(deal.expected_close_at)}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
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
      <div className="flex items-center justify-between mb-3">
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
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: state.color || "#6b7280" }}
          />
          <span className="text-sm font-medium">{state.name}</span>
          <span className="text-xs text-muted-foreground">{deals.length}</span>
        </button>
        <span
          className="text-xs text-muted-foreground"
          title={totals.map((t) => `${t.currency}: ${t.count}`).join(", ")}
        >
          {formatCurrencyTotals(totals)}
        </span>
      </div>
      {!collapsed && (
        <div className="space-y-2 min-h-[60px]">
          {deals.map((d) => (
            <DealCard key={d.id} deal={d} openStage={!terminal} onClick={() => onDealClick(d)} />
          ))}
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <Card className="flex-1 min-w-[150px]">
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        {value === "" ? (
          <Skeleton className="h-6 w-24 mt-1" />
        ) : (
          <p
            className={cn(
              "text-lg font-semibold tracking-tight truncate",
              danger && value !== "0" && "text-destructive",
            )}
          >
            {value}
          </p>
        )}
      </CardContent>
    </Card>
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
      <div className="px-4 py-3 border-b">
        <div className="flex items-center justify-between gap-3 mb-3">
          <h1 className="text-lg font-semibold">Pipeline</h1>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> New Deal
          </Button>
        </div>
        <div className="flex flex-wrap gap-3">
          <Metric label="Open value" value={totals ? formatCurrencyTotals(totals.open) : ""} />
          <Metric
            label="Won this month"
            value={totals ? formatCurrencyTotals(totals.won_this_month) : ""}
          />
          <Metric label="Active deals" value={totals ? String(openCount) : ""} />
          <Metric label="Overdue" value={totals ? String(overdueCount) : ""} danger />
        </div>
      </div>

      {states.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">
          This project has no states yet. Add stages (e.g. Lead, Qualified, Won) to use it as a
          pipeline.
        </p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={handleDragEnd}>
          <div className="flex gap-4 p-4 overflow-x-auto flex-1">
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
