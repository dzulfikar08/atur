// Analytics endpoints — shape-compatible with the frontend dashboard.
// Counts are computed from D1; trend/sprint aggregations are deferred (return empty).
import { Hono } from "hono";
import { and, eq, isNull, isNotNull, count } from "drizzle-orm";
import type { Env } from "../lib/env";
import { getDb } from "../db/index";
import * as schema from "../db/schema";

export const analyticsRoutes = new Hono<{ Bindings: Env }>({ strict: false })
  .get("/overview", async (c) => {
    const db = getDb(c.env.DB);
    const slug = c.req.param("slug")!;
    const [ws] = await db
      .select({ id: schema.workspaces.id })
      .from(schema.workspaces)
      .where(and(eq(schema.workspaces.slug, slug), isNull(schema.workspaces.deletedAt)))
      .limit(1);
    const workspaceId = ws?.id;

    const base = workspaceId
      ? and(eq(schema.issues.workspaceId, workspaceId), isNull(schema.issues.deletedAt))
      : isNull(schema.issues.deletedAt);

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
  .get("/completion-trend", (c) => c.json({ trend: [] }))
  .get("/sprints", (c) => c.json({ active_sprints: [] }));
