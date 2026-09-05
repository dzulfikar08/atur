import type { Socket } from "bun";

// Client for herdr's socket API — the session backend this daemon consumes
// (DEV-30: herdr owns the panes/PTYs; we never re-wrap them). The wire is
// newline-delimited JSON:
//
//   → {"id":"cmp:7","method":"pane.read","params":{...}}
//   ← {"id":"cmp:7","result":{"type":"pane_read","read":{...}}}
//   ← {"id":"cmp:7","error":{"code":"...","message":"..."}}
//
// Every result is a typed envelope `{type, <payload-key>}`; payloads are
// unwrapped by the named accessors below. Unsolicited event frames (no
// matching id) are ignored.
//
// herdr serves ONE request per connection (verified against protocol 20,
// 2026-09-03: frames after the first on a reused connection are never
// answered) — so each request opens a fresh unix-socket connection, which is
// cheap on this path. A herdr restart therefore cannot wedge the daemon.
//
// Verified behavior this client relies on:
//   - pane.send_text writes raw bytes through to the PTY verbatim (control
//     chars, CSI sequences included) — the whole input path is a passthrough.
//   - pane.read `revision` is always 0 and pane.get `revision` does not track
//     output. Change detection must diff snapshot text, never revisions.
//   - pane.send_keys supports a narrow key-name set; send_text is strictly
//     more capable, so it is the only input path used.

const REQUEST_TIMEOUT_MS = 8_000;

export type Json = Record<string, unknown>;

export interface HerdrPaneInfo {
  pane_id: string;
  workspace_id: string;
  tab_id: string;
  terminal_title?: string | null;
  terminal_title_stripped?: string | null;
  agent?: string | null;
  agent_status?: string | null;
  focused?: boolean;
  revision?: number;
}

export interface HerdrWorkspaceInfo {
  workspace_id: string;
  label?: string | null;
}

export class HerdrError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

export class HerdrClient {
  private seq = 0;

  constructor(private readonly socketPath: string) {}

  /** One request on a fresh connection → the unwrapped envelope payload. */
  request(method: string, params: Json = {}): Promise<Json> {
    const id = `cmp:${++this.seq}`;
    return new Promise<Json>((resolve, reject) => {
      let sock: Socket | null = null;
      let buf = "";
      let settled = false;
      const timer = setTimeout(() => {
        settle(() => reject(new HerdrError(`herdr request timed out: ${method}`, "timeout")));
      }, REQUEST_TIMEOUT_MS);
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          sock?.end();
        } catch {
          // already gone
        }
        fn();
      };
      Bun.connect({
        unix: this.socketPath,
        socket: {
          data: (_s, chunk) => {
            buf += chunk;
            let nl: number;
            while ((nl = buf.indexOf("\n")) !== -1) {
              const line = buf.slice(0, nl);
              buf = buf.slice(nl + 1);
              if (!line.trim()) continue;
              let frame: { id?: string; result?: Json; error?: { code?: string; message?: string } };
              try {
                frame = JSON.parse(line);
              } catch {
                continue;
              }
              if (frame.id !== id) continue; // unsolicited event push
              if (frame.error) {
                settle(() => reject(new HerdrError(frame.error?.message ?? "herdr error", frame.error?.code ?? "error")));
              } else {
                settle(() => resolve(frame.result ?? {}));
              }
              return;
            }
          },
          error: (_s, err) => settle(() => reject(new HerdrError(`herdr socket error: ${err.message}`, "socket"))),
          close: () => settle(() => reject(new HerdrError("herdr socket closed before reply", "disconnected"))),
        },
      })
        .then((s) => {
          if (settled) {
            s.end();
            return;
          }
          sock = s;
          s.write(JSON.stringify({ id, method, params }) + "\n");
        })
        .catch((err) =>
          settle(() => reject(new HerdrError(`herdr socket connect failed: ${err instanceof Error ? err.message : err}`, "connect"))),
        );
    });
  }

  async paneList(): Promise<HerdrPaneInfo[]> {
    const res = await this.request("pane.list");
    return (res.panes as HerdrPaneInfo[] | undefined) ?? [];
  }

  async paneGet(paneId: string): Promise<HerdrPaneInfo> {
    const res = await this.request("pane.get", { pane_id: paneId });
    return (res.pane as HerdrPaneInfo | undefined) ?? { pane_id: paneId, workspace_id: "", tab_id: "" };
  }

  async paneRead(paneId: string, opts: { lines?: number } = {}): Promise<{ text: string }> {
    const res = await this.request("pane.read", {
      pane_id: paneId,
      source: "recent",
      format: "ansi",
      ...(opts.lines ? { lines: opts.lines } : {}),
    });
    const read = res.read as { text?: string } | undefined;
    return { text: read?.text ?? "" };
  }

  async sendText(paneId: string, text: string): Promise<void> {
    await this.request("pane.send_text", { pane_id: paneId, text });
  }

  async workspaceList(): Promise<HerdrWorkspaceInfo[]> {
    const res = await this.request("workspace.list");
    return (res.workspaces as HerdrWorkspaceInfo[] | undefined) ?? [];
  }

  close(): void {
    // Connections are per-request; nothing durable to release.
  }
}
