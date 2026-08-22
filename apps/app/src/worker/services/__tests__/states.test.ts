import { describe, expect, it } from "vitest";
import * as statesService from "../states";
import { SALES_STAGES } from "../states";

// Thenable that also chains like a drizzle query builder (limit/orderBy are
// no-ops returning the same result). Each select() call consumes the next
// fixture; the last fixture repeats.
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
    groupBy: () => chain,
  };
  return chain;
}

function mockDb(selectFixtures: any[][]) {
  const inserts: any[] = [];
  const updates: any[] = [];
  let selectIdx = 0;
  const db: any = {
    select: () => {
      const rows = selectFixtures[Math.min(selectIdx, selectFixtures.length - 1)] ?? [];
      selectIdx++;
      return { from: () => ({ where: () => chainy(rows) }) };
    },
    insert: () => ({
      values: (row: any) => {
        inserts.push(row);
        return Promise.resolve();
      },
    }),
    update: () => ({
      set: (patch: any) => {
        updates.push(patch);
        return { where: () => Promise.resolve() };
      },
    }),
  };
  return { db, inserts, updates };
}

// findById returns the first row; keep the project as the sole element.
const project = (isPipeline: number) => [
  { id: "p1", workspaceId: "ws1", isPipeline, defaultStateId: null },
];

describe("SALES_STAGES", () => {
  it("is the canonical funnel with terminal Won/Lost groups", () => {
    expect(SALES_STAGES.map((s) => s.name)).toEqual([
      "Lead",
      "Qualified",
      "Proposal",
      "Negotiation",
      "Won",
      "Lost",
    ]);
    expect(SALES_STAGES.map((s) => s.group)).toEqual([
      "backlog",
      "started",
      "started",
      "started",
      "completed",
      "cancelled",
    ]);
    expect(SALES_STAGES.filter((s) => s.isDefault).map((s) => s.name)).toEqual(["Lead"]);
  });
});

describe("seedSalesStates", () => {
  it("inserts the six stages, sequences them, and defaults the project to Lead", async () => {
    const { db, inserts, updates } = mockDb([project(1)]);
    await statesService.seedSalesStates(db, "p1");
    expect(inserts).toHaveLength(6);
    expect(inserts[0]).toMatchObject({ name: "Lead", groupName: "backlog", isDefault: 1 });
    expect(inserts[5]).toMatchObject({ name: "Lost", groupName: "cancelled", isDefault: 0 });
    expect(inserts.map((i: any) => i.sequence)).toEqual([0, 10000, 20000, 30000, 40000, 50000]);
    // Projects.defaultStateId set to the Lead state id.
    expect(updates).toHaveLength(1);
    expect(updates[0].defaultStateId).toBe(inserts[0].id);
  });

  it("seeds nothing for a missing project", async () => {
    const { db, inserts } = mockDb([[]]);
    const res = await statesService.seedSalesStates(db, "missing");
    expect(res).toBeNull();
    expect(inserts).toHaveLength(0);
  });
});

describe("list lazy seeding", () => {
  it("seeds sales stages for a pipeline project with no states", async () => {
    const { db, inserts } = mockDb([
      [], // first listByProject → empty
      project(1), // projectRepo.findById → pipeline
    ]);
    await statesService.list(db, "p1");
    expect(inserts.map((i: any) => i.name)).toEqual(SALES_STAGES.map((s) => s.name));
  });

  it("seeds the default workflow for a non-pipeline project with no states", async () => {
    const { db, inserts } = mockDb([[], project(0)]);
    await statesService.list(db, "p1");
    expect(inserts.map((i: any) => i.name)).toEqual([
      "Backlog",
      "Todo",
      "In Progress",
      "Done",
      "Cancelled",
    ]);
  });

  it("never seeds when states already exist", async () => {
    const existing = [{ id: "s1", name: "Custom", groupName: "started" }];
    const { db, inserts } = mockDb([existing, existing]);
    await statesService.list(db, "p1");
    expect(inserts).toHaveLength(0);
  });
});
