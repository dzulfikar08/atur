import { Hono, type Context } from "hono";
import { and, eq, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { Env } from "../lib/env";
import { getDb } from "../db/index";
import { paginationParams } from "../lib/pagination";
import { resolveWorkspaceForCaller } from "../middleware/workspace";
import * as schema from "../db/schema";
import * as crmService from "../services/crm";

// Admin deals API for a sales pipeline (project). Mounted under
// /api/workspaces/:slug/projects/:projectId/deals. Global authMiddleware
// applies; handlers re-check workspace membership + project ownership.
export const dealsRoutes = new Hono<{ Bindings: Env }>({ strict: false });

async function resolveProject(c: Context<{ Bindings: Env }>) {
  const db = getDb(c.env.DB);
  const ws = await resolveWorkspaceForCaller(c);
  const projectId = c.req.param("projectId")!;
  const [proj] = await db
    .select()
    .from(schema.projects)
    .where(
      and(
        eq(schema.projects.id, projectId),
        eq(schema.projects.workspaceId, ws.id),
        isNull(schema.projects.deletedAt),
      ),
    )
    .limit(1);
  if (!proj) throw new HTTPException(404, { message: "Project not found" });
  return { ws, proj };
}

dealsRoutes.get("/", async (c) => {
  const db = getDb(c.env.DB);
  const { proj } = await resolveProject(c);
  const { offset, limit } = paginationParams(c);
  const result = await crmService.listDeals(db, proj.id, {
    stateId: c.req.query("state_id"),
    offset,
    limit,
  });
  return c.json(result);
});

dealsRoutes.post("/", async (c) => {
  const db = getDb(c.env.DB);
  const { ws, proj } = await resolveProject(c);
  const body = crmService.createDealSchema.parse(await c.req.json());
  const deal = await crmService.createDeal(db, ws.id, proj.id, body, c.get("user").sub);
  return c.json(deal, 201);
});

// Registered before /:issueId so the literal wins.
dealsRoutes.get("/stats", async (c) => {
  const db = getDb(c.env.DB);
  const { proj } = await resolveProject(c);
  const stats = await crmService.pipelineStats(db, proj.id);
  return c.json({ results: stats });
});

dealsRoutes.get("/:issueId", async (c) => {
  const db = getDb(c.env.DB);
  const { proj } = await resolveProject(c);
  const deal = await crmService.getDeal(db, proj.id, c.req.param("issueId")!);
  return c.json(deal);
});

dealsRoutes.patch("/:issueId", async (c) => {
  const db = getDb(c.env.DB);
  const { proj } = await resolveProject(c);
  const body = crmService.updateDealSchema.parse(await c.req.json());
  const deal = await crmService.updateDeal(db, proj.id, c.req.param("issueId")!, body);
  return c.json(deal);
});

// Stage transition (drag on the board).
dealsRoutes.post("/:issueId/move", async (c) => {
  const db = getDb(c.env.DB);
  const { proj } = await resolveProject(c);
  const body = crmService.moveDealSchema.parse(await c.req.json());
  const issue = await crmService.moveDealStage(db, proj.id, c.req.param("issueId")!, body.state_id);
  return c.json(issue);
});
