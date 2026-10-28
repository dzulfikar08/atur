/**
 * useRemoteScreen: noVNC session to the ThinkPad desktop.
 *
 * Opens GET /api/screen/ws (superuser-only; the Worker relays raw RFB bytes to
 * the bridge's loopback wayvnc) and renders it into `containerRef`. Owns the
 * RFB instance, scaling/view-only wiring, clipboard sync and the keyboard
 * helpers (typed text, soft-keyboard diffing, modifier-wrapped taps). The
 * session never auto-reconnects: a viewer joining pops a notification on the
 * desktop, so every (re)connect is an explicit user action.
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import RFB from "@novnc/novnc";
import { isNative, resolveWsUrl } from "@/lib/native";
import { apiFetch } from "@/lib/api";
import { KEYSYM, charToKeysym } from "@/lib/screenKeys";

export type RemoteScreenStatus = "idle" | "connecting" | "connected" | "disconnected";

export interface Modifiers {
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
  super?: boolean;
}

export interface RemoteScreenOptions {
  /** Connect only while true (e.g. after the status preflight passed). */
  enabled: boolean;
  viewOnly: boolean;
  /** true = scale the desktop to the container; false = 1:1 with drag-to-pan. */
  fit: boolean;
}

export interface RemoteScreen {
  status: RemoteScreenStatus;
  /** Set when the last session ended without a clean RFB shutdown. */
  dropped: boolean;
  /** Last clipboard text pushed by the remote desktop. */
  remoteClipboard: string;
  reconnect: () => void;
  disconnect: () => void;
  /** Press and release one key, wrapped in `mods`. */
  tap: (keysym: number, mods?: Modifiers) => void;
  /** Type `text` character by character (works where remote paste can't). */
  typeText: (text: string) => Promise<void>;
  /** Replace the remote clipboard; optionally follow with Ctrl+V. */
  pasteToRemote: (text: string, pressPaste: boolean) => void;
  sendCtrlAltDel: () => void;
  focus: () => void;
}

const MOD_KEYSYMS: [keyof Modifiers, number][] = [
  ["ctrl", KEYSYM.ControlL],
  ["alt", KEYSYM.AltL],
  ["shift", KEYSYM.ShiftL],
  ["super", KEYSYM.SuperL],
];

/** How long the direct socket gets to open before we use the Worker relay. */
const DIRECT_OPEN_MS = 3500;
/** After a direct miss (404 or unreachable), skip the probe for this long. */
const DIRECT_SKIP_MS = 60_000;
let directSkipUntil = 0;

/**
 * Open the bridge's direct (tailnet) screen socket: the Worker mints a
 * one-time ticket and names the URL; null when there is none or the socket
 * does not open in time, so the caller falls back to the Worker relay.
 */
async function openDirect(): Promise<WebSocket | null> {
  if (Date.now() < directSkipUntil) return null;
  try {
    const d = await apiFetch<{ url: string; ticket: string }>("/screen/direct", {
      method: "POST",
    });
    const socket = new WebSocket(`${d.url}?ticket=${encodeURIComponent(d.ticket)}`);
    const { promise, resolve } = Promise.withResolvers<boolean>();
    const timer = setTimeout(() => resolve(false), DIRECT_OPEN_MS);
    socket.addEventListener("open", () => resolve(true), { once: true });
    socket.addEventListener("error", () => resolve(false), { once: true });
    socket.addEventListener("close", () => resolve(false), { once: true });
    const opened = await promise;
    clearTimeout(timer);
    if (opened) return socket;
    socket.close();
  } catch {
    /* no direct path */
  }
  directSkipUntil = Date.now() + DIRECT_SKIP_MS;
  return null;
}

