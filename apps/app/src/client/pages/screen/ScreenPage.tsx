import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiError, apiFetch } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Eye, EyeOff, Maximize, Minimize, Monitor, RefreshCw, X } from "@/lib/icons";
import { useRemoteScreen, type Modifiers, type RemoteScreenStatus } from "@/hooks/useRemoteScreen";
import { KEYSYM, charToKeysym, diffInput } from "@/lib/screenKeys";
import { cn } from "@/lib/utils";

interface ScreenBridgeStatus {
  available: boolean;
  running: boolean;
  viewers: number;
}

const STATUS_LABEL: Record<RemoteScreenStatus, string> = {
  idle: "Idle",
  connecting: "Connecting…",
  connected: "Live",
  disconnected: "Disconnected",
};

// The soft keyboard's hidden textarea always holds this sentinel so Backspace
// has something to delete (Android fires no input event on an empty field).
const SENTINEL = "\u200b\u200b";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

function preflightMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 403) return "Screen is limited to the platform owner.";
    if (err.status === 502) return "The ThinkPad bridge is unreachable.";
  }
  return "Couldn't check desktop sharing.";
}

const EXTRA_KEYS: { label: string; keysym: number }[] = [
  { label: "Esc", keysym: KEYSYM.Escape },
  { label: "Tab", keysym: KEYSYM.Tab },
  { label: "←", keysym: KEYSYM.Left },
  { label: "↑", keysym: KEYSYM.Up },
  { label: "↓", keysym: KEYSYM.Down },
  { label: "→", keysym: KEYSYM.Right },
  { label: "⏎", keysym: KEYSYM.Return },
];

const STICKY_MODS: { name: keyof Modifiers; label: string }[] = [
  { name: "ctrl", label: "Ctrl" },
  { name: "alt", label: "Alt" },
  { name: "shift", label: "Shift" },
  { name: "super", label: "Super" },
];

