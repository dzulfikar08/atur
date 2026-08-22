import { Hono } from "hono";
import type { Env } from "../lib/env";
import { getDb } from "../db/index";
import { authMiddleware } from "../middleware/auth";
import { paginationParams, paginatedResponse } from "../lib/pagination";
import * as projectService from "../services/projects";

export const projectRoutes = new Hono<{ Bindings: Env }>({ strict: false })
  .get("/", async (c) => {
    const db = getDb(c.env.DB);
    const slug = c.req.param("slug")!;
    const { offset, limit } = paginationParams(c);
    const { rows, total } = await projectService.listByWorkspace(
      db,
      slug,
      offset,
      limit,
      c.req.query("is_pipeline") === "1" ? { isPipeline: true } : undefined,
    );
    return c.json(paginatedResponse(rows, total, offset, limit));
  })
  .post("/", authMiddleware, async (c) => {
    const db = getDb(c.env.DB);
    const slug = c.req.param("slug")!;
    const body = projectService.createProjectSchema.parse(await c.req.json());
    const project = await projectService.create(db, slug, body);
    return c.json(project, 201);
  })
  .get("/:projectId", async (c) => {
    const db = getDb(c.env.DB);
    const slug = c.req.param("slug")!;
    const projectId = c.req.param("projectId")!;
    const project = await projectService.getById(db, slug, projectId);
    return c.json(project);
  })
  .patch("/:projectId", authMiddleware, async (c) => {
    const db = getDb(c.env.DB);
    const slug = c.req.param("slug")!;
    const projectId = c.req.param("projectId")!;
    const body = projectService.updateProjectSchema.parse(await c.req.json());
    const project = await projectService.update(db, slug, projectId, body);
    return c.json(project);
  })
  .delete("/:projectId", authMiddleware, async (c) => {
    const db = getDb(c.env.DB);
    const slug = c.req.param("slug")!;
    const projectId = c.req.param("projectId")!;
    await projectService.remove(db, slug, projectId);
    return c.body(null, 204);
  })
  .get("/:projectId/members", async (c) => {
    const db = getDb(c.env.DB);
    const slug = c.req.param("slug")!;
    const projectId = c.req.param("projectId")!;
    const members = await projectService.listMembers(db, slug, projectId);
    return c.json({ results: members });
  })
  .post("/:projectId/members", authMiddleware, async (c) => {
    const db = getDb(c.env.DB);
    const slug = c.req.param("slug")!;
    const projectId = c.req.param("projectId")!;
    const body = projectService.addMemberSchema.parse(await c.req.json());
    const member = await projectService.addMember(db, slug, projectId, body);
    return c.json(member, 201);
  })
  .delete("/:projectId/members/:memberId", authMiddleware, async (c) => {
    const db = getDb(c.env.DB);
    const slug = c.req.param("slug")!;
    const projectId = c.req.param("projectId")!;
    const memberId = c.req.param("memberId")!;
    await projectService.removeMember(db, slug, projectId, memberId);
    return c.body(null, 204);
  });
