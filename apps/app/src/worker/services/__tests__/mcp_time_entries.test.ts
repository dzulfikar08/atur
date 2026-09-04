import { describe, expect, it } from "vitest";
import { getTableName } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { Env } from "../../lib/env";
import { handleTool } from "../../routes/mcp/index";

// Same slim mock pattern as workspace_tools.test.ts: select fixtures by call
// order, insert/update capture. groupBy added for the aggregate queries.
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
    groupBy: () => chain,
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
        leftJoin: () => builder,
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
        return { where: () => ({ returning: () => Promise.resolve([]) }) };
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

const ME = "u1";

async function expectStatus(fn: () => Promise<unknown>, status: number) {
  try {
    await fn();
  } catch (err) {
    if (err instanceof HTTPException && err.status === status) return;
    throw err;
  }
  throw new Error(`expected HTTPException(${status})`);
}

describe("create_time_entry agent telemetry", () => {
  const baseParams = {
    project_id: "p1",
    workspace: "acme",
    issue_id: "i1",
    duration_seconds: 1800,
  };
  // Select order: assertIssueAccess(issues) → assertProjectAccess(projects,
  // workspaces) → handler workspace lookup → read-back.
  const accessFixtures = () => [[{ projectId: "p1" }], [{ workspaceId: "ws1" }], [{ ownerId: ME }], [{ workspaceId: "ws1" }]];

  it("agent entry persists source, identity, model and token counts", async () => {
    const db = mockDb(accessFixtures());
    await handleTool(
      db.db,
      {} as Env,
      "create_time_entry",
      {
        ...baseParams,
        source: "agent",
        agent_name: "omp/firstmate",
        model: "zai/glm-5.3-flash",
        input_tokens: 12000.9, // floored
        output_tokens: 4500,
        cache_read_tokens: 8000,
        cache_write_tokens: 1200,
        reasoning_tokens: 300,
      },
      ME,
    );
    expect(db.inserts).toHaveLength(1);
    expect(db.inserts[0]).toMatchObject({
      issueId: "i1",
      workspaceId: "ws1",
      userId: ME,
      source: "agent",
      agentName: "omp/firstmate",
      model: "zai/glm-5.3-flash",
      inputTokens: 12000,
      outputTokens: 4500,
      cacheReadTokens: 8000,
      cacheWriteTokens: 1200,
      reasoningTokens: 300,
    });
  });

  it("human default: no agent fields even when junk token values are passed", async () => {
    const db = mockDb(accessFixtures());
    await handleTool(
      db.db,
      {} as Env,
      "create_time_entry",
      { ...baseParams, input_tokens: "lots", output_tokens: -5 },
      ME,
    );
    expect(db.inserts[0]).toMatchObject({
      source: "human",
      agentName: null,
      model: null,
      inputTokens: null,
      outputTokens: null,
    });
  });

  it("source=agent without agent_name is a 400, nothing inserted", async () => {
    const db = mockDb(accessFixtures());
    await expectStatus(
      () => handleTool(db.db, {} as Env, "create_time_entry", { ...baseParams, source: "agent" }, ME),
      400,
    );
    expect(db.inserts).toHaveLength(0);
  });

  it("agent entries under a foreign project are still 403", async () => {
    // workspace owner is someone else and no membership row → assertProjectAccess 403
    const db = mockDb([[{ projectId: "p1" }], [{ workspaceId: "ws1" }], [{ ownerId: "someone-else" }], []]);
    await expectStatus(
      () =>
        handleTool(
          db.db,
          {} as Env,
          "create_time_entry",
          { ...baseParams, source: "agent", agent_name: "omp/firstmate" },
          ME,
        ),
      403,
    );
    expect(db.inserts).toHaveLength(0);
  });
});

describe("get_agent_usage", () => {
  it("aggregates per agent/model/issue and rolls up totals by agent", async () => {
    // Select order: workspace by slug → aggregate (time_entries ⋈ issues).
    const rows = [
      {
        agent_name: "omp/firstmate",
        model: "zai/glm-5.3-flash",
        issue_id: "i1",
        issue_name: "Fix auth",
        sequence_id: 35,
        project_id: "p1",
        total_seconds: 1800,
        entry_count: 1,
        input_tokens: 1000,
        output_tokens: 500,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
        reasoning_tokens: 0,
        total_tokens: 1500,
      },
      {
        agent_name: "omp/firstmate",
        model: "zai/glm-5.3-flash",
        issue_id: "i2",
        issue_name: "Add KPI page",
        sequence_id: 36,
        project_id: "p1",
        total_seconds: 3600,
        entry_count: 2,
        input_tokens: 2000,
        output_tokens: 1000,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
        reasoning_tokens: 0,
        total_tokens: 3000,
      },
      {
        agent_name: "codex/pane-9",
        model: "gpt-5.2",
        issue_id: "i3",
        issue_name: "Migrate CRM",
        sequence_id: 12,
        project_id: "p2",
        total_seconds: 7200,
        entry_count: 3,
        input_tokens: 10000,
        output_tokens: 5000,
        cache_read_tokens: 4000,
        cache_write_tokens: 0,
        reasoning_tokens: 0,
        total_tokens: 15000,
      },
    ];
    const db = mockDb([[{ id: "ws1", ownerId: ME }], rows]);
    const result: any = await handleTool(db.db, {} as Env, "get_agent_usage", { workspace: "acme" }, ME);
    expect(result.results).toHaveLength(3);
    expect(result.totals.total_tokens).toBe(19500);
    expect(result.totals.total_seconds).toBe(12600);
    // Ordered by total tokens desc — heaviest agent first.
    expect(result.totals.by_agent).toEqual([
      {
        agent_name: "codex/pane-9",
        model: "gpt-5.2",
        entry_count: 3,
        issue_count: 1,
        total_seconds: 7200,
        total_tokens: 15000,
        input_tokens: 10000,
        output_tokens: 5000,
      },
      {
        agent_name: "omp/firstmate",
        model: "zai/glm-5.3-flash",
        entry_count: 3,
        issue_count: 2,
        total_seconds: 5400,
        total_tokens: 4500,
        input_tokens: 3000,
        output_tokens: 1500,
      },
    ]);
  });

  it("is 404 for an unknown workspace", async () => {
    const db = mockDb([[]]);
    await expectStatus(() => handleTool(db.db, {} as Env, "get_agent_usage", { workspace: "nope" }, ME), 404);
  });
});
