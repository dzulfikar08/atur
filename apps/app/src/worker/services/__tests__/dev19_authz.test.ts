import { describe, expect, it } from "vitest";
import { getTableName } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import * as issuesService from "../issues";
import * as modulesRepo from "../../repositories/modules";
import * as sprintsRepo from "../../repositories/sprints";
import * as cyclesRepo from "../../repositories/cycles";
import * as integrationsRepo from "../../repositories/integrations";
import { handleTool } from "../../routes/mcp/index";

// Thenable that also chains like a drizzle query builder (limit/orderBy/
// offset/innerJoin are no-ops returning the same result). Each select()
// call consumes the next fixture; the last fixture repeats. Same pattern
// as dev8_authz.test.ts / states.test.ts.
function chainy(rows: any[]) {
  const p = Promise.resolve(rows);
  const chain: any = {
    // oxlint-disable-next-line unicorn/no-thenable -- drizzle mock must be both awaitable and chainable
    then: p.then.bind(p),
    catch: p.catch.bind(p),
    finally: p.finally.bind(p),
    limit: () => chain,
    orderBy: () => chain,
    offset: () => chain,
  };
  return chain;
}

// Like the dev8 mock, but also captures inserts (activity trail assertions),
// every where() condition with its from-table (predicate pins), and backs
// db.query.projects.findFirst via projectRow for issuesService.create tests.
// insertReturning/updateReturning feed allocateNextSequence's INSERT OR
// IGNORE ... RETURNING seed and UPDATE ... RETURNING bump.
function mockDb(
  selectFixtures: any[][],
  projectRow?: any,
  opts?: { insertReturning?: any[]; updateReturning?: any[] },
) {
  const updates: any[] = [];
  const inserts: any[] = [];
  const selects: { table: string; cond: unknown }[] = [];
  let selectIdx = 0;
  const db: any = {
    query: { projects: { findFirst: async () => projectRow } },
    select: () => {
      const rows = selectFixtures[Math.min(selectIdx, selectFixtures.length - 1)] ?? [];
      const idx = selectIdx;
      selectIdx++;
      const builder: any = {
        table: "",
        innerJoin: () => builder,
        where: (cond: unknown) => {
          selects[idx] = { table: builder.table, cond };
          return chainy(rows);
        },
      };
      return {
        from: (table: any) => {
          builder.table = getTableName(table);
          return builder;
        },
      };
    },
    update: () => ({
      set: (patch: any) => {
        updates.push(patch);
        return {
          // Plain `await ...where(...)` resolves to this object harmlessly;
          // chained `.returning()` feeds the sequence-counter bump.
          where: () => ({
            returning: () => Promise.resolve(opts?.updateReturning ?? []),
          }),
        };
      },
    }),
    insert: () => ({
      values: (vals: any) => {
        inserts.push(vals);
        return {
          onConflictDoNothing: () => ({
            returning: () => Promise.resolve(opts?.insertReturning ?? []),
          }),
        };
      },
    }),
  };
  return { db, updates, inserts, selects };
}

async function expect404(fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (err) {
    expect(err).toBeInstanceOf(HTTPException);
    expect((err as HTTPException).status).toBe(404);
    return;
  }
  throw new Error("expected HTTPException(404)");
}

const MINE = "ws-mine";
const FOREIGN = "ws-foreign";

// Recursively walk a drizzle condition for a Column referencing the given DB
// column name. Used to assert findById() keeps filtering soft-deleted rows —
// a fixture mock cannot express SQL semantics, so we inspect the predicate.
function referencesColumn(cond: unknown, columnName: string): boolean {
  if (!cond || typeof cond !== "object") return false;
  const node = cond as any;
  if (node.name === columnName && node.table) return true; // drizzle Column
  if (Array.isArray(node.queryChunks)) {
    return node.queryChunks.some((chunk: unknown) => referencesColumn(chunk, columnName));
  }
  if (Array.isArray(node)) {
    return (node as unknown[]).some((chunk) => referencesColumn(chunk, columnName));
  }
  return false;
}

