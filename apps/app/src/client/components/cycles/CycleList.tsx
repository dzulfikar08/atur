import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { format, parseISO, compareDesc } from "date-fns";
import {
  CalendarDays,
  Info,
  Pencil,
  ClipboardCopy,
  Copy,
  Check,
  ChevronDown,
  Layers,
} from "@/lib/icons";
import { apiFetch } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface Cycle {
  id: string;
  name: string;
  description: string | null;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
  updated_at: string;
  project: string;
  workspace: string;
  owned_by: string;
  total_issues: number;
  completed_issues: number;
}

interface CycleListProps {
  slug: string;
  projectId: string;
}

function CycleCardSkeleton() {
  return (
    <div className="space-y-3 rounded-lg border p-4">
      <Skeleton className="h-5 w-36" />
      <Skeleton className="h-3 w-48" />
      <Skeleton className="h-2 w-full" />
      <div className="flex justify-between">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-3 w-10" />
      </div>
    </div>
  );
}

function CycleCard({ cycle, slug, projectId }: { cycle: Cycle; slug: string; projectId: string }) {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const total = cycle.total_issues ?? 0;
  const completed = cycle.completed_issues ?? 0;
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<{
    name: string;
    description: string;
    start_date: string | null;
    end_date: string | null;
  } | null>(null);

  const updateCycle = useMutation({
    mutationFn: (body: {
      name: string;
      description?: string | null;
      start_date?: string | null;
      end_date?: string | null;
    }) =>
      apiFetch(`/workspaces/${slug}/projects/${projectId}/cycles/${cycle.id}/`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cycles", slug, projectId] });
      setEditing(false);
      setDraft(null);
      toast.success("Cycle updated");
    },
    onError: () => toast.error("Failed to update cycle"),
  });

  const startEdit = () => {
    setDraft({
      name: cycle.name,
      description: cycle.description ?? "",
      start_date: cycle.start_date,
      end_date: cycle.end_date,
    });
    setEditing(true);
  };

  const cancelEdit = () => {
    setDraft(null);
    setEditing(false);
  };

  const save = () => {
    if (!draft) return;
    updateCycle.mutate({
      name: draft.name,
      description: draft.description || null,
      start_date: draft.start_date,
      end_date: draft.end_date,
    });
  };

  const copyId = () => {
    navigator.clipboard.writeText(cycle.id);
    toast.success("Cycle ID copied");
  };

  const copySummary = () => {
    const summary = [
      `Cycle: ${cycle.name}`,
      `ID: ${cycle.id}`,
      cycle.start_date && cycle.end_date
        ? `Dates: ${format(parseISO(cycle.start_date), "MMM d, yyyy")} - ${format(parseISO(cycle.end_date), "MMM d, yyyy")}`
        : null,
      `Progress: ${completed}/${total} issues (${percent}%)`,
    ]
      .filter(Boolean)
      .join("\n");
    navigator.clipboard.writeText(summary);
    toast.success("Cycle summary copied");
  };

  const now = new Date();
  let statusBadge: React.ReactNode = null;

  if (cycle.start_date && cycle.end_date) {
    const start = parseISO(cycle.start_date);
    const end = parseISO(cycle.end_date);

    if (end < now && percent < 100) {
      statusBadge = <Badge variant="destructive">Overdue</Badge>;
    } else if (start <= now && end >= now) {
      const daysLeft = Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      statusBadge = <Badge variant="secondary">{daysLeft}d left</Badge>;
    } else if (start > now) {
      statusBadge = <Badge variant="outline">Upcoming</Badge>;
    } else if (percent >= 100) {
      statusBadge = (
        <Badge className="bg-emerald-500 text-white hover:bg-emerald-600">Completed</Badge>
      );
    }
  }

  return (
    <Card
      className="cursor-pointer hover:border-primary/50 transition-colors"
      onClick={() => !editing && navigate(`/${slug}/projects/${projectId}/cycles/${cycle.id}`)}
    >
      <CardContent className="p-4">
        {editing ? (
          <div className="space-y-3" onClick={(e) => e.stopPropagation()}>
            <Input
              value={draft?.name ?? ""}
              onChange={(e) => setDraft((d) => (d ? { ...d, name: e.target.value } : d))}
              placeholder="Cycle name"
            />
            <Textarea
              value={draft?.description ?? ""}
              onChange={(e) => setDraft((d) => (d ? { ...d, description: e.target.value } : d))}
              rows={2}
              placeholder="Description"
            />
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Start date</label>
                <DatePicker
                  value={draft?.start_date ?? null}
                  onChange={(v) => setDraft((d) => (d ? { ...d, start_date: v } : d))}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">End date</label>
                <DatePicker
                  value={draft?.end_date ?? null}
                  onChange={(v) => setDraft((d) => (d ? { ...d, end_date: v } : d))}
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={save}
                disabled={updateCycle.isPending || !draft?.name.trim()}
              >
                <Check className="h-4 w-4 mr-1" /> Save
              </Button>
              <Button size="sm" variant="ghost" onClick={cancelEdit}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-semibold truncate">{cycle.name}</h3>
                {cycle.start_date && cycle.end_date && (
                  <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <CalendarDays className="h-3 w-3" />
                    <span>
                      {format(parseISO(cycle.start_date), "MMM d")} -{" "}
                      {format(parseISO(cycle.end_date), "MMM d, yyyy")}
                    </span>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-0.5 shrink-0">
                {statusBadge}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-muted-foreground"
                      onClick={(e) => {
                        e.stopPropagation();
                        copyId();
                      }}
                    >
                      <ClipboardCopy className="h-3 w-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Copy Cycle ID (for MCP calls)</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-muted-foreground"
                      onClick={(e) => {
                        e.stopPropagation();
                        copySummary();
                      }}
                    >
                      <Copy className="h-3 w-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Copy cycle summary</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-muted-foreground"
                      onClick={(e) => {
                        e.stopPropagation();
                        startEdit();
                      }}
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Edit cycle</TooltipContent>
                </Tooltip>
              </div>
            </div>

            {cycle.description && (
              <p className="mt-2 text-xs text-muted-foreground line-clamp-2">{cycle.description}</p>
            )}

            <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground font-mono">
              <Layers className="h-3 w-3" />
              {cycle.id}
            </div>

            {/* Progress bar */}
            <div className="mt-3">
              <div className="h-1.5 w-full rounded-full bg-muted">
                <div
                  className={cn(
                    "h-1.5 rounded-full transition-all",
                    percent >= 100
                      ? "bg-emerald-500"
                      : percent >= 50
                        ? "bg-blue-500"
                        : "bg-amber-500",
                  )}
                  style={{ width: `${Math.min(percent, 100)}%` }}
                />
              </div>
              <div className="mt-1.5 flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {completed}/{total} issues
                </span>
                <span className="font-medium text-foreground">{percent}%</span>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function CycleTipsCard() {
  const [tipsOpen, setTipsOpen] = useState(true);
  return (
    <Card className="mb-4">
      <button
        type="button"
        className="w-full flex items-center justify-between gap-3 p-3 text-left"
        onClick={() => setTipsOpen((v) => !v)}
      >
        <span className="flex items-center gap-2 text-sm font-medium">
          <Info className="h-4 w-4 text-muted-foreground" />
          What is a Sprint / Cycle?
        </span>
        <ChevronDown
          className={`h-4 w-4 text-muted-foreground transition-transform ${tipsOpen ? "" : "-rotate-90"}`}
        />
      </button>
      {tipsOpen && (
        <CardContent className="pb-4 space-y-2 text-sm text-muted-foreground">
          <p>
            A <strong>Sprint (Cycle)</strong> is a short time-box — usually 1–4 weeks — where a
            team commits to finishing a set of issues. Unlike a Module (a permanent grouping like a
            workstream or feature), a sprint is a <strong>temporary schedule</strong>: issues in it
            are the work you'll do right now.
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li>
              <strong>Time-boxed</strong> — has start/end dates; the card shows days left or
              Overdue if missed.
            </li>
            <li>
              <strong>Progress tracked</strong> — completed vs total issues shown as a % bar.
            </li>
            <li>
              <strong>Scoped</strong> — only issues assigned to the cycle count toward its progress.
            </li>
          </ul>
          <p className="text-xs">
            Tip: use <strong>Modules</strong> to organize (group issues into workstreams), use{" "}
            <strong>Sprints</strong> to schedule (decide what gets done this iteration).
          </p>
        </CardContent>
      )}
    </Card>
  );
}

export default function CycleList({ slug, projectId }: CycleListProps) {
  const { data: cycles = [], isLoading } = useQuery({
    queryKey: ["cycles", slug, projectId],
    queryFn: () =>
      apiFetch<{ results: Cycle[] }>(`/workspaces/${slug}/projects/${projectId}/cycles/`).then(
        (d) => d.results,
      ),
    enabled: !!slug && !!projectId,
  });

  const sorted = [...cycles].sort((a, b) => {
    const aDate = a.start_date ? a.start_date : a.created_at;
    const bDate = b.start_date ? b.start_date : b.created_at;
    return compareDesc(new Date(aDate), new Date(bDate));
  });

  if (isLoading) {
    return (
      <TooltipProvider>
        <CycleTipsCard />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <CycleCardSkeleton key={i} />
          ))}
        </div>
      </TooltipProvider>
    );
  }

  if (sorted.length === 0) {
    return (
      <TooltipProvider>
        <CycleTipsCard />
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="rounded-full bg-muted p-4 mb-4">
            <CalendarDays className="h-8 w-8 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-medium">No cycles yet</h3>
          <p className="mt-1 text-sm text-muted-foreground max-w-sm">
            Create your first sprint to start planning and tracking work in iterative cycles.
          </p>
        </div>
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider>
      <CycleTipsCard />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sorted.map((cycle) => (
          <CycleCard key={cycle.id} cycle={cycle} slug={slug} projectId={projectId} />
        ))}
      </div>
    </TooltipProvider>
  );
}
