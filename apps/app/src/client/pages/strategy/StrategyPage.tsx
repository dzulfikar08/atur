import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type WorkspaceStrategy, type StrategyVerdict, type DecisionItem } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Gauge, TrendingUp, TrendingDown, Minus, Inbox } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import StrategyScatter from "./StrategyScatter";

const VERDICTS: StrategyVerdict[] = ["invest", "harden", "harvest", "kill", "needs-review"];

const VERDICT_BADGE: Record<string, string> = {
  invest: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  harden: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  harvest: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  kill: "bg-red-500/10 text-red-600 dark:text-red-400",
  "needs-review": "bg-zinc-500/10 text-zinc-500",
};

// Trend vs the newest history row that actually differs from current values —
// the row written by the last real rescore mirrors current, so "previous" is
// the one before it.
function trendOf(ws: WorkspaceStrategy): { moat: number | null; aiProof: number | null } {
  const prev = ws.history.find(
    (h) => h.moat_score !== ws.moat_score || h.ai_proof_score !== ws.ai_proof_score,
  );
  if (!prev) return { moat: null, aiProof: null };
  return {
    moat: prev.moat_score == null || ws.moat_score == null ? null : ws.moat_score - prev.moat_score,
    aiProof:
      prev.ai_proof_score == null || ws.ai_proof_score == null
        ? null
        : ws.ai_proof_score - prev.ai_proof_score,
  };
}

function TrendArrow({ delta }: { delta: number | null }) {
  if (delta == null || delta === 0)
    return <Minus className="inline size-3 text-muted-foreground" />;
  if (delta > 0) return <TrendingUp className="inline size-3 text-emerald-500" />;
  return <TrendingDown className="inline size-3 text-red-500" />;
}

function VerdictBadge({ verdict }: { verdict: string | null }) {
  if (!verdict) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium capitalize",
        VERDICT_BADGE[verdict] ?? VERDICT_BADGE["needs-review"],
      )}
    >
      {verdict.replace("-", " ")}
    </span>
  );
}

