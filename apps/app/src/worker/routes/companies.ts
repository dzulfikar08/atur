import { Hono } from "hono";
import type { Env } from "../lib/env";
import { getDb } from "../db/index";
import { paginationParams } from "../lib/pagination";
import { authMiddleware } from "../middleware/auth";
import { resolveWorkspaceForCaller } from "../middleware/workspace";
import * as companiesService from "../services/companies";

// Admin CRM companies API. Mounted under /api/workspaces/:slug/companies; the
// global authMiddleware applies in production, and each route chains it inline
// too (mirrors projects.ts) so handlers can read c.get("user") in tests that
// mount the route file directly.
export const companiesRoutes = new Hono<{ Bindings: Env }>({ strict: false });

companiesRoutes.get("/", authMiddleware, async (c) => {
  const db = getDb(c.env.DB);
  const ws = await resolveWorkspaceForCaller(c);
  const { offset, limit } = paginationParams(c);
  const result = await companiesService.listCompanies(db, ws.id, {
    search: c.req.query("search"),
    offset,
    limit,
  });
  return c.json(result);
});

companiesRoutes.post("/", authMiddleware, async (c) => {
  const db = getDb(c.env.DB);
  const ws = await resolveWorkspaceForCaller(c);
  const body = companiesService.createCompanySchema.parse(await c.req.json());
  const company = await companiesService.createCompany(db, ws.id, body);
  return c.json(company, 201);
});

companiesRoutes.get("/:id", authMiddleware, async (c) => {
  const db = getDb(c.env.DB);
  const ws = await resolveWorkspaceForCaller(c);
  const result = await companiesService.getCompany(db, ws.id, c.req.param("id")!);
  return c.json(result);
});

companiesRoutes.patch("/:id", authMiddleware, async (c) => {
  const db = getDb(c.env.DB);
  const ws = await resolveWorkspaceForCaller(c);
  const body = companiesService.updateCompanySchema.parse(await c.req.json());
  const company = await companiesService.updateCompany(db, ws.id, c.req.param("id")!, body);
  return c.json(company);
});

companiesRoutes.delete("/:id", authMiddleware, async (c) => {
  const db = getDb(c.env.DB);
  const ws = await resolveWorkspaceForCaller(c);
  await companiesService.deleteCompany(db, ws.id, c.req.param("id")!);
  return c.body(null, 204);
});

