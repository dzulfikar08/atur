/**
 * One-time WebSocket tickets: single use, short TTL, scope-bound, hashed at
 * rest — and the session-gate bypass in app.ts only ever admits a valid ticket
 * on the screen WS route. Runs on real SQLite (test/sqliteD1.ts).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DbClient } from "../../db/index";
import * as schema from "../../db/schema";
import type { Env } from "../env";
import { createApp } from "../../app";
import { createTestDb, sqliteSupported, type TestDb } from "../../test/sqliteD1";
import { issueWsTicket, redeemWsTicket, WS_TICKET_TTL_MS } from "../wsTicket";

describe.skipIf(!sqliteSupported)("ws tickets", () => {
  let t: TestDb;
  let db: DbClient;
  let env: Env;

  async function seedUser(id: string, superuser: boolean) {
    await db.insert(schema.users).values({
      id,
      email: `${id}@example.com`,
      username: id,
      token: `session-${id}`,
      sessionExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      isSuperuser: superuser ? 1 : 0,
    });
  }

  const post = (token: string, body: unknown) =>
    createApp().request(
      "/api/ws-tickets",
      {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      },
      env,
    );

  const upgrade = (query: string) =>
    createApp().request(`/api/screen/ws${query}`, { headers: { upgrade: "websocket" } }, env);

  beforeEach(async () => {
    t = await createTestDb();
    db = t.db;
    env = { DB: t.d1 } as unknown as Env;
    await seedUser("owner", true);
    await seedUser("member", false);
  });

  describe("issue / redeem", () => {
    it("redeems exactly once", async () => {
      const { ticket } = await issueWsTicket(db, "owner", "screen");
      expect(await redeemWsTicket(db, ticket, "screen")).toBe("owner");
      expect(await redeemWsTicket(db, ticket, "screen")).toBeNull();
    });

    it("expires after the TTL", async () => {
      const now = 1_000_000;
      const { ticket, expiresAt } = await issueWsTicket(db, "owner", "screen", now);
      expect(expiresAt - now).toBe(WS_TICKET_TTL_MS);
      expect(WS_TICKET_TTL_MS).toBeLessThanOrEqual(60_000);
      expect(await redeemWsTicket(db, ticket, "screen", expiresAt)).toBeNull();
      // The refused late attempt did not touch the row.
      expect(await redeemWsTicket(db, ticket, "screen", now + 1)).toBe("owner");
    });

    it("rejects unknown tickets and another scope", async () => {
      const { ticket } = await issueWsTicket(db, "owner", "screen");
      expect(await redeemWsTicket(db, "nope", "screen")).toBeNull();
      expect(await redeemWsTicket(db, ticket, "other" as never)).toBeNull();
      // The wrong-scope probe left it redeemable.
      expect(await redeemWsTicket(db, ticket, "screen")).toBe("owner");
    });

    it("stores only the hash and sweeps expired rows on the next issue", async () => {
      const { ticket } = await issueWsTicket(db, "owner", "screen", 1000);
      const rows = await db.select().from(schema.wsTickets);
      expect(rows).toHaveLength(1);
      expect(rows[0].hash).not.toContain(ticket);
      expect(rows[0].hash).toMatch(/^[0-9a-f]{64}$/);
      await issueWsTicket(db, "owner", "screen", 1000 + WS_TICKET_TTL_MS + 1);
      expect(await db.select().from(schema.wsTickets)).toHaveLength(1);
    });
  });

  describe("POST /api/ws-tickets", () => {
    it("401s without a session", async () => {
      const res = await createApp().request(
        "/api/ws-tickets",
        { method: "POST", body: JSON.stringify({ scope: "screen" }) },
        env,
      );
      expect(res.status).toBe(401);
    });

    it("400s on an unknown scope", async () => {
      expect((await post("session-owner", { scope: "panes" })).status).toBe(400);
      expect((await post("session-owner", {})).status).toBe(400);
    });

    it("refuses a screen ticket to a non-superuser", async () => {
      const res = await post("session-member", { scope: "screen" });
      expect(res.status).toBe(403);
      expect(await db.select().from(schema.wsTickets)).toHaveLength(0);
    });

    it("mints a screen ticket for a superuser", async () => {
      const res = await post("session-owner", { scope: "screen" });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ticket: string; expires_at: number };
      expect(body.ticket.length).toBeGreaterThanOrEqual(40);
      expect(body.expires_at - Date.now()).toBeLessThanOrEqual(WS_TICKET_TTL_MS);
      expect(await redeemWsTicket(db, body.ticket, "screen")).toBe("owner");
    });
  });

  describe("GET /api/screen/ws?ticket=", () => {
    it("401s a bogus ticket instead of falling through unauthenticated", async () => {
      expect((await upgrade("?ticket=bogus")).status).toBe(401);
    });

    it("still 401s with no ticket and no session", async () => {
      expect((await upgrade("")).status).toBe(401);
    });

    it("ignores a ticket on a non-upgrade request", async () => {
      const res = await createApp().request("/api/screen/ws?ticket=bogus", undefined, env);
      expect(res.status).toBe(401);
    });

    it("lets a valid superuser ticket through to the handler, once", async () => {
      const { ticket } = await issueWsTicket(db, "owner", "screen");
      // Auth passed: with no bridge configured the handler answers 502.
      expect((await upgrade(`?ticket=${ticket}`)).status).toBe(502);
      expect((await upgrade(`?ticket=${ticket}`)).status).toBe(401);
    });

    it("still enforces superuser on a ticket minted for a non-superuser", async () => {
      const { ticket } = await issueWsTicket(db, "member", "screen");
      expect((await upgrade(`?ticket=${ticket}`)).status).toBe(403);
    });

    it("rejects a ticket whose user was deactivated", async () => {
      const { ticket } = await issueWsTicket(db, "owner", "screen");
      await db.update(schema.users).set({ isActive: 0 }).where(eq(schema.users.id, "owner"));
      expect((await upgrade(`?ticket=${ticket}`)).status).toBe(401);
    });

    it("does not open any other /api route to tickets", async () => {
      const { ticket } = await issueWsTicket(db, "owner", "screen");
      const res = await createApp().request(
        `/api/panes?ticket=${ticket}`,
        { headers: { upgrade: "websocket" } },
        env,
      );
      expect(res.status).toBe(401);
      // …and the ticket is still unspent.
      expect(await redeemWsTicket(db, ticket, "screen")).toBe("owner");
    });
  });
});
