import { beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { Env } from "../../lib/env";
import * as schema from "../../db/schema";
import { errorMiddleware } from "../../middleware/error";
import { createTestDb, sqliteSupported, type TestDb } from "../../test/sqliteD1";
import { meRoutes } from "../me";

// Real SQLite (see test/sqliteD1.ts). Skipped where node:sqlite is missing.
describe.skipIf(!sqliteSupported)("/api/me/hidden-workspaces", () => {
  let t: TestDb;
  let app: Hono<{ Bindings: Env }>;

  beforeEach(async () => {
    t = await createTestDb();
    const { db } = t;
    await db.insert(schema.users).values([
      { id: "me", email: "me@example.com", username: "me" },
      { id: "other", email: "other@example.com", username: "other" },
    ]);
    await db.insert(schema.workspaces).values([
      { id: "w-owned", name: "Owned", slug: "owned", ownerId: "me" },
      { id: "w-member", name: "Member", slug: "member", ownerId: "other" },
      { id: "w-foreign", name: "Foreign", slug: "foreign", ownerId: "other" },
    ]);
    await db.insert(schema.workspaceMembers).values({
      id: "m1",
      workspaceId: "w-member",
      memberId: "me",
      role: 15,
      isActive: 1,
    });

    app = new Hono<{ Bindings: Env }>();
    app.use("*", errorMiddleware);
    app.use("*", async (c, next) => {
      c.set("user", { sub: "me", email: "me@example.com" } as never);
      await next();
    });
    app.route("/api/me", meRoutes);
  });

  const get = async () => {
    const res = await app.request("/api/me/hidden-workspaces", undefined, { DB: t.d1 } as never);
    return { status: res.status, body: (await res.json()) as { workspace_ids: string[] } };
  };
  const patch = (body: unknown) =>
    app.request(
      "/api/me/hidden-workspaces",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      { DB: t.d1 } as never,
    );

  it("starts empty", async () => {
    expect(await get()).toEqual({ status: 200, body: { workspace_ids: [] } });
  });

  it("hides and shows workspaces the user belongs to (owned and member)", async () => {
    const hidden = await patch({ hide: ["w-owned", "w-member"] });
    expect(hidden.status).toBe(200);
    expect(((await hidden.json()) as { workspace_ids: string[] }).workspace_ids.toSorted()).toEqual(
      ["w-member", "w-owned"],
    );

    const shown = await patch({ show: ["w-owned"] });
    expect(await shown.json()).toEqual({ workspace_ids: ["w-member"] });
    expect((await get()).body.workspace_ids).toEqual(["w-member"]);
  });

  it("is idempotent for repeated hide/show", async () => {
    await patch({ hide: ["w-owned"] });
    expect((await patch({ hide: ["w-owned"] })).status).toBe(200);
    expect((await patch({ show: ["w-member"] })).status).toBe(200);
    expect((await get()).body.workspace_ids).toEqual(["w-owned"]);
  });

  it("rejects hiding a workspace the user is not a member of, applying nothing", async () => {
    const res = await patch({ hide: ["w-owned", "w-foreign"] });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("w-foreign");
    expect((await get()).body.workspace_ids).toEqual([]);
  });

  it("rejects unknown workspace ids", async () => {
    expect((await patch({ hide: ["nope"] })).status).toBe(400);
  });

  it("ignores membership for show, so stale ids can always be cleared", async () => {
    await patch({ hide: ["w-member"] });
    await t.db
      .insert(schema.userHiddenWorkspaces)
      .values({ userId: "me", workspaceId: "w-foreign" });
    // A hidden id the user can no longer reach is not reported...
    expect((await get()).body.workspace_ids).toEqual(["w-member"]);
    // ...and clearing it is accepted.
    expect((await patch({ show: ["w-foreign"] })).status).toBe(200);
  });

  it("does not leak or modify another user's hidden list", async () => {
    await t.db
      .insert(schema.userHiddenWorkspaces)
      .values({ userId: "other", workspaceId: "w-foreign" });
    await patch({ hide: ["w-owned"] });
    await patch({ show: ["w-foreign"] });
    const rows = await t.db.select().from(schema.userHiddenWorkspaces);
    expect(rows.map((r) => `${r.userId}:${r.workspaceId}`).toSorted()).toEqual([
      "me:w-owned",
      "other:w-foreign",
    ]);
  });

  it("rejects malformed bodies", async () => {
    for (const body of [
      {},
      { hide: [] },
      { hide: "w-owned" },
      { hide: [1] },
      { hide: [""] },
      null,
    ]) {
      expect((await patch(body)).status).toBe(400);
    }
    expect((await patch({ hide: Array.from({ length: 31 }, (_, i) => `w${i}`) })).status).toBe(400);
  });
});
