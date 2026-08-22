import { Hono } from "hono";
import type { Env } from "../lib/env";
import { getDb } from "../db/index";
import { authMiddleware } from "../middleware/auth";
import { paginationParams, paginatedResponse } from "../lib/pagination";
import * as workspaceService from "../services/workspaces";
import { eq, and, isNull } from "drizzle-orm";
import * as schema from "../db/schema";
import { HTTPException } from "hono/http-exception";

// Only the workspace owner or an ACTIVE admin member (role >= 20) may mutate
// or delete a workspace. Suspended members (is_active = 0) are denied even
// with an admin role — same active-member rule as requireWorkspaceMember.
// Throws 403 otherwise (404 if the workspace is unknown).
async function assertCanManage(env: Env["DB"], slug: string, userId: string) {
  const db = getDb(env);
  const [ws] = await db
    .select()
    .from(schema.workspaces)
    .where(eq(schema.workspaces.slug, slug))
    .limit(1);
  if (!ws) throw new HTTPException(404, { message: "Workspace not found" });
  if (ws.ownerId === userId) return;
  const [m] = await db
    .select()
    .from(schema.workspaceMembers)
    .where(
      and(
        eq(schema.workspaceMembers.workspaceId, ws.id),
        eq(schema.workspaceMembers.memberId, userId),
        isNull(schema.workspaceMembers.deletedAt),
      ),
    )
    .limit(1);
  if (m && m.isActive === 1 && m.role >= 20) return;
  throw new HTTPException(403, {
    message: "Only the workspace owner or an admin can perform this action",
  });
}

export const workspaceRoutes = new Hono<{ Bindings: Env }>({ strict: false })
  .get("/", authMiddleware, async (c) => {
    const db = getDb(c.env.DB);
    const user = c.get("user");
    const { offset, limit } = paginationParams(c);
    const { rows, total } = await workspaceService.list(db, user.sub, offset, limit);
    return c.json(paginatedResponse(rows, total, offset, limit));
  })
  .post("/", authMiddleware, async (c) => {
    const db = getDb(c.env.DB);
    const user = c.get("user");
    const body = workspaceService.createWorkspaceSchema.parse(await c.req.json());
    const workspace = await workspaceService.create(db, user.sub, body);
    return c.json(workspace, 201);
  })
  .get("/:slug", async (c) => {
    const db = getDb(c.env.DB);
    const slug = c.req.param("slug")!;
    const workspace = await workspaceService.getBySlug(db, slug);
    return c.json(workspace);
  })
  .patch("/:slug", authMiddleware, async (c) => {
    const db = getDb(c.env.DB);
    const slug = c.req.param("slug")!;
    await assertCanManage(c.env.DB, slug, c.get("user").sub);
    const body = workspaceService.updateWorkspaceSchema.parse(await c.req.json());
    const workspace = await workspaceService.update(db, slug, body);
    return c.json(workspace);
  })
  .delete("/:slug", authMiddleware, async (c) => {
    const db = getDb(c.env.DB);
    const slug = c.req.param("slug")!;
    await assertCanManage(c.env.DB, slug, c.get("user").sub);
    await workspaceService.remove(db, slug);
    return c.body(null, 204);
  });
