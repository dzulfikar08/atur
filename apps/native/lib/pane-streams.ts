import { useCallback, useEffect, useRef, useState } from "react";

import { openAuthedSocket } from "@/lib/socket";

// Native ports of the web's usePaneAttach / usePaneObserve
// (apps/app/src/client/hooks). Same frames, same reconnect policy; the only
// difference is how the socket authenticates (bearer header, see socket.ts).
// Frames are JSON text; the Worker relays them verbatim to the bridge.

const MAX_ATTEMPTS = 5;
const MAX_BACKOFF_MS = 15_000;
const PING_INTERVAL_MS = 30_000;

// --- attach: live terminal ---------------------------------------------------

export type PaneAttachStatus =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "unreachable"
  | "exited";

export interface PaneHello {
  cols: number;
  rows: number;
  /** True when this connection already holds the keyboard. */
  keyboard: boolean;
}

export interface PaneAttachHandlers {
  onHello?: (pane: PaneHello) => void;
  /** Keyboard ownership changed (claim granted/stolen/released). */
  onKeyboard?: (you: boolean) => void;
  /** Full visible-screen frame (ANSI). */
  onSnapshot?: (ansi: string) => void;
  /** Per-row repaint: [0-based row, full row content]. */
  onDiff?: (rows: [number, string][]) => void;
  onError?: (message: string) => void;
}

/**
 * bridge → app: hello · keyboard · snapshot · diff · pong · error · exit
 * app → bridge: input {data} · paste {text, submit} · claim · ping
 * A bridge `exit` means the pane died; reconnecting cannot revive it.
 */
export function usePaneAttach(paneId: string, handlers: PaneAttachHandlers) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<PaneAttachStatus>("connecting");
  const [retryKey, setRetryKey] = useState(0);

  const retry = useCallback(() => {
    setStatus("connecting");
    setRetryKey((k) => k + 1);
  }, []);

  /** Raw keyboard input; dropped (returns false) unless the socket is open. */
  const sendInput = useCallback((data: string): boolean => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify({ type: "input", data }));
    return true;
  }, []);

  /**
   * Literal multi-line text as one paste (newlines are not Enter presses),
   * optionally submitted with Enter. Needs a bridge that knows `paste`.
   */
  const sendPaste = useCallback((text: string, submit: boolean): boolean => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify({ type: "paste", text, submit }));
    return true;
  }, []);

  /** Request (or steal) keyboard ownership; the bridge arbitrates. */
  const claimKeyboard = useCallback(() => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "claim" }));
  }, []);

  useEffect(() => {
    let disposed = false;
    let attempts = 0;
    let gotExit = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let pingTimer: ReturnType<typeof setInterval> | undefined;

    const stopPing = () => {
      clearInterval(pingTimer);
      pingTimer = undefined;
    };

    const connect = () => {
      if (disposed) return;
      setStatus(attempts === 0 ? "connecting" : "reconnecting");
      const ws = openAuthedSocket(`/api/panes/attach?pane=${encodeURIComponent(paneId)}`);
      wsRef.current = ws;

      ws.onopen = () => {
        if (disposed) {
          ws.close();
          return;
        }
        attempts = 0;
        setStatus("connected");
        stopPing();
        pingTimer = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "ping" }));
        }, PING_INTERVAL_MS);
      };

      ws.onmessage = (event) => {
        if (typeof event.data !== "string") return;
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(event.data) as Record<string, unknown>;
        } catch {
          return;
        }
        const h = handlersRef.current;
        switch (msg.type) {
          case "hello": {
            const pane = msg.pane as { cols?: unknown; rows?: unknown } | undefined;
            h.onHello?.({
              cols: typeof pane?.cols === "number" ? pane.cols : 80,
              rows: typeof pane?.rows === "number" ? pane.rows : 24,
              keyboard: msg.keyboard === true,
            });
            break;
          }
          case "keyboard":
            h.onKeyboard?.(msg.you === true);
            break;
          case "snapshot":
            if (typeof msg.ansi === "string") h.onSnapshot?.(msg.ansi);
            break;
          case "diff": {
            if (!Array.isArray(msg.rows)) break;
            const rows: [number, string][] = [];
            for (const row of msg.rows as unknown[]) {
              if (
                Array.isArray(row) &&
                row.length === 2 &&
                typeof row[0] === "number" &&
                typeof row[1] === "string"
              ) {
                rows.push([row[0], row[1]]);
              }
            }
            if (rows.length > 0) h.onDiff?.(rows);
            break;
          }
          case "error":
            h.onError?.(typeof msg.message === "string" ? msg.message : "unknown bridge error");
            break;
          case "exit":
            gotExit = true;
            setStatus("exited");
            break;
        }
      };

      ws.onclose = () => {
        stopPing();
        if (wsRef.current === ws) wsRef.current = null;
        if (disposed || gotExit) return;
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
      stopPing();
      const ws = wsRef.current;
      wsRef.current = null;
      ws?.close(1000, "unmount");
    };
  }, [paneId, retryKey]);

  return { status, sendInput, sendPaste, retry, claimKeyboard };
}

// --- observe: structured transcript ------------------------------------------

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

export interface PaneObserve {
  status: ObserveStatus;
  mode: ObserveMode;
  blocks: ObserveBlock[];
  rawText: string;
  error: string | null;
  retry: () => void;
}

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
    kind: kind as ObserveBlockKind,
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

/**
 * Read-only stream (the daemon closes any client frame, so nothing is ever
 * sent): snapshot · blocks · raw · error. `enabled` gates the connection so it
 * only runs while the Transcript view is open. `attempts` deliberately spans
 * the whole cycle (not reset on open): the daemon's standard rejection is
 * accept-then-error, which would otherwise hot-loop on an unobservable pane.
 */
export function usePaneObserve(paneId: string, enabled: boolean): PaneObserve {
  const [status, setStatus] = useState<ObserveStatus>(enabled && paneId ? "connecting" : "idle");
  const [mode, setMode] = useState<ObserveMode>("structured");
  const [blocks, setBlocks] = useState<ObserveBlock[]>([]);
  const [rawText, setRawText] = useState("");
  const [error, setError] = useState<string | null>(null);
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
    let ws: WebSocket | null = null;

    const connect = () => {
      if (disposed) return;
      setStatus(attempts === 0 ? "connecting" : "reconnecting");
      const socket = openAuthedSocket(`/api/panes/observe?pane=${encodeURIComponent(paneId)}`);
      ws = socket;

      socket.onopen = () => {
        if (disposed) {
          socket.close();
          return;
        }
        setStatus("connected");
      };

      socket.onmessage = (event) => {
        if (typeof event.data !== "string") return;
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(event.data) as Record<string, unknown>;
        } catch {
          return;
        }
        switch (msg.type) {
          case "snapshot": {
            const next: ObserveMode = msg.mode === "raw" ? "raw" : "structured";
            setMode(next);
            if (next === "raw") {
              if (typeof msg.text === "string") setRawText(msg.text);
            } else {
              setBlocks(parseBlocks(msg.blocks));
            }
            break;
          }
          // Full replacement on each change, never a merge; frames carry the
          // current mode (the bridge can flip structured ↔ raw mid-stream).
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

      socket.onclose = () => {
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
      ws?.close(1000, "unmount");
    };
  }, [paneId, enabled, retryKey]);

  return { status, mode, blocks, rawText, error, retry };
}
