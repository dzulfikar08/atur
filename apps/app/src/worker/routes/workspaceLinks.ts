import { Hono } from "hono";
import type { Env } from "../lib/env";
import { getDb } from "../db/index";
import { authMiddleware } from "../middleware/auth";
import {
  requireWorkspaceMember,
  requireWorkspaceAdmin,
} from "../middleware/workspace";
import * as linksService from "../services/workspaceLinks";

// Control-plane bindings (DEV-29). Mounted under /api/workspaces/:slug/links.
// Reads need membership; writes (upsert/delete) need owner-or-admin — the
// same split as members.ts. The binding row is keyed by the :slug param, so
// the guard is what keeps workspace A's members out of workspace B's links.
export const workspaceLinkRoutes = new Hono<{ Bindings: Env }>({ strict: false })
  .get("/", authMiddleware, requireWorkspaceMember, async (c) => {
    const db = getDb(c.env.DB);
    const link = await linksService.get(db, c.req.param("slug")!);
    return c.json(link); // null body = unbound workspace
  })
  .put("/", authMiddleware, requireWorkspaceMember, requireWorkspaceAdmin, async (c) => {
    const db = getDb(c.env.DB);
    const slug = c.req.param("slug")!;
    const body = linksService.upsertLinkSchema.parse(await c.req.json());
    const link = await linksService.upsert(db, slug, body);
    return c.json(link, 200);
  })
  .delete("/", authMiddleware, requireWorkspaceMember, requireWorkspaceAdmin, async (c) => {
    const db = getDb(c.env.DB);
    await linksService.remove(db, c.req.param("slug")!);
    return c.body(null, 204);
  });
