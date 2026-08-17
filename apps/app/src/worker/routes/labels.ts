import { Hono } from "hono";
import type { Env } from "../lib/env";
import { getDb } from "../db/index";
import { authMiddleware } from "../middleware/auth";
import * as labelsService from "../services/labels";
import { HTTPException } from "hono/http-exception";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema";

async function resolveWorkspaceId(env: Env["DB"], slug: string): Promise<string> {
  const db = getDb(env);
  const [ws] = await db
    .select({ id: schema.workspaces.id })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.slug, slug))
    .limit(1);
  if (!ws) throw new HTTPException(404, { message: "Workspace not found" });
  return ws.id;
}

export const labelRoutes = new Hono<{ Bindings: Env }>({ strict: false })
  .get("/", async (c) => {
    const db = getDb(c.env.DB);
    const slug = c.req.param("slug")!;
    const projectId = c.req.param("projectId")!;
    const workspaceId = await resolveWorkspaceId(c.env.DB, slug);
    const result = await labelsService.list(db, projectId, workspaceId);
    return c.json(result);
  })
  .post("/", authMiddleware, async (c) => {
    const db = getDb(c.env.DB);
    const slug = c.req.param("slug")!;
    const projectId = c.req.param("projectId")!;
    const workspaceId = await resolveWorkspaceId(c.env.DB, slug);
    const body = labelsService.createLabelSchema.parse(await c.req.json());
    const result = await labelsService.create(db, workspaceId, projectId, body);
    return c.json(result, 201);
  })
  .get("/:labelId", async (c) => {
    const db = getDb(c.env.DB);
    const labelId = c.req.param("labelId")!;
    const result = await labelsService.getById(db, labelId);
    return c.json(result);
  })
  .patch("/:labelId", authMiddleware, async (c) => {
    const db = getDb(c.env.DB);
    const labelId = c.req.param("labelId")!;
    const body = labelsService.updateLabelSchema.parse(await c.req.json());
    const result = await labelsService.update(db, labelId, body);
    return c.json(result);
  })
  .delete("/:labelId", authMiddleware, async (c) => {
    const db = getDb(c.env.DB);
    const labelId = c.req.param("labelId")!;
    await labelsService.remove(db, labelId);
    return c.body(null, 204);
  });
