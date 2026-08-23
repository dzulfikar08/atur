import { Hono } from "hono";
import type { Env } from "../lib/env";
import { getDb } from "../db/index";
import { authMiddleware } from "../middleware/auth";
import { requireWorkspaceMember } from "../middleware/workspace";
import * as integrationService from "../services/integrations";

export const integrationRoutes = new Hono<{ Bindings: Env }>({ strict: false })
  .get("/", authMiddleware, requireWorkspaceMember, async (c) => {
    const db = getDb(c.env.DB);
    const integrations = await integrationService.list(db, c.get("workspace").id);
    return c.json(integrations);
  })
  .post("/", authMiddleware, requireWorkspaceMember, async (c) => {
    const db = getDb(c.env.DB);
    const user = c.get("user");
    const body = integrationService.createIntegrationSchema.parse(await c.req.json());
    const integration = await integrationService.create(db, user.sub, c.get("workspace").id, body);
    return c.json(integration, 201);
  })
  .get("/:integrationId", authMiddleware, requireWorkspaceMember, async (c) => {
    const db = getDb(c.env.DB);
    const integration = await integrationService.getById(db, c.req.param("integrationId")!);
    return c.json(integration);
  })
  // remove takes the guard's workspace id: an integration UUID from another
  // workspace matches nothing → 404 (cross-workspace IDOR).
  .delete("/:integrationId", authMiddleware, requireWorkspaceMember, async (c) => {
    const db = getDb(c.env.DB);
    await integrationService.remove(db, c.req.param("integrationId")!, c.get("workspace").id);
    return c.json({ ok: true });
  });
