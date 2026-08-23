import { Hono } from "hono";
import type { Env } from "../lib/env";
import { getDb } from "../db/index";
import { authMiddleware } from "../middleware/auth";
import { requireWorkspaceMember } from "../middleware/workspace";
import * as relationsService from "../services/relations";

export const relationRoutes = new Hono<{ Bindings: Env }>({ strict: false })
  .get("/:issueId", authMiddleware, requireWorkspaceMember, async (c) => {
    const db = getDb(c.env.DB);
    const issueId = c.req.param("issueId")!;
    const relations = await relationsService.list(db, issueId);
    return c.json(relations);
  })
  .post("/", authMiddleware, requireWorkspaceMember, async (c) => {
    const db = getDb(c.env.DB);
    const body = relationsService.createRelationSchema.parse(await c.req.json());
    const relation = await relationsService.create(db, c.get("workspace").id, body);
    return c.json(relation, 201);
  })
  // remove takes the guard's workspace id: a relation whose issue lives in
  // another workspace matches nothing → 404 (cross-workspace IDOR).
  .delete("/:relationId", authMiddleware, requireWorkspaceMember, async (c) => {
    const db = getDb(c.env.DB);
    const relationId = c.req.param("relationId")!;
    await relationsService.remove(db, relationId, c.get("workspace").id);
    return c.json({ success: true });
  });
