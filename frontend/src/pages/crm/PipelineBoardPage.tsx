import { useState, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type Deal, type State } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Plus } from '@/lib/icons';
import { toast } from 'sonner';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
  useDraggable,
  useDroppable,
  type DragEndEvent,
} from '@dnd-kit/core';

function money(cents: number, currency = 'USD') {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
  } catch {
    return `${cents}`;
  }
}

function DealCard({ deal }: { deal: Deal }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: deal.issue_id });
  const style: React.CSSProperties = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    opacity: isDragging ? 0.4 : 1,
  };
  return (
    <Card
      ref={setNodeRef}
      style={style}
      className="cursor-grab active:cursor-grabbing hover:shadow-md select-none"
      {...listeners}
      {...attributes}
    >
      <CardContent className="p-3">
        <p className="text-sm font-medium truncate">{deal.name}</p>
        <p className="text-xs text-muted-foreground mt-1">{money(deal.amount_cents, deal.currency)}</p>
      </CardContent>
    </Card>
  );
}

function Column({ state, deals, total }: { state: State; deals: Deal[]; total: number }) {
  const { setNodeRef, isOver } = useDroppable({ id: state.id });
  return (
    <div
      ref={setNodeRef}
      className={`min-w-[260px] w-[260px] flex-shrink-0 rounded-lg p-3 transition-colors ${
        isOver ? 'bg-muted/40 ring-2 ring-primary/20' : ''
      }`}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: state.color || '#6b7280' }} />
          <span className="text-sm font-medium">{state.name}</span>
          <span className="text-xs text-muted-foreground">{deals.length}</span>
        </div>
        <span className="text-xs text-muted-foreground">{money(total)}</span>
      </div>
      <div className="space-y-2 min-h-[60px]">
        {deals.map((d) => (
          <DealCard key={d.id} deal={d} />
        ))}
      </div>
    </div>
  );
}

const EMPTY = { name: '', amount: '', currency: 'USD', customer_id: '', expected_close_at: '' };

export default function PipelineBoardPage() {
  const { slug, projectId } = useParams();
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const { data: dealsData, isLoading } = useQuery({
    queryKey: ['deals', slug, projectId],
    queryFn: () => api.listDeals(slug!, projectId!),
    enabled: !!slug && !!projectId,
  });
  const { data: states = [] } = useQuery({
    queryKey: ['states', slug, projectId],
    queryFn: () => api.listStates(slug!, projectId!),
    enabled: !!slug && !!projectId,
  });
  const { data: stats = [] } = useQuery({
    queryKey: ['deal-stats', slug, projectId],
    queryFn: () => api.listDealStats(slug!, projectId!),
    enabled: !!slug && !!projectId,
  });
  const { data: contacts = [] } = useQuery({
    queryKey: ['contacts-all', slug],
    queryFn: async () => (await api.listContacts(slug!)).results,
    enabled: !!slug,
  });

  const deals = dealsData?.results ?? [];
  const statsMap = useMemo(() => new Map(stats.map((s) => [s.state_id, s.total_cents])), [stats]);

  const grouped = useMemo(() => {
    const g: Record<string, Deal[]> = {};
    for (const s of states) g[s.id] = [];
    for (const d of deals) {
      const sid = d.state_id || '__none';
      if (!g[sid]) g[sid] = [];
      g[sid].push(d);
    }
    return g;
  }, [deals, states]);

  const moveMut = useMutation({
    mutationFn: ({ issueId, stateId }: { issueId: string; stateId: string }) =>
      api.moveDealStage(slug!, projectId!, issueId, stateId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deals', slug, projectId] });
      qc.invalidateQueries({ queryKey: ['deal-stats', slug, projectId] });
      toast.success('Deal moved');
    },
    onError: () => {
      toast.error('Failed to move deal');
      qc.invalidateQueries({ queryKey: ['deals', slug, projectId] });
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

  const createMut = useMutation({
    mutationFn: () =>
      api.createDeal(slug!, projectId!, {
        name: form.name,
        amount_cents: form.amount ? Math.round(parseFloat(form.amount) * 100) : undefined,
        currency: form.currency || undefined,
        customer_id: form.customer_id || undefined,
        expected_close_at: form.expected_close_at || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deals', slug, projectId] });
      qc.invalidateQueries({ queryKey: ['deal-stats', slug, projectId] });
      setCreateOpen(false);
      setForm(EMPTY);
      toast.success('Deal created');
    },
    onError: () => toast.error('Failed to create deal'),
  });

  if (isLoading) return <p className="text-muted-foreground">Loading pipeline…</p>;

  return (
    <div className="flex flex-col h-full -m-4 md:-m-6 lg:-m-8">
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <h1 className="text-lg font-semibold">Pipeline</h1>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="h-4 w-4 mr-1" /> New Deal</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New deal</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium">Title</label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Acme — Pro plan" />
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="text-sm font-medium">Amount</label>
                  <Input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="0.00" />
                </div>
                <div>
                  <label className="text-sm font-medium">Currency</label>
                  <Input value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} className="w-24" />
                </div>
              </div>
              <div>
                <label className="text-sm font-medium">Customer</label>
                <select
                  value={form.customer_id}
                  onChange={(e) => setForm({ ...form, customer_id: e.target.value })}
                  className="w-full border rounded px-2 py-2 text-sm"
                >
                  <option value="">— None —</option>
                  {contacts.map((c) => (
                    <option key={c.id} value={c.id}>{c.name || c.email}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium">Expected close</label>
                <Input type="date" value={form.expected_close_at} onChange={(e) => setForm({ ...form, expected_close_at: e.target.value })} />
              </div>
              <Button className="w-full" disabled={!form.name || createMut.isPending} onClick={() => createMut.mutate()}>
                {createMut.isPending ? 'Creating…' : 'Create deal'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {states.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">
          This project has no states yet. Add states (e.g. Lead, Qualified, Won) to use it as a pipeline.
        </p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={handleDragEnd}>
          <div className="flex gap-4 p-4 overflow-x-auto flex-1">
            {states.map((s) => (
              <Column key={s.id} state={s} deals={grouped[s.id] ?? []} total={statsMap.get(s.id) ?? 0} />
            ))}
          </div>
        </DndContext>
      )}
    </div>
  );
}