export default function ScreenPage() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const kbdRef = useRef<HTMLTextAreaElement | null>(null);

  const [viewOnly, setViewOnly] = useState(false);
  const [fit, setFit] = useState(true);
  const [cmdAsCtrl, setCmdAsCtrl] = useState(isMac);
  const [nativeFullscreen, setNativeFullscreen] = useState(false);
  const [cssFullscreen, setCssFullscreen] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [mods, setMods] = useState<Modifiers>({});

  const statusQuery = useQuery({
    queryKey: ["screen-status"],
    queryFn: () => apiFetch<ScreenBridgeStatus>("/screen/status"),
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 0,
  });
  const ready = statusQuery.data?.available === true;

  const screen = useRemoteScreen(containerRef, { enabled: ready, viewOnly, fit });
  const { tap, typeText, pasteToRemote, focus } = screen;
  const connected = screen.status === "connected";
  const modsRef = useRef(mods);
  modsRef.current = mods;

  // Sticky on-screen modifiers apply to the next key, then release.
  const takeMods = useCallback((): Modifiers => {
    const held = modsRef.current;
    if (Object.values(held).some(Boolean)) setMods({});
    return held;
  }, []);

  // Keys captured above noVNC's own handler (which sits on the canvas):
  //  - Ctrl/Cmd+V is left to the browser's paste event below, so the remote
  //    never gets a raw Ctrl+V before its clipboard is set (double paste).
  //  - With Cmd→Ctrl on, Cmd+<letter> is sent as Ctrl+<letter> and a bare Cmd
  //    press never reaches the remote (Super+V would toggle floating in Hyprland).
  useEffect(() => {
    const root = containerRef.current;
    if (!root || !connected || viewOnly) return;
    const onKey = (e: KeyboardEvent) => {
      if (cmdAsCtrl && e.key === "Meta") {
        e.stopPropagation();
        e.preventDefault();
        return;
      }
      if (e.key.length !== 1 || e.altKey) return;
      const cmd = cmdAsCtrl && e.metaKey && !e.ctrlKey;
      if (!cmd && !e.ctrlKey) return;
      if (e.key.toLowerCase() === "v") {
        e.stopPropagation(); // no preventDefault: the paste event must still fire
        return;
      }
      if (!cmd) return;
      e.stopPropagation();
      e.preventDefault();
      if (e.type !== "keydown") return;
      const keysym = charToKeysym(e.key.toLowerCase());
      if (keysym !== null) tap(keysym, { ctrl: true, shift: e.shiftKey });
    };
    root.addEventListener("keydown", onKey, true);
    root.addEventListener("keyup", onKey, true);
    return () => {
      root.removeEventListener("keydown", onKey, true);
      root.removeEventListener("keyup", onKey, true);
    };
  }, [connected, viewOnly, cmdAsCtrl, tap]);

  // Browser paste (Cmd/Ctrl+V on the viewer) → remote clipboard + Ctrl+V.
  useEffect(() => {
    if (!connected || viewOnly) return;
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("[data-local-input]")) return;
      const text = e.clipboardData?.getData("text/plain");
      if (!text) return;
      e.preventDefault();
      pasteToRemote(text, true);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [connected, viewOnly, pasteToRemote]);

  // Native fullscreen where supported (not iPhone Safari → CSS-expanded fallback).
  useEffect(() => {
    const sync = () => setNativeFullscreen(document.fullscreenElement === rootRef.current);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);
  const toggleFullscreen = () => {
    const root = rootRef.current;
    if (!root) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else if (cssFullscreen) {
      setCssFullscreen(false);
    } else if (root.requestFullscreen) {
      root.requestFullscreen().catch(() => setCssFullscreen(true));
    } else {
      setCssFullscreen(true);
    }
  };
  const fullscreen = nativeFullscreen || cssFullscreen;

  const onKeyboardInput = () => {
    const ta = kbdRef.current;
    if (!ta) return;
    const { deleted, inserted } = diffInput(SENTINEL, ta.value);
    ta.value = SENTINEL;
    ta.setSelectionRange(SENTINEL.length, SENTINEL.length);
    for (let i = 0; i < deleted; i++) tap(KEYSYM.BackSpace);
    for (const ch of inserted) {
      const keysym = charToKeysym(ch);
      if (keysym !== null) tap(keysym, takeMods());
    }
  };

  const toggleKeyboard = () => {
    const ta = kbdRef.current;
    if (!ta) return;
    if (document.activeElement === ta) {
      ta.blur();
      setKeysOpen(false);
    } else {
      ta.value = SENTINEL;
      ta.focus();
      setKeysOpen(true);
    }
  };

  const sendPaste = async (mode: "clipboard" | "type") => {
    const text = pasteText;
    if (!text) return;
    setPasteOpen(false);
    setPasteText("");
    if (mode === "type") await typeText(text);
    else pasteToRemote(text, true);
    focus();
  };

  const readLocalClipboard = async () => {
    try {
      setPasteText(await navigator.clipboard.readText());
    } catch {
      /* permission denied — the user can paste into the box by hand */
    }
  };

  const error = statusQuery.isError
    ? preflightMessage(statusQuery.error)
    : statusQuery.data && !statusQuery.data.available
      ? "Desktop sharing isn't available on the ThinkPad (wayvnc or the Wayland session is missing)."
      : null;

  return (
    <div
      ref={rootRef}
      className={cn(
        "flex min-h-0 flex-col gap-2 bg-background",
        // AppShell's <main> has no fixed height, so size against the viewport
        // minus the top bar and the shell's padding at each breakpoint.
        fullscreen
          ? "fixed inset-0 z-50 p-2"
          : "h-[calc(100dvh-9.5rem)] md:h-[calc(100dvh-6.5rem)] lg:h-[calc(100dvh-7.5rem)]",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Monitor className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">Screen</span>
        <Badge variant={connected ? "default" : "secondary"}>{STATUS_LABEL[screen.status]}</Badge>
        {viewOnly && <Badge variant="outline">View only</Badge>}
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <Button size="sm" variant="outline" onClick={() => setPasteOpen((v) => !v)}>
            Paste
          </Button>
          <Button size="sm" variant="outline" onClick={toggleKeyboard}>
            Keyboard
          </Button>
          <Button
            size="sm"
            variant={viewOnly ? "default" : "outline"}
            onClick={() => setViewOnly((v) => !v)}
          >
            {viewOnly ? <EyeOff /> : <Eye />}
            View only
          </Button>
          <Button size="sm" variant="outline" onClick={() => setFit((v) => !v)}>
            {fit ? "1:1" : "Fit"}
          </Button>
          {isMac && (
            <Button
              size="sm"
              variant={cmdAsCtrl ? "default" : "outline"}
              onClick={() => setCmdAsCtrl((v) => !v)}
              title="Send ⌘ shortcuts as Ctrl on the ThinkPad"
            >
              ⌘→Ctrl
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={toggleFullscreen}>
            {fullscreen ? <Minimize /> : <Maximize />}
            {fullscreen ? "Exit" : "Full screen"}
          </Button>
          {connected ? (
            <Button size="sm" variant="outline" onClick={screen.disconnect}>
              Disconnect
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              disabled={!ready || screen.status === "connecting"}
              onClick={screen.reconnect}
            >
              <RefreshCw />
              {screen.status === "idle" ? "Connect" : "Reconnect"}
            </Button>
          )}
        </div>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden rounded-lg border border-border/80 bg-black">
        <div ref={containerRef} className="size-full" />
        {(error || (screen.status === "disconnected" && !pasteOpen)) && (
          <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-muted-foreground">
            {error ??
              (screen.dropped
                ? "Connection lost. The ThinkPad may be asleep, or the bridge restarted."
                : "Disconnected.")}
          </div>
        )}
        {statusQuery.isPending && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            Checking the ThinkPad…
          </div>
        )}

        {pasteOpen && (
          <div
            data-local-input
            className="absolute right-3 top-3 z-10 flex w-[min(24rem,calc(100%-1.5rem))] flex-col gap-2 rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-lg"
          >
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Send text to the ThinkPad</span>
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto size-7 p-0"
                aria-label="Close"
                onClick={() => setPasteOpen(false)}
              >
                <X />
              </Button>
            </div>
            <Textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder="Password, 2FA code, anything…"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              rows={3}
            />
            <div className="flex flex-wrap gap-1.5">
              <Button size="sm" variant="outline" onClick={readLocalClipboard}>
                From my clipboard
              </Button>
              <Button size="sm" disabled={!pasteText || viewOnly} onClick={() => sendPaste("type")}>
                Type it
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!pasteText || viewOnly}
                onClick={() => sendPaste("clipboard")}
              >
                Paste (Ctrl+V)
              </Button>
              {screen.remoteClipboard && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void navigator.clipboard?.writeText(screen.remoteClipboard)}
                >
                  Copy ThinkPad clipboard
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              “Type it” sends keystrokes, so it works in password fields that block paste.
            </p>
          </div>
        )}
      </div>

      {keysOpen && connected && (
        <div className="flex flex-wrap items-center gap-1.5">
          {STICKY_MODS.map(({ name, label }) => (
            <Button
              key={name}
              size="sm"
              variant={mods[name] ? "default" : "outline"}
              onClick={() => setMods((m) => ({ ...m, [name]: !m[name] }))}
            >
              {label}
            </Button>
          ))}
          {EXTRA_KEYS.map(({ label, keysym }) => (
            <Button key={label} size="sm" variant="outline" onClick={() => tap(keysym, takeMods())}>
              {label}
            </Button>
          ))}
          <Button size="sm" variant="outline" onClick={screen.sendCtrlAltDel}>
            Ctrl+Alt+Del
          </Button>
        </div>
      )}

      {/* Soft keyboard sink: off-screen but focusable so iOS/Android raise their keyboard. */}
      <textarea
        ref={kbdRef}
        data-local-input
        aria-label="Remote keyboard input"
        className="pointer-events-none fixed bottom-0 left-0 size-px opacity-0"
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        defaultValue={SENTINEL}
        onInput={onKeyboardInput}
        onKeyDown={(e) => {
          // Enter/Tab/arrows don't always produce input events; send them directly.
          const named: Record<string, number> = {
            Enter: KEYSYM.Return,
            Tab: KEYSYM.Tab,
            Escape: KEYSYM.Escape,
            ArrowLeft: KEYSYM.Left,
            ArrowRight: KEYSYM.Right,
            ArrowUp: KEYSYM.Up,
            ArrowDown: KEYSYM.Down,
          };
          const keysym = named[e.key];
          if (keysym !== undefined) {
            e.preventDefault();
            tap(keysym, takeMods());
          }
        }}
      />
    </div>
  );
}
