import { Hono } from "hono";
import { and, eq, isNull } from "drizzle-orm";
import type { Env } from "../lib/env";
import { getDb } from "../db/index";
import { authMiddleware } from "../middleware/auth";
import { requireWorkspaceMember } from "../middleware/workspace";
import * as cyclesService from "../services/cycles";
import * as schema from "../db/schema";

export const cycleRoutes = new Hono<{ Bindings: Env }>({ strict: false })
  .get("/", authMiddleware, requireWorkspaceMember, async (c) => {
    const db = getDb(c.env.DB);
    const projectId = c.req.param("projectId")!;
    const result = await cyclesService.list(db, projectId, c);
    return c.json(result);
  })
  .post("/", authMiddleware, requireWorkspaceMember, async (c) => {
    const db = getDb(c.env.DB);
    const projectId = c.req.param("projectId")!;
    const user = c.get("user");
    const body = cyclesService.createCycleSchema.parse(await c.req.json());
    const result = await cyclesService.create(db, body, projectId, c.get("workspace").id, user.sub);
    return c.json(result, 201);
  })
  .get("/:cycleId", authMiddleware, requireWorkspaceMember, async (c) => {
    const db = getDb(c.env.DB);
    const cycleId = c.req.param("cycleId")!;
    const result = await cyclesService.getById(db, cycleId);
    return c.json(result);
  })
  // update/remove (and their issue-link mutations) take the guard's workspace
  // id: a cycle UUID from another workspace matches nothing → 404
  // (cross-workspace IDOR).
  .patch("/:cycleId", authMiddleware, requireWorkspaceMember, async (c) => {
    const db = getDb(c.env.DB);
    const cycleId = c.req.param("cycleId")!;
    const body = cyclesService.updateCycleSchema.parse(await c.req.json());
    const result = await cyclesService.update(db, cycleId, c.get("workspace").id, body);
    return c.json(result);
  })
  .delete("/:cycleId", authMiddleware, requireWorkspaceMember, async (c) => {
    const db = getDb(c.env.DB);
    const cycleId = c.req.param("cycleId")!;
    await cyclesService.remove(db, cycleId, c.get("workspace").id);
    return c.json({ success: true });
  })
  .post("/:cycleId/issues", authMiddleware, requireWorkspaceMember, async (c) => {
    const db = getDb(c.env.DB);
    const cycleId = c.req.param("cycleId")!;
    const body = cyclesService.addIssueSchema.parse(await c.req.json());
    await cyclesService.addIssue(db, cycleId, c.get("workspace").id, body);
    return c.json({ success: true }, 201);
  })
  .get("/:cycleId/issues", authMiddleware, requireWorkspaceMember, async (c) => {
    const db = getDb(c.env.DB);
    const cycleId = c.req.param("cycleId")!;
    const rows = await db
      .select()
      .from(schema.issues)
      .innerJoin(schema.cycleIssues, eq(schema.cycleIssues.issueId, schema.issues.id))
      .where(and(eq(schema.cycleIssues.cycleId, cycleId), isNull(schema.issues.deletedAt)));
    return c.json({ results: rows.map((r) => r.issues) });
  })
  .get("/:cycleId/cycle-issues", authMiddleware, requireWorkspaceMember, async (c) => {
    const db = getDb(c.env.DB);
    const cycleId = c.req.param("cycleId")!;
    const rows = await db
      .select()
      .from(schema.issues)
      .innerJoin(schema.cycleIssues, eq(schema.cycleIssues.issueId, schema.issues.id))
      .where(and(eq(schema.cycleIssues.cycleId, cycleId), isNull(schema.issues.deletedAt)));
    return c.json({ results: rows.map((r) => r.issues) });
  })
  .delete("/:cycleId/issues/:issueId", authMiddleware, requireWorkspaceMember, async (c) => {
    const db = getDb(c.env.DB);
    const cycleId = c.req.param("cycleId")!;
    const issueId = c.req.param("issueId")!;
    await cyclesService.removeIssue(db, cycleId, c.get("workspace").id, issueId);
    return c.json({ success: true });
  });
