import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { eq } from "drizzle-orm";
import type { Env } from "../lib/env";
import { getDb } from "../db/index";
import { authMiddleware } from "../middleware/auth";
import { requireWorkspaceMember } from "../middleware/workspace";
import * as schema from "../db/schema";
import * as integrationService from "../services/integrations";

export const integrationRoutes = new Hono<{ Bindings: Env }>({ strict: false })
  .get("/", authMiddleware, async (c) => {
    const db = getDb(c.env.DB);
    const slug = c.req.param("slug")!;
    const [workspace] = await db
      .select()
      .from(schema.workspaces)
      .where(eq(schema.workspaces.slug, slug))
      .limit(1);
    if (!workspace) throw new HTTPException(404, { message: "Workspace not found" });
    const integrations = await integrationService.list(db, workspace.id);
    return c.json(integrations);
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
    const body = integrationService.createIntegrationSchema.parse(await c.req.json());
    const integration = await integrationService.create(db, user.sub, workspace.id, body);
    return c.json(integration, 201);
  })
  .get("/:integrationId", authMiddleware, async (c) => {
    const db = getDb(c.env.DB);
    const integration = await integrationService.getById(db, c.req.param("integrationId")!);
    return c.json(integration);
  })
  .delete("/:integrationId", authMiddleware, requireWorkspaceMember, async (c) => {
    const db = getDb(c.env.DB);
    await integrationService.remove(db, c.req.param("integrationId")!);
    return c.json({ ok: true });
  });
