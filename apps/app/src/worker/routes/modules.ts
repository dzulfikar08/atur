import { Hono } from "hono";
import { and, eq, isNull } from "drizzle-orm";
import type { Env } from "../lib/env";
import { getDb } from "../db/index";
import { authMiddleware } from "../middleware/auth";
import * as modulesService from "../services/modules";
import * as schema from "../db/schema";

export const moduleRoutes = new Hono<{ Bindings: Env }>({ strict: false })
  .get("/", async (c) => {
    const db = getDb(c.env.DB);
    const projectId = c.req.param("projectId")!;
    const result = await modulesService.list(db, projectId, c);
    return c.json(result);
  })
  .post("/", authMiddleware, async (c) => {
    const db = getDb(c.env.DB);
    const projectId = c.req.param("projectId")!;
    const workspaceSlug = c.req.param("slug")!;
    const body = modulesService.createModuleSchema.parse(await c.req.json());
    const result = await modulesService.create(db, body, projectId, workspaceSlug);
    return c.json(result, 201);
  })
  .get("/:moduleId", async (c) => {
    const db = getDb(c.env.DB);
    const moduleId = c.req.param("moduleId")!;
    const result = await modulesService.getById(db, moduleId);
    return c.json(result);
  })
  .patch("/:moduleId", authMiddleware, async (c) => {
    const db = getDb(c.env.DB);
    const moduleId = c.req.param("moduleId")!;
    const body = modulesService.updateModuleSchema.parse(await c.req.json());
    const result = await modulesService.update(db, moduleId, body);
    return c.json(result);
  })
  .delete("/:moduleId", authMiddleware, async (c) => {
    const db = getDb(c.env.DB);
    const moduleId = c.req.param("moduleId")!;
    await modulesService.remove(db, moduleId);
    return c.json({ success: true });
  })
  .post("/:moduleId/issues", authMiddleware, async (c) => {
    const db = getDb(c.env.DB);
    const moduleId = c.req.param("moduleId")!;
    const body = modulesService.addIssueSchema.parse(await c.req.json());
    await modulesService.addIssue(db, moduleId, body);
    return c.json({ success: true }, 201);
  })
  .get("/:moduleId/issues", async (c) => {
    const db = getDb(c.env.DB);
    const moduleId = c.req.param("moduleId")!;
    const rows = await db
      .select()
      .from(schema.issues)
      .innerJoin(schema.moduleIssues, eq(schema.moduleIssues.issueId, schema.issues.id))
      .where(and(eq(schema.moduleIssues.moduleId, moduleId), isNull(schema.issues.deletedAt)));
    return c.json({ results: rows.map((r) => r.issues) });
  })
  .delete("/:moduleId/issues/:issueId", authMiddleware, async (c) => {
    const db = getDb(c.env.DB);
    const moduleId = c.req.param("moduleId")!;
    const issueId = c.req.param("issueId")!;
    await modulesService.removeIssue(db, moduleId, issueId);
    return c.json({ success: true });
  });
