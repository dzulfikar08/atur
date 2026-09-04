import { Hono } from "hono";
import type { Env } from "../lib/env";
import { getDb } from "../db/index";
import { authMiddleware } from "../middleware/auth";
import { requireWorkspaceMember } from "../middleware/workspace";
import * as timesheetService from "../services/timesheet";

export const timesheetRoutes = new Hono<{ Bindings: Env }>({ strict: false })
  .get(
    "/",
    authMiddleware,
    requireWorkspaceMember,
    async (c) => {
      const db = getDb(c.env.DB);
      const slug = c.req.param("slug")!;
      const user = c.get("user");
      const result = await timesheetService.getTimesheet(db, slug, user.sub, {
        from: c.req.query("from") || undefined,
        to: c.req.query("to") || undefined,
        userId: c.req.query("user_id") || undefined,
        projectId: c.req.query("project_id") || undefined,
      });
      return c.json(result);
    },
  )
  // Agent KPI report — token + duration burn per agent/model/issue.
  .get("/agent-usage", authMiddleware, requireWorkspaceMember, async (c) => {
    const db = getDb(c.env.DB);
    const slug = c.req.param("slug")!;
    const user = c.get("user");
    const result = await timesheetService.getAgentUsage(db, slug, user.sub, {
      from: c.req.query("from") || undefined,
      to: c.req.query("to") || undefined,
      projectId: c.req.query("project_id") || undefined,
      issueId: c.req.query("issue_id") || undefined,
    });
    return c.json(result);
  });
