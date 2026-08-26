import { describe, expect, it } from "vitest";
import { getTableName } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import * as svc from "../customFieldValues";

// dev19-style harness: select fixtures by call order, insert capture.
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
  const inserts: any[] = [];
  let selectIdx = 0;
  const db: any = {
    select: () => {
      const rows = selectFixtures[Math.min(selectIdx, selectFixtures.length - 1)] ?? [];
      selectIdx++;
      const builder: any = {
        table: "",
        innerJoin: () => builder,
        where: () => chainy(rows),
      };
      return {
        from: (table: any) => {
          builder.table = getTableName(table);
          return builder;
        },
      };
    },
    insert: () => ({
      values: (vals: any) => {
        inserts.push(vals);
        return { onConflictDoUpdate: () => Promise.resolve() };
      },
    }),
  };
  return { db, inserts };
}

const ISSUE = { id: "i1", projectId: "p1", workspaceId: "ws-1" };

describe("customFieldValues service (DEV-26)", () => {
  it("set stringifies value_json and upserts for a same-project field", async () => {
    const db = mockDb([[{ id: "f1" }]]);
    const result = await svc.set(db.db, ISSUE, {
      values: [
        { custom_field_id: "f1", value_json: { amount_cents: 3750000000, currency: "IDR" } },
      ],
    });
    expect(result).toEqual({ ok: true });
    expect(db.inserts).toHaveLength(1);
    expect(db.inserts[0]).toMatchObject({
      issueId: "i1",
      customFieldId: "f1",
      workspaceId: "ws-1",
    });
    expect(db.inserts[0].valueJson).toBe('{"amount_cents":3750000000,"currency":"IDR"}');
  });

  it("set with a foreign-project field id is a 404, nothing written", async () => {
    const db = mockDb([[]]); // field lookup misses
    try {
      await svc.set(db.db, ISSUE, {
        values: [{ custom_field_id: "f-foreign", value_json: 1 }],
      });
      throw new Error("expected HTTPException(404)");
    } catch (err) {
      expect(err).toBeInstanceOf(HTTPException);
      expect((err as HTTPException).status).toBe(404);
    }
    expect(db.inserts).toHaveLength(0);
  });

  it("set with null value_json clears (stores null)", async () => {
    const db = mockDb([[{ id: "f1" }]]);
    await svc.set(db.db, ISSUE, {
      values: [{ custom_field_id: "f1", value_json: null }],
    });
    expect(db.inserts[0].valueJson).toBeNull();
  });

  it("list parses value_json and maps the wire shape", async () => {
    const db = mockDb([
      [
        {
          id: "v1",
          issueId: "i1",
          customFieldId: "f1",
          valueJson: '{"amount_cents":100,"currency":"IDR"}',
          workspaceId: "ws-1",
          fieldName: "Target Jumlah",
          fieldType: "currency",
          fieldSettings: '{"currency":"IDR"}',
        },
      ],
    ]);
    const rows = await svc.list(db.db, ISSUE);
    expect(rows).toEqual([
      {
        id: "v1",
        issue_id: "i1",
        custom_field_id: "f1",
        value_json: { amount_cents: 100, currency: "IDR" },
        field_name: "Target Jumlah",
        field_type: "currency",
        field_settings: { currency: "IDR" },
      },
    ]);
  });
});
