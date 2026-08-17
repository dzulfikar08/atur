import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { eq } from "drizzle-orm";
import type { Env } from "../lib/env";
import { getDb } from "../db/index";
import { authMiddleware } from "../middleware/auth";
import * as schema from "../db/schema";
import * as webhookService from "../services/webhooks";

export const webhookRoutes = new Hono<{ Bindings: Env }>({ strict: false })
  .get("/", authMiddleware, async (c) => {
    const db = getDb(c.env.DB);
    const slug = c.req.param("slug")!;
    const [workspace] = await db
      .select()
      .from(schema.workspaces)
      .where(eq(schema.workspaces.slug, slug))
      .limit(1);
    if (!workspace) throw new HTTPException(404, { message: "Workspace not found" });
    const webhooks = await webhookService.list(db, workspace.id);
    return c.json(webhooks);
  })
  .post("/", authMiddleware, async (c) => {
    const db = getDb(c.env.DB);
    const slug = c.req.param("slug")!;
    const [workspace] = await db
      .select()
      .from(schema.workspaces)
      .where(eq(schema.workspaces.slug, slug))
      .limit(1);
    if (!workspace) throw new HTTPException(404, { message: "Workspace not found" });
    const body = webhookService.createWebhookSchema.parse(await c.req.json());
    const webhook = await webhookService.create(db, workspace.id, body);
    return c.json(webhook, 201);
  })
  .patch("/:webhookId", authMiddleware, async (c) => {
    const db = getDb(c.env.DB);
    const slug = c.req.param("slug")!;
    const webhookId = c.req.param("webhookId")!;
    const [workspace] = await db
      .select()
      .from(schema.workspaces)
      .where(eq(schema.workspaces.slug, slug))
      .limit(1);
    if (!workspace) throw new HTTPException(404, { message: "Workspace not found" });
    const body = webhookService.createWebhookSchema.partial().parse(await c.req.json());
    const webhook = await webhookService.update(db, webhookId, body);
    return c.json(webhook);
  })
  .delete("/:webhookId", authMiddleware, async (c) => {
    const db = getDb(c.env.DB);
    const slug = c.req.param("slug")!;
    const webhookId = c.req.param("webhookId")!;
    const [workspace] = await db
      .select()
      .from(schema.workspaces)
      .where(eq(schema.workspaces.slug, slug))
      .limit(1);
    if (!workspace) throw new HTTPException(404, { message: "Workspace not found" });
    await webhookService.remove(db, webhookId);
    return c.json({ ok: true });
  });