// Extract the literal an `eq(column, value)` predicate binds from a drizzle
// condition tree (chunks sequence [Column(columnName), " = ", Param]). The
// where() conditions are workspace-blind in this mock, so tests pin the
// workspace predicate's VALUE: they fail if eq(workspaceId, ...) is dropped
// or pointed at the wrong workspace.
function eqParam(cond: unknown, columnName: string): unknown {
  if (!cond || typeof cond !== "object") return undefined;
  const node = cond as any;
  if (Array.isArray(node.queryChunks)) {
    const chunks = node.queryChunks;
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i] as any;
      // drizzle 0.45 chunk layout: [Column, StringChunk([" = "]), Param].
      // StringChunk.value is a template-strings ARRAY; Param.value is the
      // bound literal.
      if (c?.name === columnName && c?.table) {
        const mid = chunks[i + 1]?.value;
        const midStr = Array.isArray(mid) ? mid.join("") : mid;
        const val = chunks[i + 2]?.value;
        if (typeof midStr === "string" && midStr.includes("=") && val !== undefined) {
          return val;
        }
      }
      const nested = eqParam(c, columnName);
      if (nested !== undefined) return nested;
    }
  }
  return undefined;
}

describe("DEV-19 HTTP issue update state validation", () => {
  const issue = {
    id: "i1",
    workspaceId: MINE,
    stateId: "s-old",
    name: "Some issue",
    priority: "none",
    startDate: null,
    targetDate: null,
    estimatePoints: null,
    descriptionHtml: null,
  };

  it("rejects a foreign-workspace state_id with a 404 before any write", async () => {
    const foreignState = { id: "s-foreign", workspaceId: FOREIGN, name: "Foreign done" };
    const db = mockDb([[issue], [foreignState]]);
    await expect404(() => issuesService.update(db.db, "i1", { state_id: "s-foreign" }));
    expect(db.updates).toHaveLength(0);
  });

  it("rejects a missing (or soft-deleted) state_id with a 404 before any write", async () => {
    // statesRepo.findById filters deletedAt, so a soft-deleted state and an
    // unknown UUID are indistinguishable — both resolve to no row here.
    const db = mockDb([[issue], []]);
    await expect404(() => issuesService.update(db.db, "i1", { state_id: "s-gone" }));
    expect(db.updates).toHaveLength(0);
  });

  it("accepts an in-workspace state change and still records trail names", async () => {
    // Select order: issue, new state (validation), issue re-read after
    // update, old state (trail), labels, assignees, enriched state.
    const newState = { id: "s-new", workspaceId: MINE, name: "New" };
    const db = mockDb([
      [issue],
      [newState],
      [{ ...issue, stateId: "s-new" }],
      [{ id: "s-old", name: "Old" }],
      [],
      [],
      [{ id: "s-new", name: "New" }],
    ]);
    await issuesService.update(db.db, "i1", { state_id: "s-new" });
    expect(db.updates).toHaveLength(1);
    expect(db.updates[0]).toMatchObject({ stateId: "s-new" });
    const stateEvent = db.inserts.find((v) => v.field === "state");
    expect(stateEvent).toMatchObject({ oldValue: "Old", newValue: "New" });
  });
});

