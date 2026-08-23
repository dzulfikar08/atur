// Analytics endpoints — shape-compatible with the frontend dashboard.
// Counts are computed from D1; trend/sprint aggregations are deferred (return empty).
import { Hono } from "hono";
import { and, eq, isNull, isNotNull, count } from "drizzle-orm";
import type { Env } from "../lib/env";
import { getDb } from "../db/index";
import * as schema from "../db/schema";
import { authMiddleware } from "../middleware/auth";
import { requireWorkspaceMember } from "../middleware/workspace";

export const analyticsRoutes = new Hono<{ Bindings: Env }>({ strict: false })
  .get("/overview", authMiddleware, requireWorkspaceMember, async (c) => {
    const db = getDb(c.env.DB);
    // The guard resolved (and membership-checked) the workspace for :slug.
    const workspaceId = c.get("workspace").id;

    const base = and(eq(schema.issues.workspaceId, workspaceId), isNull(schema.issues.deletedAt));

    const [totalRow] = await db.select({ n: count() }).from(schema.issues).where(base);
    const [openRow] = await db
      .select({ n: count() })
      .from(schema.issues)
      .where(and(base, isNull(schema.issues.completedAt)));
    const [closedRow] = await db
      .select({ n: count() })
      .from(schema.issues)
      .where(and(base, isNotNull(schema.issues.completedAt)));

    return c.json({
      total_issues: totalRow.n,
      open_issues: openRow.n,
      closed_issues: closedRow.n,
      overdue_issues: 0,
      total_trend: 0,
      open_trend: 0,
      closed_trend: 0,
      overdue_trend: 0,
    });
  })
  .get("/completion-trend", authMiddleware, requireWorkspaceMember, (c) => c.json({ trend: [] }))
  .get("/sprints", authMiddleware, requireWorkspaceMember, (c) => c.json({ active_sprints: [] }));
