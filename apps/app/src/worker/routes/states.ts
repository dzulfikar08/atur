import { Hono } from "hono";
import type { Env } from "../lib/env";
import { getDb } from "../db/index";
import { authMiddleware } from "../middleware/auth";
import { requireWorkspaceMember } from "../middleware/workspace";
import * as statesService from "../services/states";

export const stateRoutes = new Hono<{ Bindings: Env }>({ strict: false })
  .get("/", authMiddleware, requireWorkspaceMember, async (c) => {
    const db = getDb(c.env.DB);
    const projectId = c.req.param("projectId")!;
    const result = await statesService.list(db, projectId);
    return c.json(result);
  })
  .post("/", authMiddleware, requireWorkspaceMember, async (c) => {
    const db = getDb(c.env.DB);
    const projectId = c.req.param("projectId")!;
    const body = statesService.createStateSchema.parse(await c.req.json());
    const result = await statesService.create(db, projectId, c.get("workspace").id, body);
    return c.json(result, 201);
  })
  .get("/:stateId", authMiddleware, requireWorkspaceMember, async (c) => {
    const db = getDb(c.env.DB);
    const stateId = c.req.param("stateId")!;
    const result = await statesService.getById(db, stateId, c.get("workspace").id);
    return c.json(result);
  })
  // update/remove take the guard's workspace id: a state UUID from another
  // workspace matches nothing → 404 (cross-workspace IDOR).
  .patch("/:stateId", authMiddleware, requireWorkspaceMember, async (c) => {
    const db = getDb(c.env.DB);
    const stateId = c.req.param("stateId")!;
    const body = statesService.updateStateSchema.parse(await c.req.json());
    const result = await statesService.update(db, stateId, c.get("workspace").id, body);
    return c.json(result);
  })
  .delete("/:stateId", authMiddleware, requireWorkspaceMember, async (c) => {
    const db = getDb(c.env.DB);
    const stateId = c.req.param("stateId")!;
    await statesService.remove(db, stateId, c.get("workspace").id);
    return c.body(null, 204);
  });
