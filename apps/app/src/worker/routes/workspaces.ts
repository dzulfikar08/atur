import { Hono } from "hono";
import type { Env } from "../lib/env";
import { getDb } from "../db/index";
import { authMiddleware } from "../middleware/auth";
import { requireWorkspaceAdmin, requireWorkspaceMember } from "../middleware/workspace";
import { paginationParams, paginatedResponse } from "../lib/pagination";
import * as workspaceService from "../services/workspaces";

// Workspace mutations (PATCH/DELETE /:slug) are gated by requireWorkspaceAdmin
// from middleware/workspace.ts: owner or ACTIVE admin (role >= 20), resolved
// through workspaceRepo.findBySlug (deletedAt-filtered, so a soft-deleted
// workspace 404s instead of matching the raw slug).

export const workspaceRoutes = new Hono<{ Bindings: Env }>({ strict: false })
  .get("/", authMiddleware, async (c) => {
    const db = getDb(c.env.DB);
    const user = c.get("user");
    const { offset, limit } = paginationParams(c);
    const { rows, total } = await workspaceService.list(db, user.sub, offset, limit);
    return c.json(paginatedResponse(rows, total, offset, limit));
  })
  .post("/", authMiddleware, async (c) => {
    const db = getDb(c.env.DB);
    const user = c.get("user");
    const body = workspaceService.createWorkspaceSchema.parse(await c.req.json());
    const workspace = await workspaceService.create(db, user.sub, body);
    return c.json(workspace, 201);
  })
  .get("/:slug", authMiddleware, requireWorkspaceMember, async (c) => {
    const db = getDb(c.env.DB);
    const slug = c.req.param("slug")!;
    const workspace = await workspaceService.getBySlug(db, slug);
    return c.json(workspace);
  })
  .patch("/:slug", authMiddleware, requireWorkspaceAdmin, async (c) => {
    const db = getDb(c.env.DB);
    const body = workspaceService.updateWorkspaceSchema.parse(await c.req.json());
    const workspace = await workspaceService.update(db, c.get("workspace").slug, body);
    return c.json(workspace);
  })
  .delete("/:slug", authMiddleware, requireWorkspaceAdmin, async (c) => {
    const db = getDb(c.env.DB);
    await workspaceService.remove(db, c.get("workspace").slug);
    return c.body(null, 204);
  });