export function useRemoteScreen(
  containerRef: RefObject<HTMLDivElement | null>,
  { enabled, viewOnly, fit }: RemoteScreenOptions,
): RemoteScreen {
  const rfbRef = useRef<RFB | null>(null);
  const viewOnlyRef = useRef(viewOnly);
  viewOnlyRef.current = viewOnly;
  const [status, setStatus] = useState<RemoteScreenStatus>("idle");
  const [dropped, setDropped] = useState(false);
  const [remoteClipboard, setRemoteClipboard] = useState("");
  const [session, setSession] = useState(0);

  useEffect(() => {
    const target = containerRef.current;
    if (!enabled || !target) return;

    setStatus("connecting");
    setDropped(false);
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const relayUrl = isNative()
      ? resolveWsUrl("/api/screen/ws")
      : `${protocol}//${window.location.host}/api/screen/ws`;
    let rfb: RFB | null = null;
    let cancelled = false;

    const attach = (socket: WebSocket) => {
      socket.binaryType = "arraybuffer";
      const session = new RFB(target, socket, { shared: true });
      rfb = session;
      rfbRef.current = session;
      session.viewOnly = viewOnlyRef.current;
      session.scaleViewport = true;
      session.clipViewport = false;
      session.resizeSession = false;
      session.focusOnClick = true;
      session.showDotCursor = true;
      session.qualityLevel = 6;
      session.compressionLevel = 2;

      session.addEventListener("connect", () => {
        setStatus("connected");
        if (!viewOnlyRef.current) session.focus();
      });
      session.addEventListener("disconnect", (e) => {
        setStatus("disconnected");
        setDropped(!(e as CustomEvent<{ clean: boolean }>).detail.clean);
        if (rfbRef.current === session) rfbRef.current = null;
      });
      session.addEventListener("clipboard", (e) => {
        const text = (e as CustomEvent<{ text: string }>).detail.text;
        setRemoteClipboard(text);
        // Best effort: browsers only allow this with a recent user gesture.
        navigator.clipboard?.writeText(text).catch(() => {});
      });
    };

    void (async () => {
      // Prefer the bridge's tailnet listener (no Cloudflare hop) when the
      // Worker offers one and this browser can reach it; any failure falls
      // through to the Worker relay, which always works.
      if (!isNative()) {
        const socket = await openDirect();
        if (cancelled) {
          socket?.close();
          return;
        }
        if (socket) {
          attach(socket);
          return;
        }
      }
      attach(new WebSocket(relayUrl));
    })();

    return () => {
      cancelled = true;
      const live = rfb as RFB | null;
      if (live && rfbRef.current === live) rfbRef.current = null;
      try {
        live?.disconnect();
      } catch {
        /* already disconnected */
      }
      // noVNC leaves its canvas wrapper behind in the target.
      target.replaceChildren();
    };
  }, [containerRef, enabled, session]);

  useEffect(() => {
    const rfb = rfbRef.current;
    if (rfb) rfb.viewOnly = viewOnly;
  }, [viewOnly, status]);

  useEffect(() => {
    const rfb = rfbRef.current;
    if (!rfb) return;
    rfb.scaleViewport = fit;
    rfb.clipViewport = !fit;
    rfb.dragViewport = !fit;
  }, [fit, status]);

  const reconnect = useCallback(() => setSession((n) => n + 1), []);

  const disconnect = useCallback(() => {
    rfbRef.current?.disconnect();
  }, []);

  const tap = useCallback((keysym: number, mods: Modifiers = {}) => {
    const rfb = rfbRef.current;
    if (!rfb || viewOnlyRef.current) return;
    const held = MOD_KEYSYMS.filter(([name]) => mods[name]);
    for (const [, sym] of held) rfb.sendKey(sym, null, true);
    rfb.sendKey(keysym, null, true);
    rfb.sendKey(keysym, null, false);
    for (const [, sym] of [...held].reverse()) rfb.sendKey(sym, null, false);
  }, []);

  const typeText = useCallback(async (text: string) => {
    for (const ch of text) {
      const rfb = rfbRef.current;
      if (!rfb || viewOnlyRef.current) return;
      const keysym = charToKeysym(ch);
      if (keysym === null) continue;
      rfb.sendKey(keysym, null, true);
      rfb.sendKey(keysym, null, false);
      // Yield so a long paste doesn't flood the socket in one frame.
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 3);
      await promise;
    }
  }, []);

  const pasteToRemote = useCallback(
    (text: string, pressPaste: boolean) => {
      const rfb = rfbRef.current;
      if (!rfb || viewOnlyRef.current) return;
      rfb.clipboardPasteFrom(text);
      // Give wayvnc a moment to publish the selection before the keystroke.
      if (pressPaste) setTimeout(() => tap(0x76, { ctrl: true }), 80);
    },
    [tap],
  );

  const sendCtrlAltDel = useCallback(() => {
    if (!viewOnlyRef.current) rfbRef.current?.sendCtrlAltDel();
  }, []);

  const focus = useCallback(() => rfbRef.current?.focus(), []);

  return {
    status,
    dropped,
    remoteClipboard,
    reconnect,
    disconnect,
    tap,
    typeText,
    pasteToRemote,
    sendCtrlAltDel,
    focus,
  };
}
