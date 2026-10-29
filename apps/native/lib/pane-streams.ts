import { useCallback, useEffect, useRef, useState } from "react";

import { directManager } from "@/lib/direct";
import { openDirectPane, type DirectPaneHandle } from "@/lib/direct/pane-direct";
import {
  availabilityOf,
  directPaneStatus,
  fallbackDelay,
  parsePaneTarget,
  shouldReturnToDirect,
  shouldUseDirect,
  type DirectPhase,
  type PaneTransport,
} from "@/lib/direct/transport-choice";
import { openAuthedSocket } from "@/lib/socket";
import { applyChatFrame, type ChatState } from "@/lib/transcript";

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
  /**
   * Reply to `requestHistory`: the pane's last rows including scrollback (ANSI,
   * oldest first); `visible` = how many trailing rows are the visible grid
   * (absent from older bridges).
   */
  onHistory?: (rows: string[], visible?: number) => void;
  /** A direct `requestHistory` failed (the bridge never fails one: it just stays silent). */
  onHistoryFailed?: () => void;
  /** The pane was re-laid out (another client became active, or the phone sizer attached). */
  onGeometry?: (size: { cols: number; rows: number }) => void;
  onError?: (message: string) => void;
}

/**
 * bridge → app: hello · keyboard · snapshot · diff · geometry · history · pong · error · exit
 * app → bridge: input {data} · paste {text, submit} · claim · history {lines} · resize {cols, rows} · ping
 * A bridge `exit` means the pane died; reconnecting cannot revive it.
 *
 * Two roads lead to the same pane. `direct:<id>` panes are direct only. Any other pane goes
 * straight to the paired computer when the user prefers it and the computer lists the pane as a
 * session, and falls back to the bridge when direct is not attached within 4 s, refuses the
 * attach, or drops and does not return within 6 s. On the bridge it goes back to direct as soon
 * as the computer is connected again; the bridge socket is closed first, so frames of the two
 * roads never interleave. The rules are in lib/direct/transport-choice.ts.
 */
