/**
 * Muxy backend: pure units, then the pane list and reconnect behaviour against
 * a scripted socket server speaking the real protocol, then an integration run
 * against an isolated Muxy server (own ATUR_TERM_DIR, never the user's). The
 * integration block is skipped when the muxy CLI is not installed.
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  setDefaultTimeout,
  test,
} from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InputError, PaneGoneError } from "./backend";
import {
  MuxyBackend,
  findOmpTranscripts,
  muxyBinary,
  muxyChildEnv,
  muxySocketExists,
  muxySocketPath,
  summarizePanes,
} from "./backend-muxy";
import { muxyKeyEvent, pasteChunks, renderRow, renderRows } from "./muxy-render";
import {
  CONTROL,
  CborWriter,
  FrameParser,
  Kind,
  Topic,
  encodeFrame,
  uuidBytes,
  type Cbor,
  type MuxyRun,
} from "./muxy-wire";

const run = (text: string, style: MuxyRun["style"] = {}): MuxyRun => ({ text, style });

describe("renderRow", () => {
  test("maps palette, bright, 256 and RGB colours to SGR", () => {
    expect(
      renderRow({
        index: 0,
        runs: [
          run("red", { fg: { Indexed: 1 }, bold: true }),
          run("bright", { fg: { Indexed: 9 } }),
          run("cube", { fg: { Indexed: 196 } }),
          run("rgb", { bg: { Rgb: [10, 20, 30] } }),
        ],
      }),
    ).toBe("\x1b[0;1;31mred\x1b[0;91mbright\x1b[0;38;5;196mcube\x1b[0;48;2;10;20;30mrgb\x1b[0m");
  });

  test("resets before default text and ends styled rows with a reset", () => {
    expect(renderRow({ index: 0, runs: [run("a", { inverse: true }), run(" b"), run("c")] })).toBe(
      "\x1b[0;7ma\x1b[0m bc",
    );
    expect(renderRow({ index: 0, runs: [run("plain")] })).toBe("plain");
  });

  test("consecutive runs of one style share a single SGR", () => {
    const blue = { fg: { Rgb: [0, 180, 255] as [number, number, number] } };
    expect(
      renderRow({ index: 0, runs: [run("─", blue), run("─", blue), run("─", blue), run(" x")] }),
    ).toBe("\x1b[0;38;2;0;180;255m───\x1b[0m x");
  });

  test("underline styles carry their variant and colour; colour alone draws nothing", () => {
    expect(
      renderRow({
        index: 0,
        runs: [run("x", { underline: "Curly", underline_color: { Rgb: [1, 2, 3] } })],
      }),
    ).toBe("\x1b[0;4:3;58;2;1;2;3mx\x1b[0m");
    expect(
      renderRow({
        index: 0,
        runs: [run("y", { underline: "None", underline_color: { Indexed: 5 } })],
      }),
    ).toBe("y");
  });

  test("screen rows keep their positions, padded to the screen height", () => {
    const rows = [
      { index: 0, runs: [run("top")] },
      { index: 2, runs: [run("third")] },
    ];
    expect(renderRows(rows, 4)).toEqual(["top", "", "third", ""]);
    expect(renderRows(rows)).toEqual(["top", "", "third"]);
  });
});

describe("muxyKeyEvent", () => {
  test("named keys and herdr aliases", () => {
    expect(muxyKeyEvent("enter")).toEqual({
      key: "enter",
      modifiers: 0,
      text: "",
      unshiftedCodepoint: 0,
    });
    expect(muxyKeyEvent("Enter").key).toBe("enter");
    expect(muxyKeyEvent("esc").key).toBe("escape");
    for (const key of [
      "tab",
      "backspace",
      "up",
      "down",
      "left",
      "right",
      "home",
      "end",
      "delete",
      "pageup",
      "pagedown",
      "f1",
      "f12",
    ]) {
      expect(muxyKeyEvent(key)).toMatchObject({ key, modifiers: 0, text: "" });
    }
  });

  test("modifiers become flags, and a modified key types no text", () => {
    expect(muxyKeyEvent("shift+tab")).toMatchObject({ key: "tab", modifiers: 1, text: "" });
    expect(muxyKeyEvent("ctrl+c")).toEqual({
      key: "c",
      modifiers: 4,
      text: "",
      unshiftedCodepoint: 0x63,
    });
    expect(muxyKeyEvent("ctrl+alt+x")).toMatchObject({ key: "x", modifiers: 6, text: "" });
    expect(muxyKeyEvent("ctrl+\\")).toMatchObject({ key: "\\", modifiers: 4, text: "" });
  });

  test("characters type themselves, shifted ones in capitals", () => {
    expect(muxyKeyEvent("a")).toEqual({
      key: "a",
      modifiers: 0,
      text: "a",
      unshiftedCodepoint: 0x61,
    });
    expect(muxyKeyEvent("shift+a")).toMatchObject({ key: "a", modifiers: 1, text: "A" });
    expect(muxyKeyEvent("space")).toMatchObject({ key: "space", text: " " });
  });

  test("unknown keys throw instead of typing their name", () => {
    expect(() => muxyKeyEvent("hyper+x")).toThrow(/unsupported key/);
    expect(() => muxyKeyEvent("f26")).toThrow(/unsupported key/);
    expect(() => muxyKeyEvent("ctrl+")).toThrow(/unsupported key/);
    expect(() => muxyKeyEvent("foo")).toThrow(/unsupported key/);
  });
});

describe("pasteChunks", () => {
  test("text goes through whole; marker wrapping is the server's job", () => {
    expect(pasteChunks("ls -la")).toEqual(["ls -la"]);
    expect(pasteChunks("a\nb")).toEqual(["a\nb"]);
  });

  test("paste markers inside the text are removed, nested ones too", () => {
    expect(pasteChunks("a\n\x1b[201~rm -rf /\n")).toEqual(["a\nrm -rf /\n"]);
    // One pass would turn the nested marker into a real end marker.
    expect(pasteChunks("a\n\x1b[20\x1b[201~1~rm -rf ~\n")).toEqual(["a\nrm -rf ~\n"]);
    expect(pasteChunks("\x1b[200~foo")).toEqual(["foo"]);
  });

  test("chunks split between code points and reassemble to the original", () => {
    const text = "😀😀😀ab😀";
    const chunks = pasteChunks(text, 2);
    expect(chunks).toHaveLength(3);
    expect(chunks.join("")).toBe(text);
    for (const chunk of chunks) expect(chunk.isWellFormed()).toBe(true);
  });
});

describe("muxyChildEnv", () => {
  test("drops the bridge's secrets and settings, keeps the user's environment", () => {
    expect(
      muxyChildEnv({
        HOME: "/h",
        PATH: "/bin",
        MUXY_DIR: "/m",
        ATUR_TERM_DIR: "/a",
        ATUR_TERM_BIN: "/bin/atur-term",
        ATUR_CONNECT_TOKEN: "atb_x",
        ATUR_URL: "https://x",
        BRIDGE_TOKEN: "t",
        HERDR_BRIDGE_TOKEN: "t",
        MUXY_SESSION_ID: "7",
        ATUR_TERM_SESSION_ID: "8",
      }),
    ).toEqual({
      HOME: "/h",
      PATH: "/bin",
      MUXY_DIR: "/m",
      ATUR_TERM_DIR: "/a",
      ATUR_TERM_BIN: "/bin/atur-term",
    });
  });
});

describe("summarizePanes", () => {
  const sessions = [
    { id: "13", project: "p2", directory: "/srv/other" },
    { id: "12", project: "p1", directory: "/srv/atur" },
    { id: "11", project: "p1", directory: "/srv/atur" },
  ];
  const projects = [{ id: "p1", name: "Atur", directory: "/srv/atur", home: false, color: "#fff" }];
  const agents = new Map([
    ["11", { session: "11", provider: 11, state: 2 }],
    ["12", { session: "12", provider: 99, state: 77 }],
  ]);
  const meta = new Map([
    [
      "11",
      { title: "π ⠋ fix", directory: "/srv/atur/apps", process: { name: "omp", isShell: false } },
    ],
    ["12", { title: "", directory: "", process: null }],
  ]);

  test("projects in Muxy's order, sessions by id, live title and directory", () => {
    const panes = summarizePanes({
      sessions,
      projects,
      agents,
      meta,
      transcripts: new Map([["11", "/home/u/.omp/agent/sessions/x/11.jsonl"]]),
    });
    expect(panes.map((p) => p.id)).toEqual(["11", "12", "13"]);
    expect(panes[0]).toMatchObject({
      workspaceId: "p1",
      workspaceLabel: "Atur",
      tabId: "11",
      cwd: "/srv/atur/apps",
      title: "π ⠋ fix",
      agent: "omp",
      agentStatus: "working",
      agentSessionPath: "/home/u/.omp/agent/sessions/x/11.jsonl",
    });
  });

  test("an empty live title or directory falls back; newer providers still read as an agent", () => {
    const panes = summarizePanes({ sessions, projects, agents, meta, transcripts: new Map() });
    expect(panes[1]).toMatchObject({
      cwd: "/srv/atur",
      title: null,
      agent: "agent",
      agentStatus: "unknown",
    });
    expect(panes[2]).toMatchObject({
      workspaceLabel: "",
      cwd: "/srv/other",
      title: null,
      agent: null,
      agentStatus: null,
      agentSessionPath: null,
    });
  });
});

describe("muxyBinary", () => {
  test("ATUR_TERM_BIN wins over the old MUXY_BIN", () => {
    expect(muxyBinary({ ATUR_TERM_BIN: "/a/atur-term", MUXY_BIN: "/m/muxy" })).toBe("/a/atur-term");
  });
});

describe("muxySocketPath", () => {
  test("ATUR_TERM_DIR wins on every platform", () => {
    expect(muxySocketPath({ ATUR_TERM_DIR: "/x", HOME: "/h" }, "linux")).toBe("/x/server.sock");
    expect(muxySocketPath({ ATUR_TERM_DIR: "/x", HOME: "/h" }, "darwin")).toBe("/x/server.sock");
  });

  test("Linux uses an absolute XDG_STATE_HOME, else ~/.local/state", () => {
    expect(muxySocketPath({ HOME: "/h", XDG_STATE_HOME: "/s" }, "linux")).toBe(
      "/s/atur-terminal/server.sock",
    );
    expect(muxySocketPath({ HOME: "/h", XDG_STATE_HOME: "rel" }, "linux")).toBe(
      "/h/.local/state/atur-terminal/server.sock",
    );
  });

  test("macOS uses Application Support/Atur Terminal and ignores XDG", () => {
    expect(muxySocketPath({ HOME: "/h", XDG_STATE_HOME: "/s" }, "darwin")).toBe(
      "/h/Library/Application Support/Atur Terminal/server.sock",
    );
  });

  describe("fallback to the pre-rename Muxy server", () => {
    const home = mkdtempSync(join(tmpdir(), "atur-sock-"));
    afterAll(() => rmSync(home, { recursive: true, force: true }));
    const sock = (dir: string) => {
      mkdirSync(join(home, dir), { recursive: true });
      writeFileSync(join(home, dir, "server.sock"), "");
    };
    const env = (extra: Record<string, string> = {}) => ({ HOME: home, ...extra });
    const atur = join(home, ".local/state/atur-terminal/server.sock");
    const muxy = join(home, ".local/state/muxy/server.sock");

    test("nothing running: the Atur Terminal path, where a started server will be", () => {
      expect(muxySocketPath(env(), "linux")).toBe(atur);
      expect(muxySocketExists(env(), "linux")).toBe(false);
    });

    test("only the old Muxy socket exists: it is used", () => {
      sock(".local/state/muxy");
      expect(muxySocketPath(env(), "linux")).toBe(muxy);
      expect(muxySocketExists(env(), "linux")).toBe(true);
      expect(muxySocketPath(env({ MUXY_DIR: join(home, ".local/state/muxy") }), "linux")).toBe(
        muxy,
      );
    });

    test("both exist: Atur Terminal wins", () => {
      sock(".local/state/atur-terminal");
      expect(muxySocketPath(env(), "linux")).toBe(atur);
    });

    test("an explicit ATUR_TERM_DIR never falls back to Muxy", () => {
      const pinned = env({ ATUR_TERM_DIR: join(home, "isolated") });
      expect(muxySocketPath(pinned, "linux")).toBe(join(home, "isolated/server.sock"));
      expect(muxySocketExists(pinned, "linux")).toBe(false);
    });
  });
});

describe("findOmpTranscripts", () => {
  const root = mkdtempSync(join(tmpdir(), "atur-proc-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  /** A fake /proc entry: its environment and the files it holds open. */
  function proc(pid: string, env: string[], fds: Record<string, string>) {
    mkdirSync(join(root, pid, "fd"), { recursive: true });
    writeFileSync(join(root, pid, "environ"), env.join("\0") + "\0");
    for (const [fd, target] of Object.entries(fds)) symlinkSync(target, join(root, pid, "fd", fd));
  }

  test("links a terminal session to the transcript its omp process holds open (either env name)", async () => {
    const sessions = join(root, "home/.omp/agent/sessions/-proj");
    mkdirSync(join(sessions, "2026_abc"), { recursive: true });
    const main = join(sessions, "2026_abc.jsonl");
    const sub = join(sessions, "2026_abc/Task.jsonl");
    const other = join(sessions, "2026_other.jsonl");
    for (const f of [main, sub, other]) writeFileSync(f, "{}\n");
    // omp: transcript, a sub-agent transcript, a socket; a worker of the same terminal; another terminal; no terminal
    proc("100", ["HOME=/h", "MUXY_SESSION_ID=555"], { "3": main, "4": sub, "5": "socket:[1]" });
    proc("101", ["MUXY_SESSION_ID=555"], {});
    proc("102", ["MUXY_SESSION_ID=999"], { "3": other });
    proc("103", ["PATH=/bin"], { "3": other });
    proc("104", ["MUXY_SESSION_ID=5550"], { "3": other }); // not 555
    writeFileSync(join(root, "notapid"), "");
    const found = await findOmpTranscripts(new Set(["555", "777"]), root);
    expect([...found]).toEqual([["555", main]]);

    // A process of the renamed build carries ATUR_TERM_SESSION_ID instead.
    proc("105", ["HOME=/h", "ATUR_TERM_SESSION_ID=777"], { "3": other });
    proc("106", ["ATUR_TERM_SESSION_ID=7770"], { "3": other }); // not 777
    const both = await findOmpTranscripts(new Set(["555", "777"]), root);
    expect(new Map(both)).toEqual(
      new Map([
        ["555", main],
        ["777", other],
      ]),
    );
  });
});

