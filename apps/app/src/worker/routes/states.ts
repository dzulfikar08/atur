import { Hono } from "hono";
import type { Env } from "../lib/env";
import { getDb } from "../db/index";
import { authMiddleware } from "../middleware/auth";
import * as statesService from "../services/states";
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

export const stateRoutes = new Hono<{ Bindings: Env }>({ strict: false })
  .get("/", async (c) => {
    const db = getDb(c.env.DB);
    const projectId = c.req.param("projectId")!;
    const result = await statesService.list(db, projectId);
    return c.json(result);
  })
  .post("/", authMiddleware, async (c) => {
    const db = getDb(c.env.DB);
    const slug = c.req.param("slug")!;
    const projectId = c.req.param("projectId")!;
    const workspaceId = await resolveWorkspaceId(c.env.DB, slug);
    const body = statesService.createStateSchema.parse(await c.req.json());
    const result = await statesService.create(db, projectId, workspaceId, body);
    return c.json(result, 201);
  })
  .get("/:stateId", async (c) => {
    const db = getDb(c.env.DB);
    const stateId = c.req.param("stateId")!;
    const result = await statesService.getById(db, stateId);
    return c.json(result);
  })
  .patch("/:stateId", authMiddleware, async (c) => {
    const db = getDb(c.env.DB);
    const stateId = c.req.param("stateId")!;
    const body = statesService.updateStateSchema.parse(await c.req.json());
    const result = await statesService.update(db, stateId, body);
    return c.json(result);
  })
  .delete("/:stateId", authMiddleware, async (c) => {
    const db = getDb(c.env.DB);
    const stateId = c.req.param("stateId")!;
    await statesService.remove(db, stateId);
    return c.body(null, 204);
  });
