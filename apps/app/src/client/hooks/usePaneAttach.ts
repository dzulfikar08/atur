/**
 * usePaneAttach: browser side of the pane observation WebSocket (ATUR-2).
 *
 * Connects to GET /api/panes/attach?pane=<id>, which the Worker upgrades and
 * proxies to the local herdr bridge. Protocol is JSON text frames, piped
 * verbatim (never parsed into app state beyond the typed switch below):
 *   bridge → client: {type:"hello", pane:{...,cols,rows}}
 *                    {type:"snapshot", revision, ansi}
 *                    {type:"pong"} | {type:"error", message} | {type:"exit", reason}
 *   client → bridge: {type:"input", data} | {type:"ping"}
 *
 * Reconnects with exponential backoff (1s → 15s, MAX_ATTEMPTS tries) and then
 * reports "unreachable" so the UI can offer a manual retry. A bridge `exit`
 * frame means the pane itself died — reconnecting cannot bring it back, so
 * the hook stops and reports "exited".
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { isNative, resolveWsUrl } from "@/lib/native";

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
  keyboard?: boolean;
}

export interface PaneAttachHandlers {
  onHello?: (pane: PaneHello) => void;
  /** Keyboard ownership changed (claim granted/stolen/released). */
  onKeyboard?: (you: boolean) => void;
  /** Full visible-screen frame (ANSI). */
  onSnapshot?: (ansi: string) => void;
  /** Per-row repaint: [0-based row, full row content] — write atomically. */
  onDiff?: (rows: [number, string][]) => void;
  onExit?: (reason: string) => void;
  onError?: (message: string) => void;
}

const MAX_ATTEMPTS = 5;
const MAX_BACKOFF_MS = 15_000;
const PING_INTERVAL_MS = 30_000;

export function usePaneAttach(paneId: string, handlers: PaneAttachHandlers) {
  // Handlers live in a ref so re-renders never re-run the connection effect.
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<PaneAttachStatus>("connecting");
  // Bumping retryKey tears the socket down and starts a fresh attempt cycle.
  const [retryKey, setRetryKey] = useState(0);

  const retry = useCallback(() => {
    setStatus("connecting");
    setRetryKey((k) => k + 1);
  }, []);

  /** Send raw keyboard input; no-op unless the socket is open. */
  const sendInput = useCallback((data: string) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "input", data }));
    }
  }, []);

  /** Request (or steal) keyboard ownership; the bridge arbitrates. */
  const claimKeyboard = useCallback(() => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "claim" }));
    }
  }, []);

  useEffect(() => {
    let disposed = false;
    let attempts = 0;
    let gotExit = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let pingTimer: ReturnType<typeof setInterval> | null = null;

    const stopPing = () => {
      if (pingTimer) {
        clearInterval(pingTimer);
        pingTimer = null;
      }
    };

    const connect = () => {
      if (disposed) return;
      setStatus(attempts === 0 ? "connecting" : "reconnecting");

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const qs = `pane=${encodeURIComponent(paneId)}`;
      const wsUrl = isNative()
        ? resolveWsUrl(`/api/panes/attach?${qs}`)
        : `${protocol}//${window.location.host}/api/panes/attach?${qs}`;
      const ws = new WebSocket(wsUrl);
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
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "ping" }));
          }
        }, PING_INTERVAL_MS);
      };

      ws.onmessage = (event: MessageEvent) => {
        if (typeof event.data !== "string") return;
        let msg: { type?: unknown; pane?: unknown; ansi?: unknown; rows?: unknown; message?: unknown; reason?: unknown; keyboard?: unknown; you?: unknown };
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }
        switch (msg.type) {
          case "hello": {
            const pane = msg.pane as { cols?: unknown; rows?: unknown } | undefined;
            handlersRef.current.onHello?.({
              cols: typeof pane?.cols === "number" ? pane.cols : 80,
              rows: typeof pane?.rows === "number" ? pane.rows : 24,
              keyboard: msg.keyboard === true,
            });
            break;
          }
          case "keyboard":
            handlersRef.current.onKeyboard?.(msg.you === true);
            break;
          case "snapshot":
            if (typeof msg.ansi === "string") handlersRef.current.onSnapshot?.(msg.ansi);
            break;
          case "diff": {
            if (!Array.isArray(msg.rows)) break;
            const rows: [number, string][] = [];
            for (const row of msg.rows) {
              if (
                Array.isArray(row) &&
                row.length === 2 &&
                typeof row[0] === "number" &&
                typeof row[1] === "string"
              ) {
                rows.push([row[0], row[1]]);
              }
            }
            if (rows.length > 0) handlersRef.current.onDiff?.(rows);
            break;
          }
          case "error":
            handlersRef.current.onError?.(
              typeof msg.message === "string" ? msg.message : "unknown bridge error",
            );
            break;
          case "exit":
            // Pane is gone — a reconnect would just fail again.
            gotExit = true;
            setStatus("exited");
            handlersRef.current.onExit?.(
              typeof msg.reason === "string" ? msg.reason : "pane closed",
            );
            break;
        }
      };

      ws.onclose = () => {
        stopPing();
        wsRef.current = null;
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
      if (reconnectTimer) clearTimeout(reconnectTimer);
      stopPing();
      const ws = wsRef.current;
      wsRef.current = null;
      // Normal closure; suppresses the onclose reconnect path via `disposed`.
      ws?.close(1000, "unmount");
    };
  }, [paneId, retryKey]);
  return { status, sendInput, retry, claimKeyboard };
}