// ── A scripted Muxy server ────────────────────────────────────────────────

interface FakeSession {
  id: string;
  project: string;
  directory: string;
  title: string;
  live: string;
}

/** Speaks enough of the real protocol for the backend's pane list. */
class FakeMuxy {
  readonly dir = mkdtempSync(join(tmpdir(), "atur-fake-muxy-"));
  readonly socket = join(this.dir, "server.sock");
  sessions: FakeSession[] = [];
  projects = [{ id: "a".repeat(32), name: "Atur", directory: "/srv/atur" }];
  agents: Array<{ session: string; provider: number; state: number }> = [];
  /** Unread indicator events; `kind` 1 is a completion. */
  events: Array<{ id: string; session: string; kind: number }> = [];
  acknowledged: string[][] = [];
  hello: { versions: number[]; features: number[]; version: string } = {
    versions: [2],
    features: [1],
    version: "2.2.0",
  };
  requests: number[] = [];
  private clients = new Set<{ write(data: Uint8Array): number; end(): void }>();
  private parsers = new WeakMap<object, FrameParser>();
  private listener: { stop(closeActive?: boolean): void } | null = null;

  start(): void {
    this.listener = Bun.listen({
      unix: this.socket,
      socket: {
        open: (socket) => {
          this.clients.add(socket);
          this.parsers.set(socket, new FrameParser());
        },
        close: (socket) => {
          this.clients.delete(socket);
        },
        data: (socket, data) => {
          const parser = this.parsers.get(socket) ?? new FrameParser();
          let messages;
          try {
            messages = parser.push(new Uint8Array(data));
          } catch {
            socket.write(new Uint8Array([9, 0, 0, 0, 1, 0, 0, 0, 0, 0, 8, 1, 1])); // a version-1 fatal
            return;
          }
          for (const m of messages) this.handle(socket, m);
        },
      },
    });
  }

