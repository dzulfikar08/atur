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

// Flatten a drizzle condition into its SQL text (StringChunk template pieces
// joined). The cond tree is circular (Column -> table -> columns), so
// JSON.stringify is out; this walks only the chunk arrays we care about.
function sqlText(cond: unknown): string {
  const parts: string[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const n = node as any;
    if (Array.isArray(n.queryChunks)) {
      for (const chunk of n.queryChunks) walk(chunk);
      return;
    }
    const v = n.value;
    if (typeof v === "string") parts.push(v);
    else if (Array.isArray(v)) parts.push(v.join(""));
  };
  walk(cond);
  return parts.join(" ");
}

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

  it("enrichIssues assignee query carries the workspace-members EXISTS + issues join", async () => {
    // The harness can't evaluate SQL, so pin the query SHAPE: the captured
    // condition must embed the correlated workspace_members EXISTS.
    const db = mockDb([[], []]);
    await issuesService.enrichIssues(db.db, [
      { id: "i1", stateId: null, workspaceId: MINE } as any,
    ]);
    const text = sqlText(db.selects[0].cond);
    expect(text).toContain("workspace_members");
    expect(text).toContain("workspace_id");
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
