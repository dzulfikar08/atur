/**
 * usePaneObserve: read-only structured transcript stream for a pane (DEV-33).
 *
 * Connects to GET /api/panes/observe?pane=<id>, the Worker-side sibling of
 * /attach with identical per-pane authz. Protocol is JSON text frames pushed
 * by the bridge daemon:
 *   {type:"snapshot", paneId, mode:"structured"|"raw", blocks:[Block]}
 *   {type:"blocks",   blocks:[Block]}   — full replacement on every change
 *   {type:"raw",      paneId, text}     — mode "raw": no parseable structure
 *   {type:"error",    error}            — followed by a close
 *
 * The channel is strictly server→client: the daemon closes (1008) any client
 * frame, so this hook never sends after open — no ping, no input, no keyboard.
 *
 * Reconnect policy mirrors usePaneAttach: exponential backoff 1s → 15s for
 * MAX_ATTEMPTS tries, then "unreachable" so the UI can offer a manual retry.
 * `enabled` gates the connection — the pane page only subscribes while the
 * Transcript view is open.
 */
import { useCallback, useEffect, useState } from "react";
import { isNative, resolveWsUrl } from "@/lib/native";

export type ObserveBlockKind = "tool" | "output" | "model" | "error";

export interface ObserveBlock {
  id: number;
  kind: ObserveBlockKind;
  /** Tool name for kind:"tool"; null otherwise. */
  title: string | null;
  /** Model name for kind:"model"; null otherwise. */
  model: string | null;
  /** ISO timestamp. */
  startedAt: string;
  /** ISO timestamp; null while the block is still running. */
  endedAt: string | null;
  text: string;
  lineCount: number;
}

export type ObserveMode = "structured" | "raw";

export type ObserveStatus = "idle" | "connecting" | "connected" | "reconnecting" | "unreachable";

const MAX_ATTEMPTS = 5;
const MAX_BACKOFF_MS = 15_000;

const BLOCK_KINDS: Record<string, true> = { tool: true, output: true, model: true, error: true };

/** Defensive frame→block coercion; malformed blocks are dropped, not trusted. */
function parseBlock(value: unknown): ObserveBlock | null {
  if (typeof value !== "object" || value === null) return null;
  const b = value as Record<string, unknown>;
  const kind = typeof b.kind === "string" ? b.kind : "";
  if (typeof b.id !== "number" || !BLOCK_KINDS[kind]) return null;
  if (typeof b.startedAt !== "string" || typeof b.text !== "string") return null;
  return {
    id: b.id,
    kind: b.kind as ObserveBlockKind,
    title: typeof b.title === "string" ? b.title : null,
    model: typeof b.model === "string" ? b.model : null,
    startedAt: b.startedAt,
    endedAt: typeof b.endedAt === "string" ? b.endedAt : null,
    text: b.text,
    lineCount: typeof b.lineCount === "number" ? b.lineCount : b.text.split("\n").length,
  };
}

function parseBlocks(value: unknown): ObserveBlock[] {
  if (!Array.isArray(value)) return [];
  return value.map(parseBlock).filter((b): b is ObserveBlock => b !== null);
}

/** Frame `mode` → state updater; absent/unknown mode keeps the current one. */
function resolveMode(value: unknown): (prev: ObserveMode) => ObserveMode {
  return (prev) => (value === "raw" || value === "structured" ? value : prev);
}

/** Everything the Transcript view needs to render one pane's stream. */
export interface PaneObserve {
  status: ObserveStatus;
  mode: ObserveMode;
  blocks: ObserveBlock[];
  rawText: string;
  error: string | null;
  retry: () => void;
}

export function usePaneObserve(paneId: string, enabled: boolean): PaneObserve {
  const [status, setStatus] = useState<ObserveStatus>(enabled && paneId ? "connecting" : "idle");
  const [mode, setMode] = useState<ObserveMode>("structured");
  const [blocks, setBlocks] = useState<ObserveBlock[]>([]);
  const [rawText, setRawText] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Bumping retryKey tears the socket down and starts a fresh attempt cycle.
  const [retryKey, setRetryKey] = useState(0);

  const retry = useCallback(() => {
    setStatus("connecting");
    setError(null);
    setRetryKey((k) => k + 1);
  }, []);

  useEffect(() => {
    if (!enabled || !paneId) {
      setStatus("idle");
      return;
    }
    let disposed = false;
    let attempts = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    // Live socket (reassigned across reconnects); closed in cleanup below.
    let ws: WebSocket | null = null;

    const connect = () => {
      if (disposed) return;
      setStatus(attempts === 0 ? "connecting" : "reconnecting");

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const qs = `pane=${encodeURIComponent(paneId)}`;
      const wsUrl = isNative()
        ? resolveWsUrl(`/api/panes/observe?${qs}`)
        : `${protocol}//${window.location.host}/api/panes/observe?${qs}`;
      const socket = new WebSocket(wsUrl);
      ws = socket;

      socket.onopen = () => {
        if (disposed) {
          socket.close();
          return;
        }
        setStatus("connected");
        // NOTE: `attempts` is deliberately NOT reset here. Unlike /attach, the
        // daemon's standard rejection is accept-then-error (error frame +
        // 1008 close), so a reset-on-open budget would hot-loop forever on an
        // unobservable pane. The 5-attempt budget spans the whole cycle; the
        // user gets a manual Retry after "unreachable".
      };

      ws.onmessage = (event: MessageEvent) => {
        if (typeof event.data !== "string") return;
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }
        switch (msg.type) {
          case "snapshot": {
            const nextMode: ObserveMode = msg.mode === "raw" ? "raw" : "structured";
            setMode(nextMode);
            if (nextMode === "raw") {
              if (typeof msg.text === "string") setRawText(msg.text);
            } else {
              setBlocks(parseBlocks(msg.blocks));
            }
            break;
          }
          // Full replacement on each change — never merge. Frames carry the
          // current mode: the bridge can transition structured ↔ raw
          // mid-stream; absent mode keeps the current one.
          case "blocks":
            setMode(resolveMode(msg.mode));
            setBlocks(parseBlocks(msg.blocks));
            break;
          case "raw":
            setMode(resolveMode(msg.mode));
            if (typeof msg.text === "string") setRawText(msg.text);
            break;
          case "error":
            setError(typeof msg.error === "string" ? msg.error : "unknown bridge error");
            break;
        }
      };

      ws.onclose = () => {
        if (disposed) return;
        if (attempts + 1 >= MAX_ATTEMPTS) {
          setStatus("unreachable");
          return;
        }
        const delay = Math.min(1000 * 2 ** attempts, MAX_BACKOFF_MS);
        attempts += 1;
        setStatus("reconnecting");
        reconnectTimer = setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      disposed = true;
      clearTimeout(reconnectTimer);
      // Close the live socket: a Transcript→Terminal toggle must not strand
      // an open connection (and its bridge poller). onopen's disposed guard
      // covers the open-after-disposal race (same pattern as usePaneAttach).
      ws?.close(1000, "unmount");
    };
  }, [paneId, enabled, retryKey]);

  return { status, mode, blocks, rawText, error, retry };
}
