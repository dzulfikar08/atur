import { describe, expect, it } from "vitest";
import { HTTPException } from "hono/http-exception";
import * as labelsService from "../labels";
import * as sprintsService from "../sprints";
import * as customFieldsService from "../customFields";
import * as relationsService from "../relations";
import * as searchService from "../search";

// Thenable that also chains like a drizzle query builder (limit/where are
// no-ops returning the same result). Each select() call consumes the next
// fixture; the last fixture repeats. Same pattern as states.test.ts.
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
  };
  return chain;
}

function mockDb(selectFixtures: any[][]) {
  const updates: any[] = [];
  let selectIdx = 0;
  const db: any = {
    select: () => {
      const rows = selectFixtures[Math.min(selectIdx, selectFixtures.length - 1)] ?? [];
      selectIdx++;
      return { from: () => ({ where: () => chainy(rows) }) };
    },
    update: () => ({
      set: (patch: any) => {
        updates.push(patch);
        return { where: () => Promise.resolve() };
      },
    }),
  };
  return { db, updates };
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

describe("DEV-8 scoped getById", () => {
  it("labels: foreign-workspace label is a 404, not a leaky 200", async () => {
    const foreign = mockDb([[{ id: "l1", workspaceId: FOREIGN }]]);
    await expect404(() => labelsService.getById(foreign.db, "l1", MINE));

    const mine = mockDb([[{ id: "l1", workspaceId: MINE }]]);
    expect(await labelsService.getById(mine.db, "l1", MINE)).toMatchObject({
      id: "l1",
      workspaceId: MINE,
    });
  });

  it("sprints: foreign-workspace sprint is a 404", async () => {
    const foreign = mockDb([[{ id: "s1", workspaceId: FOREIGN }]]);
    await expect404(() => sprintsService.getById(foreign.db, "s1", MINE));
  });

  it("custom fields: foreign-workspace field is a 404", async () => {
    const foreign = mockDb([[{ id: "f1", workspaceId: FOREIGN }]]);
    await expect404(() => customFieldsService.getById(foreign.db, "f1", MINE));
  });
});

describe("DEV-8 relations both-sided checks", () => {
  const relation = [{ id: "r1", issueId: "i1", relatedIssueId: "i2" }];

  it("remove: relation whose related side is foreign is a 404, nothing deleted", async () => {
    // First select resolves the relation, second returns only ONE of the two
    // issues scoped to the caller's workspace (i1 local, i2 foreign).
    const db = mockDb([relation, [{ id: "i1" }]]);
    await expect404(() => relationsService.remove(db.db, "r1", MINE));
    expect(db.updates).toHaveLength(0);
  });

  it("remove: both sides local deletes the relation", async () => {
    const db = mockDb([relation, [{ id: "i1" }, { id: "i2" }]]);
    await relationsService.remove(db.db, "r1", MINE);
    expect(db.updates).toHaveLength(1);
  });

  it("remove: self-relation (issueId === relatedIssueId) is deletable", async () => {
    // SQL IN dedupes, so a self-relation matches ONE row — the expectation
    // must shrink to 1 or such rows become permanently undeletable.
    const self = [{ id: "r2", issueId: "i1", relatedIssueId: "i1" }];
    const db = mockDb([self, [{ id: "i1" }]]);
    await relationsService.remove(db.db, "r2", MINE);
    expect(db.updates).toHaveLength(1);
  });

  it("list: foreign issue id is a 404, relation graph never queried", async () => {
    const db = mockDb([[]]);
    await expect404(() => relationsService.list(db.db, "i-foreign", MINE));
  });

  it("create: related issue outside the workspace is a 404", async () => {
    const db = mockDb([[{ id: "i1" }]]);
    await expect404(() =>
      relationsService.create(db.db, MINE, {
        issue_id: "i1",
        related_issue_id: "i2",
        relation_type: "blocks",
      }),
    );
  });
});

describe("DEV-8 search membership filter", () => {
  it("unscoped search only returns rows from member/owned workspaces", async () => {
    // Select order: memberRows, ownedRows, searchIssues, searchProjects.
    const db = mockDb([
      [{ workspaceId: "w1" }],
      [{ id: "w2" }],
      [{ id: "i1", name: "hit" }],
      [{ id: "p1", name: "proj" }],
    ]);
    const result = await searchService.search(db.db, "hit", undefined, undefined, 50, "u1");
    expect(result).toMatchObject({
      issues: [{ id: "i1" }],
      projects: [{ id: "p1" }],
    });
  });

  it("user with no workspaces gets empty results without querying", async () => {
    const db = mockDb([[], []]);
    const result = await searchService.search(db.db, "hit", undefined, undefined, 50, "u1");
    expect(result).toEqual({ issues: [], projects: [] });
  });
});
