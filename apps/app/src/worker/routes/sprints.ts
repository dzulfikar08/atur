import { Hono } from "hono";
import type { Env } from "../lib/env";
import { getDb } from "../db/index";
import { authMiddleware } from "../middleware/auth";
import { requireWorkspaceMember } from "../middleware/workspace";
import * as sprintsService from "../services/sprints";

export const sprintRoutes = new Hono<{ Bindings: Env }>({ strict: false })
  .get("/", authMiddleware, requireWorkspaceMember, async (c) => {
    const db = getDb(c.env.DB);
    const projectId = c.req.param("projectId")!;
    const result = await sprintsService.list(db, projectId, c);
    return c.json(result);
  })
  .post("/", authMiddleware, requireWorkspaceMember, async (c) => {
    const db = getDb(c.env.DB);
    const projectId = c.req.param("projectId")!;
    const user = c.get("user");
    const body = sprintsService.createSprintSchema.parse(await c.req.json());
    const result = await sprintsService.create(
      db,
      body,
      projectId,
      c.get("workspace").id,
      user.sub,
    );
    return c.json(result, 201);
  })
  .get("/:sprintId", authMiddleware, requireWorkspaceMember, async (c) => {
    const db = getDb(c.env.DB);
    const sprintId = c.req.param("sprintId")!;
    const result = await sprintsService.getById(db, sprintId, c.get("workspace").id);
    return c.json(result);
  })
  // update/remove (and their issue-link mutations) take the guard's workspace
  // id: a sprint UUID from another workspace matches nothing → 404
  // (cross-workspace IDOR).
  .patch("/:sprintId", authMiddleware, requireWorkspaceMember, async (c) => {
    const db = getDb(c.env.DB);
    const sprintId = c.req.param("sprintId")!;
    const body = sprintsService.updateSprintSchema.parse(await c.req.json());
    const result = await sprintsService.update(db, sprintId, c.get("workspace").id, body);
    return c.json(result);
  })
  .delete("/:sprintId", authMiddleware, requireWorkspaceMember, async (c) => {
    const db = getDb(c.env.DB);
    const sprintId = c.req.param("sprintId")!;
    await sprintsService.remove(db, sprintId, c.get("workspace").id);
    return c.json({ success: true });
  })
  .post("/:sprintId/issues", authMiddleware, requireWorkspaceMember, async (c) => {
    const db = getDb(c.env.DB);
    const sprintId = c.req.param("sprintId")!;
    const body = sprintsService.addIssueSchema.parse(await c.req.json());
    await sprintsService.addIssue(db, sprintId, c.get("workspace").id, body);
    return c.json({ success: true }, 201);
  })
  .delete("/:sprintId/issues/:issueId", authMiddleware, requireWorkspaceMember, async (c) => {
    const db = getDb(c.env.DB);
    const sprintId = c.req.param("sprintId")!;
    const issueId = c.req.param("issueId")!;
    await sprintsService.removeIssue(db, sprintId, c.get("workspace").id, issueId);
    return c.json({ success: true });
  });
