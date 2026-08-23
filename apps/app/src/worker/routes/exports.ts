import { Hono } from "hono";
import type { Env } from "../lib/env";
import { getDb } from "../db/index";
import { authMiddleware } from "../middleware/auth";
import { requireWorkspaceMember } from "../middleware/workspace";
import * as exportService from "../services/exports";

export const exportRoutes = new Hono<{ Bindings: Env }>({ strict: false })
  .get("/", authMiddleware, requireWorkspaceMember, async (c) => {
    const db = getDb(c.env.DB);
    const exports = await exportService.list(db, c.get("workspace").id);
    return c.json(exports);
  })
  .post("/", authMiddleware, requireWorkspaceMember, async (c) => {
    const db = getDb(c.env.DB);
    const user = c.get("user");
    const body = exportService.createExportSchema.parse(await c.req.json());
    const exp = await exportService.create(db, user.sub, c.get("workspace").id, body);
    return c.json(exp, 201);
  });
