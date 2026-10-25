/**
 * Muxy backend: pure rendering/mapping units, then an integration run against
 * an isolated Muxy server (own MUXY_DIR, never the user's). The integration
 * block is skipped when the muxy CLI is not installed.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PaneGoneError } from "./backend";
import {
  MuxyBackend,
  muxyBinary,
  muxyKeyBytes,
  muxySocketPath,
  pastePayloads,
  renderRow,
  renderRows,
  summarizeSessions,
  type MuxyRun,
} from "./backend-muxy";

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

describe("muxyKeyBytes", () => {
  test("maps every key name the hub emits to terminal bytes", () => {
    const keys: Record<string, string> = {
      enter: "\r",
      tab: "\t",
      backspace: "\x7f",
      esc: "\x1b",
      up: "\x1b[A",
      down: "\x1b[B",
      right: "\x1b[C",
      left: "\x1b[D",
      home: "\x1b[H",
      end: "\x1b[F",
      delete: "\x1b[3~",
      pageup: "\x1b[5~",
      pagedown: "\x1b[6~",
      "shift+tab": "\x1b[Z",
      "ctrl+c": "\x03",
      "ctrl+a": "\x01",
      "ctrl+z": "\x1a",
      "ctrl+\\": "\x1c",
      Enter: "\r",
    };
    for (const [name, bytes] of Object.entries(keys)) expect(muxyKeyBytes(name)).toBe(bytes);
  });

  test("unknown keys throw instead of typing their name", () => {
    expect(() => muxyKeyBytes("f5")).toThrow(/unsupported key/);
    expect(() => muxyKeyBytes("ctrl+1")).toThrow(/unsupported key/);
  });
});

describe("pastePayloads", () => {
  test("single-line text goes as-is; multi-line text becomes one bracketed paste", () => {
    expect(pastePayloads("ls -la")).toEqual(["ls -la"]);
    expect(pastePayloads("a\nb")).toEqual(["\x1b[200~a\nb\x1b[201~"]);
  });

  test("an end marker inside the text cannot close the paste early", () => {
    expect(pastePayloads("a\n\x1b[201~rm -rf /\n")).toEqual(["\x1b[200~a\nrm -rf /\n\x1b[201~"]);
  });

  test("chunks split between code points and reassemble to the original", () => {
    const text = "😀😀😀ab😀";
    const chunks = pastePayloads(text, 2);
    expect(chunks).toHaveLength(3);
    expect(chunks.join("")).toBe(text);
    for (const chunk of chunks) expect(chunk.isWellFormed()).toBe(true);
  });
});

describe("summarizeSessions", () => {
  const sessions = [
    { id: "11", project_id: "p1", directory: "/srv/atur", status: "Live" },
    { id: "12", project_id: "p1", directory: "/srv/atur", status: "Live" },
    { id: "13", project_id: "p2", directory: "/srv/other", status: "Live" },
    { id: "14", project_id: "p1", directory: "/srv/atur", status: "Ended" },
  ];
  const projects = [{ id: "p1", name: "Atur" }];
  const agents = [
    { session: "11", provider: "OhMyPi", state: "working" },
    { session: "12", provider: { Unrecognized: 42 }, state: "napping" },
  ];

  test("live sessions only, labelled by project, tagged by detected agent", () => {
    const panes = summarizeSessions(sessions, projects, agents);
    expect(panes.map((p) => p.id)).toEqual(["11", "12", "13"]);
    expect(panes[0]).toMatchObject({
      workspaceId: "p1",
      workspaceLabel: "Atur",
      tabId: "11",
      cwd: "/srv/atur",
      agent: "omp",
      agentStatus: "working",
    });
    // Providers and states newer than the bridge still read as an agent.
    expect(panes[1]).toMatchObject({ agent: "agent", agentStatus: "unknown" });
    expect(panes[2]).toMatchObject({ workspaceLabel: "", agent: null, agentStatus: null });
  });
});

describe("muxySocketPath", () => {
  test("MUXY_DIR wins on every platform", () => {
    expect(muxySocketPath({ MUXY_DIR: "/x", HOME: "/h" }, "linux")).toBe("/x/server.sock");
    expect(muxySocketPath({ MUXY_DIR: "/x", HOME: "/h" }, "darwin")).toBe("/x/server.sock");
  });

  test("Linux uses an absolute XDG_STATE_HOME, else ~/.local/state", () => {
    expect(muxySocketPath({ HOME: "/h", XDG_STATE_HOME: "/s" }, "linux")).toBe(
      "/s/muxy/server.sock",
    );
    expect(muxySocketPath({ HOME: "/h", XDG_STATE_HOME: "rel" }, "linux")).toBe(
      "/h/.local/state/muxy/server.sock",
    );
  });

  test("macOS uses Application Support/Muxy 2 and ignores XDG", () => {
    expect(muxySocketPath({ HOME: "/h", XDG_STATE_HOME: "/s" }, "darwin")).toBe(
      "/h/Library/Application Support/Muxy 2/server.sock",
    );
  });
});

const hasMuxy = muxyBinary() !== "muxy";

describe.skipIf(!hasMuxy)("MuxyBackend against a real Muxy server", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "atur-muxy-")));
  const work = join(root, "work");
  const env = { ...process.env, MUXY_DIR: join(root, "state") };
  const backend = new MuxyBackend({ env });
  let paneId = "";
  let workspaceId = "";

  // Polls an external process (the Muxy server) that exposes no change signal.
  async function until<T>(fn: () => Promise<T | null | false>, what: string): Promise<T> {
    const deadline = Date.now() + 8000;
    for (;;) {
      const value = await fn();
      if (value) return value;
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
      await Bun.sleep(50);
    }
  }

  const screenHas = (needle: string) => async () => {
    const { text } = await backend.readVisible(paneId);
    return text.includes(needle) ? text : null;
  };

  beforeAll(async () => {
    mkdirSync(work, { recursive: true });
    const created = await backend.createWorkspace({ cwd: work, label: "atur-test" });
    paneId = created.pane.id;
    workspaceId = created.workspace.id;
  });

  afterAll(() => {
    Bun.spawnSync([muxyBinary(), "server", "stop", "--force"], { env });
    rmSync(root, { recursive: true, force: true });
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

  test("text and keys reach the shell; colours come back as SGR", async () => {
    await backend.sendText(paneId, "printf '\\033[31mRED-%s\\033[0m\\n' MARK");
    await backend.sendKeys(paneId, ["enter"]);
    const text = await until(screenHas("\x1b[0;31mRED-MARK"), "styled output");
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

  test("history pages through scrollback, oldest first, ending with the screen", async () => {
    await backend.sendText(paneId, "seq 1 1200");
    await backend.sendKeys(paneId, ["enter"]);
    await until(screenHas("\n1200"), "seq output");
    const rows = await backend.readHistory(paneId, 1000);
    expect(rows).toHaveLength(1000);
    // Row "400" lies beyond the first 500-row page: only paging reaches it.
    const early = rows.indexOf("400");
    const late = rows.indexOf("1200");
    expect(early).toBeGreaterThanOrEqual(0);
    expect(late).toBeGreaterThan(early);
    expect(rows.indexOf("401")).toBe(early + 1);
  });

  test("a split is a new session in the same project", async () => {
    const pane = await backend.splitPane(paneId, "right");
    expect(pane.id).not.toBe(paneId);
    expect(pane).toMatchObject({ workspaceId, cwd: work });
    await backend.closePane(pane.id);
  });

  test("closed, unknown and malformed sessions are gone", async () => {
    const pane = await backend.splitPane(paneId, "down");
    await backend.closePane(pane.id);
    await expect(backend.getPane(pane.id)).rejects.toBeInstanceOf(PaneGoneError);
    await expect(backend.readVisible(pane.id)).rejects.toBeInstanceOf(PaneGoneError);
    await expect(backend.readVisible("123")).rejects.toBeInstanceOf(PaneGoneError);
    await expect(backend.sendKeys("w1:p1", ["enter"])).rejects.toBeInstanceOf(PaneGoneError);
  });
});
