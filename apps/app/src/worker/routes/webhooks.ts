import { Hono } from "hono";
import type { Env } from "../lib/env";
import { getDb } from "../db/index";
import { authMiddleware } from "../middleware/auth";
import { requireWorkspaceMember } from "../middleware/workspace";
import * as webhookService from "../services/webhooks";

export const webhookRoutes = new Hono<{ Bindings: Env }>({ strict: false })
  .get("/", authMiddleware, requireWorkspaceMember, async (c) => {
    const db = getDb(c.env.DB);
    const webhooks = await webhookService.list(db, c.get("workspace").id);
    return c.json(webhooks);
  })
  .post("/", authMiddleware, requireWorkspaceMember, async (c) => {
    const db = getDb(c.env.DB);
    const body = webhookService.createWebhookSchema.parse(await c.req.json());
    const webhook = await webhookService.create(db, c.get("workspace").id, body);
    return c.json(webhook, 201);
  })
  // update/remove take the guard's workspace id: a webhook UUID from another
  // workspace matches nothing → 404 (cross-workspace IDOR).
  .patch("/:webhookId", authMiddleware, requireWorkspaceMember, async (c) => {
    const db = getDb(c.env.DB);
    const webhookId = c.req.param("webhookId")!;
    const body = webhookService.createWebhookSchema.partial().parse(await c.req.json());
    const webhook = await webhookService.update(db, webhookId, c.get("workspace").id, body);
    return c.json(webhook);
  })
  .delete("/:webhookId", authMiddleware, requireWorkspaceMember, async (c) => {
    const db = getDb(c.env.DB);
    const webhookId = c.req.param("webhookId")!;
    await webhookService.remove(db, webhookId, c.get("workspace").id);
    return c.json({ ok: true });
  });
