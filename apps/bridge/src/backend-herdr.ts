/**
 * herdr backend: the socket API (herdr.ts) behind PaneBackend. Request
 * parameters and response handling are exactly what hub.ts, observe.ts and
 * agent-events.ts used to do inline, so herdr deployments see no change.
 */
import {
  PaneGoneError,
  type AgentStatus,
  type CreatedWorkspace,
  type PaneBackend,
  type PaneSummary,
  type ScreenRead,
  type SplitDirection,
} from "./backend";
import { HerdrError, rpc } from "./herdr";
import { PaneSizer, type GridSize } from "./sizer";

interface HerdrPane {
  pane_id: string;
  workspace_id: string;
  tab_id: string;
  cwd?: string | null;
  agent?: string | null;
  agent_status?: string | null;
  agent_session?: { kind?: string; value?: string } | null;
  terminal_title?: string | null;
  terminal_title_stripped?: string | null;
  revision: number;
}

interface PaneReadPayload {
  read: { pane_id: string; text: string; revision: number; truncated: boolean };
}

interface PaneRect {
  pane_id: string;
  rect: { width: number; height: number };
}

/** Only a missing pane is terminal; transient herdr hiccups must not look like exits. */
function asPaneGone(e: unknown): unknown {
  const gone = e instanceof HerdrError && /not_found|no such/i.test(e.code + " " + e.message);
  return gone ? new PaneGoneError((e as Error).message) : e;
}

function summarize(pane: HerdrPane, workspaceLabel: string): PaneSummary {
  const session = pane.agent_session;
  return {
    id: pane.pane_id,
    workspaceId: pane.workspace_id,
    workspaceLabel,
    tabId: pane.tab_id,
    cwd: pane.cwd ?? null,
    title: pane.terminal_title_stripped ?? pane.terminal_title ?? null,
    agent: pane.agent ?? null,
    agentStatus: (pane.agent_status ?? null) as AgentStatus | null,
    agentSessionPath: session?.kind === "path" && session.value ? session.value : null,
    revision: pane.revision,
  };
}

export class HerdrBackend implements PaneBackend {
  readonly kind = "herdr";
  /** Lays panes out at the keyboard owner's phone size (see sizer.ts). */
  private readonly sizer = new PaneSizer();

  async listPanes(): Promise<PaneSummary[]> {
    const [{ workspaces }, { panes }] = await Promise.all([
      rpc<{ workspaces: { workspace_id: string; label: string }[] }>("workspace.list"),
      rpc<{ panes?: HerdrPane[] }>("pane.list", {}),
    ]);
    // One unfiltered list: the workspace filter is `workspace_id`, and an
    // unknown key (the old `workspace`) is silently ignored, which returned
    // every pane once per workspace, each time under that workspace's label.
    const labels = new Map(workspaces.map((w) => [w.workspace_id, w.label]));
    return (panes ?? []).map((pane) => summarize(pane, labels.get(pane.workspace_id) ?? ""));
  }

  async pollPanes(): Promise<PaneSummary[]> {
    const res = await rpc<{ panes?: HerdrPane[] }>("pane.list", {});
    return (res.panes ?? []).map((pane) => summarize(pane, ""));
  }

  async getPane(id: string, timeoutMs?: number): Promise<PaneSummary> {
    try {
      const { pane } = await rpc<{ pane: HerdrPane }>("pane.get", { pane_id: id }, timeoutMs);
      return { ...summarize(pane, ""), raw: pane as unknown as Record<string, unknown> };
    } catch (e) {
      throw asPaneGone(e);
    }
  }

  async readVisible(id: string): Promise<ScreenRead> {
    try {
      const res = await rpc<PaneReadPayload>("pane.read", {
        pane_id: id,
        source: "visible",
        format: "ansi",
        strip_ansi: false,
      });
      return { text: res.read.text, revision: res.read.revision };
    } catch (e) {
      throw asPaneGone(e);
    }
  }

  async readHistory(id: string, lines: number): Promise<string[]> {
    try {
      const res = await rpc<PaneReadPayload>("pane.read", {
        pane_id: id,
        source: "recent",
        lines,
        format: "ansi",
        strip_ansi: false,
      });
      return res.read.text.split("\n").map((row) => row.replace(/\r$/, ""));
    } catch (e) {
      throw asPaneGone(e);
    }
  }

  async geometry(id: string): Promise<GridSize | null> {
    try {
      const { layout } = await rpc<{ layout: { panes: PaneRect[] } }>("pane.layout", {
        pane_id: id,
      });
      const rect = layout.panes.find((p) => p.pane_id === id)?.rect;
      return rect ? { cols: rect.width, rows: rect.height } : null;
    } catch {
      return null; // geometry unavailable — callers keep what they have
    }
  }

  async sendText(id: string, text: string): Promise<void> {
    await rpc("pane.send_input", { pane_id: id, text });
  }

  async sendKeys(id: string, keys: string[]): Promise<void> {
    await rpc("pane.send_input", { pane_id: id, keys });
  }

  async createWorkspace(opts: { cwd: string; label?: string }): Promise<CreatedWorkspace> {
    // focus:false: a phone request must not yank the desktop herdr onto the new workspace.
    const res = await rpc<{
      workspace: { workspace_id: string; label: string };
      root_pane: HerdrPane;
    }>("workspace.create", { cwd: opts.cwd, label: opts.label ?? null, focus: false });
    const pane = summarize(res.root_pane, res.workspace.label);
    return {
      workspace: {
        id: res.workspace.workspace_id,
        label: res.workspace.label,
        cwd: pane.cwd ?? opts.cwd,
        paneCount: 1,
      },
      pane,
    };
  }

  async splitPane(id: string, direction: SplitDirection, cwd?: string): Promise<PaneSummary> {
    let pane: HerdrPane;
    try {
      // Resolved here rather than left to herdr's cwd policy: the contract is "starts
      // where the source pane is", and the lookup doubles as the not-found check.
      const source = await this.getPane(id);
      ({ pane } = await rpc<{ pane: HerdrPane }>("pane.split", {
        target_pane_id: id,
        direction,
        cwd: cwd ?? source.cwd,
        focus: false,
      }));
    } catch (e) {
      throw asPaneGone(e);
    }
    // The pane exists now: a failed label lookup must not turn the split into an error.
    const label = await rpc<{ workspace: { label: string } }>("workspace.get", {
      workspace_id: pane.workspace_id,
    }).then(
      (r) => r.workspace.label,
      () => "",
    );
    return summarize(pane, label);
  }

  async closePane(id: string): Promise<void> {
    try {
      await rpc("pane.close", { pane_id: id });
    } catch (e) {
      throw asPaneGone(e);
    }
  }

  // herdr sizes every pane for its one active client, so the pane id is irrelevant.
  resize(holder: unknown, _id: string, size: GridSize): Promise<void> {
    this.sizer.request(holder, size);
    return Promise.resolve();
  }

  release(holder: unknown): void {
    this.sizer.drop(holder);
  }

  stop(): void {
    this.sizer.stop();
  }
}
