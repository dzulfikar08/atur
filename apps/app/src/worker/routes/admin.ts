import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { getDb } from "../db/index";
import * as schema from "../db/schema";
import type { Env } from "../lib/env";
import { authMiddleware } from "../middleware/auth";
import { runD1Backup } from "../services/backup";

// Platform-operator routes: single-tenant ops actions that span workspaces.
// Gated on users.is_superuser (the only platform-wide role flag), never on
// workspace membership.
export const adminRoutes = new Hono<{ Bindings: Env }>({ strict: false })
  .post("/backup-d1", authMiddleware, async (c) => {
    const db = getDb(c.env.DB);
    const { sub } = c.get("user");
    const user = await db
      .select({ isSuperuser: schema.users.isSuperuser })
      .from(schema.users)
      .where(eq(schema.users.id, sub))
      .get();
    if (!user?.isSuperuser) {
      return c.json({ error: "forbidden" }, 403);
    }
    return c.json(await runD1Backup(c.env));
  });
