import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Code2 } from "@/lib/icons";
import { usePaneAttach, type PaneAttachStatus } from "@/hooks/usePaneAttach";

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

  // Pane meta (title, cwd, agent) comes from the shared panes list cache; the
  // view still works if the list is unavailable — the id is the fallback title.
  const panesQuery = useQuery({ queryKey: ["panes"], queryFn: api.listPanes });
  const pane = panesQuery.data?.panes.find((p) => p.pane_id === paneId);

  const { status, sendInput, retry } = usePaneAttach(paneId ?? "", {
    // hello carries the real pane geometry — the grid is authoritative.
    onHello: ({ cols, rows }) => termRef.current?.resize(cols, rows),
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
    onError: (message) => setBridgeError(message),
  });

  // One terminal per mount; the socket hook owns (re)connection, this effect
  // only owns the xterm instance and its keyboard wiring.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !paneId) return;
    const term = new Terminal({
      cursorBlink: false,
      scrollback: 2000,
      fontFamily:
        "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      fontSize: 13,
      theme: {
        background: "#0a0a0a",
        foreground: "#e5e5e5",
        cursor: "#e5e5e5",
      },
    });
    termRef.current = term;
    term.open(container);
    term.onData((data) => sendInput(data));
    term.focus();

    return () => {
      term.dispose();
      termRef.current = null;
    };
  }, [paneId, sendInput]);

  if (!paneId) return null;

  const paneGone = status === "exited" || status === "unreachable";

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Header */}
      <div className="flex items-center gap-3 border-b pb-4">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => navigate("/panes")}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold">
            {pane?.title ?? paneId}
          </h1>
          <p className="truncate text-xs text-muted-foreground">
            {[pane?.workspace_label, pane?.agent, pane?.cwd]
              .filter(Boolean)
              .join(" · ") || paneId}
          </p>
        </div>
        <Badge variant={statusBadgeVariant(status)}>{STATUS_LABELS[status]}</Badge>
      </div>

      {bridgeError && (
        <p className="text-sm text-destructive">Bridge error: {bridgeError}</p>
      )}

      {/* Terminal */}
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
    </div>
  );
}
