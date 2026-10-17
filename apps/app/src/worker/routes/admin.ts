import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { getDb } from "../db/index";
import * as schema from "../db/schema";
import type { Env } from "../lib/env";
import { authMiddleware } from "../middleware/auth";
import * as platform from "../repositories/platform";
import { runD1Backup } from "../services/backup";

// Platform-operator routes: the superuser console (read-only, spans every
// workspace) and single-tenant ops actions. Gated on users.is_superuser (the
// only platform-wide role flag), never on workspace membership.
const requireSuperuser = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  const user = await getDb(c.env.DB)
    .select({ isSuperuser: schema.users.isSuperuser })
    .from(schema.users)
    .where(eq(schema.users.id, c.get("user").sub))
    .get();
  if (!user?.isSuperuser) return c.json({ error: "forbidden" }, 403);
  await next();
});

const RANGE_DAYS: Record<string, number> = { "7": 7, "30": 30, "90": 90 };
const USER_TYPES: Record<string, "team" | "customers" | "all"> = {
  team: "team",
  customers: "customers",
  all: "all",
};

export const adminRoutes = new Hono<{ Bindings: Env }>({ strict: false })
  .use("*", authMiddleware, requireSuperuser)
  .get("/me", (c) => {
    const { sub, email, displayName } = c.get("user");
    return c.json({ id: sub, email, display_name: displayName });
  })
  .get("/overview", async (c) => {
    const db = getDb(c.env.DB);
    const days = RANGE_DAYS[c.req.query("days") ?? ""] ?? 30;
    const [totals, daily] = await Promise.all([platform.totals(db), platform.daily(db, days)]);
    return c.json({ totals, daily });
  })
  .get("/users", async (c) => {
    const users = await platform.listUsers(getDb(c.env.DB), {
      q: c.req.query("q")?.trim() || undefined,
      type: USER_TYPES[c.req.query("type") ?? ""] ?? "team",
    });
    return c.json({ results: users });
  })
  .get("/users/:id", async (c) => {
    const detail = await platform.getUser(getDb(c.env.DB), c.req.param("id"));
    if (!detail) return c.json({ error: "User not found" }, 404);
    return c.json(detail);
  })
  .get("/workspaces", async (c) => {
    const workspaces = await platform.listWorkspaces(getDb(c.env.DB), {
      q: c.req.query("q")?.trim() || undefined,
    });
    return c.json({ results: workspaces });
  })
  .get("/workspaces/:slug", async (c) => {
    const detail = await platform.getWorkspace(getDb(c.env.DB), c.req.param("slug"));
    if (!detail) return c.json({ error: "Workspace not found" }, 404);
    return c.json(detail);
  })
  .get("/feed", async (c) => {
    const limit = Math.min(Math.max(Number(c.req.query("limit")) || 50, 1), 200);
    const items = await platform.feed(getDb(c.env.DB), {
      before: c.req.query("before") || undefined,
      workspace: c.req.query("workspace") || undefined,
      actorId: c.req.query("actor") || undefined,
      limit,
    });
    return c.json({
      results: items,
      next_before: items.length === limit ? items[items.length - 1].at : null,
    });
  })
  .get("/agents", async (c) => {
    const days = c.req.query("days");
    const rows = await platform.agentUsage(getDb(c.env.DB), {
      since: days === "all" ? undefined : platform.sinceISO(RANGE_DAYS[days ?? ""] ?? 30),
    });
    return c.json({ results: rows });
  })
  .post("/backup-d1", async (c) => {
    try {
      return c.json(await runD1Backup(c.env));
    } catch (e) {
      // Ops route: surface the raw failure to the superuser instead of a
      // generic 500 — the cron path logs the error, here the caller debugs.
      return c.json({ error: String(e instanceof Error ? (e.stack ?? e.message) : e) }, 500);
    }
  });
