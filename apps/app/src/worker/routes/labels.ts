import { Hono } from "hono";
import type { Env } from "../lib/env";
import { getDb } from "../db/index";
import { authMiddleware } from "../middleware/auth";
import { requireWorkspaceMember } from "../middleware/workspace";
import * as labelsService from "../services/labels";

export const labelRoutes = new Hono<{ Bindings: Env }>({ strict: false })
  .get("/", authMiddleware, requireWorkspaceMember, async (c) => {
    const db = getDb(c.env.DB);
    const projectId = c.req.param("projectId")!;
    const result = await labelsService.list(db, projectId, c.get("workspace").id);
    return c.json(result);
  })
  .post("/", authMiddleware, requireWorkspaceMember, async (c) => {
    const db = getDb(c.env.DB);
    const projectId = c.req.param("projectId")!;
    const workspaceId = c.get("workspace").id;
    const body = labelsService.createLabelSchema.parse(await c.req.json());
    const result = await labelsService.create(db, workspaceId, projectId, body);
    return c.json(result, 201);
  })
  .get("/:labelId", authMiddleware, requireWorkspaceMember, async (c) => {
    const db = getDb(c.env.DB);
    const labelId = c.req.param("labelId")!;
    const result = await labelsService.getById(db, labelId);
    return c.json(result);
  })
  // update/remove take the guard's workspace id: a label UUID from another
  // workspace matches nothing → 404 (cross-workspace IDOR).
  .patch("/:labelId", authMiddleware, requireWorkspaceMember, async (c) => {
    const db = getDb(c.env.DB);
    const labelId = c.req.param("labelId")!;
    const body = labelsService.updateLabelSchema.parse(await c.req.json());
    const result = await labelsService.update(db, labelId, c.get("workspace").id, body);
    return c.json(result);
  })
  .delete("/:labelId", authMiddleware, requireWorkspaceMember, async (c) => {
    const db = getDb(c.env.DB);
    const labelId = c.req.param("labelId")!;
    await labelsService.remove(db, labelId, c.get("workspace").id);
    return c.body(null, 204);
  });
