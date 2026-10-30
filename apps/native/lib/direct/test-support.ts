import type { KeyValueStorage } from "@/lib/direct/credentials";
import type {
  DirectAppState,
  DirectLink,
  DirectNative,
  DirectNetwork,
  DirectTimers,
} from "@/lib/direct/manager";
import {
  DirectError,
  type AttachInfo,
  type DirectCredential,
  type DirectEvent,
  type DirectRoute,
  type DirectSession,
  type DirectTransport,
  type EchoMode,
  type EchoStats,
  type HistoryReply,
  type PairingTarget,
  type TransportPreference,
} from "@/modules/atur-direct/src/types";

// Fakes for the direct layer's tests: no native module, no clock, no keystore.

/** Lets every promise continuation run. */
export const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

export const HEX64 = "ab".repeat(32);

export function credential(serverId = "srv-1"): DirectCredential {
  return {
    serverId,
    serverName: "Desk",
    hosts: ["100.64.0.1", "desk.local"],
    port: 4500,
    fingerprint: HEX64,
    deviceId: "dev-1",
    token: HEX64,
  };
}

export function session(id: string, overrides: Partial<DirectSession> = {}): DirectSession {
  return {
    id,
    projectId: "p1",
    projectName: "atur",
    directory: "/home/dev/work/atur",
    title: "",
    status: "live",
    attached: false,
    agent: null,
    ...overrides,
  };
}

export function memoryStorage(): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: async (key) => data.get(key) ?? null,
    setItem: async (key, value) => {
      data.set(key, value);
    },
    removeItem: async (key) => {
      data.delete(key);
    },
  };
}

/** Timers driven by hand: `advance(ms)` runs what falls due, in order. */
export class FakeTimers implements DirectTimers {
  now = 0;
  private nextId = 1;
  private readonly tasks = new Map<number, { at: number; run: () => void }>();

  setTimeout(run: () => void, ms: number): unknown {
    const id = this.nextId++;
    this.tasks.set(id, { at: this.now + ms, run });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.tasks.delete(handle as number);
  }

  get pending(): number {
    return this.tasks.size;
  }

  async advance(ms: number): Promise<void> {
    const end = this.now + ms;
    for (;;) {
      let due: [number, { at: number; run: () => void }] | null = null;
      for (const entry of this.tasks) {
        if (entry[1].at <= end && (!due || entry[1].at < due[1].at)) due = entry;
      }
      if (!due) break;
      this.tasks.delete(due[0]);
      this.now = due[1].at;
      due[1].run();
      await flush();
    }
    this.now = end;
    await flush();
  }
}

export class FakeAppState implements DirectAppState {
  active = true;
  private readonly listeners = new Set<(active: boolean) => void>();

  isActive(): boolean {
    return this.active;
  }

