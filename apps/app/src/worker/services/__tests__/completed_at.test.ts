import { describe, expect, it } from "vitest";
import { getTableName } from "drizzle-orm";
import * as issuesRepo from "../../repositories/issues";
import { handleTool } from "../../routes/mcp/index";
import { issueLabel, issueUrl } from "../issue_notifications";

// Thenable that also chains like a drizzle query builder.
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
    where: () => chain,
    innerJoin: () => chain,
    leftJoin: () => chain,
  };
  return chain;
}

// Selects are routed per table; update().set() payloads and inserts are captured.
function mockDb(tables: Record<string, any[]>) {
  const updates: { table: string; values: any }[] = [];
  const inserts: { table: string; values: any }[] = [];
  const db: any = {
    select: () => ({
      from: (table: any) => chainy(tables[getTableName(table)] ?? []),
    }),
    update: (table: any) => ({
      set: (values: any) => {
        updates.push({ table: getTableName(table), values });
        return { where: () => Promise.resolve() };
      },
    }),
    insert: (table: any) => ({
      values: (values: any) => {
        inserts.push({ table: getTableName(table), values });
        return { returning: () => Promise.resolve([values]), then: undefined };
      },
    }),
  };
  return { db, updates, inserts };
}

const stateOf = (groupName: string) => ({ states: [{ id: "s1", groupName }] });

describe("completedAtForState", () => {
  it("is set for completed and cancelled groups, null otherwise", async () => {
    for (const g of ["completed", "cancelled"]) {
      const { db } = mockDb(stateOf(g));
      expect(await issuesRepo.completedAtForState(db, "s1", "NOW")).toBe("NOW");
    }
    for (const g of ["backlog", "unstarted", "started"]) {
      const { db } = mockDb(stateOf(g));
      expect(await issuesRepo.completedAtForState(db, "s1", "NOW")).toBeNull();
    }
    expect(await issuesRepo.completedAtForState(mockDb({}).db, null)).toBeNull();
  });
});

describe("issuesRepo.update", () => {
  it("sets completed_at when moving into a completed state", async () => {
    const { db, updates } = mockDb({ ...stateOf("completed"), issues: [{ id: "i1" }] });
    await issuesRepo.update(db, "i1", { stateId: "s1" });
    expect(updates[0].values.completedAt).toEqual(expect.any(String));
  });

  it("clears completed_at when moving back to an open state", async () => {
    const { db, updates } = mockDb({ ...stateOf("started"), issues: [{ id: "i1" }] });
    await issuesRepo.update(db, "i1", { stateId: "s1" });
    expect(updates[0].values.completedAt).toBeNull();
  });

  it("leaves completed_at alone when the state is not touched", async () => {
    const { db, updates } = mockDb({ issues: [{ id: "i1" }] });
    await issuesRepo.update(db, "i1", { priority: "high" });
    expect("completedAt" in updates[0].values).toBe(false);
  });
});

describe("mcp update_issue", () => {
  const tables = (group: string) => ({
    workspaces: [{ id: "w1", ownerId: "u1", slug: "acme" }],
    workspace_members: [{ id: "m1" }],
    states: [{ id: "s1", groupName: group }],
    issues: [{ id: "i1" }],
  });

  it("toggles completed_at with the state group", async () => {
    const done = mockDb(tables("completed"));
    await handleTool(
      done.db,
      {} as any,
      "update_issue",
      { workspace: "acme", project_id: "p1", issue_id: "i1", state_id: "s1" },
      "u1",
    );
    const doneUpdate = done.updates.find((u) => u.table === "issues")!;
    expect(doneUpdate.values.completedAt).toEqual(expect.any(String));

    const open = mockDb(tables("started"));
    await handleTool(
      open.db,
      {} as any,
      "update_issue",
      { workspace: "acme", project_id: "p1", issue_id: "i1", state_id: "s1" },
      "u1",
    );
    expect(open.updates.find((u) => u.table === "issues")!.values.completedAt).toBeNull();
  });
});

describe("issue notification refs", () => {
  const issue = {
    id: "i1",
    name: "Crash on login",
    sequenceId: 2,
    projectId: "p1",
    workspaceId: "w1",
  };

  it("labels with PROJECT-seq and links with the workspace slug", () => {
    const refs = { projectIdentifier: "MOB", workspaceSlug: "acme-mobile" };
    expect(issueLabel(issue, refs)).toBe("MOB-2");
    expect(issueUrl(issue, refs)).toBe("https://app.diatur.com/acme-mobile/projects/p1/issues/2");
  });
});
