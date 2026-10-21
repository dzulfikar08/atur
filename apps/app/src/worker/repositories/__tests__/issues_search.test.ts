import { beforeAll, describe, expect, it } from "vitest";
import * as schema from "../../db/schema";
import { createTestDb, sqliteSupported, type TestDb } from "../../test/sqliteD1";
import { listByProject } from "../issues";
import { searchIssues } from "../search";

const NOW = "2026-10-20T00:00:00.000Z";

// Free-text search must find an issue by its key (29, #29, DEV-29) on the
// server too: MCP list_issues/search_issues and /api/search filter in SQL.
describe.skipIf(!sqliteSupported)("issue text search by key", () => {
  let t: TestDb;

  beforeAll(async () => {
    t = await createTestDb();
    const { db } = t;
    await db.insert(schema.users).values({ id: "u", email: "u@x.test", username: "u" });
    await db
      .insert(schema.workspaces)
      .values({ id: "ws", name: "W", slug: "w", ownerId: "u", createdAt: NOW });
    await db.insert(schema.projects).values([
      { id: "dev", name: "Dev", identifier: "DEV", workspaceId: "ws", createdAt: NOW },
      { id: "ops", name: "Ops", identifier: "OPS", workspaceId: "ws", createdAt: NOW },
    ] as (typeof schema.projects.$inferInsert)[]);
    const issue = (id: string, projectId: string, sequenceId: number, name: string) => ({
      id,
      name,
      sequenceId,
      projectId,
      workspaceId: "ws",
      createdAt: NOW,
    });
    await db
      .insert(schema.issues)
      .values([
        issue("d2", "dev", 2, "Login bug"),
        issue("d7", "dev", 7, "Fix 29 typos"),
        issue("d29", "dev", 29, "Search"),
        issue("d129", "dev", 129, "Billing"),
        issue("o29", "ops", 29, "Export"),
      ] as (typeof schema.issues.$inferInsert)[]);
  });

  const listDev = async (search: string) =>
    (await listByProject(t.db, "dev", { offset: 0, limit: 50, search })).data
      .map((r) => r.name)
      .sort();
  const searchAll = async (query: string) =>
    (await searchIssues(t.db, { query, workspaceId: "ws", limit: 50 })).map((r) => r.id).sort();

  it("matches numbers as a key prefix alongside name hits", async () => {
    expect(await listDev("29")).toEqual(["Fix 29 typos", "Search"]);
    expect(await listDev("#2")).toEqual(["Login bug", "Search"]);
    expect(await listDev("0029")).toEqual(["Search"]);
  });

  it("scopes IDENT-N to the project with that identifier, case-insensitively", async () => {
    expect(await searchAll("dev-29")).toEqual(["d29"]);
    expect(await searchAll("OPS 29")).toEqual(["o29"]);
    expect(await searchAll("DEV-2")).toEqual(["d2", "d29"]);
    expect(await searchAll("NOPE-29")).toEqual([]);
  });
});