describe("DEV-19 MCP tool validation", () => {
  // Select order for create_issue: workspace (slug), project-in-workspace,
  // then the ids under validation. getWorkspaceId skips the caller-membership
  // select because the fixtures make the caller the workspace owner.
  it("create_issue: state outside the workspace is a 404, nothing inserted", async () => {
    const db = mockDb([[{ id: MINE, ownerId: "u1" }], [{ id: "p1" }], []]);
    await expect404(() =>
      handleTool(
        db.db,
        {} as any,
        "create_issue",
        {
          workspace: "mine",
          project_id: "p1",
          name: "Issue",
          state_id: "s-foreign",
        },
        "u1",
      ),
    );
    expect(db.inserts).toHaveLength(0);
  });

  it("create_issue: label outside the workspace is a 404, nothing inserted", async () => {
    const db = mockDb([[{ id: MINE, ownerId: "u1" }], [{ id: "p1" }], []]);
    await expect404(() =>
      handleTool(
        db.db,
        {} as any,
        "create_issue",
        {
          workspace: "mine",
          project_id: "p1",
          name: "Issue",
          label_ids: ["l-foreign"],
        },
        "u1",
      ),
    );
    expect(db.inserts).toHaveLength(0);
  });

  it("create_issue: assignee who is not an active member is a 404, nothing inserted", async () => {
    // Select order: workspace, project, assignee owner, member rows.
    const db = mockDb([[{ id: MINE, ownerId: "u1" }], [{ id: "p1" }], [{ ownerId: "u1" }], []]);
    await expect404(() =>
      handleTool(
        db.db,
        {} as any,
        "create_issue",
        {
          workspace: "mine",
          project_id: "p1",
          name: "Issue",
          assignee_ids: ["u-stranger"],
        },
        "u1",
      ),
    );
    expect(db.inserts).toHaveLength(0);
  });

  it("update_issue: state outside the workspace is a 404, no update issued", async () => {
    // Select order: workspace (slug), state. (Owner caller skips the
    // membership select.)
    const db = mockDb([[{ id: MINE, ownerId: "u1" }], []]);
    await expect404(() =>
      handleTool(
        db.db,
        {} as any,
        "update_issue",
        {
          workspace: "mine",
          project_id: "p1",
          issue_id: "i1",
          state_id: "s-foreign",
        },
        "u1",
      ),
    );
    expect(db.updates).toHaveLength(0);
  });

  it("set_assignee: non-member assignee is a 404, nothing inserted", async () => {
    // Select order: issue (access), project (access), workspace (access),
    // issue workspace re-read, assignee owner, assignee member rows.
    const db = mockDb([
      [{ projectId: "p1" }],
      [{ workspaceId: MINE }],
      [{ ownerId: "u1" }],
      [{ workspaceId: MINE }],
      [{ ownerId: "u1" }],
      [],
    ]);
    await expect404(() =>
      handleTool(
        db.db,
        {} as any,
        "set_assignee",
        {
          workspace: "mine",
          project_id: "p1",
          issue_id: "i1",
          assignee_id: "u-stranger",
        },
        "u1",
      ),
    );
    expect(db.inserts).toHaveLength(0);
  });
});

describe("DEV-19 repo findById soft-delete filters", () => {
  it.each([
    ["modules", modulesRepo.findById],
    ["sprints", sprintsRepo.findById],
    ["cycles", cyclesRepo.findById],
    ["integrations", integrationsRepo.findById],
  ])("%s findById filters soft-deleted rows", async (_name, findById) => {
    const db = mockDb([[{ id: "x1" }]]);
    await findById(db.db, "x1");
    expect(db.selects.length).toBeGreaterThan(0);
    expect(db.selects.some((s) => referencesColumn(s.cond, "deleted_at"))).toBe(true);
  });
});

