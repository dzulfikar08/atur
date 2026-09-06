/**
 * TranscriptView — read-only structured rendering of a pane's activity stream
 * (DEV-33). Blocks arrive via usePaneObserve; this component is presentational
 * so the frame protocol can be exercised against a mock without the bridge.
 *
 * Mobile-first: all text wraps (`whitespace-pre-wrap break-words`) so narrow
 * viewports never horizontal-scroll, and expanders are full-width tap targets.
 */
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight } from "@/lib/icons";
import type { ObserveBlock, PaneObserve } from "@/hooks/usePaneObserve";
import { cn } from "@/lib/utils";

/** Blocks taller than this collapse behind a "N lines — tap to expand" row. */
const COLLAPSE_THRESHOLD = 8;

/** 4.2s / 12s / 1m 03s — coarse per-block runtime. */
function humanizeDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0.0s";
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${totalSeconds}s`;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

function KindBadge({ block }: { block: ObserveBlock }) {
  if (block.kind === "error") return <Badge variant="destructive">Error</Badge>;
  if (block.kind === "model") return <Badge variant="default">{block.model ?? "Model"}</Badge>;
  if (block.kind === "tool") return <Badge variant="secondary">Tool</Badge>;
  return <Badge variant="outline">Output</Badge>;
}

function TranscriptBlock({ block }: { block: ObserveBlock }) {
  // Local expansion state: collapsed by default, per block.
  const [expanded, setExpanded] = useState(false);
  const collapsible = block.lineCount > COLLAPSE_THRESHOLD;
  const start = Date.parse(block.startedAt);
  const end = block.endedAt ? Date.parse(block.endedAt) : Date.now();
  const running = !block.endedAt && Number.isFinite(start);
  const duration = Number.isFinite(start) ? humanizeDuration(end - start) : null;

  return (
    <div
      className={cn(
        "rounded-lg border bg-card",
        block.kind === "error" && "border-destructive/40 bg-destructive/10",
      )}
    >
      <div className="flex flex-wrap items-center gap-2 px-3 pb-1 pt-2.5">
        <KindBadge block={block} />
        {/* kind:"tool" surfaces the tool title next to its badge. */}
        {block.kind === "tool" && block.title && (
          <span className="min-w-0 truncate text-xs font-medium">{block.title}</span>
        )}
        {duration && (
          <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
            {duration}
            {running && "…"}
          </span>
        )}
      </div>
      <div className="px-3 pb-2.5">
        {collapsible && !expanded ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-full justify-start px-2 text-xs text-muted-foreground"
            onClick={() => setExpanded(true)}
          >
            <ChevronRight className="h-3.5 w-3.5" />
            {block.lineCount} lines — tap to expand
          </Button>
        ) : (
          <>
            <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed">
              {block.text}
            </pre>
            {collapsible && (
              <Button
                variant="ghost"
                size="sm"
                className="mt-1 h-7 w-full justify-start px-2 text-xs text-muted-foreground"
                onClick={() => setExpanded(false)}
              >
                <ChevronDown className="h-3.5 w-3.5" />
                Tap to collapse
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function TranscriptView({
  status,
  mode,
  blocks,
  rawText,
  error,
  retry: onRetry,
}: PaneObserve) {
  if (status === "unreachable") {
    return (
      <div className="flex h-[65vh] min-h-[320px] flex-col items-center justify-center gap-3 rounded-lg border bg-card p-6 text-center">
        <p className="font-medium text-foreground">Transcript unavailable</p>
        <p className="text-sm text-muted-foreground">
          Gave up after several attempts — the bridge may be offline.
        </p>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <Button variant="outline" size="sm" onClick={onRetry}>
          Retry
        </Button>
      </div>
    );
  }

  const showBlocks = mode === "structured" ? blocks : [];
  return (
    <div className="h-[65vh] min-h-[320px] overflow-y-auto rounded-lg border bg-background p-2">
      {error && <p className="px-1 pb-2 text-sm text-destructive">Bridge error: {error}</p>}
      {status === "reconnecting" && (
        <p className="px-1 pb-2 text-sm text-muted-foreground">Reconnecting…</p>
      )}

      {mode === "raw" ? (
        // No parseable structure — plain wrapped text, never a blank screen.
        rawText ? (
          <pre className="whitespace-pre-wrap break-words p-1 font-mono text-xs leading-relaxed">
            {rawText}
          </pre>
        ) : (
          <p className="p-6 text-center text-sm text-muted-foreground">waiting for output…</p>
        )
      ) : showBlocks.length > 0 ? (
        <div className="space-y-2">
          {showBlocks.map((block) => (
            <TranscriptBlock key={block.id} block={block} />
          ))}
        </div>
      ) : (
        <p className="p-6 text-center text-sm text-muted-foreground">
          {status === "connected" ? "waiting for output…" : "Connecting…"}
        </p>
      )}
    </div>
  );
}
