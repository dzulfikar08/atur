/**
 * DEV-33 contract test: drives usePaneObserve + TranscriptView against a mock
 * of the bridge observe channel (snapshot/blocks/raw/error frames) without
 * the live daemon. Also pins the reconnect policy (1s → 2s → 4s → 8s backoff,
 * then unreachable + manual retry) and the read-only rule (the hook never
 * sends a frame after open).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TranscriptView from "@/components/panes/TranscriptView";
import { usePaneObserve, type PaneObserve } from "@/hooks/usePaneObserve";

/** Minimal event-emitter stand-in for the browser WebSocket (test seam). */
class MockWebSocket {
  static instances: MockWebSocket[] = [];

  url: string;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = 3;
  }

  // ——— test drivers ———
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  /** Server pushes one JSON text frame. */
  push(frame: unknown) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
  /** Server drops the connection. */
  drop() {
    this.readyState = 3;
    this.onclose?.();
  }
}

/** The socket created for the current connection attempt. */
function currentSocket(): MockWebSocket {
  const ws = MockWebSocket.instances.at(-1);
  if (!ws) throw new Error("no WebSocket created");
  return ws;
}

beforeEach(() => {
  MockWebSocket.instances = [];
  vi.stubGlobal("WebSocket", MockWebSocket);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

let latest: PaneObserve | null = null;

function Harness({ paneId = "p1", enabled = true }: { paneId?: string; enabled?: boolean }) {
  const obs = usePaneObserve(paneId, enabled);
  latest = obs;
  return <TranscriptView {...obs} />;
}

const iso = (offsetMs: number) => new Date(Date.UTC(2026, 8, 6, 10, 0, 0) + offsetMs).toISOString();

const structuredSnapshot = {
  type: "snapshot",
  paneId: "p1",
  mode: "structured",
  blocks: [
    {
      id: 1,
      kind: "model",
      title: null,
      model: "claude-sonnet-4",
      startedAt: iso(0),
      endedAt: iso(4200),
      text: "Analyzing the failing test…",
      lineCount: 1,
    },
    {
      id: 2,
      kind: "tool",
      title: "bun test",
      model: null,
      startedAt: iso(4200),
      endedAt: iso(9100),
      text: "$ bun test src/client",
      lineCount: 1,
    },
    {
      id: 3,
      kind: "output",
      title: null,
      model: null,
      startedAt: iso(9100),
      endedAt: null,
      text: "3 pass\n1 fail",
      lineCount: 2,
    },
  ],
};

/** Drive socket lifecycle/frames inside act so React flushes the hook state. */
function drive(fn: (ws: MockWebSocket) => void) {
  act(() => fn(currentSocket()));
}

describe("usePaneObserve + TranscriptView against the bridge contract", () => {
  it("renders structured blocks with model badge, tool title, and timing", () => {
    render(<Harness />);
    expect(currentSocket().url).toBe("ws://localhost/api/panes/observe?pane=p1");
    drive((ws) => {
      ws.open();
      ws.push(structuredSnapshot);
    });

    // Model badge shows block.model; tool shows its title.
    expect(screen.getByText("claude-sonnet-4")).toBeInTheDocument();
    expect(screen.getByText("bun test")).toBeInTheDocument();
    // Per-block timing: 4.2s and 4.9s.
    expect(screen.getByText("4.2s")).toBeInTheDocument();
    expect(screen.getByText("4.9s")).toBeInTheDocument();
    // Running block (no endedAt) gets a duration + running indicator.
    expect(screen.getByText("0.0s…")).toBeInTheDocument();
    // Block text renders.
    expect(screen.getByText(/3 pass/)).toBeInTheDocument();
    // Read-only channel: the hook never sends anything.
    expect(currentSocket().sent).toEqual([]);
  });

  it("replaces blocks wholesale on `blocks` frames (never merges)", () => {
    render(<Harness />);
    drive((ws) => {
      ws.open();
      ws.push(structuredSnapshot);
      ws.push({
        type: "blocks",
        blocks: [
          {
            id: 9,
            kind: "output",
            title: null,
            model: null,
            startedAt: iso(0),
            endedAt: iso(500),
            text: "fresh replacement",
            lineCount: 1,
          },
        ],
      });
    });
    expect(screen.queryByText(/3 pass/)).not.toBeInTheDocument();
    expect(screen.getByText("fresh replacement")).toBeInTheDocument();
  });

  it("collapses blocks over 8 lines and toggles on tap", async () => {
    const user = userEvent.setup();
    const lines = Array.from({ length: 12 }, (_, i) => `line-${i + 1}`).join("\n");
    render(<Harness />);
    drive((ws) => {
      ws.open();
      ws.push({
        type: "snapshot",
        paneId: "p1",
        mode: "structured",
        blocks: [
          {
            id: 1,
            kind: "output",
            title: null,
            model: null,
            startedAt: iso(0),
            endedAt: iso(100),
            text: lines,
            lineCount: 12,
          },
        ],
      });
    });

    // Collapsed by default: text hidden behind a full-width expander.
    expect(screen.queryByText("line-12")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /12 lines — tap to expand/ }));
    expect(screen.getByText(/line-12/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /tap to collapse/i }));
    expect(screen.queryByText("line-12")).not.toBeInTheDocument();
  });

  it("renders error blocks with destructive styling", () => {
    const { container } = render(<Harness />);
    drive((ws) => {
      ws.open();
      ws.push({
        type: "snapshot",
        paneId: "p1",
        mode: "structured",
        blocks: [
          {
            id: 1,
            kind: "error",
            title: null,
            model: null,
            startedAt: iso(0),
            endedAt: iso(50),
            text: "boom",
            lineCount: 1,
          },
        ],
      });
    });
    expect(screen.getByText("Error")).toBeInTheDocument();
    expect(container.querySelector(".border-destructive\\/40")).not.toBeNull();
  });

  it("falls back to a wrapped raw view for mode:raw snapshots and raw frames", () => {
    render(<Harness />);
    drive((ws) => {
      ws.open();
      ws.push({ type: "snapshot", paneId: "p1", mode: "raw", text: "plain\nansi dump" });
    });
    const pre = screen.getByText(/plain/).closest("pre");
    expect(pre).not.toBeNull();
    expect(pre).toHaveClass("whitespace-pre-wrap");
    drive((ws) => ws.push({ type: "raw", paneId: "p1", text: "plain\nansi dump\nmore" }));
    expect(screen.getByText(/more/)).toBeInTheDocument();
  });

  it("shows the waiting placeholder on an empty live pane", () => {
    render(<Harness />);
    drive((ws) => {
      ws.open();
      ws.push({ type: "snapshot", paneId: "p1", mode: "structured", blocks: [] });
    });
    expect(screen.getByText("waiting for output…")).toBeInTheDocument();
  });

  it("surfaces error frames, exhausts backoff into unreachable, then retries", () => {
    vi.useFakeTimers();
    try {
      render(<Harness />);
      // 5 attempts: initial + 4 backoff reconnects (1s, 2s, 4s, 8s).
      for (let attempt = 0; attempt < 5; attempt++) {
        drive((ws) => {
          ws.open();
          if (attempt === 0) ws.push({ type: "error", error: "pane not observable" });
          ws.drop();
        });
        if (attempt < 4) act(() => vi.advanceTimersByTime(15_000));
      }
      expect(MockWebSocket.instances).toHaveLength(5);
      expect(screen.getByText("Transcript unavailable")).toBeInTheDocument();
      expect(screen.getByText("pane not observable")).toBeInTheDocument();

      // Manual retry opens a fresh socket; open + empty stream → placeholder.
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
      expect(MockWebSocket.instances).toHaveLength(6);
      drive((ws) => ws.open());
      expect(latest?.status).toBe("connected");
      expect(screen.getByText("waiting for output…")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("disconnects while disabled and reconnects when re-enabled", () => {
    const { rerender } = render(<Harness enabled={false} />);
    expect(MockWebSocket.instances).toHaveLength(0);
    expect(latest?.status).toBe("idle");

    act(() => rerender(<Harness enabled />));
    drive((ws) => {
      ws.open();
      ws.push(structuredSnapshot);
    });
    expect(latest?.status).toBe("connected");
    expect(screen.getByText("claude-sonnet-4")).toBeInTheDocument();
  });
});