describe("DEV-19 round 2 — HTTP create/update id binding", () => {
  const project = { id: "p1", workspaceId: MINE, defaultStateId: "s-def" };
  const issue = {
    id: "i1",
    workspaceId: MINE,
    stateId: "s-old",
    name: "Some issue",
    priority: "none",
    startDate: null,
    targetDate: null,
    estimatePoints: null,
    descriptionHtml: null,
  };

  it("create: foreign-workspace state_id is a 404, nothing inserted", async () => {
    // Select order: project (query.findFirst), state (validation).
    const db = mockDb([[{ id: "s-foreign", workspaceId: FOREIGN, name: "Foreign" }]], project);
    await expect404(() =>
      issuesService.create(db.db, "p1", {
        name: "Issue",
        priority: "none",
        state_id: "s-foreign",
      }),
    );
    expect(db.inserts).toHaveLength(0);
  });

  it("create: foreign-workspace label id is a 404, nothing inserted", async () => {
    const db = mockDb([[]], project);
    await expect404(() =>
      issuesService.create(db.db, "p1", {
        name: "Issue",
        priority: "none",
        label_ids: ["l-foreign"],
      }),
    );
    expect(db.inserts).toHaveLength(0);
  });

  it("create: non-member assignee is a 404, nothing inserted", async () => {
    // Select order: project, assignee owner, assignee member rows.
    const db = mockDb([[{ ownerId: "u1" }], []], project);
    await expect404(() =>
      issuesService.create(db.db, "p1", {
        name: "Issue",
        priority: "none",
        assignee_ids: ["u-stranger"],
      }),
    );
    expect(db.inserts).toHaveLength(0);
  });

  it("update: foreign-workspace label in label_ids is a 404, no update issued", async () => {
    // Select order: issue, label rows (validation).
    const db = mockDb([[issue], []]);
    await expect404(() => issuesService.update(db.db, "i1", { label_ids: ["l-foreign"] }));
    expect(db.updates).toHaveLength(0);
  });

  it("update: non-member assignee in assignee_ids is a 404, no update issued", async () => {
    // Select order: issue, assignee owner, assignee member rows.
    const db = mockDb([[issue], [{ ownerId: "u1" }], []]);
    await expect404(() => issuesService.update(db.db, "i1", { assignee_ids: ["u-stranger"] }));
    expect(db.updates).toHaveLength(0);
  });

  it("MCP create_issue: parent issue outside the workspace is a 404, nothing inserted", async () => {
    // Select order: workspace (slug), project-in-workspace, parent issue.
    const db = mockDb([[{ id: MINE, ownerId: "u1" }], [{ id: "p1" }], []]);
    await expect404(() =>
      handleTool(
        db.db,
        {} as any,
        "create_issue",
        {
          workspace: "mine",
          project_id: "p1",
          name: "Issue",
          parent_id: "i-foreign",
        },
        "u1",
      ),
    );
    expect(db.inserts).toHaveLength(0);
  });

  it("HTTP create: parent issue outside the workspace is a 404, nothing inserted", async () => {
    // Select order: project (query.findFirst), parent issue (validation).
    const db = mockDb([[]], project);
    await expect404(() =>
      issuesService.create(db.db, "p1", {
        name: "Issue",
        priority: "none",
        parent_id: "i-foreign",
      }),
    );
    expect(db.inserts).toHaveLength(0);
  });
});

