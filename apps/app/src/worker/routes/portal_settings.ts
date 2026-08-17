import { Hono, type Context } from "hono";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { Env } from "../lib/env";
import { getDb } from "../db/index";
import { authMiddleware } from "../middleware/auth";
import * as schema from "../db/schema";
import * as workspaceRepo from "../repositories/workspaces";
import * as projectsRepo from "../repositories/projects";
import * as portalSettingsRepo from "../repositories/portalSettings";

export const portalSettingsRoutes = new Hono<{ Bindings: Env }>({ strict: false });

const updateSchema = z.object({
  support_project_id: z.string().uuid().nullable(),
  is_enabled: z.boolean(),
});

// Workspace admin/member gate: caller must own or be an active member.
async function requireMember(c: Context<{ Bindings: Env }>, workspaceId: string, userId: string) {
  const db = getDb(c.env.DB);
  const [member] = await db
    .select()
    .from(schema.workspaceMembers)
    .where(
      and(
        eq(schema.workspaceMembers.workspaceId, workspaceId),
        eq(schema.workspaceMembers.memberId, userId),
        isNull(schema.workspaceMembers.deletedAt),
      ),
    )
    .limit(1);
  return !!member;
}

portalSettingsRoutes.get("/", authMiddleware, async (c) => {
  const db = getDb(c.env.DB);
  const slug = c.req.param("slug")!;
  const user = c.get("user");
  const workspace = await workspaceRepo.findBySlug(db, slug);
  if (!workspace) throw new HTTPException(404, { message: "Workspace not found" });
  if (!(await requireMember(c, workspace.id, user.sub))) {
    throw new HTTPException(403, { message: "Not a member of this workspace" });
  }
  const settings = await portalSettingsRepo.get(db, workspace.id);
  return c.json(
    settings ?? { workspace_id: workspace.id, support_project_id: null, is_enabled: 0 },
  );
});

portalSettingsRoutes.put("/", authMiddleware, async (c) => {
  const db = getDb(c.env.DB);
  const slug = c.req.param("slug")!;
  const user = c.get("user");
  const workspace = await workspaceRepo.findBySlug(db, slug);
  if (!workspace) throw new HTTPException(404, { message: "Workspace not found" });
  if (!(await requireMember(c, workspace.id, user.sub))) {
    throw new HTTPException(403, { message: "Not a member of this workspace" });
  }

  const body = updateSchema.parse(await c.req.json());

  // The support project must belong to this workspace when set.
  if (body.support_project_id) {
    const project = await projectsRepo.findById(db, body.support_project_id);
    if (!project || project.workspaceId !== workspace.id) {
      throw new HTTPException(400, { message: "Project does not belong to this workspace" });
    }
  }

  const settings = await portalSettingsRepo.upsert(db, workspace.id, {
    supportProjectId: body.support_project_id,
    isEnabled: body.is_enabled ? 1 : 0,
  });
  return c.json(settings);
});
