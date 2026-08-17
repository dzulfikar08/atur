import { Hono } from "hono";
import type { Env } from "../lib/env";
import { getDb } from "../db/index";
import { authMiddleware } from "../middleware/auth";
import * as timesheetService from "../services/timesheet";

export const timesheetRoutes = new Hono<{ Bindings: Env }>({ strict: false }).get(
  "/",
  authMiddleware,
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
);