export function usePaneAttach(paneId: string, handlers: PaneAttachHandlers) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const wsRef = useRef<WebSocket | null>(null);
  const directRef = useRef<DirectPaneHandle | null>(null);
  // The grid the screen last asked for, so a pane that moves roads attaches at the same size.
  const gridRef = useRef({ cols: 80, rows: 24 });
  // The direct connection on which attaching this pane failed: not retried on that one.
  const failedOnRef = useRef<string | null>(null);
  const [status, setStatus] = useState<PaneAttachStatus>("connecting");
  const [retryKey, setRetryKey] = useState(0);
  const [choice, setChoice] = useState<{ paneId: string; transport: PaneTransport }>(() => ({
    paneId,
    transport: chooseTransport(paneId, null),
  }));
  const transport = choice.paneId === paneId ? choice.transport : chooseTransport(paneId, null);

  useEffect(() => {
    void directManager.start();
  }, []);

  const retry = useCallback(() => {
    failedOnRef.current = null;
    setStatus("connecting");
    setChoice({ paneId, transport: chooseTransport(paneId, null) });
    setRetryKey((k) => k + 1);
  }, [paneId]);

  /** Raw keyboard input; dropped (returns false) unless the road is open. */
  const sendInput = useCallback((data: string): boolean => {
    const direct = directRef.current;
    if (direct) return direct.sendInput(data);
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
    const direct = directRef.current;
    if (direct) return direct.sendPaste(text, submit);
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify({ type: "paste", text, submit }));
    return true;
  }, []);

  /** Request (or steal) keyboard ownership; the bridge arbitrates. Direct input needs no claim. */
  const claimKeyboard = useCallback(() => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "claim" }));
  }, []);

  /** Ask for the last `lines` rows including scrollback; answered by `onHistory`. Read-only. */
  const requestHistory = useCallback((lines: number) => {
    const direct = directRef.current;
    if (direct) {
      direct.requestHistory(lines);
      return;
    }
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "history", lines }));
  }, []);

  /** Lay the pane out at this grid (keyboard owner only; the bridge attaches a phone-sized herdr client). */
  const requestResize = useCallback((cols: number, rows: number) => {
    gridRef.current = { cols, rows };
    const direct = directRef.current;
    if (direct) {
      direct.requestResize(cols, rows);
      return;
    }
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "resize", cols, rows }));
    }
  }, []);

  // The direct road.
  useEffect(() => {
    if (transport !== "direct") return;
    setChoice((prev) => (prev.paneId === paneId ? prev : { paneId, transport }));
    const target = parsePaneTarget(paneId);
    let disposed = false;
    let phase: DirectPhase = "waiting";
    let timer: ReturnType<typeof setTimeout> | undefined;

    const enter = (next: DirectPhase) => {
      if (disposed) return;
      phase = next;
      clearTimeout(timer);
      timer = undefined;
      const delay = fallbackDelay(next, target.directOnly);
      if (delay === 0) {
        setChoice({ paneId, transport: "bridge" });
        return;
      }
      if (delay !== null) {
        timer = setTimeout(() => {
          if (disposed) return;
          // Connected yet never attached: do not come back on this connection.
          if (next === "waiting") {
            failedOnRef.current = directManager.getSnapshot().connection?.id ?? null;
          }
          setChoice({ paneId, transport: "bridge" });
        }, delay);
      }
      setStatus(directPaneStatus(next, directManager.getSnapshot().state));
    };

    const handle = openDirectPane(
      directManager,
      target.sessionId,
      {
        onHello: (pane) => handlersRef.current.onHello?.(pane),
        onSnapshot: (ansi) => handlersRef.current.onSnapshot?.(ansi),
        onDiff: (rows) => handlersRef.current.onDiff?.(rows),
        onHistory: (rows, visible) => handlersRef.current.onHistory?.(rows, visible),
        onHistoryFailed: () => handlersRef.current.onHistoryFailed?.(),
        onGeometry: (size) => handlersRef.current.onGeometry?.(size),
        onError: (message) => handlersRef.current.onError?.(message),
        onAttached: () => enter("attached"),
        onLost: () => enter("lost"),
        onFailed: (message) => {
          if (disposed) return;
          if (target.directOnly) handlersRef.current.onError?.(message);
          else failedOnRef.current = directManager.getSnapshot().connection?.id ?? null;
          enter("failed");
        },
        onExit: () => enter("exited"),
      },
      gridRef.current,
    );
    directRef.current = handle;
    enter("waiting");

    // The manager giving up (no pairing left, incompatible) ends the wait on a `direct:` pane.
    const unsubscribe = directManager.subscribe(() => {
      if (phase === "waiting" || phase === "lost") {
        setStatus(directPaneStatus(phase, directManager.getSnapshot().state));
      }
    });

    return () => {
      disposed = true;
      clearTimeout(timer);
      unsubscribe();
      handle.close();
      if (directRef.current === handle) directRef.current = null;
    };
  }, [paneId, retryKey, transport]);

  // The bridge road.
  useEffect(() => {
    if (transport !== "bridge") return;
    setChoice((prev) => (prev.paneId === paneId ? prev : { paneId, transport }));
    const target = parsePaneTarget(paneId);
    let disposed = false;
    let attempts = 0;
    let gotExit = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let pingTimer: ReturnType<typeof setInterval> | undefined;

    const stopPing = () => {
      clearInterval(pingTimer);
      pingTimer = undefined;
    };

    /** Direct is back: leave the bridge (its cleanup closes the socket) and attach there. */
    const returnToDirect = (): boolean => {
      const availability = availabilityOf(directManager.getSnapshot(), failedOnRef.current);
      if (disposed || gotExit || !shouldReturnToDirect(target, availability)) return false;
      setChoice({ paneId, transport: "direct" });
      return true;
    };
    const unsubscribeDirect = directManager.subscribe(() => void returnToDirect());

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
        // Frames still queued when the pane moved to direct must not reach the screen.
        if (disposed || typeof event.data !== "string") return;
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
          case "geometry":
            if (typeof msg.cols === "number" && typeof msg.rows === "number") {
              h.onGeometry?.({ cols: msg.cols, rows: msg.rows });
            }
            break;
          case "history":
            if (Array.isArray(msg.rows)) {
              h.onHistory?.(
                msg.rows.filter((row: unknown): row is string => typeof row === "string"),
                typeof msg.visible === "number" ? msg.visible : undefined,
              );
            }
            break;
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
        // A reconnect point: the right moment to take the direct road if it is back.
        if (returnToDirect()) return;
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
      unsubscribeDirect();
      const ws = wsRef.current;
      wsRef.current = null;
      ws?.close(1000, "unmount");
    };
  }, [paneId, retryKey, transport]);

  return {
    status,
    transport,
    sendInput,
    sendPaste,
    retry,
    claimKeyboard,
    requestHistory,
    requestResize,
  };
}