describe("DEV-19 round 4 — label/assignee service binding + happy paths", () => {
  const project = { id: "p1", workspaceId: MINE, defaultStateId: "s-def" };
  const issue = {
    id: "i1",
    workspaceId: MINE,
    stateId: "s-old",
    name: "Some issue",
    priority: "none",
    startDate: null,
    targetDate: null,
    estimatePoints: null,
    descriptionHtml: null,
  };

  it("addLabel: foreign-workspace label is a 404, nothing inserted", async () => {
    // Select order: issue, label rows (validation).
    const db = mockDb([[issue], []]);
    await expect404(() => issuesService.addLabel(db.db, "i1", "l-foreign"));
    expect(db.inserts).toHaveLength(0);
    const labelSelect = db.selects.find((s) => s.table === "labels");
    expect(eqParam(labelSelect?.cond, "workspace_id")).toBe(MINE);
  });

  it("addAssignee: non-member is a 404, nothing inserted", async () => {
    // Select order: issue, assignee owner, assignee member rows.
    const db = mockDb([[issue], [{ ownerId: "u1" }], []]);
    await expect404(() => issuesService.addAssignee(db.db, "i1", "u-stranger"));
    expect(db.inserts).toHaveLength(0);
    const memberSelect = db.selects.find((s) => s.table === "workspace_members");
    expect(eqParam(memberSelect?.cond, "workspace_id")).toBe(MINE);
  });

  it("addAssignee: the workspace owner passes without a membership row", async () => {
    // Owner-or-member (round 4): the owner id is accepted even when
    // workspace_members has no active row for them.
    // Select order: issue, assignee owner, member rows (empty), subscribe
    // existing-subscriber check.
    const db = mockDb([[issue], [{ ownerId: "u-owner" }], [], []]);
    await issuesService.addAssignee(db.db, "i1", "u-owner");
    expect(db.inserts.some((v) => v.assigneeId === "u-owner")).toBe(true);
  });

  it("set_assignee: validation binds to the ISSUE's workspace, not the caller's", async () => {
    // The issue lives in ws-other (resolved via assertIssueAccess); the
    // caller (u1, owner of ws-mine) reaches it through a shared project
    // context. The assignee check must resolve ws-other's owner/members.
    // Select order: issue (access), project (access), workspace (access),
    // issue workspace re-read, assignee owner of ws-other, ws-other members.
    const db = mockDb([
      [{ projectId: "p1" }],
      [{ workspaceId: "ws-other" }],
      [{ ownerId: "u1" }],
      [{ workspaceId: "ws-other" }],
      [{ ownerId: "u-owner-other" }],
      [],
    ]);
    await expect404(() =>
      handleTool(
        db.db,
        {} as any,
        "set_assignee",
        {
          workspace: "mine",
          project_id: "p1",
          issue_id: "i1",
          assignee_id: "u-stranger",
        },
        "u1",
      ),
    );
    expect(db.inserts).toHaveLength(0);
    const memberSelect = db.selects.filter((s) => s.table === "workspace_members").pop();
    expect(eqParam(memberSelect?.cond, "workspace_id")).toBe("ws-other");
  });

  it("MCP create_issue: valid state+label+assignee+parent issues all the inserts", async () => {
    // Select order: workspace (slug), project, state, labels batch,
    // assignee owner, assignee members, parent issue. Then the sequence
    // seed insert (no-op), the counter bump update, and the row inserts.
    const db = mockDb(
      [
        [{ id: MINE, ownerId: "u1" }],
        [{ id: "p1" }],
        [{ id: "s1" }],
        [{ id: "l1" }],
        [{ ownerId: "u1" }],
        [{ memberId: "u2" }],
        [{ id: "par1" }],
      ],
      undefined,
      { updateReturning: [{ nextSequence: 5 }] },
    );
    await handleTool(
      db.db,
      {} as any,
      "create_issue",
      {
        workspace: "mine",
        project_id: "p1",
        name: "Issue",
        state_id: "s1",
        label_ids: ["l1"],
        assignee_ids: ["u2"],
        parent_id: "par1",
      },
      "u1",
    );
    const issueInsert = db.inserts.find((v) => v.name === "Issue");
    expect(issueInsert).toMatchObject({
      stateId: "s1",
      parentId: "par1",
      sequenceId: 5,
      workspaceId: MINE,
    });
    expect(db.inserts.some((v) => v.labelId === "l1")).toBe(true);
    expect(db.inserts.some((v) => v.assigneeId === "u2")).toBe(true);
    // Workspace-sensitive predicates bind to the CALL's workspace.
    const labelSelect = db.selects.find((s) => s.table === "labels");
    expect(eqParam(labelSelect?.cond, "workspace_id")).toBe(MINE);
    const memberSelect = db.selects.find((s) => s.table === "workspace_members");
    expect(eqParam(memberSelect?.cond, "workspace_id")).toBe(MINE);
  });

  it("HTTP create: valid state+label+assignee inserts the issue", async () => {
    // Select order: state, labels batch, assignee owner, assignee members,
    // issue re-read after create, subscribe existing check, enrich labels,
    // enrich assignees, enrich state.
    const db = mockDb(
      [
        [{ id: "s1", name: "Todo", workspaceId: MINE }],
        [{ id: "l1" }],
        [{ ownerId: "u1" }],
        [{ memberId: "u2" }],
        [{ ...issue, stateId: "s1" }],
        [],
        [],
        [],
        [],
      ],
      project,
      { updateReturning: [{ nextSequence: 5 }] },
    );
    await issuesService.create(db.db, "p1", {
      name: "Issue",
      priority: "none",
      state_id: "s1",
      label_ids: ["l1"],
      assignee_ids: ["u2"],
    });
    expect(db.inserts.some((v) => v.name === "Issue" && v.sequenceId === 5)).toBe(true);
    expect(db.inserts.some((v) => v.labelId === "l1")).toBe(true);
    expect(db.inserts.some((v) => v.assigneeId === "u2")).toBe(true);
    const labelSelect = db.selects.find((s) => s.table === "labels");
    expect(eqParam(labelSelect?.cond, "workspace_id")).toBe(MINE);
    const memberSelect = db.selects.find((s) => s.table === "workspace_members");
    expect(eqParam(memberSelect?.cond, "workspace_id")).toBe(MINE);
  });
});
