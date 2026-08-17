import { Hono } from "hono";
import type { Env } from "../lib/env";
import { getDb } from "../db/index";
import * as searchService from "../services/search";

export const searchRoutes = new Hono<{ Bindings: Env }>({ strict: false }).get("/", async (c) => {
  const db = getDb(c.env.DB);
  const q = c.req.query("q");
  if (!q) return c.json({ results: [], query: "" });
  const workspace = c.req.param("slug") || c.req.query("workspace");
  const project = c.req.query("project");
  const limit = Math.min(parseInt(c.req.query("limit") || "50", 10), 100);
  const results = await searchService.search(db, q, workspace, project, limit);
  return c.json(results);
});
