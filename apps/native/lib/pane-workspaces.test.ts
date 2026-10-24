import { describe, expect, test } from "bun:test";

import type { PaneListItem, PaneTargets } from "./api";
import {
  activeWorkspace,
  customPath,
  filterByWorkspace,
  newestPane,
  newWorkspaceTargets,
  paneWorkspaceKey,
  workspaceChips,
  workspaceKey,
} from "./pane-workspaces";

function pane(
  id: string,
  workspace: string,
  label: string,
  extra: Partial<PaneListItem> = {},
): PaneListItem {
  return {
    pane_id: id,
    workspace_id: workspace,
    workspace_label: label,
    tab_id: "t",
    cwd: null,
    agent: null,
    agent_status: null,
    title: null,
    revision: 1,
    ...extra,
  };
}

const laptop = { id: "m1", name: "Laptop" };
const desktop = { id: "m2", name: "Desktop" };

describe("workspace keys", () => {
  test("a workspace id is only unique per machine", () => {
    expect(workspaceKey(undefined, "w1")).toBe("|w1");
    expect(workspaceKey("m1", "w1")).toBe("m1|w1");
    expect(paneWorkspaceKey(pane("a", "w1", "x", { machine: laptop }))).toBe("m1|w1");
    expect(paneWorkspaceKey(pane("a", "w1", "x"))).toBe("|w1");
  });
});

describe("workspaceChips", () => {
  test("one chip per workspace in list order", () => {
    const chips = workspaceChips([
      pane("a", "w2", "beta"),
      pane("b", "w1", "alpha"),
      pane("c", "w2", "beta"),
    ]);
    expect(chips).toEqual([
      { key: "|w2", label: "beta" },
      { key: "|w1", label: "alpha" },
    ]);
    expect(workspaceChips([])).toEqual([]);
  });

  test("workspaces with the same label on different machines get the machine appended", () => {
    const chips = workspaceChips([
      pane("a", "w1", "app", { machine: laptop }),
      pane("b", "w1", "app", { machine: desktop }),
      pane("c", "w2", "solo", { machine: laptop }),
    ]);
    expect(chips.map((c) => c.label)).toEqual(["app · Laptop", "app · Desktop", "solo"]);
  });

  test("falls back to the workspace id when the label is empty", () => {
    expect(workspaceChips([pane("a", "w7", "")])[0]?.label).toBe("w7");
  });
});

describe("selection and filtering", () => {
  const panes = [pane("a", "w1", "alpha"), pane("b", "w2", "beta"), pane("c", "w1", "alpha")];

  test("a saved workspace that vanished falls back to All", () => {
    const chips = workspaceChips(panes);
    expect(activeWorkspace(chips, "|w2")).toBe("|w2");
    expect(activeWorkspace(chips, "|gone")).toBeNull();
    expect(activeWorkspace(chips, null)).toBeNull();
  });

  test("filters by key, and null keeps every pane", () => {
    expect(filterByWorkspace(panes, "|w1").map((p) => p.pane_id)).toEqual(["a", "c"]);
    expect(filterByWorkspace(panes, null)).toHaveLength(3);
    expect(filterByWorkspace(panes, "|none")).toEqual([]);
  });

  test("newestPane is the most active pane of the workspace, the later one on a tie", () => {
    const list = [
      pane("a", "w1", "alpha", { revision: 5 }),
      pane("b", "w2", "beta", { revision: 99 }),
      pane("c", "w1", "alpha", { revision: 9 }),
      pane("d", "w1", "alpha", { revision: 9 }),
    ];
    expect(newestPane(list, "|w1")?.pane_id).toBe("d");
    expect(newestPane(list, "|w2")?.pane_id).toBe("b");
    expect(newestPane(list, "|none")).toBeNull();
  });
});

describe("newWorkspaceTargets", () => {
  const targets: PaneTargets = {
    roots: [{ path: "/srv/acme", label: "Acme" }],
    machines: [laptop, desktop],
    workspaces: [
      { id: "w1", label: "a", cwd: "/home/me/code/app", pane_count: 2, machine: laptop },
      { id: "w2", label: "b", cwd: "/home/me/code/app", pane_count: 1, machine: laptop },
      { id: "w3", label: "c", cwd: null, pane_count: 1, machine: laptop },
      { id: "w1", label: "legacy", cwd: "/srv/acme", pane_count: 1 },
    ],
  };

  test("offers the dev box for bound repos, then each machine with its distinct folders", () => {
    expect(newWorkspaceTargets(targets)).toEqual([
      { machineId: null, name: "Dev box", paths: [{ path: "/srv/acme", label: "Acme" }] },
      {
        machineId: "m1",
        name: "Laptop",
        paths: [{ path: "/home/me/code/app", label: "code/app" }],
      },
      { machineId: "m2", name: "Desktop", paths: [] },
    ]);
  });

  test("no roots means no dev box target; nothing at all means no targets", () => {
    expect(newWorkspaceTargets({ ...targets, roots: [] }).map((t) => t.name)).toEqual([
      "Laptop",
      "Desktop",
    ]);
    expect(newWorkspaceTargets({ roots: [], machines: [], workspaces: [] })).toEqual([]);
  });
});

describe("customPath", () => {
  test("trims and requires an absolute path", () => {
    expect(customPath("  /home/me/code ")).toBe("/home/me/code");
    expect(customPath("code/app")).toBeNull();
    expect(customPath("~/code")).toBeNull();
    expect(customPath("   ")).toBeNull();
  });
});
