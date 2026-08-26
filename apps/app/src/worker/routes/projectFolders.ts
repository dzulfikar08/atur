import { Hono } from "hono";
import type { Env } from "../lib/env";
import { getDb } from "../db/index";
import { authMiddleware } from "../middleware/auth";
import { requireWorkspaceMember } from "../middleware/workspace";
import * as foldersService from "../services/projectFolders";

export const projectFolderRoutes = new Hono<{ Bindings: Env }>({ strict: false })
  .get("/", authMiddleware, requireWorkspaceMember, async (c) => {
    const db = getDb(c.env.DB);
    const result = await foldersService.list(db, c.get("workspace").id, c);
    return c.json(result);
  })
  .post("/", authMiddleware, requireWorkspaceMember, async (c) => {
    const db = getDb(c.env.DB);
    const body = foldersService.createFolderSchema.parse(await c.req.json());
    const result = await foldersService.create(db, c.get("workspace").id, body);
    return c.json(result, 201);
  })
  .get("/:folderId", authMiddleware, requireWorkspaceMember, async (c) => {
    const db = getDb(c.env.DB);
    const result = await foldersService.getById(
      db,
      c.req.param("folderId")!,
      c.get("workspace").id,
    );
    return c.json(result);
  })
  // update/remove take the guard's workspace id: a folder UUID from another
  // workspace matches nothing → 404 (cross-workspace IDOR).
  .patch("/:folderId", authMiddleware, requireWorkspaceMember, async (c) => {
    const db = getDb(c.env.DB);
    const body = foldersService.updateFolderSchema.parse(await c.req.json());
    const result = await foldersService.update(
      db,
      c.req.param("folderId")!,
      c.get("workspace").id,
      body,
    );
    return c.json(result);
  })
  .delete("/:folderId", authMiddleware, requireWorkspaceMember, async (c) => {
    const db = getDb(c.env.DB);
    await foldersService.remove(db, c.req.param("folderId")!, c.get("workspace").id);
    return c.body(null, 204);
  });
