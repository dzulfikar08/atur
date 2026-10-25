/**
 * The terminal multiplexer the bridge drives. Everything the hubs need from
 * herdr, tmux or Muxy goes through this one interface, so the wire protocol to the
 * app (hub.ts, observe.ts) and the push-event poller (agent-events.ts) never
 * learn which backend is underneath.
 */
import type { GridSize } from "./sizer";

export type AgentStatus = "idle" | "working" | "blocked" | "done" | "unknown";

export interface PaneSummary {
  id: string;
  workspaceId: string;
  workspaceLabel: string;
  tabId: string;
  cwd: string | null;
  title: string | null;
  /** Agent running in the pane (`omp`, `claude`, `codex`, ...); null for a plain shell. */
  agent: string | null;
  agentStatus: AgentStatus | null;
  /** Path of the agent's session transcript, when the backend knows it. */
  agentSessionPath: string | null;
  /** Backend change counter; 0 when the backend has none. */
  revision: number;
  /** Backend-native pane record, echoed verbatim in the `hello` frame when present. */
  raw?: Record<string, unknown>;
}

/** The visible grid as ANSI rows joined by `\r\n`, plus the backend's change counter. */
export interface ScreenRead {
  text: string;
  revision: number;
}

/** The pane no longer exists (agent exited, window closed). Anything else is transient. */
export class PaneGoneError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaneGoneError";
  }
}

/** The request clashes with existing state (e.g. a tmux session of that name already exists). */
export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}

/** The request itself is invalid for this backend (answered 400). */
export class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InputError";
  }
}

export type SplitDirection = "right" | "down";

/** A herdr workspace / tmux session / Muxy project, folded from its panes. */
export interface WorkspaceSummary {
  id: string;
  label: string;
  /** cwd of the workspace's first pane. */
  cwd: string | null;
  paneCount: number;
}

export interface CreatedWorkspace {
  workspace: WorkspaceSummary;
  /** The workspace's first (root) pane. */
  pane: PaneSummary;
}

/** Workspaces in first-seen pane order; a workspace always has at least one pane. */
export function workspacesOf(panes: readonly PaneSummary[]): WorkspaceSummary[] {
  const byId = new Map<string, WorkspaceSummary>();
  for (const pane of panes) {
    const known = byId.get(pane.workspaceId);
    if (known) known.paneCount += 1;
    else {
      byId.set(pane.workspaceId, {
        id: pane.workspaceId,
        label: pane.workspaceLabel,
        cwd: pane.cwd,
        paneCount: 1,
      });
    }
  }
  return [...byId.values()];
}

export interface PaneBackend {
  readonly kind: "herdr" | "tmux" | "muxy";
  /** Every pane with its workspace label, for `GET /panes`. */
  listPanes(): Promise<PaneSummary[]>;
  /** Cheapest full pane list, for the event poller; `workspaceLabel` may be empty. */
  pollPanes(): Promise<PaneSummary[]>;
  /** Throws PaneGoneError when the pane does not exist. */
  getPane(id: string, timeoutMs?: number): Promise<PaneSummary>;
  readVisible(id: string): Promise<ScreenRead>;
  /** The last `lines` rows including host scrollback, oldest first, ANSI. */
  readHistory(id: string, lines: number): Promise<string[]>;
  /** Pane grid size; null when unavailable (callers keep what they have). */
  geometry(id: string): Promise<GridSize | null>;
  /** Literal text, never key presses; newlines stay newlines. */
  sendText(id: string, text: string): Promise<void>;
  /** Key presses by herdr key name ("enter", "ctrl+c", "shift+tab", ...). */
  sendKeys(id: string, keys: string[]): Promise<void>;
  /** A phone viewer (keyed by its socket) wants the pane laid out at `size`. */
  resize(holder: unknown, id: string, size: GridSize): Promise<void>;
  /** New workspace (tmux: detached session) whose first pane starts in `cwd`; `cwd` is already validated. */
  createWorkspace(opts: { cwd: string; label?: string }): Promise<CreatedWorkspace>;
  /** Split `id`; the new pane starts in `cwd`, default the source pane's cwd. Throws PaneGoneError when `id` is gone. */
  splitPane(id: string, direction: SplitDirection, cwd?: string): Promise<PaneSummary>;
  /** Close the pane and stop whatever runs in it. Throws PaneGoneError when it is already gone. */
  closePane(id: string): Promise<void>;
  /** The viewer left or stopped asking; sizes are restored once nobody holds one. */
  release(holder: unknown): void;
  /** Daemon shutdown: give every borrowed size back. */
  stop(): void;
}

/** herdr socket path; shared by the herdr client and backend auto-detection. */
export function herdrSocketPath(env: Record<string, string | undefined> = process.env): string {
  return env.HERDR_SOCKET ?? `${env.HOME}/.config/herdr/herdr.sock`;
}