function formatDue(date: string | null): string {
  if (!date) return "no date";
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default function StrategyPage() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const strategyQuery = useQuery({
    queryKey: ["strategy"],
    queryFn: api.listStrategy,
  });
  const decisionsQuery = useQuery({
    queryKey: ["decisions"],
    queryFn: api.listDecisions,
  });

  const workspaces = strategyQuery.data ?? [];
  const selected = workspaces.find((w) => w.id === selectedId) ?? null;

  const scored = useMemo(
    () => workspaces.filter((w) => w.moat_score != null && w.ai_proof_score != null),
    [workspaces],
  );
  const unscored = useMemo(
    () => workspaces.filter((w) => w.moat_score == null || w.ai_proof_score == null),
    [workspaces],
  );
  const decisions: DecisionItem[] = decisionsQuery.data ?? [];

  const saveMutation = useMutation({
    mutationFn: ({
      slug,
      data,
    }: {
      slug: string;
      data: {
        moatScore?: number | null;
        aiProofScore?: number | null;
        strategyVerdict?: StrategyVerdict | null;
        strategyNote?: string | null;
      };
    }) => api.updateWorkspaceStrategy(slug, data),
    onSuccess: () => {
      toast.success("Saved");
      queryClient.invalidateQueries({ queryKey: ["strategy"] });
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
    },
    onError: (e: Error) => toast.error(e.message || "Save failed"),
  });

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <div className="flex items-center gap-2">
        <Gauge className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-semibold">Portfolio Strategy</h1>
        <span className="text-sm text-muted-foreground ml-auto">
          {scored.length}/{workspaces.length} scored · rescore monthly, trend beats absolute
        </span>
      </div>

      {strategyQuery.isLoading ? (
        <div className="animate-pulse text-sm text-muted-foreground">Loading…</div>
      ) : strategyQuery.isError ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          Failed to load strategy data.
          <Button
            variant="outline"
            size="sm"
            className="ml-2"
            onClick={() => strategyQuery.refetch()}
          >
            Retry
          </Button>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="p-4 lg:col-span-2">
              <StrategyScatter
                workspaces={workspaces}
                selectedId={selectedId}
                onSelect={setSelectedId}
              />
            </Card>
            <ScoreEditor
              workspaces={workspaces}
              selected={selected}
              onSelect={setSelectedId}
              onSave={(slug, data) => saveMutation.mutate({ slug, data })}
              saving={saveMutation.isPending}
            />
          </div>

          {unscored.length > 0 && (
            <Card className="p-3">
              <div className="text-xs text-muted-foreground mb-2">
                Needs review — not on the matrix yet ({unscored.length})
              </div>
              <WorkspaceChips workspaces={unscored} onSelect={setSelectedId} />
            </Card>
          )}

          {/* Scorecard */}
          <Card className="overflow-hidden">
            <div className="border-b bg-muted/40 px-4 py-2 text-sm font-medium">Scorecard</div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Product</th>
                  <th className="px-4 py-2 font-medium text-center">Moat</th>
                  <th className="px-4 py-2 font-medium text-center">AI-proof</th>
                  <th className="px-4 py-2 font-medium">Verdict</th>
                  <th className="px-4 py-2 font-medium">Note</th>
                  <th className="px-4 py-2 font-medium">Reviewed</th>
                </tr>
              </thead>
              <tbody>
                {workspaces.map((w) => {
                  const trend = trendOf(w);
                  return (
                    <tr
                      key={w.id}
                      className={cn(
                        "cursor-pointer border-t transition-colors hover:bg-accent/50",
                        w.id === selectedId && "bg-accent/60",
                      )}
                      onClick={() => setSelectedId(w.id)}
                    >
                      <td className="px-4 py-2 font-medium">{w.name}</td>
                      <td className="px-4 py-2 text-center">
                        {w.moat_score ?? "—"} <TrendArrow delta={trend.moat} />
                      </td>
                      <td className="px-4 py-2 text-center">
                        {w.ai_proof_score ?? "—"} <TrendArrow delta={trend.aiProof} />
                      </td>
                      <td className="px-4 py-2">
                        <VerdictBadge verdict={w.strategy_verdict} />
                      </td>
                      <td className="max-w-[260px] truncate px-4 py-2 text-muted-foreground">
                        {w.strategy_note ?? ""}
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {w.reviewed_at ? formatDue(w.reviewed_at.slice(0, 10)) : "never"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>

          {/* Decision inbox */}
          <Card className="overflow-hidden">
            <div className="flex items-center gap-2 border-b bg-muted/40 px-4 py-2 text-sm font-medium">
              <Inbox className="size-4 text-muted-foreground" />
              Decision inbox
              <span className="ml-auto text-xs font-normal text-muted-foreground">
                open is-decision issues across all workspaces
              </span>
            </div>
            {decisions.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                No open decisions. Flag issues with <code>is_decision</code> via MCP to track them
                here.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="px-4 py-2 font-medium">Decision</th>
                    <th className="px-4 py-2 font-medium">Workspace</th>
                    <th className="px-4 py-2 font-medium">State</th>
                    <th className="px-4 py-2 font-medium">Due</th>
                  </tr>
                </thead>
                <tbody>
                  {decisions.map((d) => (
                    <tr key={d.id} className="border-t">
                      <td className="px-4 py-2">
                        <Link
                          to={`/${d.workspace_slug}/projects/${d.project_id}/issues/${d.sequence_id}`}
                          className="font-medium text-foreground hover:underline"
                        >
                          <span className="font-mono text-xs text-muted-foreground mr-1.5">
                            {d.project_identifier}-{d.sequence_id}
                          </span>
                          {d.name}
                        </Link>
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">{d.workspace_name}</td>
                      <td className="px-4 py-2">
                        {d.state_name ? (
                          <span
                            className="inline-flex items-center gap-1.5 text-xs"
                            style={d.state_color ? { color: d.state_color } : undefined}
                          >
                            <span
                              className="size-2 rounded-full"
                              style={{ background: d.state_color ?? "#71717a" }}
                            />
                            {d.state_name}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {formatDue(d.target_date)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

// Clickable workspace chips — shared by the "needs review" card and the
// editor's empty state so both list workspaces identically.
function WorkspaceChips({
  workspaces,
  onSelect,
}: {
  workspaces: WorkspaceStrategy[];
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {workspaces.map((w) => (
        <button
          key={w.id}
          onClick={() => onSelect(w.id)}
          className="rounded-full border border-border px-2.5 py-1 text-xs text-foreground/80 transition-colors hover:bg-accent"
        >
          {w.name}
        </button>
      ))}
    </div>
  );
}

// ── Score editor panel ──
// The parent mounts this keyed by the selected workspace id, so every
// selection is a fresh component — form state initializes from props and no
// render-phase sync is needed.
function ScoreEditor({
  workspaces,
  selected,
  onSelect,
  onSave,
  saving,
}: {
  workspaces: WorkspaceStrategy[];
  selected: WorkspaceStrategy | null;
  onSelect: (id: string) => void;
  onSave: (
    slug: string,
    data: {
      moatScore?: number | null;
      aiProofScore?: number | null;
      strategyVerdict?: StrategyVerdict | null;
      strategyNote?: string | null;
    },
  ) => void;
  saving: boolean;
}) {
  const [moat, setMoat] = useState(selected?.moat_score != null ? String(selected.moat_score) : "");
  const [aiProof, setAiProof] = useState(
    selected?.ai_proof_score != null ? String(selected.ai_proof_score) : "",
  );
  const [verdict, setVerdict] = useState(selected?.strategy_verdict ?? "");
  const [note, setNote] = useState(selected?.strategy_note ?? "");

  if (!selected) {
    return (
      <Card className="p-4">
        <div className="text-sm font-medium mb-1">Score a product</div>
        <div className="text-xs text-muted-foreground mb-3">
          Pick a dot on the matrix or a row/chip below.
        </div>
        <WorkspaceChips workspaces={workspaces} onSelect={onSelect} />
      </Card>
    );
  }

  const numOrNull = (v: string) => (v === "" ? null : Number(v));

  return (
    <Card className="p-4 space-y-3">
      <div>
        <div className="text-sm font-medium">{selected.name}</div>
        {selected.reviewed_at && (
          <div className="text-xs text-muted-foreground">
            last reviewed {formatDue(selected.reviewed_at.slice(0, 10))}
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Moat (0–5)</label>
          <Select value={moat} onValueChange={setMoat}>
            <SelectTrigger className="h-9">
              <SelectValue placeholder="—" />
            </SelectTrigger>
            <SelectContent>
              {["0", "1", "2", "3", "4", "5"].map((v) => (
                <SelectItem key={v} value={v}>
                  {v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">AI-proof (0–5)</label>
          <Select value={aiProof} onValueChange={setAiProof}>
            <SelectTrigger className="h-9">
              <SelectValue placeholder="—" />
            </SelectTrigger>
            <SelectContent>
              {["0", "1", "2", "3", "4", "5"].map((v) => (
                <SelectItem key={v} value={v}>
                  {v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground">Verdict</label>
        <Select value={verdict} onValueChange={setVerdict}>
          <SelectTrigger className="h-9">
            <SelectValue placeholder="—" />
          </SelectTrigger>
          <SelectContent>
            {VERDICTS.map((v) => (
              <SelectItem key={v} value={v}>
                {v.replace("-", " ")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground">Evidence — no score without a line</label>
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          placeholder="e.g. workflow lock-in only; AI recreates in weeks"
        />
      </div>
      <Button
        size="sm"
        disabled={saving}
        onClick={() =>
          onSave(selected.slug, {
            moatScore: numOrNull(moat),
            aiProofScore: numOrNull(aiProof),
            strategyVerdict: (verdict || null) as StrategyVerdict | null,
            strategyNote: note || null,
          })
        }
      >
        {saving ? "Saving…" : "Save rescore"}
      </Button>
    </Card>
  );
}
