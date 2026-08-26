import { describe, expect, it } from "vitest";

import { buildHierarchicalRows, type TreeIssue } from "../issueTree";

interface TestIssue extends TreeIssue {
  name: string;
}

const issue = (id: string, name: string, parent_id: string | null = null): TestIssue => ({
  id,
  name,
  parent_id,
});

describe("buildHierarchicalRows", () => {
  it("nests children under their parent in walk order", () => {
    const rows = buildHierarchicalRows(
      [issue("c", "child", "p"), issue("p", "parent"), issue("g", "grandchild", "c")],
      new Set(),
    );
    expect(rows.map((r) => [r.issue.id, r.depth])).toEqual([
      ["p", 0],
      ["c", 1],
      ["g", 2],
    ]);
    expect(rows[0]!.childCount).toBe(1);
    expect(rows[1]!.childCount).toBe(1);
    expect(rows[2]!.childCount).toBe(0);
  });

  it("keeps orphans top-level but marks them as sub-issues", () => {
    const rows = buildHierarchicalRows([issue("a", "orphan", "missing")], new Set());
    expect(rows).toHaveLength(1);
    expect(rows[0]!.depth).toBe(0);
    expect(rows[0]!.isSubIssue).toBe(true);
  });

  it("marks nested rows as sub-issues and roots not", () => {
    const rows = buildHierarchicalRows([issue("p", "parent"), issue("c", "child", "p")], new Set());
    expect(rows[0]!.isSubIssue).toBe(false);
    expect(rows[1]!.isSubIssue).toBe(true);
  });

  it("hides the whole descendant subtree of a collapsed parent", () => {
    const rows = buildHierarchicalRows(
      [issue("p", "parent"), issue("c", "child", "p"), issue("g", "grandchild", "c")],
      new Set(["p"]),
    );
    expect(rows.map((r) => r.issue.id)).toEqual(["p"]);
    expect(rows[0]!.childCount).toBe(1); // count survives collapse
  });

  it("terminates on parent cycles without hanging", () => {
    // a↔b mutual parents: both nest under each other, neither is a root, so
    // the walk never starts — no rows, and critically no infinite loop.
    // (With parent_id-only data a cycle can never hang off a root: the loop
    // nodes are only reachable through each other.)
    const rows = buildHierarchicalRows([issue("a", "a", "b"), issue("b", "b", "a")], new Set());
    expect(rows).toEqual([]);
  });

  it("ignores a self-referencing parent_id", () => {
    const rows = buildHierarchicalRows([issue("a", "self", "a")], new Set());
    expect(rows).toHaveLength(1);
    expect(rows[0]!.depth).toBe(0);
  });

  it("respects sameTree: cross-tree children stay top-level", () => {
    const issues: (TestIssue & { project_id: string })[] = [
      { id: "p", name: "parent", parent_id: null, project_id: "1" },
      { id: "c", name: "child", parent_id: "p", project_id: "2" },
    ];
    const rows = buildHierarchicalRows(issues, new Set(), {
      sameTree: (p, c) => p.project_id === c.project_id,
    });
    expect(rows.map((r) => [r.issue.id, r.depth])).toEqual([
      ["p", 0],
      ["c", 0],
    ]);
    // The parent exists in the list, so the row keeps no orphan marker — it
    // just renders top-level. (Verbatim port of the MyIssues behavior.)
    expect(rows[1]!.isSubIssue).toBe(false);
  });

  it("returns an empty list for no issues", () => {
    expect(buildHierarchicalRows([], new Set())).toEqual([]);
  });
});
