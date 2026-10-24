/**
 * tmux backend: pure parsing/mapping units, then an integration run against an
 * isolated tmux server (own socket, never the user's). The integration block
 * is skipped when tmux is not installed.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { PaneGoneError } from "./backend";
import {
  captureToRows,
  captureToText,
  parsePaneList,
  TmuxBackend,
  tmuxKeyName,
} from "./backend-tmux";
import { chooseBackendKind } from "./select-backend";

const US = "\x1f";

function row(fields: Partial<Record<string, string>> = {}): string {
  const f = {
    id: "%3",
    sessionId: "$1",
    sessionName: "work",
    windowId: "@2",
    cwd: "/srv/acme",
    title: "",
    command: "bash",
    dead: "0",
    status: "",
    agent: "",
    session: "",
    ...fields,
  };
  return [
    f.id,
    f.sessionId,
    f.sessionName,
    f.windowId,
    f.cwd,
    f.title,
    f.command,
    f.dead,
    f.status,
    f.agent,
    f.session,
  ].join(US);
}

describe("tmuxKeyName", () => {
  test("maps every herdr key name the hub emits", () => {
    expect(
      [
        "enter",
        "tab",
        "backspace",
        "esc",
        "up",
        "down",
        "left",
        "right",
        "home",
        "end",
        "delete",
        "pageup",
        "pagedown",
        "shift+tab",
      ].map(tmuxKeyName),
    ).toEqual([
      "Enter",
      "Tab",
      "BSpace",
      "Escape",
      "Up",
      "Down",
      "Left",
      "Right",
      "Home",
      "End",
      "DC",
      "PageUp",
      "PageDown",
      "BTab",
    ]);
  });

  test("ctrl combos become C-<letter>, including Ctrl+backslash", () => {
    expect(tmuxKeyName("ctrl+c")).toBe("C-c");
    expect(tmuxKeyName("ctrl+z")).toBe("C-z");
    expect(tmuxKeyName("ctrl+\\")).toBe("C-\\");
  });

  test("unknown keys throw instead of being typed as text", () => {
    expect(() => tmuxKeyName("hyper+q")).toThrow(/unsupported key/);
    expect(() => tmuxKeyName("ctrl+1")).toThrow(/unsupported key/);
    expect(() => tmuxKeyName("F1")).toThrow(/unsupported key/);
  });
});

describe("parsePaneList", () => {
  test("maps session to workspace and window to tab", () => {
    const [pane] = parsePaneList(row() + "\n", "myhost");
    expect(pane).toEqual({
      id: "%3",
      workspaceId: "$1",
      workspaceLabel: "work",
      tabId: "@2",
      cwd: "/srv/acme",
      title: null,
      agent: null,
      agentStatus: null,
      agentSessionPath: null,
      revision: 0,
    });
  });

  test("hook options give the agent and its status", () => {
    const [pane] = parsePaneList(
      row({ status: "Blocked", agent: "claude", session: "/tmp/s.jsonl", title: "✳ Fix tests" }),
      "myhost",
    );
    expect(pane).toMatchObject({
      agent: "claude",
      agentStatus: "blocked",
      agentSessionPath: "/tmp/s.jsonl",
      title: "✳ Fix tests",
    });
  });

  test("a status without a named agent still marks the pane as an agent", () => {
    const [pane] = parsePaneList(row({ status: "working" }), "myhost");
    expect(pane).toMatchObject({ agent: "agent", agentStatus: "working" });
  });

  test("a known agent process without hooks has unknown status", () => {
    const [pane] = parsePaneList(row({ command: "codex" }), "myhost");
    expect(pane).toMatchObject({ agent: "codex", agentStatus: "unknown" });
  });

  test("garbage status values degrade to unknown", () => {
    const [pane] = parsePaneList(row({ agent: "omp", status: "constructor" }), "myhost");
    expect(pane?.agentStatus).toBe("unknown");
  });

  test("the hostname default title carries no information", () => {
    const [pane] = parsePaneList(row({ title: "myhost" }), "myhost");
    expect(pane?.title).toBeNull();
  });

  test("dead panes and malformed lines are skipped", () => {
    const out = [row({ id: "%1", dead: "1" }), "garbage", row({ id: "x" }), row({ id: "%2" })].join(
      "\n",
    );
    expect(parsePaneList(out, "h").map((p) => p.id)).toEqual(["%2"]);
  });
});

describe("capture output", () => {
  test("rows are joined with CRLF and the final newline is dropped", () => {
    expect(captureToText("one\ntwo\n\n")).toBe("one\r\ntwo\r\n");
    expect(captureToText("only\n")).toBe("only");
  });

  test("history keeps the last N rows, oldest first", () => {
    expect(captureToRows("a\nb\nc\nd\n", 2)).toEqual(["c", "d"]);
    expect(captureToRows("a\nb\n", 10)).toEqual(["a", "b"]);
  });
});

describe("chooseBackendKind", () => {
  const probes = (herdr: boolean, tmux: boolean) => ({
    herdrSocketExists: () => herdr,
    tmuxInstalled: () => tmux,
  });

  test("auto prefers herdr, then tmux", () => {
    expect(chooseBackendKind({}, probes(true, true))).toBe("herdr");
    expect(chooseBackendKind({}, probes(false, true))).toBe("tmux");
    expect(chooseBackendKind({ BRIDGE_BACKEND: "auto" }, probes(false, true))).toBe("tmux");
  });

  test("BRIDGE_BACKEND forces a backend regardless of probes", () => {
    expect(chooseBackendKind({ BRIDGE_BACKEND: "tmux" }, probes(true, true))).toBe("tmux");
    expect(chooseBackendKind({ BRIDGE_BACKEND: "HERDR" }, probes(false, false))).toBe("herdr");
  });

  test("nothing available, or a bad value, is an error", () => {
    expect(() => chooseBackendKind({}, probes(false, false))).toThrow(/no terminal backend/);
    expect(() => chooseBackendKind({ BRIDGE_BACKEND: "screen" }, probes(true, true))).toThrow(
      /must be herdr, tmux or auto/,
    );
  });
});

const hasTmux = Bun.which("tmux") !== null;

describe.skipIf(!hasTmux)("TmuxBackend against a real tmux server", () => {
  const socket = `atur-test-${process.pid}`;
  const backend = new TmuxBackend({ socket, timing: { debounceMs: 10, graceMs: 80 } });
  let paneId = "";
  let socketPath = "";

  const tmux = (...args: string[]): string => {
    const proc = Bun.spawnSync(["tmux", "-L", socket, ...args], { stdout: "pipe", stderr: "pipe" });
    if (proc.exitCode !== 0) throw new Error(`tmux ${args.join(" ")}: ${proc.stderr.toString()}`);
    return proc.stdout.toString().trim();
  };

  async function until<T>(fn: () => Promise<T | null | false>, what: string): Promise<T> {
    const deadline = Date.now() + 5000;
    for (;;) {
      const value = await fn();
      if (value) return value;
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
      await Bun.sleep(25);
    }
  }

  const screenHas = (needle: string) => async () => {
    const { text } = await backend.readVisible(paneId);
    return text.includes(needle) ? text : null;
  };

  beforeAll(() => {
    tmux(
      "-f",
      "/dev/null",
      "new-session",
      "-d",
      "-s",
      "atur",
      "-x",
      "100",
      "-y",
      "20",
      "env PS1='$ ' bash --norc --noprofile",
    );
    paneId = tmux("list-panes", "-a", "-F", "#{pane_id}").split("\n")[0] ?? "";
    socketPath = tmux("display-message", "-p", "#{socket_path}");
  });

  afterAll(() => {
    backend.stop();
    Bun.spawnSync(["tmux", "-L", socket, "kill-server"]);
    // kill-server leaves the socket file behind.
    if (socketPath) rmSync(socketPath, { force: true });
  });

  test("lists the pane with session and window ids", async () => {
    const panes = await backend.listPanes();
    expect(panes).toHaveLength(1);
    expect(panes[0]).toMatchObject({
      id: paneId,
      workspaceLabel: "atur",
      agent: null,
      agentStatus: null,
    });
    expect(panes[0]?.cwd).toBeTruthy();
    expect((await backend.getPane(paneId)).id).toBe(paneId);
  });

  test("visible screen is exactly the pane grid, and typing shows up", async () => {
    expect(await backend.geometry(paneId)).toEqual({ cols: 100, rows: 20 });
    await backend.sendText(paneId, "echo hello-$((20+1))");
    await backend.sendKeys(paneId, ["enter"]);
    const text = await until(screenHas("hello-21"), "command output");
    expect(text.split("\r\n")).toHaveLength(20);
    expect(text).toContain("echo hello-$((20+1))");
  });

  test("screen revision only moves when the screen changes", async () => {
    const a = await backend.readVisible(paneId);
    const b = await backend.readVisible(paneId);
    expect(b.revision).toBe(a.revision);
    await backend.sendText(paneId, "x");
    const c = await until(async () => {
      const r = await backend.readVisible(paneId);
      return r.revision > a.revision ? r : null;
    }, "revision bump");
    expect(c.text).not.toBe(a.text);
    await backend.sendKeys(paneId, ["ctrl+c"]);
  });

  test("multi-line text arrives as one paste with its newlines intact", async () => {
    await backend.sendKeys(paneId, ["ctrl+c"]);
    await backend.sendText(paneId, "echo first-line\necho second-line");
    await backend.sendKeys(paneId, ["enter"]);
    const text = await until(screenHas("second-line"), "pasted lines to run");
    expect(text.split("\r\n").filter((r) => r === "first-line")).toHaveLength(1);
    expect(text.split("\r\n").filter((r) => r === "second-line")).toHaveLength(1);
  });

  test("text that looks like options or shell syntax is typed literally", async () => {
    await backend.sendKeys(paneId, ["ctrl+c"]);
    await backend.sendText(paneId, "echo '-x; $HOME \"q\" héllo'");
    await backend.sendKeys(paneId, ["enter"]);
    const text = await until(screenHas("-x; $HOME"), "literal echo");
    expect(text).toContain("héllo");
  });

  test("an unknown key is rejected before anything is sent", async () => {
    await expect(backend.sendKeys(paneId, ["enter", "hyper+q"])).rejects.toThrow(/unsupported key/);
  });

  test("history returns the last N rows including scrollback", async () => {
    await backend.sendText(paneId, "for i in $(seq 1 60); do echo row-$i; done");
    await backend.sendKeys(paneId, ["enter"]);
    await until(screenHas("row-60"), "loop output");
    const rows = await backend.readHistory(paneId, 40);
    expect(rows).toHaveLength(40);
    expect(rows.some((r) => r.includes("row-60"))).toBe(true);
    expect(rows.some((r) => r.includes("row-30"))).toBe(true);
    expect(rows).not.toContain("row-5");
  });

  test("phone resize shrinks the window, release restores it after the grace period", async () => {
    const holder = {};
    await backend.resize(holder, paneId, { cols: 60, rows: 12 });
    await until(async () => {
      const g = await backend.geometry(paneId);
      return g?.cols === 60 && g.rows === 12;
    }, "resized pane");
    // Real wall-clock wait on purpose: the claim is that nothing restores the
    // size while a holder is still attached, which no event can prove.
    await Bun.sleep(150);
    expect(await backend.geometry(paneId)).toEqual({ cols: 60, rows: 12 });
    backend.release(holder);
    await until(async () => {
      const g = await backend.geometry(paneId);
      return g?.cols === 100 && g.rows === 20;
    }, "restored pane");
    expect(tmux("show-options", "-wv", "-t", paneId, "window-size")).toBe("");
  });

  test("agent status comes from the pane's @atur options", async () => {
    tmux("set-option", "-p", "-t", paneId, "@atur_agent", "claude");
    tmux("set-option", "-p", "-t", paneId, "@atur_status", "blocked");
    const [pane] = await backend.listPanes();
    expect(pane).toMatchObject({ agent: "claude", agentStatus: "blocked" });
    expect(await backend.pollPanes()).toEqual(await backend.listPanes());
    tmux("set-option", "-p", "-t", paneId, "-u", "@atur_status");
    expect((await backend.getPane(paneId)).agentStatus).toBe("unknown");
  });

  test("a closed pane is PaneGoneError; a missing server is an empty list", async () => {
    tmux("new-window", "-d", "-t", "atur", "sleep 600");
    const victim = tmux("list-panes", "-a", "-F", "#{pane_id}").split("\n").at(-1) ?? "";
    expect(victim).not.toBe(paneId);
    tmux("kill-pane", "-t", victim);
    await expect(backend.readVisible(victim)).rejects.toBeInstanceOf(PaneGoneError);
    await expect(backend.getPane(victim)).rejects.toBeInstanceOf(PaneGoneError);
    await expect(backend.getPane("not-a-pane")).rejects.toBeInstanceOf(PaneGoneError);

    const nowhere = new TmuxBackend({ socket: `atur-test-none-${process.pid}` });
    expect(await nowhere.listPanes()).toEqual([]);
    await expect(nowhere.readVisible("%0")).rejects.toBeInstanceOf(PaneGoneError);
  });
});