  stop(): void {
    this.listener?.stop(true);
    this.listener = null;
    this.clients.clear();
    rmSync(this.socket, { force: true });
  }

  dropClients(): void {
    for (const c of this.clients) c.end();
    this.clients.clear();
  }

  private handle(
    socket: { write(d: Uint8Array): number },
    m: { kind: number; fields: Cbor[] | Uint8Array },
  ): void {
    const fields = m.fields as Cbor[];
    if (m.kind === Kind.Hello) {
      const w = new CborWriter();
      w.array(3).array(this.hello.versions.length);
      for (const v of this.hello.versions) w.uint(v);
      w.array(2).array(3).str(this.hello.version).uint(21).array(1).uint(2).uint(1);
      w.array(this.hello.features.length);
      for (const f of this.hello.features) w.uint(f);
      socket.write(encodeFrame(CONTROL, Kind.HelloReply, w.finish()));
      return;
    }
    if (m.kind !== Kind.Request) return;
    const id = fields[0] as number;
    const variant = (fields[1] as Cbor[])[0] as number;
    this.requests.push(variant);
    const w = new CborWriter();
    w.array(2).uint(id);
    const enc = new TextEncoder();
    if (variant === 1) {
      w.variant(0, 1).array(this.sessions.length);
      for (const s of this.sessions) {
        w.array(3).bytes(uuidBytes(s.project)).uint(BigInt(s.id)).bytes(enc.encode(s.directory));
      }
    } else if (variant === 2) {
      w.variant(1, 1)
        .array(6)
        .bytes(uuidBytes("b".repeat(32)))
        .bytes(uuidBytes(this.projects[0]?.id ?? "b".repeat(32)));
      w.uint(1).array(this.projects.length);
      for (const p of this.projects) {
        w.array(9).bytes(uuidBytes(p.id)).bool(false).bytes(enc.encode(p.directory)).str(p.name);
        w.null().null().str("#e5484d").null().null();
      }
      w.null().null();
    } else if (variant === 25) {
      w.variant(25, 1).array(3).uint(1).array(this.agents.length);
      for (const a of this.agents) {
        const project = this.sessions.find((s) => s.id === a.session)?.project ?? "a".repeat(32);
        w.array(4).uint(BigInt(a.session)).bytes(uuidBytes(project)).uint(a.provider).uint(a.state);
      }
      w.array(this.events.length);
      for (const e of this.events) {
        const project = this.sessions.find((s) => s.id === e.session)?.project ?? "a".repeat(32);
        w.array(7).uint(BigInt(e.id)).uint(BigInt(e.session)).bytes(uuidBytes(project));
        w.uint(11).uint(123).uint(e.kind).bool(false);
      }
    } else if (variant === 26) {
      const ids = ((fields[1] as Cbor[])[1] as Cbor[])[0] as Cbor[];
      this.acknowledged.push(ids.map(String));
      w.variant(26, 0);
    } else if (variant === 21) {
      const referenced = (fields[1] as Cbor[])[1] as Cbor[];
      const sessions = (referenced[2] as Cbor[]).map(String);
      w.variant(21, 0);
      setTimeout(() => {
        for (const id of sessions) this.pushMetadata(socket, id);
      }, 5);
    } else {
      w.variant(8, 0); // Pong: nothing else is asked of this server
    }
    socket.write(encodeFrame(CONTROL, Kind.Reply, w.finish()));
  }

