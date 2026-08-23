import { Hono } from "hono";
import type { Env } from "../lib/env";
import { getDb } from "../db/index";
import { authMiddleware } from "../middleware/auth";
import { requireWorkspaceMember } from "../middleware/workspace";
import * as pagesService from "../services/pages";

export const pageRoutes = new Hono<{ Bindings: Env }>({ strict: false })
  .get("/", authMiddleware, requireWorkspaceMember, async (c) => {
    const db = getDb(c.env.DB);
    const result = await pagesService.list(db, c.get("workspace").id);
    return c.json(result);
  })
  .post("/", authMiddleware, requireWorkspaceMember, async (c) => {
    const db = getDb(c.env.DB);
    const user = c.get("user");
    const body = pagesService.createPageSchema.parse(await c.req.json());
    const result = await pagesService.create(db, c.get("workspace").id, user.sub, body);
    return c.json(result, 201);
  })
  .get("/:pageId", authMiddleware, requireWorkspaceMember, async (c) => {
    const db = getDb(c.env.DB);
    const pageId = c.req.param("pageId")!;
    const result = await pagesService.getById(db, pageId, c.get("workspace").id);
    return c.json(result);
  })
  // update/remove take the guard's workspace id: a page UUID from another
  // workspace matches nothing → 404 (cross-workspace IDOR).
  .patch("/:pageId", authMiddleware, requireWorkspaceMember, async (c) => {
    const db = getDb(c.env.DB);
    const pageId = c.req.param("pageId")!;
    const body = pagesService.updatePageSchema.parse(await c.req.json());
    const result = await pagesService.update(db, pageId, c.get("workspace").id, body);
    return c.json(result);
  })
  .delete("/:pageId", authMiddleware, requireWorkspaceMember, async (c) => {
    const db = getDb(c.env.DB);
    const pageId = c.req.param("pageId")!;
    await pagesService.remove(db, pageId, c.get("workspace").id);
    return c.body(null, 204);
  })
  .get("/:pageId/backlinks", authMiddleware, requireWorkspaceMember, (c) => c.json([]));
