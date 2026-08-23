import { describe, expect, it } from "vitest";
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

// Like the dev8 mock, but also captures inserts (activity trail assertions)
// and every where() condition (soft-delete filter assertions). projectRow
// backs db.query.projects.findFirst for issuesService.create tests.
function mockDb(selectFixtures: any[][], projectRow?: any) {
  const updates: any[] = [];
  const inserts: any[] = [];
  const wheres: unknown[] = [];
  let selectIdx = 0;
  const db: any = {
    query: { projects: { findFirst: async () => projectRow } },
    select: () => {
      const rows = selectFixtures[Math.min(selectIdx, selectFixtures.length - 1)] ?? [];
      selectIdx++;
      const builder: any = {
        innerJoin: () => builder,
        where: (cond: unknown) => {
          wheres.push(cond);
          return chainy(rows);
        },
      };
      return { from: () => builder };
    },
    update: () => ({
      set: (patch: any) => {
        updates.push(patch);
        return { where: () => Promise.resolve() };
      },
    }),
    insert: () => ({
      values: (vals: any) => {
        inserts.push(vals);
        return Promise.resolve();
      },
    }),
  };
  return { db, updates, inserts, wheres };
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
  // then the id under validation. getWorkspaceId skips the caller-membership
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
    // issue workspace re-read, assignee membership.
    const db = mockDb([
      [{ projectId: "p1" }],
      [{ workspaceId: MINE }],
      [{ ownerId: "u1" }],
      [{ workspaceId: MINE }],
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
    expect(db.wheres.length).toBeGreaterThan(0);
    expect(db.wheres.some((cond) => referencesColumn(cond, "deleted_at"))).toBe(true);
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
    const db = mockDb([[]], project);
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
    const db = mockDb([[issue], []]);
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
