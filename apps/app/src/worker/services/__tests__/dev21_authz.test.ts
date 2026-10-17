import { describe, expect, it } from "vitest";
import { getTableName } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import * as projectsService from "../projects";
import * as issuesService from "../issues";
import * as issuesRepo from "../../repositories/issues";
import * as polarService from "../polar";

// Same harness family as dev19/dev20 (select-ordinal fixtures + where capture).
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

function mockDb(selectFixtures: any[][]) {
  const updates: any[] = [];
  const selects: { table: string; cond: unknown }[] = [];
  let selectIdx = 0;
  const db: any = {
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
        return { where: () => Promise.resolve() };
      },
    }),
    insert: () => ({
      values: () => ({ onConflictDoNothing: () => ({ returning: () => Promise.resolve([]) }) }),
    }),
  };
  return { db, updates, selects };
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

// Extract the literal an eq(column, value) predicate binds (dev19 harness).
function eqParam(cond: unknown, columnName: string): unknown {
  if (!cond || typeof cond !== "object") return undefined;
  const node = cond as any;
  if (Array.isArray(node.queryChunks)) {
    const chunks = node.queryChunks;
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i] as any;
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

const MINE = "ws-mine";
const FOREIGN = "ws-foreign";

// projectsService.update select order: workspaces (findBySlug), projects
// (findById), then assertProjectIdsInWorkspace's selects.
describe("DEV-21 project config store-side binding", () => {
  const ws = [{ id: MINE, slug: "mine" }];
  const project = [{ id: "p1", workspaceId: MINE }];

  it("foreign defaultStateId is a 404, no write", async () => {
    const db = mockDb([ws, project, []]); // state select misses
    await expect404(() =>
      projectsService.update(db.db, "mine", "p1", { defaultStateId: "st-foreign" } as any),
    );
    expect(db.updates).toHaveLength(0);
    expect(eqParam(db.selects[2].cond, "workspace_id")).toBe(MINE);
  });

  it("non-member defaultAssigneeId is a 404 (owner passes without member row)", async () => {
    // owner select, then members select misses; assignee is not the owner.
    const db = mockDb([ws, project, [{ ownerId: "owner-1" }], []]);
    await expect404(() =>
      projectsService.update(db.db, "mine", "p1", { defaultAssigneeId: "u-foreign" } as any),
    );
    expect(db.updates).toHaveLength(0);

    const ok = mockDb([ws, project, [{ ownerId: "owner-1" }], []]);
    await projectsService.update(ok.db, "mine", "p1", { defaultAssigneeId: "owner-1" } as any);
    expect(ok.updates).toHaveLength(1);
  });
});

describe("DEV-21 polar project-scoped state guard", () => {
  const settings = (stateId: string | null) =>
    ({ workspaceId: MINE, pipelineProjectId: "p-ok", defaultStateId: stateId }) as any;

  it("a cross-PROJECT state (same workspace) is dropped for the group pick", async () => {
    // project resolves; state select misses (project-scoped); group pick hits.
    const db = mockDb([[{ id: "p-ok" }], [], [{ id: "g1" }]]);
    const { projectId, defaultStateId } = await polarService.resolvePipeline(
      db.db,
      settings("st-other-project"),
    );
    expect(projectId).toBe("p-ok");
    expect(defaultStateId).toBe("g1");
    // The state guard carried the project predicate.
    expect(eqParam(db.selects[1].cond, "project_id")).toBe("p-ok");
  });
});

describe("DEV-21 label/assignee enrichment belt-and-braces", () => {
  it("listLabels with workspaceId pins the label workspace predicate", async () => {
    const db = mockDb([[{ id: "l1", name: "L", color: "#fff" }]]);
    await issuesRepo.listLabels(db.db, "i1", MINE);
    expect(eqParam(db.selects[0].cond, "workspace_id")).toBe(MINE);
  });

  it("enrichIssues drops a foreign-workspace label row", async () => {
    // Select order: assigneeRows, then labelRows.
    const db = mockDb([
      [], // no assignees
      [{ issueId: "i1", id: "l1", name: "L", color: "#fff", workspaceId: FOREIGN }],
    ]);
    const [out] = await issuesService.enrichIssues(db.db, [
      { id: "i1", stateId: null, workspaceId: MINE } as any,
    ]);
    expect(out.labels).toEqual([]);
  });

  it("enrichIssues drops an assignee whose active membership is in another workspace", async () => {
    // The assignee query joins workspace_members (active, non-deleted) and
    // returns the member row's workspace; only the OWNING issue's workspace
    // renders. Select order: assigneeRows, labelRows, moduleRows.
    const user = { issueId: "i1", id: "u1", email: "a@x", username: "a", displayName: "A", avatar: null };
    const db = mockDb([
      [
        { ...user, workspaceId: MINE },
        { ...user, id: "u2", workspaceId: FOREIGN },
      ],
      [],
      [],
    ]);
    const [out] = await issuesService.enrichIssues(db.db, [
      { id: "i1", stateId: null, workspaceId: MINE },
    ]);
    expect(out.assignees.map((a) => a.id)).toEqual(["u1"]);
    // The query reads issue_assignees (membership comes from the joined member row).
    expect(db.selects[0].table).toBe("issue_assignees");
  });

  it("enrichIssues attaches module ids from live module links", async () => {
    // Select order: assigneeRows, labelRows, moduleRows.
    const db = mockDb([
      [],
      [],
      [
        { issueId: "i1", moduleId: "m1", workspaceId: MINE },
        { issueId: "i1", moduleId: "m2", workspaceId: FOREIGN },
      ],
    ]);
    const [out] = await issuesService.enrichIssues(db.db, [
      { id: "i1", stateId: null, workspaceId: MINE } as any,
    ]);
    // m2 is a legacy foreign-workspace link — must drop out.
    expect(out.moduleIds).toEqual(["m1"]);
  });

  it("enrichIssues module query reads module_issues", async () => {
    // Shape pin: the module select runs against module_issues (the harness's
    // sqlText can't surface column names, so the deleted_at filters on the
    // link + joined modules row are exercised by the query in the service).
    const db = mockDb([[], [], []]);
    await issuesService.enrichIssues(db.db, [
      { id: "i1", stateId: null, workspaceId: MINE } as any,
    ]);
    expect(db.selects[2].table).toBe("module_issues");
    expect(db.selects[2].cond).toBeTruthy();
  });
  it("moveDealToGroup keys the stage state on the ISSUE's project", async () => {
    // Select order: issue resolve (projectId from the ISSUE row, not any
    // configured pipeline project), then findStateByGroup.
    const db = mockDb([[{ projectId: "p-issue" }], [{ id: "g2" }]]);
    const settings = { workspaceId: MINE, pipelineProjectId: "p-configured" } as any;
    await polarService.moveDealToGroup(db.db, settings, "i1", "cancelled");
    expect(eqParam(db.selects[0].cond, "id")).toBe("i1");
    expect(eqParam(db.selects[1].cond, "project_id")).toBe("p-issue");
  });
});