  subscribe(listener: (active: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  set(active: boolean): void {
    this.active = active;
    for (const listener of [...this.listeners]) listener(active);
  }
}

/** A network whose changes the test announces by hand. */
export class FakeNetwork implements DirectNetwork {
  private readonly listeners = new Set<() => void>();

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** The phone's network changed. */
  change(): void {
    for (const listener of [...this.listeners]) listener();
  }

  get listenerCount(): number {
    return this.listeners.size;
  }
}

let linkCount = 0;

export class FakeLink implements DirectLink {
  readonly id = `link-${++linkCount}`;
  readonly serverId: string;
  readonly serverName = "Desk";
  readonly serverVersion = "1.0.0";
  transport: DirectTransport = "tls";
  udpNote = "";
  route: DirectRoute | null = null;
  addresses: readonly string[] = [];
  closed = false;
  sessionList: DirectSession[] = [];
  pingMs = 12;
  /** Every ping is lost while set. */
  pingFails = false;
  sessionsCalls = 0;
  pingCalls = 0;
  disconnects = 0;
  readonly attaches: { session: string; cols: number; rows: number }[] = [];
  readonly detaches: string[] = [];
  readonly inputs: { session: string; data: string }[] = [];
  readonly pastes: { session: string; text: string; submit: boolean }[] = [];
  readonly resizes: { session: string; cols: number; rows: number }[] = [];
  historyRows: HistoryReply = { rows: [], visible: 0, prompts: [] };
  /** The `lines` of every `history` call; an error in `historyError` rejects them. */
  readonly historyAsked: number[] = [];
  historyError: DirectError | null = null;
  /** What `attach` answers with; an error rejects. */
  attachResult: AttachInfo | DirectError | null = null;
  private readonly listeners = new Set<(event: DirectEvent) => void>();

  constructor(serverId = "srv-1") {
    this.serverId = serverId;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  subscribe(listener: (event: DirectEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Delivers an event the way the module does; `disconnected` closes the link first. */
  emit(event: DirectEvent): void {
    if (event.t === "disconnected") this.closed = true;
    for (const listener of [...this.listeners]) listener(event);
  }

  get listenerCount(): number {
    return this.listeners.size;
  }

  async sessions(): Promise<DirectSession[]> {
    this.sessionsCalls++;
    return this.sessionList;
  }

  async endSession(): Promise<void> {}

  async ping(): Promise<number> {
    this.pingCalls++;
    if (this.pingFails) throw new DirectError("Timeout", "");
    return this.pingMs;
  }

  async disconnect(): Promise<void> {
    this.disconnects++;
    this.closed = true;
  }

  async attach(session: string, cols: number, rows: number): Promise<AttachInfo> {
    this.attaches.push({ session, cols, rows });
    if (this.attachResult instanceof DirectError) throw this.attachResult;
    return this.attachResult ?? { session, cols, rows, title: "", directory: "" };
  }

  async detach(session: string): Promise<void> {
    this.detaches.push(session);
  }

  input(session: string, data: string): boolean {
    if (this.closed) return false;
    this.inputs.push({ session, data });
    return true;
  }

  paste(session: string, text: string, submit: boolean): boolean {
    if (this.closed) return false;
    this.pastes.push({ session, text, submit });
    return true;
  }

  readonly images: { session: string; name: string; base64: string }[] = [];

  async pasteImage(session: string, name: string, base64: string): Promise<{ path: string }> {
    this.images.push({ session, name, base64 });
    return { path: `/home/dev/.cache/atur/pastes/${name}` };
  }

  resize(session: string, cols: number, rows: number): boolean {
    if (this.closed) return false;
    this.resizes.push({ session, cols, rows });
    return true;
  }

  async history(_session: string, lines: number): Promise<HistoryReply> {
    this.historyAsked.push(lines);
    if (this.historyError) throw this.historyError;
    return this.historyRows;
  }

  readonly echoModes: EchoMode[] = [];

  async setEchoMode(mode: EchoMode): Promise<void> {
    this.echoModes.push(mode);
  }

  async echoStats(): Promise<EchoStats> {
    return {
      mode: "auto",
      rttMs: null,
      keys: 0,
      visibleConfirmed: 0,
      hiddenConfirmed: 0,
      visibleWrong: 0,
      hiddenWrong: 0,
      transport: this.transport,
      route: this.route,
    };
  }
}

/**
 * A native module that answers `connect` from a script: each entry is a link to hand out or an
 * error to throw; the last entry repeats once the script runs out. `hold()` makes the next
 * connect wait until `release()`.
 */
export class FakeNative implements DirectNative {
  script: (FakeLink | DirectError)[] = [new FakeLink()];
  readonly connects: DirectCredential[] = [];
  readonly connectOptions: (TransportPreference | undefined)[] = [];
  pairResult: DirectCredential | DirectError = credential();
  parseResult: PairingTarget | DirectError = { hosts: ["100.64.0.1"], port: 4500 };
  readonly pairs: { link: string; deviceName: string }[] = [];
  private gate: PromiseWithResolvers<void> | null = null;

  /** The next connects wait until `release()`. */
  hold(): void {
    this.gate = Promise.withResolvers<void>();
  }

  release(): void {
    this.gate?.resolve();
    this.gate = null;
  }

  async parsePairingLink(): Promise<PairingTarget> {
    if (this.parseResult instanceof DirectError) throw this.parseResult;
    return this.parseResult;
  }

  async pair(link: string, deviceName: string): Promise<DirectCredential> {
    this.pairs.push({ link, deviceName });
    if (this.pairResult instanceof DirectError) throw this.pairResult;
    return this.pairResult;
  }

  async connect(
    cred: DirectCredential,
    options?: { transport?: TransportPreference },
  ): Promise<DirectLink> {
    this.connects.push(cred);
    this.connectOptions.push(options?.transport);
    await this.gate?.promise;
    const next = this.script.length > 1 ? this.script.shift() : this.script[0];
    if (next instanceof DirectError) throw next;
    if (!next) throw new DirectError("Internal", "empty script");
    return next;
  }
}
