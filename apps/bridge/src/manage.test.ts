/**
 * Pane management routes over a fake backend: input validation, status codes
 * and wire shapes. The backends themselves are covered in backend-tmux.test.ts
 * (real tmux) and by the live herdr smoke run.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ConflictError,
  PaneGoneError,
  workspacesOf,
  type PaneBackend,
  type PaneSummary,
  type SplitDirection,
} from "./backend";
import { handleManage, validateCwd, validateLabel } from "./manage";

function pane(id: string, workspaceId: string, label: string, cwd: string | null): PaneSummary {
  return {
    id,
    workspaceId,
    workspaceLabel: label,
    tabId: `${workspaceId}:t1`,
    cwd,
    title: null,
    agent: null,
    agentStatus: null,
    agentSessionPath: null,
    revision: 1,
  };
}

interface Calls {
  created: { cwd: string; label?: string }[];
  split: { id: string; direction: SplitDirection; cwd?: string }[];
  closed: string[];
}

function fakeBackend(panes: PaneSummary[], calls: Calls, fail?: () => Error | null): PaneBackend {
  const maybeFail = () => {
    const e = fail?.();
    if (e) throw e;
  };
  const partial: Pick<
    PaneBackend,
    "kind" | "listPanes" | "createWorkspace" | "splitPane" | "closePane"
  > = {
    kind: "herdr",
    listPanes: async () => panes,
    createWorkspace: async (opts) => {
      maybeFail();
      calls.created.push(opts);
      const root = pane("w9:p1", "w9", opts.label ?? "new", opts.cwd);
      return {
        workspace: { id: "w9", label: root.workspaceLabel, cwd: opts.cwd, paneCount: 1 },
        pane: root,
      };
    },
    splitPane: async (id, direction, cwd) => {
      maybeFail();
      calls.split.push({ id, direction, cwd });
      return pane("w1:p2", "w1", "acme", cwd ?? "/srv/acme");
    },
    closePane: async (id) => {
      maybeFail();
      calls.closed.push(id);
    },
  };
  // Only the methods the management routes call are faked.
  return partial as PaneBackend;
}

describe("workspacesOf", () => {
  test("folds panes into workspaces in first-seen order with the first pane's cwd", () => {
    const list = workspacesOf([
      pane("a:1", "a", "alpha", "/srv/a"),
      pane("b:1", "b", "beta", "/srv/b"),
      pane("a:2", "a", "alpha", "/srv/a/sub"),
    ]);
    expect(list).toEqual([
      { id: "a", label: "alpha", cwd: "/srv/a", paneCount: 2 },
      { id: "b", label: "beta", cwd: "/srv/b", paneCount: 1 },
    ]);
    expect(workspacesOf([])).toEqual([]);
  });
});

describe("validateCwd / validateLabel", () => {
  let dir = "";
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "atur-manage-"));
    writeFileSync(join(dir, "file.txt"), "x");
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test("accepts an existing absolute directory and normalises it", async () => {
    expect(await validateCwd(dir)).toBe(dir);
    expect(await validateCwd(`${dir}/`)).toBe(dir);
    expect(await validateCwd(`${dir}/../${dir.split("/").at(-1)}`)).toBe(dir);
    expect(await validateCwd("/")).toBe("/");
  });

  test("rejects relative, missing, non-directory, oversized and control-character paths", async () => {
    await expect(validateCwd("relative/dir")).rejects.toThrow(/absolute/);
    await expect(validateCwd("~/code")).rejects.toThrow(/absolute/);
    await expect(validateCwd(join(dir, "nope"))).rejects.toThrow(/existing directory/);
    await expect(validateCwd(join(dir, "file.txt"))).rejects.toThrow(/existing directory/);
    await expect(validateCwd(`/${"a".repeat(5000)}`)).rejects.toThrow(/too long/);
    await expect(validateCwd(`${dir}\n`)).rejects.toThrow(/control/);
    await expect(validateCwd("")).rejects.toThrow(/required/);
    await expect(validateCwd(42)).rejects.toThrow(/required/);
  });

  test("labels are trimmed, optional, length-limited and free of control characters", () => {
    expect(validateLabel(undefined)).toBeUndefined();
    expect(validateLabel(null)).toBeUndefined();
    expect(validateLabel("   ")).toBeUndefined();
    expect(validateLabel("  atur app  ")).toBe("atur app");
    expect(validateLabel("a".repeat(64))).toHaveLength(64);
    expect(() => validateLabel("a".repeat(65))).toThrow(/longer than 64/);
    expect(() => validateLabel("bad\u0007label")).toThrow(/control/);
    expect(() => validateLabel("two\nlines")).toThrow(/control/);
    expect(() => validateLabel(7)).toThrow(/string/);
  });
});

describe("handleManage", () => {
  let dir = "";
  let calls: Calls;
  const panes = [
    pane("w1:p1", "w1", "acme", "/srv/acme"),
    pane("w1:p2", "w1", "acme", "/srv/acme"),
    pane("w2:p1", "w2", "beta", null),
  ];
  const url = (path: string) => new URL(`http://127.0.0.1:7601${path}`);
  const post = (path: string, body: unknown, backend: PaneBackend) =>
    handleManage(
      new Request(url(path).href, {
        method: "POST",
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
      url(path),
      backend,
    ) as Promise<Response>;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "atur-manage-"));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const fresh = (fail?: () => Error | null) => {
    calls = { created: [], split: [], closed: [] };
    return fakeBackend(panes, calls, fail);
  };

  test("ignores paths and methods it does not own", async () => {
    const backend = fresh();
    for (const [method, path] of [
      ["GET", "/panes"],
      ["GET", "/panes/close"],
      ["POST", "/panes/paste"],
      ["DELETE", "/workspaces"],
    ] as const) {
      const res = await handleManage(new Request(url(path).href, { method }), url(path), backend);
      expect(res).toBeNull();
    }
  });

  test("GET /workspaces lists workspaces with pane counts", async () => {
    const res = await handleManage(
      new Request(url("/workspaces").href),
      url("/workspaces"),
      fresh(),
    );
    expect(res?.status).toBe(200);
    expect(await res?.json()).toEqual({
      workspaces: [
        { id: "w1", label: "acme", cwd: "/srv/acme", pane_count: 2 },
        { id: "w2", label: "beta", cwd: null, pane_count: 1 },
      ],
    });
  });

  test("POST /workspaces creates with the validated cwd and label", async () => {
    const backend = fresh();
    const res = await post("/workspaces", { cwd: `${dir}/`, label: "  scratch " }, backend);
    expect(res.status).toBe(201);
    expect(calls.created).toEqual([{ cwd: dir, label: "scratch" }]);
    expect(await res.json()).toMatchObject({
      workspace: { id: "w9", label: "scratch", cwd: dir, pane_count: 1 },
      pane: { pane_id: "w9:p1", workspace_id: "w9", workspace_label: "scratch", cwd: dir },
    });
  });

  test("POST /workspaces rejects bad input with 400 and never reaches the backend", async () => {
    const backend = fresh();
    for (const body of [
      { cwd: "relative" },
      { cwd: `${dir}/missing` },
      { cwd: dir, label: "x".repeat(65) },
      { cwd: dir, label: "tab\there" },
      {},
      "not json",
      "[1]",
    ]) {
      const res = await post("/workspaces", body, backend);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: expect.any(String) });
    }
    expect(calls.created).toEqual([]);
  });

  test("POST /workspaces turns a name clash into 409 and a backend failure into 502", async () => {
    let res = await post(
      "/workspaces",
      { cwd: dir },
      fresh(() => new ConflictError('a workspace named "x" already exists')),
    );
    expect(res.status).toBe(409);
    res = await post(
      "/workspaces",
      { cwd: dir },
      fresh(() => new Error("herdr socket closed")),
    );
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "herdr socket closed" });
  });

  test("POST /panes/split passes direction (and an optional cwd) and answers the new pane", async () => {
    const backend = fresh();
    let res = await post("/panes/split", { pane: "w1:p1", direction: "right" }, backend);
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ pane: { pane_id: "w1:p2", workspace_label: "acme" } });
    res = await post("/panes/split", { pane: "w1:p1", direction: "down", cwd: dir }, backend);
    expect(res.status).toBe(201);
    expect(calls.split).toEqual([
      { id: "w1:p1", direction: "right", cwd: undefined },
      { id: "w1:p1", direction: "down", cwd: dir },
    ]);
  });

  test("POST /panes/split validates pane, direction and cwd; unknown pane is 404", async () => {
    const backend = fresh();
    for (const body of [
      { direction: "right" },
      { pane: "", direction: "right" },
      { pane: "w1:p1", direction: "left" },
      { pane: "w1:p1" },
      { pane: "w1:p1", direction: "right", cwd: "relative" },
      { pane: "bad\nid", direction: "right" },
    ]) {
      expect((await post("/panes/split", body, backend)).status).toBe(400);
    }
    expect(calls.split).toEqual([]);

    const res = await post(
      "/panes/split",
      { pane: "gone", direction: "right" },
      fresh(() => new PaneGoneError("no such pane")),
    );
    expect(res.status).toBe(404);
  });

  test("POST /panes/close is 204 with no body; unknown pane is 404; missing pane is 400", async () => {
    const backend = fresh();
    const res = await post("/panes/close", { pane: "w1:p2" }, backend);
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect(calls.closed).toEqual(["w1:p2"]);

    expect((await post("/panes/close", {}, backend)).status).toBe(400);
    const gone = await post(
      "/panes/close",
      { pane: "w1:p9" },
      fresh(() => new PaneGoneError("not_found")),
    );
    expect(gone.status).toBe(404);
  });
});
