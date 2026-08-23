import { Hono } from "hono";
import type { Env } from "../lib/env";
import { getDb } from "../db/index";
import { resolveWorkspaceForCaller } from "../middleware/workspace";
import * as searchService from "../services/search";

export const searchRoutes = new Hono<{ Bindings: Env }>({ strict: false }).get("/", async (c) => {
  const db = getDb(c.env.DB);
  const q = c.req.query("q");
  if (!q) return c.json({ results: [], query: "" });
  const workspace = c.req.param("slug") || c.req.query("workspace");
  // This router is mounted at BOTH /api/search (no :slug) and
  // /api/workspaces/:slug/search. When a workspace is named — by either the
  // path param or the legacy ?workspace= query — require the caller to be a
  // member of it before any rows leave the database.
  if (workspace) await resolveWorkspaceForCaller(c, workspace);
  const project = c.req.query("project");
  const limit = Math.min(parseInt(c.req.query("limit") || "50", 10), 100);
  // Unscoped search is bounded to the caller: userId filters results to
  // workspaces they own or are an active member of (see services/search.ts).
  const results = await searchService.search(db, q, workspace, project, limit, c.get("user").sub);
  return c.json(results);
});
