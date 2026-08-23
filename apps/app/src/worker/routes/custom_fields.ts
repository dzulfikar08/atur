import { Hono } from "hono";
import type { Env } from "../lib/env";
import { getDb } from "../db/index";
import { authMiddleware } from "../middleware/auth";
import { requireWorkspaceMember } from "../middleware/workspace";
import * as customFieldsService from "../services/customFields";

export const customFieldRoutes = new Hono<{ Bindings: Env }>({ strict: false })
  .get("/", authMiddleware, requireWorkspaceMember, async (c) => {
    const db = getDb(c.env.DB);
    const projectId = c.req.param("projectId")!;
    const result = await customFieldsService.list(db, projectId);
    return c.json(result);
  })
  .post("/", authMiddleware, requireWorkspaceMember, async (c) => {
    const db = getDb(c.env.DB);
    const projectId = c.req.param("projectId")!;
    const body = customFieldsService.createCustomFieldSchema.parse(await c.req.json());
    const result = await customFieldsService.create(db, projectId, c.get("workspace").id, body);
    return c.json(result, 201);
  })
  // update/remove take the guard's workspace id: a field UUID from another
  // workspace matches nothing → 404 (cross-workspace IDOR).
  .patch("/:fieldId", authMiddleware, requireWorkspaceMember, async (c) => {
    const db = getDb(c.env.DB);
    const fieldId = c.req.param("fieldId")!;
    const body = customFieldsService.updateCustomFieldSchema.parse(await c.req.json());
    const result = await customFieldsService.update(db, fieldId, c.get("workspace").id, body);
    return c.json(result);
  })
  .delete("/:fieldId", authMiddleware, requireWorkspaceMember, async (c) => {
    const db = getDb(c.env.DB);
    const fieldId = c.req.param("fieldId")!;
    await customFieldsService.remove(db, fieldId, c.get("workspace").id);
    return c.body(null, 204);
  });
