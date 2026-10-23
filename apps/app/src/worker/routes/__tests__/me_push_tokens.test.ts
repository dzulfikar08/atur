import { beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { Env } from "../../lib/env";
import * as schema from "../../db/schema";
import { errorMiddleware } from "../../middleware/error";
import { createTestDb, sqliteSupported, type TestDb } from "../../test/sqliteD1";
import { meRoutes } from "../me";

const TOKEN = "ExponentPushToken[abc123]";

describe.skipIf(!sqliteSupported)("/api/me/push-tokens", () => {
  let t: TestDb;
  let app: Hono<{ Bindings: Env }>;
  let caller = "me";

  const send = (method: "PUT" | "DELETE", body: unknown) =>
    app.request(
      "/api/me/push-tokens",
      { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
      { DB: t.d1 } as never,
    );

  const rows = () =>
    t.db
      .select({ userId: schema.pushTokens.userId, platform: schema.pushTokens.platform })
      .from(schema.pushTokens)
      .where(eq(schema.pushTokens.token, TOKEN));

  beforeEach(async () => {
    t = await createTestDb();
    caller = "me";
    await t.db.insert(schema.users).values([
      { id: "me", email: "me@example.com", username: "me" },
      { id: "other", email: "other@example.com", username: "other" },
    ]);
    app = new Hono<{ Bindings: Env }>();
    app.use("*", errorMiddleware);
    app.use("*", async (c, next) => {
      c.set("user", { sub: caller, email: "x@example.com" } as never);
      await next();
    });
    app.route("/api/me", meRoutes);
  });

  it("registers a token and updates the platform on re-registration without duplicating", async () => {
    expect((await send("PUT", { token: TOKEN, platform: "ios" })).status).toBe(200);
    expect((await send("PUT", { token: TOKEN, platform: "android" })).status).toBe(200);
    expect(await rows()).toEqual([{ userId: "me", platform: "android" }]);
  });

  it("reassigns a token held by another user to the caller", async () => {
    caller = "other";
    await send("PUT", { token: TOKEN, platform: "ios" });
    caller = "me";
    await send("PUT", { token: TOKEN, platform: "ios" });
    expect(await rows()).toEqual([{ userId: "me", platform: "ios" }]);
  });

  it("rejects malformed tokens and unknown platforms with 400", async () => {
    expect((await send("PUT", { token: "not-a-token", platform: "ios" })).status).toBe(400);
    expect((await send("PUT", { token: TOKEN, platform: "web" })).status).toBe(400);
    expect((await send("PUT", {})).status).toBe(400);
    expect((await send("DELETE", { token: "nope" })).status).toBe(400);
    expect(await rows()).toEqual([]);
  });

  it("deletes only the caller's own row and is idempotent", async () => {
    caller = "other";
    await send("PUT", { token: TOKEN, platform: "ios" });

    caller = "me";
    expect((await send("DELETE", { token: TOKEN })).status).toBe(200);
    expect(await rows()).toEqual([{ userId: "other", platform: "ios" }]);

    caller = "other";
    expect((await send("DELETE", { token: TOKEN })).status).toBe(200);
    expect((await send("DELETE", { token: TOKEN })).status).toBe(200);
    expect(await rows()).toEqual([]);
  });
});
