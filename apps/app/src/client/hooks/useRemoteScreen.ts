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
    const wsUrl = isNative()
      ? resolveWsUrl("/api/screen/ws")
      : `${protocol}//${window.location.host}/api/screen/ws`;
    const socket = new WebSocket(wsUrl);
    socket.binaryType = "arraybuffer";
    const rfb = new RFB(target, socket, { shared: true });
    rfbRef.current = rfb;

    rfb.viewOnly = viewOnlyRef.current;
    rfb.scaleViewport = true;
    rfb.clipViewport = false;
    rfb.resizeSession = false;
    rfb.focusOnClick = true;
    rfb.showDotCursor = true;
    rfb.qualityLevel = 6;
    rfb.compressionLevel = 2;

    rfb.addEventListener("connect", () => {
      setStatus("connected");
      if (!viewOnlyRef.current) rfb.focus();
    });
    rfb.addEventListener("disconnect", (e) => {
      setStatus("disconnected");
      setDropped(!(e as CustomEvent<{ clean: boolean }>).detail.clean);
      if (rfbRef.current === rfb) rfbRef.current = null;
    });
    rfb.addEventListener("clipboard", (e) => {
      const text = (e as CustomEvent<{ text: string }>).detail.text;
      setRemoteClipboard(text);
      // Best effort: browsers only allow this with a recent user gesture.
      navigator.clipboard?.writeText(text).catch(() => {});
    });

    return () => {
      if (rfbRef.current === rfb) rfbRef.current = null;
      try {
        rfb.disconnect();
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
