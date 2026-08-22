import { Hono } from "hono";
import type { Env } from "../lib/env";
import { getDb } from "../db/index";
import { authMiddleware } from "../middleware/auth";
import { requireWorkspaceMember } from "../middleware/workspace";
import * as relationsService from "../services/relations";

export const relationRoutes = new Hono<{ Bindings: Env }>({ strict: false })
  .get("/:issueId", async (c) => {
    const db = getDb(c.env.DB);
    const issueId = c.req.param("issueId")!;
    const relations = await relationsService.list(db, issueId);
    return c.json(relations);
  })
  .post("/", authMiddleware, requireWorkspaceMember, async (c) => {
    const db = getDb(c.env.DB);
    const body = relationsService.createRelationSchema.parse(await c.req.json());
    const relation = await relationsService.create(db, body);
    return c.json(relation, 201);
  })
  .delete("/:relationId", authMiddleware, requireWorkspaceMember, async (c) => {
    const db = getDb(c.env.DB);
    const relationId = c.req.param("relationId")!;
    await relationsService.remove(db, relationId);
    return c.json({ success: true });
  });
