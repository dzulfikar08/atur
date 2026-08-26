import { z } from "zod";
import type { Context } from "hono";
import type { Env } from "../lib/env";
import type { DbClient } from "../db/index";
import * as foldersRepo from "../repositories/projectFolders";
import { HTTPException } from "hono/http-exception";
import { paginationParams, paginatedResponse } from "../lib/pagination";

export const createFolderSchema = z.object({
  name: z.string().min(1).max(255),
  // nullable → can clear a color; optional → no-op.
  color: z.string().nullable().optional(),
  sort_order: z.number().optional(),
});

export const updateFolderSchema = createFolderSchema
  .partial()
  .refine((d) => Object.keys(d).length > 0, { message: "At least one field required" });

export async function create(
  db: DbClient,
  workspaceId: string,
  data: z.infer<typeof createFolderSchema>,
) {
  return foldersRepo.create(db, {
    name: data.name,
    color: data.color,
    sortOrder: data.sort_order,
    workspaceId,
  });
}

// workspaceId is the caller's workspace (route guard). A folder in another
// workspace is indistinguishable from a missing one → 404, never a leaky 200.
export async function getById(db: DbClient, id: string, workspaceId: string) {
  const folder = await foldersRepo.findById(db, id);
  if (!folder || folder.workspaceId !== workspaceId) {
    throw new HTTPException(404, { message: "Folder not found" });
  }
  return folder;
}

export async function list(db: DbClient, workspaceId: string, c: Context<{ Bindings: Env }>) {
  const { offset, limit } = paginationParams(c);
  const { folders, total } = await foldersRepo.listByWorkspace(db, workspaceId, offset, limit);
  return paginatedResponse(folders, total, offset, limit);
}

export async function update(
  db: DbClient,
  id: string,
  workspaceId: string,
  data: z.infer<typeof updateFolderSchema>,
) {
  await getById(db, id, workspaceId);
  const patch: Record<string, unknown> = {};
  if (data.name !== undefined) patch.name = data.name;
  if (data.color !== undefined) patch.color = data.color;
  if (data.sort_order !== undefined) patch.sortOrder = data.sort_order;
  return foldersRepo.update(db, id, workspaceId, patch);
}

export async function remove(db: DbClient, id: string, workspaceId: string) {
  await getById(db, id, workspaceId);
  // Projects keep their folder_id (ON DELETE SET NULL only fires on hard
  // delete); they simply render under "No folder" once the folder is gone.
  await foldersRepo.softDelete(db, id, workspaceId);
}
