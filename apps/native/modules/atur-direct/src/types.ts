// Types of the direct path: the phone talks to Atur Terminal's server over its own TLS transport,
// through the Rust core (crates/atur-mobile in dzulfikar08/atur-terminal). Nothing here imports
// native code, so the layers above can be tested with a fake.

/** Everything needed to reconnect to a paired computer. Treat `token` like a password. */
export interface DirectCredential {
  serverId: string;
  serverName: string;
  hosts: string[];
  port: number;
  /** SHA-256 of the server certificate, 64 hex characters. */
  fingerprint: string;
  deviceId: string;
  /** 32 bytes, 64 hex characters. */
  token: string;
}

export interface PairingTarget {
  hosts: string[];
  port: number;
}

/** Error codes of the Rust core (MobileError), plus `Internal` for a bug in the glue. */
export type DirectErrorCode =
  | "InvalidLink"
  | "InvalidCredential"
  | "Unreachable"
  | "IdentityMismatch"
  | "Unauthorized"
  | "IncompatibleVersion"
  | "Unsupported"
  | "Timeout"
  | "Disconnected"
  | "Server"
  | "Internal";

export class DirectError extends Error {
  constructor(
    readonly code: DirectErrorCode,
    readonly reason: string,
  ) {
    super(reason ? `${code}: ${reason}` : code);
    this.name = "DirectError";
  }

  /** Only the user can fix these: do not retry, ask them to pair again or update. */
  get fatal(): boolean {
    return (
      this.code === "InvalidCredential" ||
      this.code === "IdentityMismatch" ||
      this.code === "Unauthorized" ||
      this.code === "IncompatibleVersion" ||
      this.code === "InvalidLink"
    );
  }
}

export type SessionStatus = "starting" | "live" | "ended" | "unavailable";
export type AgentState = "unknown" | "idle" | "working" | "blocked";

export interface DirectProject {
  id: string;
  name: string;
  directory: string;
  isHome: boolean;
  isWorktree: boolean;
}

export interface DirectAgent {
  provider: string;
  state: AgentState;
}

/** A terminal session on the computer. `id` is the decimal session id, the same string the bridge uses as pane id on Atur Terminal. */
export interface DirectSession {
  id: string;
  projectId: string;
  projectName: string;
  directory: string;
  status: SessionStatus;
  /** True while this phone has it attached. */
  attached: boolean;
  agent: DirectAgent | null;
}

export interface AttachInfo {
  session: string;
  cols: number;
  rows: number;
  title: string;
  directory: string;
}

export interface HistoryReply {
  /** ANSI rows, oldest first, ending with the visible grid. */
  rows: string[];
  /** How many trailing rows are the visible grid. */
  visible: number;
}

export interface ActivityEvent {
  id: string;
  session: string;
  projectId: string;
  provider: string;
  timestamp: number;
  kind: "attention" | "completed";
}

export interface ActivitySnapshot {
  agents: { session: string; projectId: string; provider: string; state: AgentState }[];
  events: ActivityEvent[];
}

export type EchoMode = "auto" | "always" | "never";

export interface EchoStats {
  mode: EchoMode;
  /** Round trip time the core measured, ms; null before the first sample. */
  rttMs: number | null;
  keys: number;
  visibleConfirmed: number;
  hiddenConfirmed: number;
  visibleWrong: number;
  hiddenWrong: number;
}

/** Pushed by the core. Row strings are the bridge's frame vocabulary (ANSI, one string per row). */
export type DirectEvent =
  | { t: "hello"; session: string; cols: number; rows: number }
  | { t: "snapshot"; session: string; ansi: string }
  | { t: "diff"; session: string; rows: [number, string][] }
  | { t: "geometry"; session: string; cols: number; rows: number }
  | { t: "title"; session: string; title: string; directory: string }
  | { t: "ended"; session: string }
  | { t: "catalog" }
  | { t: "sessions" }
  | { t: "activity" }
  | { t: "git"; projectId: string }
  | { t: "files"; projectId: string; paths: string[] }
  | { t: "restarting" }
  | { t: "disconnected" };

export interface DirectFileEntry {
  name: string;
  /** Relative to the project folder. */
  path: string;
  isDirectory: boolean;
}

/** `null` for a folder without a repository. */
export interface DirectGitSummary {
  branch: string | null;
  ahead: number;
  behind: number;
  staged: number;
  unstaged: number;
  untracked: number;
  conflicted: number;
}
