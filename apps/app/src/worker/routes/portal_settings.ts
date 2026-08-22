import { Hono } from "hono";
import { z } from "zod";
import { HTTPException } from "hono/http-exception";
import type { Env } from "../lib/env";
import { getDb } from "../db/index";
import { authMiddleware } from "../middleware/auth";
import { resolveWorkspaceForCaller } from "../middleware/workspace";
import * as projectsRepo from "../repositories/projects";
import * as portalSettingsRepo from "../repositories/portalSettings";

export const portalSettingsRoutes = new Hono<{ Bindings: Env }>({ strict: false });

const updateSchema = z.object({
  support_project_id: z.string().uuid().nullable(),
  is_enabled: z.boolean(),
});

portalSettingsRoutes.get("/", authMiddleware, async (c) => {
  const db = getDb(c.env.DB);
  const workspace = await resolveWorkspaceForCaller(c);
  const settings = await portalSettingsRepo.get(db, workspace.id);
  return c.json(
    settings ?? { workspace_id: workspace.id, support_project_id: null, is_enabled: 0 },
  );
});

portalSettingsRoutes.put("/", authMiddleware, async (c) => {
  const db = getDb(c.env.DB);
  const workspace = await resolveWorkspaceForCaller(c);

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
