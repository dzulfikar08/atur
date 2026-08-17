import { z } from "zod";
import type { DbClient } from "../db/index";
import * as workspaceRepo from "../repositories/workspaces";
import { HTTPException } from "hono/http-exception";

export const createWorkspaceSchema = z.object({
  name: z.string().min(1).max(80),
  slug: z
    .string()
    .min(1)
    .max(48)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  logo: z.string().nullable().optional(),
  organizationSize: z.string().nullable().optional(),
  timezone: z.string().optional().default("UTC"),
  backgroundColor: z.string().nullable().optional(),
});

export const updateWorkspaceSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  logo: z.string().nullable().optional(),
  organizationSize: z.string().nullable().optional(),
  timezone: z.string().optional(),
  backgroundColor: z.string().nullable().optional(),
});

export async function create(
  db: DbClient,
  ownerId: string,
  data: z.infer<typeof createWorkspaceSchema>,
) {
  const existing = await workspaceRepo.findBySlug(db, data.slug);
  if (existing) {
    throw new HTTPException(409, { message: "Workspace slug already exists" });
  }
  return workspaceRepo.create(db, { ...data, ownerId });
}

export async function getBySlug(db: DbClient, slug: string) {
  const workspace = await workspaceRepo.findBySlug(db, slug);
  if (!workspace) throw new HTTPException(404, { message: "Workspace not found" });
  return workspace;
}

export async function list(db: DbClient, userId: string, offset: number, limit: number) {
  return workspaceRepo.listByUser(db, userId, offset, limit);
}

export async function update(
  db: DbClient,
  slug: string,
  data: z.infer<typeof updateWorkspaceSchema>,
) {
  const workspace = await workspaceRepo.findBySlug(db, slug);
  if (!workspace) throw new HTTPException(404, { message: "Workspace not found" });
  return workspaceRepo.update(db, workspace.id, data);
}

export async function remove(db: DbClient, slug: string) {
  const workspace = await workspaceRepo.findBySlug(db, slug);
  if (!workspace) throw new HTTPException(404, { message: "Workspace not found" });
  await workspaceRepo.softDelete(db, workspace.id);
}