  private pushMetadata(socket: { write(d: Uint8Array): number }, id: string): void {
    const s = this.sessions.find((x) => x.id === id);
    if (!s) return;
    const w = new CborWriter();
    w.array(2).uint(BigInt(id)).array(3).str(s.title).bytes(new TextEncoder().encode(s.live));
    w.array(2).str("omp").bool(false);
    socket.write(encodeFrame(CONTROL, Kind.SessionMetadata, w.finish()));
  }

  /** Tells every client that `topic` changed (a coalesced invalidation). */
  changed(topic: number): void {
    const w = new CborWriter();
    w.array(2).uint(topic).uint(2);
    for (const c of this.clients) c.write(encodeFrame(CONTROL, Kind.Changed, w.finish()));
  }

  ended(session: string): void {
    const w = new CborWriter();
    w.array(2).uint(BigInt(session)).array(2).uint(0).uint(0);
    for (const c of this.clients) c.write(encodeFrame(CONTROL, Kind.SessionEnded, w.finish()));
  }
}

async function eventually<T>(
  fn: () => Promise<T | null | false> | T | null | false,
  what: string,
): Promise<T> {
  const deadline = Date.now() + 5000;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(10);
  }
}

describe("MuxyBackend pane list over the protocol", () => {
  const servers: FakeMuxy[] = [];
  const backends: MuxyBackend[] = [];
  afterEach(async () => {
    await Promise.all(backends.splice(0).map((b) => b.stop()));
    for (const s of servers.splice(0)) s.stop();
  });

  function setup(): { server: FakeMuxy; backend: MuxyBackend } {
    const server = new FakeMuxy();
    server.sessions = [
      {
        id: "11",
        project: "a".repeat(32),
        directory: "/srv/atur",
        title: "π > fix push text",
        live: "/srv/atur/apps/bridge",
      },
      {
        id: "12",
        project: "a".repeat(32),
        directory: "/srv/atur",
        title: "bash",
        live: "/srv/atur",
      },
    ];
    server.agents = [{ session: "11", provider: 11, state: 2 }];
    server.start();
    const backend = new MuxyBackend({ env: { ATUR_TERM_DIR: server.dir, HOME: server.dir } });
    servers.push(server);
    backends.push(backend);
    return { server, backend };
  }

  test("titles, live directories, agents and projects come from one connection", async () => {
    const { server, backend } = setup();
    const panes = await backend.listPanes();
    expect(panes).toHaveLength(2);
    expect(panes[0]).toMatchObject({
      id: "11",
      workspaceLabel: "Atur",
      title: "π > fix push text",
      cwd: "/srv/atur/apps/bridge",
      agent: "omp",
      agentStatus: "working",
    });
    expect(panes[1]).toMatchObject({ id: "12", title: "bash", agent: null });
    // The listing was read once; polling and getPane answer from the cache.
    const before = server.requests.length;
    await backend.pollPanes();
    await backend.pollPanes();
    expect((await backend.getPane("12")).title).toBe("bash");
    expect(server.requests.length).toBe(before);
  });

  test("pushed invalidations refresh the cache without a request from a caller", async () => {
    const { server, backend } = setup();
    await backend.listPanes();
    server.sessions.push({
      id: "13",
      project: "a".repeat(32),
      directory: "/srv/x",
      title: "new",
      live: "/srv/x",
    });
    server.agents = [{ session: "11", provider: 11, state: 3 }];
    server.changed(Topic.Sessions);
    server.changed(Topic.Activity);
    const panes = await eventually(async () => {
      const list = await backend.pollPanes();
      return list.length === 3 && list[0]?.agentStatus === "blocked" && list[2]?.title === "new"
        ? list
        : null;
    }, "refreshed panes");
    expect(panes[2]).toMatchObject({ id: "13", cwd: "/srv/x" });
  });

  test("a finished agent is done until a viewer acknowledges it, and the ack reaches the server", async () => {
    const { server, backend } = setup();
    server.agents = [{ session: "11", provider: 11, state: 4 }];
    server.events = [{ id: "900", session: "11", kind: 1 }];
    const panes = await backend.listPanes();
    expect(panes[0]?.agentStatus).toBe("done");
    await backend.acknowledge("11");
    await backend.acknowledge("11");
    expect(server.acknowledged).toEqual([["900"]]);
    await backend.acknowledge("12");
    expect(server.acknowledged).toHaveLength(1);
  });

  test("an ended session leaves the list and its pane is gone", async () => {
    const { server, backend } = setup();
    await backend.listPanes();
    server.sessions = server.sessions.filter((s) => s.id !== "12");
    server.ended("12");
    await eventually(async () => (await backend.pollPanes()).length === 1, "pane removed");
    await expect(backend.getPane("12")).rejects.toBeInstanceOf(PaneGoneError);
    await expect(backend.readVisible("12")).rejects.toBeInstanceOf(PaneGoneError);
  });

  test("a dropped connection empties the list and the next call reconnects", async () => {
    const { server, backend } = setup();
    expect(await backend.listPanes()).toHaveLength(2);
    server.stop();
    await eventually(async () => (await backend.pollPanes()).length === 0, "empty list");
    await expect(backend.getPane("11")).rejects.toBeInstanceOf(PaneGoneError);
    server.start();
    expect(await backend.pollPanes()).toHaveLength(2);
  });

  test("a server that closes the connection is retried", async () => {
    const { server, backend } = setup();
    await backend.listPanes();
    server.dropClients();
    await eventually(async () => {
      const panes = await backend.pollPanes();
      return panes.length === 2;
    }, "reconnect");
  });

  test("no socket, no server: nothing to list, nothing started", async () => {
    const backend = new MuxyBackend({
      env: { ATUR_TERM_DIR: join(tmpdir(), "atur-none-" + Date.now()), HOME: "/h" },
    });
    expect(await backend.listPanes()).toEqual([]);
    expect(await backend.pollPanes()).toEqual([]);
    await expect(backend.readVisible("5")).rejects.toBeInstanceOf(PaneGoneError);
    await expect(backend.sendText("5", "x")).rejects.toBeInstanceOf(PaneGoneError);
    await expect(backend.closePane("5")).rejects.toBeInstanceOf(PaneGoneError);
  });

  test("a malformed pane id is gone without asking the server", async () => {
    const { server, backend } = setup();
    await backend.listPanes();
    const before = server.requests.length;
    await expect(backend.readVisible("w1:p1")).rejects.toBeInstanceOf(PaneGoneError);
    await expect(backend.sendKeys("0", ["enter"])).rejects.toBeInstanceOf(PaneGoneError);
    expect(server.requests.length).toBe(before);
  });

  test("a server speaking another protocol version fails loudly, not as a stopped server", async () => {
    const { server, backend } = setup();
    server.hello = { versions: [3], features: [1], version: "9.0.0" };
    await expect(backend.listPanes()).rejects.toThrow(
      /unsupported Atur Terminal protocol.*Atur Terminal 9\.0\.0.*protocol 3/,
    );
    await expect(backend.pollPanes()).rejects.toThrow(/unsupported Atur Terminal protocol/);
    await expect(backend.getPane("11")).rejects.toThrow(/unsupported Atur Terminal protocol/);
  });

  test("a server without server-side terminal input is refused with the fix", async () => {
    const { server, backend } = setup();
    server.hello = { versions: [2], features: [], version: "2.1.0" };
    await expect(backend.listPanes()).rejects.toThrow(
      /Atur Terminal 2\.1\.0.*Update Atur Terminal\./,
    );
  });

  test("a server that answers in the old framing reads as unsupported", async () => {
    const dir = mkdtempSync(join(tmpdir(), "atur-legacy-muxy-"));
    const socket = join(dir, "server.sock");
    // Muxy before protocol 2 rejects the hello with a version-1 frame.
    const listener = Bun.listen({
      unix: socket,
      socket: {
        data(s) {
          s.write(new Uint8Array([9, 0, 0, 0, 1, 0, 0, 0, 0, 0, 8, 1, 1]));
        },
      },
    });
    try {
      const backend = new MuxyBackend({ env: { ATUR_TERM_DIR: dir, HOME: dir } });
      await expect(backend.listPanes()).rejects.toThrow(/unsupported Atur Terminal protocol/);
      await backend.stop();
    } finally {
      listener.stop(true);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── A real Muxy server ────────────────────────────────────────────────────

const hasMuxy = muxyBinary() !== "atur-term";
/** Styling escape sequences (built from a string: the pattern is an ESC). */
const SGR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;:]*m`, "g");

describe.skipIf(!hasMuxy)("MuxyBackend against a real Muxy server", () => {
  setDefaultTimeout(20_000); // a real server and a real shell
  const root = realpathSync(mkdtempSync(join(tmpdir(), "atur-muxy-")));
  const work = join(root, "work");
  const env: Record<string, string | undefined> = {
    ...process.env,
    ATUR_TERM_DIR: join(root, "state"),
    ATUR_CONNECT_TOKEN: "atb_leak_check",
  };
  delete env.MUXY_SESSION_ID;
  delete env.ATUR_TERM_SESSION_ID;
  delete env.MUXY_SERVER_ID;
  const backend = new MuxyBackend({ env, timing: { debounceMs: 20, graceMs: 150 } });
  let paneId = "";
  let workspaceId = "";

  // Polls an external process (the Muxy server) for output it has not produced yet.
  async function until<T>(fn: () => Promise<T | null | false>, what: string): Promise<T> {
    const deadline = Date.now() + 8000;
    for (;;) {
      const value = await fn();
      if (value) return value;
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
      await Bun.sleep(25);
    }
  }

  const screenHas = (id: string, needle: string) => async () => {
    const { text } = await backend.readVisible(id);
    return text.includes(needle) ? text : null;
  };

  /** Plain screen rows without styling, blank rows dropped. */
  async function plain(id: string): Promise<string> {
    const { text } = await backend.readVisible(id);
    return text
      .split("\r\n")
      .map((l) => l.replace(SGR, "").trimEnd())
      .filter(Boolean)
      .join("\n");
  }

  beforeAll(async () => {
    mkdirSync(work, { recursive: true });
    // Nothing may start the server before createWorkspace does.
    expect(await backend.listPanes()).toEqual([]);
    expect(await backend.pollPanes()).toEqual([]);
    await expect(backend.readVisible("123")).rejects.toBeInstanceOf(PaneGoneError);
    await expect(backend.sendText("123", "x")).rejects.toBeInstanceOf(PaneGoneError);
    expect(existsSync(muxySocketPath(env))).toBe(false);

    const created = await backend.createWorkspace({ cwd: work, label: "atur-test" });
    paneId = created.pane.id;
    workspaceId = created.workspace.id;
  });

  afterAll(async () => {
    await backend.stop();
    Bun.spawnSync([muxyBinary(), "server", "stop", "--force"], { env });
    rmSync(root, { recursive: true, force: true });
  });

  test("terminals of a server the bridge started never see its tokens", async () => {
    await backend.sendText(paneId, 'echo "tok=[$ATUR_CONNECT_TOKEN]"');
    await backend.sendKeys(paneId, ["enter"]);
    // The output row starts with "tok=["; the echoed command line does not.
    const text = await until(screenHas(paneId, "\r\ntok=["), "echo output");
    expect(text).toContain("\r\ntok=[]");
    expect(text).not.toContain("atb_leak_check");
  });

  test("a blank project name is bad input; a name starting with dashes is fine", async () => {
    await expect(backend.createWorkspace({ cwd: work, label: "  " })).rejects.toBeInstanceOf(
      InputError,
    );
    await expect(
      backend.createWorkspace({ cwd: join(root, "missing"), label: "x" }),
    ).rejects.toBeInstanceOf(InputError);
    const dashed = join(root, "dashed");
    mkdirSync(dashed);
    const created = await backend.createWorkspace({ cwd: dashed, label: "--x" });
    expect(created.workspace.label).toBe("--x");
    await backend.closePane(created.pane.id);
  });

  test("a folder Muxy already knows opens in its existing project", async () => {
    const again = await backend.createWorkspace({ cwd: work, label: "ignored" });
    expect(again.workspace).toMatchObject({ id: workspaceId, label: "atur-test", paneCount: 2 });
    expect(again.pane.id).not.toBe(paneId);
    await backend.closePane(again.pane.id);
  });

  test("a new workspace is a project whose session is listed under its label", async () => {
    const panes = await backend.listPanes();
    expect(panes).toHaveLength(1);
    expect(panes[0]).toMatchObject({
      id: paneId,
      workspaceId,
      workspaceLabel: "atur-test",
      cwd: work,
      agent: null,
    });
    expect((await backend.getPane(paneId)).id).toBe(paneId);
    expect(await backend.geometry(paneId)).toMatchObject({ cols: expect.any(Number) });
  });

  test("title and directory follow the terminal as it reports them", async () => {
    const pane = await backend.splitPane(paneId, "right");
    try {
      expect(pane.cwd).toBe(work);
      // The prompt would set both again the moment the command ends, so the command keeps running.
      await backend.sendText(
        pane.id,
        "printf '\\033]0;bridge-title\\007\\033]7;file://localhost/tmp\\007'; sleep 600",
      );
      await backend.sendKeys(pane.id, ["enter"]);
      const live = await until(async () => {
        const p = (await backend.listPanes()).find((x) => x.id === pane.id);
        return p?.title === "bridge-title" && p.cwd === "/tmp" ? p : null;
      }, "title and directory");
      expect(live.workspaceLabel).toBe("atur-test");
      expect((await backend.getPane(pane.id)).cwd).toBe("/tmp");
    } finally {
      await backend.closePane(pane.id);
    }
  });

  test("text and keys reach the shell; colours come back as SGR", async () => {
    await backend.sendText(paneId, "printf '\\033[31mRED-%s\\033[0m\\n' MARK");
    await backend.sendKeys(paneId, ["enter"]);
    const text = await until(screenHas(paneId, "\x1b[0;31mRED-MARK"), "styled output");
    expect(text.split("\r\n").length).toBeGreaterThan(1);
  });

  test("screen revision only moves when the screen changes", async () => {
    const a = await backend.readVisible(paneId);
    const b = await backend.readVisible(paneId);
    expect(b.revision).toBe(a.revision);
    await backend.sendText(paneId, "echo NEXT-MARK");
    await backend.sendKeys(paneId, ["enter"]);
    await until(async () => {
      const r = await backend.readVisible(paneId);
      return r.revision > a.revision && r.text.includes("NEXT-MARK") ? r : null;
    }, "revision bump");
  });

  test("keys are encoded by the server with the terminal's own modes", async () => {
    const pane = await backend.splitPane(paneId, "right");
    try {
      // Raw input, no echo, no CR translation: `cat -v` shows exactly the bytes that arrive.
      await backend.sendText(
        pane.id,
        'stty -echo -icanon -isig -ixon -icrnl; clear; echo RE""ADY; cat -v',
      );
      await backend.sendKeys(pane.id, ["enter"]);
      await until(screenHas(pane.id, "READY"), "cat reading");
      await backend.sendKeys(pane.id, [
        "up",
        "shift+tab",
        "esc",
        "alt+x",
        "ctrl+c",
        "ctrl+\\",
        "f5",
        "delete",
        "pageup",
        "backspace",
        "shift+a",
        "ctrl+a",
        "enter",
      ]);
      const text = await until(async () => {
        const screen = await plain(pane.id);
        return screen.includes("^M") ? screen : null;
      }, "echoed keys");
      expect(text).toContain("^[[A^[[Z^[^[x^C^\\^[[15~^[[3~^[[5~^?A^A^M");
      // Multi-line text is a paste: a program that did not ask for bracketed paste gets plain lines.
      await backend.sendText(pane.id, "one\ntwo");
      await until(async () => (await plain(pane.id)).includes("one^Mtwo"), "pasted lines");
    } finally {
      await backend.closePane(pane.id);
    }
  });

  test("multi-line text is wrapped in paste markers once the program asks for them", async () => {
    const pane = await backend.splitPane(paneId, "right");
    try {
      await backend.sendText(
        pane.id,
        'stty -echo -icanon -isig -icrnl; printf "\\033[?2004h"; clear; echo RE""ADY; cat -v',
      );
      await backend.sendKeys(pane.id, ["enter"]);
      await until(screenHas(pane.id, "READY"), "cat reading");
      await backend.sendText(pane.id, "one\ntwo");
      await until(async () => (await plain(pane.id)).includes("^[[200~one"), "paste markers");
      // Bracketed paste keeps the newline as it is; only the markers are added.
      expect(await plain(pane.id)).toContain("^[[200~one\ntwo^[[201~");
    } finally {
      await backend.closePane(pane.id);
    }
  });

  test("history pages through scrollback, oldest first, ending with the screen", async () => {
    await backend.sendText(paneId, "seq 1 1200");
    await backend.sendKeys(paneId, ["enter"]);
    await until(screenHas(paneId, "\n1200"), "seq output");
    const rows = await backend.readHistory(paneId, 1000);
    expect(rows).toHaveLength(1000);
    // Row "400" lies beyond the first 500-row page: only paging reaches it.
    const early = rows.indexOf("400");
    const late = rows.indexOf("1200");
    expect(early).toBeGreaterThanOrEqual(0);
    expect(late).toBeGreaterThan(early);
    expect(rows.indexOf("401")).toBe(early + 1);
  });

  test("cached scrollback equals a cold read as output keeps arriving", async () => {
    /** A backend that has never read this pane: its history comes from a full rebuild. */
    async function coldRead(): Promise<string[]> {
      const cold = new MuxyBackend({ env });
      try {
        return await cold.readHistory(paneId, 1500);
      } finally {
        await cold.stop();
      }
    }
    for (let round = 0; round < 3; round++) {
      const last = String(2000 + round * 50 + 30);
      await backend.readHistory(paneId, 1500); // fills the cache
      await backend.sendText(paneId, `seq ${2000 + round * 50} ${last}`);
      await backend.sendKeys(paneId, ["enter"]);
      await until(screenHas(paneId, `\n${last}`), "seq output");
      // The screen part follows pushed frames, so the two views may differ for an instant;
      // the cache must converge on what a cold read returns, and never stay different.
      const converged = await until(async () => {
        const cached = await backend.readHistory(paneId, 1500);
        const cold = await coldRead();
        const same = cached.length === cold.length && cached.every((r, i) => r === cold[i]);
        return same && cached.includes(last) ? cached : null;
      }, "cached history equal to a cold read");
      expect(converged.length).toBeGreaterThan(1000);
    }
  });

  test("a phone-sized grid is taken while a viewer holds it and given back after", async () => {
    const original = await backend.geometry(paneId);
    expect(original).not.toBeNull();
    const holder = {};
    await backend.resize(holder, paneId, { cols: 50, rows: 20 });
    await until(async () => {
      const g = await backend.geometry(paneId);
      return g?.cols === 50 && g.rows === 20;
    }, "phone grid");
    await backend.sendText(paneId, "stty size");
    await backend.sendKeys(paneId, ["enter"]);
    await until(screenHas(paneId, "20 50"), "stty size in the shell");
    backend.release(holder);
    await until(async () => {
      const g = await backend.geometry(paneId);
      return g?.cols === original?.cols && g?.rows === original?.rows;
    }, "restored grid");
  });

  test("a size somebody else set meanwhile is not undone when the phone leaves", async () => {
    const pane = await backend.splitPane(paneId, "right");
    const quick = { debounceMs: 10, graceMs: 10 };
    const phone = new MuxyBackend({ env, timing: quick });
    const desktop = new MuxyBackend({ env, timing: quick }); // stands in for a window resizing itself
    const probe = async () => (await new MuxyBackend({ env }).geometry(pane.id))?.cols;
    try {
      const holder = {};
      await phone.resize(holder, pane.id, { cols: 50, rows: 20 });
      await until(async () => (await probe()) === 50, "phone grid");
      await desktop.resize({}, pane.id, { cols: 100, rows: 30 });
      // Both connections must have been told before the phone lets go.
      await until(async () => (await phone.geometry(pane.id))?.cols === 100, "phone told");
      phone.release(holder);
      await phone.stop(); // resolves once its restore has been answered
      expect(await probe()).toBe(100);
    } finally {
      await Promise.all([phone.stop(), desktop.stop()]);
      await backend.closePane(pane.id);
    }
  });

  test("stopping the backend gives a borrowed grid back", async () => {
    const original = await backend.geometry(paneId);
    const other = new MuxyBackend({ env });
    await other.resize({}, paneId, { cols: 60, rows: 18 });
    await until(async () => (await backend.geometry(paneId))?.cols === 60, "phone grid");
    await other.stop();
    await until(
      async () => (await backend.geometry(paneId))?.cols === original?.cols,
      "restored grid",
    );
  });

  test("a split is a new session in the same project, starting where the source is", async () => {
    const pane = await backend.splitPane(paneId, "right");
    expect(pane.id).not.toBe(paneId);
    expect(pane).toMatchObject({ workspaceId });
    // The source's live directory, unless one is given.
    expect(pane.cwd).toBe((await backend.getPane(paneId)).cwd);
    await backend.closePane(pane.id);
    const elsewhere = await backend.splitPane(paneId, "down", work);
    expect(elsewhere.cwd).toBe(work);
    await backend.closePane(elsewhere.id);
  });

  test("closed, unknown and malformed sessions are gone", async () => {
    const pane = await backend.splitPane(paneId, "down");
    await backend.closePane(pane.id);
    await expect(backend.getPane(pane.id)).rejects.toBeInstanceOf(PaneGoneError);
    await expect(backend.readVisible(pane.id)).rejects.toBeInstanceOf(PaneGoneError);
    await expect(backend.closePane(pane.id)).rejects.toBeInstanceOf(PaneGoneError);
    await expect(backend.readVisible("123")).rejects.toBeInstanceOf(PaneGoneError);
    await expect(backend.sendKeys("w1:p1", ["enter"])).rejects.toBeInstanceOf(PaneGoneError);
  });

  test("a session that exits on its own is gone", async () => {
    const pane = await backend.splitPane(paneId, "right");
    await backend.readVisible(pane.id);
    await backend.sendText(pane.id, "exit");
    await backend.sendKeys(pane.id, ["enter"]);
    await until(
      async () => (await backend.listPanes()).every((p) => p.id !== pane.id),
      "session removal",
    );
    await expect(backend.readVisible(pane.id)).rejects.toBeInstanceOf(PaneGoneError);
  });

  // Last: it kills this suite's server.
  test("a crashed server is not restarted by polling or pane commands", async () => {
    const socket = muxySocketPath(env);
    const serverPids = () =>
      Bun.spawnSync(["pgrep", "-f", `(atur-term|muxy)-server --socket ${socket}`])
        .stdout.toString()
        .split("\n")
        .filter(Boolean)
        .map(Number);
    const [pid] = serverPids();
    expect(pid).toBeGreaterThan(0);
    process.kill(pid as number, "SIGKILL");
    await until(async () => serverPids().length === 0, "server exit");
    // A crash leaves the socket file behind.
    expect(existsSync(socket)).toBe(true);

    await until(async () => (await backend.pollPanes()).length === 0, "empty list");
    expect(await backend.listPanes()).toEqual([]);
    await expect(backend.readVisible(paneId)).rejects.toBeInstanceOf(PaneGoneError);
    await expect(backend.sendKeys(paneId, ["enter"])).rejects.toBeInstanceOf(PaneGoneError);
    expect(serverPids()).toEqual([]);

    // Creating a workspace is the one thing that brings a server back, on the same backend.
    const revived = await backend.createWorkspace({ cwd: work, label: "back" });
    expect(serverPids().length).toBeGreaterThan(0);
    expect((await backend.listPanes()).map((p) => p.id)).toEqual([revived.pane.id]);
  });
});
