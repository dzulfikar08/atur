import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Code2, FileText } from "@/lib/icons";
import { usePaneAttach, type PaneAttachStatus } from "@/hooks/usePaneAttach";
import { usePaneObserve } from "@/hooks/usePaneObserve";
import TranscriptView from "@/components/panes/TranscriptView";
import { PromptComposer } from "@/components/panes/PromptComposer";
import { TerminalKeyRow } from "@/components/panes/TerminalKeyRow";
import { applyModifiers, fitFontSize, type Modifiers } from "@/lib/terminalKeys";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

const FIT_KEY = "atur.pane.fit";

const STATUS_LABELS: Record<PaneAttachStatus, string> = {
  connecting: "Connecting…",
  connected: "Live",
  reconnecting: "Reconnecting…",
  unreachable: "Unreachable",
  exited: "Exited",
};

function statusBadgeVariant(status: PaneAttachStatus) {
  switch (status) {
    case "connected":
      return "default" as const;
    case "exited":
    case "unreachable":
      return "destructive" as const;
    default:
      return "secondary" as const;
  }
}

export default function PaneViewPage() {
  const { paneId } = useParams();
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const [bridgeError, setBridgeError] = useState<string | null>(null);
  // Keyboard ownership is bridge-arbitrated: hello + keyboard frames decide,
  // the button only asks. Starts read-only on every (re)connect.
  const [ownsKeyboard, setOwnsKeyboard] = useState(false);
  // Touch devices get the app's extras: a key row for keys a phone keyboard
  // lacks, and "Fit width" (the pane's grid is fixed, phones are narrow).
  const [touch] = useState(() => window.matchMedia?.("(pointer: coarse)").matches ?? false);
  const [mods, setMods] = useState<Modifiers>({ ctrl: false, alt: false });
  const modsRef = useRef(mods);
  modsRef.current = mods;
  const [fit, setFit] = useState(() => localStorage.getItem(FIT_KEY) !== "0");
  const [cols, setCols] = useState(0);

  // Pane meta (title, cwd, agent) comes from the shared panes list cache; the
  // view still works if the list is unavailable — the id is the fallback title.
  const panesQuery = useQuery({ queryKey: ["panes"], queryFn: api.listPanes });
  const pane = panesQuery.data?.panes.find((p) => p.pane_id === paneId);

  const { status, sendInput, sendPaste, retry, claimKeyboard } = usePaneAttach(paneId ?? "", {
    // hello carries the real pane geometry — the grid is authoritative.
    onHello: ({ cols, rows, keyboard }) => {
      setOwnsKeyboard(keyboard === true);
      setCols(cols);
      termRef.current?.resize(cols, rows);
    },
    // Full frame: home + clear + replay in ONE write (one parse pass → one
    // repaint, no clear/draw flash). term.reset() is never used per frame —
    // it blanks the screen and forces a second paint.
    onSnapshot: (ansi) => {
      setBridgeError(null);
      termRef.current?.write("\x1b[H\x1b[2J\x1b[?25l" + ansi + "\x1b[?25l");
    },
    // Diff: repaint only changed rows, cursor-addressed, in one write. The
    // cursor stays hidden — herdr's dump carries no cursor position, so a
    // visible cursor would just sit at the wrong spot.
    onDiff: (rows) => {
      let data = "";
      for (const [row, line] of rows) {
        data += `\x1b[${row + 1};1H\x1b[2K` + line;
      }
      data += "\x1b[?25l";
      termRef.current?.write(data);
    },
    onKeyboard: (you) => setOwnsKeyboard(you),
    onError: (message) => setBridgeError(message),
  });

  // Transcript view (DEV-33): read-only structured stream beside the raw
  // xterm. Terminal stays the default; the observe socket only connects
  // while the Transcript view is open.
  const [view, setView] = useState<"terminal" | "transcript">("terminal");
  const observe = usePaneObserve(paneId ?? "", view === "transcript");

  // One terminal per mount; the socket hook owns (re)connection, this effect
  // only owns the xterm instance and its keyboard wiring.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !paneId) return;
    const term = new Terminal({
      cursorBlink: false,
      scrollback: 2000,
      fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      fontSize: 13,
      theme: {
        background: "#0a0a0a",
        foreground: "#e5e5e5",
        cursor: "#e5e5e5",
      },
    });
    termRef.current = term;
    term.open(container);
    term.focus();

    return () => {
      term.dispose();
      termRef.current = null;
    };
  }, [paneId]);

  // Keyboard wiring follows ownership: read-only viewers get no onData pipe
  // at all (the bridge would reject the input anyway). Re-wired when
  // ownership flips so a Take keyboard click starts typing immediately.
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    if (!ownsKeyboard) return;
    // Sticky Ctrl/Alt from the key row act on the next key typed.
    const disposable = term.onData((data) => {
      const m = modsRef.current;
      if (m.ctrl || m.alt) {
        sendInput(applyModifiers(data, m));
        setMods({ ctrl: false, alt: false });
      } else {
        sendInput(data);
      }
    });
    term.focus();
    return () => disposable.dispose();
  }, [ownsKeyboard, sendInput, status]);

  // Fit width (touch only): size the font so the pane's columns fill the box.
  useEffect(() => {
    const term = termRef.current;
    const box = containerRef.current?.parentElement;
    if (!term || !box) return;
    const apply = () => {
      const size = touch && fit && cols > 0 ? fitFontSize(box.clientWidth - 16, cols) : 13;
      if (term.options.fontSize !== size) term.options.fontSize = size;
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(box);
    return () => observer.disconnect();
  }, [touch, fit, cols]);

  const pressKey = (data: string) => {
    sendInput(applyModifiers(data, mods));
    if (mods.ctrl || mods.alt) setMods({ ctrl: false, alt: false });
  };
  if (!paneId) return null;

  const paneGone = status === "exited" || status === "unreachable";

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Header: on a phone the title takes the first line, controls wrap below. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b pb-4">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate("/panes")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1 basis-48">
          <h1 className="truncate text-lg font-semibold">{pane?.title ?? paneId}</h1>
          <p className="truncate text-xs text-muted-foreground">
            {[pane?.machine?.name, pane?.workspace_label, pane?.agent, pane?.cwd]
              .filter(Boolean)
              .join(" · ") || paneId}
          </p>
        </div>
        {ownsKeyboard ? (
          <Badge variant="default">Keyboard: yours</Badge>
        ) : (
          <Badge variant="outline">Read-only</Badge>
        )}
        {!ownsKeyboard && status === "connected" && (
          <Button variant="outline" size="sm" onClick={claimKeyboard}>
            Take keyboard
          </Button>
        )}
        {touch && cols > 0 && (
          <Button
            variant="outline"
            size="sm"
            aria-pressed={fit}
            onClick={() => {
              localStorage.setItem(FIT_KEY, fit ? "0" : "1");
              setFit(!fit);
            }}
          >
            {fit ? "Actual size" : "Fit width"}
          </Button>
        )}
        <Badge variant={statusBadgeVariant(status)}>{STATUS_LABELS[status]}</Badge>
      </div>

      {bridgeError && <p className="text-sm text-destructive">Bridge error: {bridgeError}</p>}

      {/* Terminal | Transcript — shadcn tabs, the repo's standard toggle.
          forceMount keeps the xterm DOM alive across switches: its effect is
          keyed by paneId only, so unmounting would orphan the Terminal from
          its (rebuilt) container. Radix leaves hiding to us via data-state,
          hence the explicit `hidden` class. */}
      <Tabs
        value={view}
        onValueChange={(v) => setView(v as "terminal" | "transcript")}
        className="flex min-h-0 flex-1 flex-col"
      >
        <TabsList>
          <TabsTrigger value="terminal">
            <Code2 className="mr-1.5 h-3.5 w-3.5" />
            Terminal
          </TabsTrigger>
          <TabsTrigger value="transcript">
            <FileText className="mr-1.5 h-3.5 w-3.5" />
            Transcript
          </TabsTrigger>
        </TabsList>
        <TabsContent
          value="terminal"
          forceMount
          className={cn("min-h-0 flex-1", view !== "terminal" && "hidden")}
        >
          <div className="relative min-h-[320px] h-[65vh] overflow-auto rounded-lg border bg-[#0a0a0a] p-2">
            <div ref={containerRef} className="h-full" />

            {paneGone && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-lg bg-black/85">
                <Code2 className="h-8 w-8 text-muted-foreground" />
                {status === "exited" ? (
                  <>
                    <p className="font-medium text-foreground">Pane exited</p>
                    <p className="text-sm text-muted-foreground">
                      The terminal pane closed on the execution plane.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="font-medium text-foreground">Execution plane unreachable</p>
                    <p className="text-sm text-muted-foreground">
                      Gave up after several attempts — the bridge may be offline.
                    </p>
                  </>
                )}
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={retry}>
                    Reconnect
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => navigate("/panes")}>
                    Back to panes
                  </Button>
                </div>
              </div>
            )}
          </div>
          {touch && ownsKeyboard && !paneGone && (
            <div className="mt-2">
              <TerminalKeyRow
                mods={mods}
                onToggle={(mod) => setMods((m) => ({ ...m, [mod]: !m[mod] }))}
                onKey={pressKey}
              />
            </div>
          )}
          {pane?.agent && !paneGone && (
            <div className="mt-2">
              <PromptComposer
                paneId={paneId}
                enabled={ownsKeyboard && status === "connected"}
                onSend={(text) => sendPaste(text, true)}
              />
            </div>
          )}
        </TabsContent>
        <TabsContent value="transcript" className="min-h-0 flex-1">
          <TranscriptView {...observe} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