function chooseTransport(paneId: string, failedOn: string | null): PaneTransport {
  return shouldUseDirect(
    parsePaneTarget(paneId),
    availabilityOf(directManager.getSnapshot(), failedOn),
  )
    ? "direct"
    : "bridge";
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
  /** Session-log conversation; null until the bridge sends one (or when it has none). */
  chat: ChatState | null;
  /** Opted in to the chat; the bridge has not said yet whether it has a session log. */
  awaitingChat: boolean;
  loadingOlder: boolean;
  /** Request the next older page of `chat`. */
  loadOlder: () => void;
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
 * Observe stream: snapshot · blocks · raw · error, plus the opt-in session-log
 * chat (transcript · append · older · transcript-unavailable, see
 * apps/bridge/src/session-transcript.ts). `enabled` gates the connection so it
 * only runs while the Transcript view is open.
 *
 * Chat opt-in: after the first `snapshot` the client sends `{type:"transcript"}`.
 * A bridge that has a session log answers with a `transcript` page and stops
 * the screen frames; one without answers `transcript-unavailable` and the screen
 * blocks keep flowing. A bridge older than this feature closes 1008 on any client
 * frame: that is remembered (`legacy`) and the reconnect skips the opt-in.
 *
 * `attempts` spans the whole cycle and resets only once the bridge proves the
 * pane is observable (a `snapshot`): the daemon's standard rejection is
 * accept-then-error, which would otherwise hot-loop on an unobservable pane.
 */
export function usePaneObserve(paneId: string, enabled: boolean): PaneObserve {
  const [status, setStatus] = useState<ObserveStatus>(enabled && paneId ? "connecting" : "idle");
  const [mode, setMode] = useState<ObserveMode>("structured");
  const [blocks, setBlocks] = useState<ObserveBlock[]>([]);
  const [rawText, setRawText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [chat, setChat] = useState<ChatState | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [awaitingChat, setAwaitingChat] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const chatRef = useRef<ChatState | null>(null);
  chatRef.current = chat;
  const loadingRef = useRef(false);
  const olderTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const retry = useCallback(() => {
    setStatus("connecting");
    setError(null);
    setRetryKey((k) => k + 1);
  }, []);

  const finishOlder = useCallback(() => {
    clearTimeout(olderTimer.current);
    loadingRef.current = false;
    setLoadingOlder(false);
  }, []);

  /** Page back through the session log; a no-op without more history or an open socket. */
  const loadOlder = useCallback(() => {
    const ws = wsRef.current;
    const state = chatRef.current;
    if (!ws || ws.readyState !== 1 || !state?.hasMore || loadingRef.current) return;
    loadingRef.current = true;
    setLoadingOlder(true);
    // A reply lost to a reconnect must not wedge paging.
    olderTimer.current = setTimeout(finishOlder, 10_000);
    ws.send(JSON.stringify({ type: "older", before: state.cursor }));
  }, [finishOlder]);

  // The bridge predates the chat feed; learned once, kept across reconnects.
  const legacy = useRef(false);

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
      wsRef.current = socket;
      let optedIn = false;
      let chatFed = false;

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
            attempts = 0;
            const next: ObserveMode = msg.mode === "raw" ? "raw" : "structured";
            setMode(next);
            if (next === "raw") {
              if (typeof msg.text === "string") setRawText(msg.text);
            } else {
              setBlocks(parseBlocks(msg.blocks));
            }
            if (!optedIn && !legacy.current) {
              optedIn = true;
              setAwaitingChat(true);
              socket.send(JSON.stringify({ type: "transcript" }));
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
          case "transcript":
            chatFed = true;
            finishOlder();
            setChat((prev) => applyChatFrame(prev, msg));
            setAwaitingChat(false);
            break;
          case "append":
            setChat((prev) => applyChatFrame(prev, msg));
            break;
          case "older":
            finishOlder();
            setChat((prev) => applyChatFrame(prev, msg));
            break;
          // No session log for this pane: the screen blocks are the transcript.
          case "transcript-unavailable":
            if (!chatFed) setChat(null);
            setAwaitingChat(false);
            break;
          case "error":
            setError(typeof msg.error === "string" ? msg.error : "unknown bridge error");
            break;
        }
      };

      socket.onclose = (event) => {
        if (disposed) return;
        if (wsRef.current === socket) wsRef.current = null;
        finishOlder();
        setAwaitingChat(false);
        if (optedIn && !chatFed && event.code === 1008) {
          // Old bridge: it closes on any client frame. Reconnect without the opt-in.
          legacy.current = true;
          reconnectTimer = setTimeout(connect, 0);
          return;
        }
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
      clearTimeout(olderTimer.current);
      loadingRef.current = false;
      wsRef.current = null;
      ws?.close(1000, "unmount");
    };
  }, [paneId, enabled, retryKey, finishOlder]);

  return {
    status,
    mode,
    blocks,
    rawText,
    error,
    retry,
    chat,
    awaitingChat,
    loadingOlder,
    loadOlder,
  };
}
