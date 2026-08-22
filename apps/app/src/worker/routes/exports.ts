import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { eq } from "drizzle-orm";
import type { Env } from "../lib/env";
import { getDb } from "../db/index";
import { authMiddleware } from "../middleware/auth";
import { requireWorkspaceMember } from "../middleware/workspace";
import * as schema from "../db/schema";
import * as exportService from "../services/exports";

export const exportRoutes = new Hono<{ Bindings: Env }>({ strict: false })
  .get("/", authMiddleware, async (c) => {
    const db = getDb(c.env.DB);
    const slug = c.req.param("slug")!;
    const [workspace] = await db
      .select()
      .from(schema.workspaces)
      .where(eq(schema.workspaces.slug, slug))
      .limit(1);
    if (!workspace) throw new HTTPException(404, { message: "Workspace not found" });
    const exports = await exportService.list(db, workspace.id);
    return c.json(exports);
  })
  .post("/", authMiddleware, requireWorkspaceMember, async (c) => {
    const db = getDb(c.env.DB);
    const user = c.get("user");
    const slug = c.req.param("slug")!;
    const [workspace] = await db
      .select()
      .from(schema.workspaces)
      .where(eq(schema.workspaces.slug, slug))
      .limit(1);
    if (!workspace) throw new HTTPException(404, { message: "Workspace not found" });
    const body = exportService.createExportSchema.parse(await c.req.json());
    const exp = await exportService.create(db, user.sub, workspace.id, body);
    return c.json(exp, 201);
  });
