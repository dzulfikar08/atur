import { describe, expect, it } from "vitest";
import { getTableName } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import * as feedbackService from "../feedback";
import * as polarService from "../polar";

// Thenable that also chains like a drizzle query builder. Each select()
// consumes the next fixture; the last repeats. Same harness idea as
// dev19_authz.test.ts, trimmed to what the DEV-20 paths need.
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
  const inserts: any[] = [];
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
      values: (vals: any) => {
        inserts.push(vals);
        return { onConflictDoNothing: () => ({ returning: () => Promise.resolve([]) }) };
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

// Extract the literal an eq(column, value) predicate binds (see
// dev19_authz.test.ts for the chunk-layout rationale — pins the workspace
// VALUE, not just the column presence).
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

// upsertAdminConfig select order:
// resolveProject(workspaces, projects) -> assertWorkspaceMember ->
// assertBoardIdsInWorkspace(states?, labels?) -> findBoardByProject.
describe("DEV-20 feedback admin config store-side binding", () => {
  const ws = [{ id: MINE, slug: "mine" }];
  const project = [{ id: "p1", workspaceId: MINE, name: "P" }];
  const member = [{ id: "m1" }];

  it("foreign state_id is a 404, no board write", async () => {
    const db = mockDb([ws, project, member, []]); // state select misses
    await expect404(() =>
      feedbackService.upsertAdminConfig(db.db, "mine", "p1", "u1", {
        default_state_id: "st-foreign",
      } as any),
    );
    expect(db.updates).toHaveLength(0);
    expect(db.inserts).toHaveLength(0);
    // The state assert is workspace-pinned to the board's workspace.
    expect(eqParam(db.selects[3].cond, "workspace_id")).toBe(MINE);
  });

  it("foreign label_id is a 404, no board write", async () => {
    const db = mockDb([ws, project, member, []]); // label select misses
    await expect404(() =>
      feedbackService.upsertAdminConfig(db.db, "mine", "p1", "u1", {
        submit_label_id: "lb-foreign",
      } as any),
    );
    expect(db.updates).toHaveLength(0);
  });

  it("valid ids proceed to the board upsert", async () => {
    const db = mockDb([
      ws,
      project,
      member,
      [{ id: "st1" }],
      [{ id: "lb1" }],
      [{ id: "b1", projectId: "p1" }], // existing board -> update path
    ]);
    await feedbackService.upsertAdminConfig(db.db, "mine", "p1", "u1", {
      default_state_id: "st1",
      submit_label_id: "lb1",
    } as any);
    expect(db.updates).toHaveLength(1);
  });
});

// sanitizeBoardConfig select order: states?, labels?.
describe("DEV-20 feedback createItem consume-side sanitize", () => {
  it("poisoned board ids are dropped, not linked", async () => {
    const db = mockDb([[], []]); // both miss
    const out = await feedbackService.sanitizeBoardConfig(db.db, {
      workspaceId: MINE,
      defaultStateId: "st-foreign",
      submitLabelId: "lb-foreign",
    });
    expect(out).toEqual({ stateId: null, labelId: null });
    expect(eqParam(db.selects[0].cond, "workspace_id")).toBe(MINE);
    expect(eqParam(db.selects[1].cond, "workspace_id")).toBe(MINE);
  });

  it("valid board ids survive", async () => {
    const db = mockDb([[{ id: "st1" }], [{ id: "lb1" }]]);
    const out = await feedbackService.sanitizeBoardConfig(db.db, {
      workspaceId: MINE,
      defaultStateId: "st1",
      submitLabelId: "lb1",
    });
    expect(out).toEqual({ stateId: "st1", labelId: "lb1" });
  });
});

// resolvePipeline select order: boundPipelineProject project? -> auto-pick
// projects -> default state? -> findStateByGroup.
describe("DEV-20 polar consumer binding", () => {
  const settings = (pipelineProjectId: string | null, defaultStateId: string | null) =>
    ({ workspaceId: MINE, pipelineProjectId, defaultStateId }) as any;

  it("poisoned pipeline_project_id falls back to the workspace's own project", async () => {
    const db = mockDb([
      [], // stored project does not resolve in ws
      [{ id: "own-p1", isPipeline: 1, createdAt: "2026-01-01" }], // auto-pick
      [{ id: "g1" }], // default state via group pick
    ]);
    const { projectId } = await polarService.resolvePipeline(db.db, settings("foreign-p", null));
    expect(projectId).toBe("own-p1");
    // The fallback pick is workspace-scoped.
    expect(eqParam(db.selects[1].cond, "workspace_id")).toBe(MINE);
  });

  it("valid pipeline_project_id is kept", async () => {
    const db = mockDb([[{ id: "ok-p" }], [{ id: "g1" }]]);
    const { projectId } = await polarService.resolvePipeline(db.db, settings("ok-p", null));
    expect(projectId).toBe("ok-p");
  });

  it("poisoned default_state_id falls back to the group pick", async () => {
    const db = mockDb([
      [{ id: "ok-p" }], // project resolves
      [], // stored state does not resolve
      [{ id: "g1" }], // findStateByGroup
    ]);
    const { projectId, defaultStateId } = await polarService.resolvePipeline(
      db.db,
      settings("ok-p", "st-foreign"),
    );
    expect(projectId).toBe("ok-p");
    expect(defaultStateId).toBe("g1");
    expect(eqParam(db.selects[1].cond, "workspace_id")).toBe(MINE);
  });
});
