import { z } from "zod";
import type { DbClient } from "../db/index";
import * as pagesRepo from "../repositories/pages";
import { HTTPException } from "hono/http-exception";

export const createPageSchema = z.object({
  name: z.string().min(1),
  description_html: z.string().optional(),
  description_json: z.object({}).passthrough().optional(),
  access: z.number().optional(),
  color: z.string().optional(),
  parent_id: z.string().optional(),
});

export async function create(
  db: DbClient,
  workspaceId: string,
  ownedById: string,
  data: z.infer<typeof createPageSchema>,
) {
  return pagesRepo.create(db, {
    name: data.name,
    workspaceId,
    ownedById,
    descriptionHtml: data.description_html,
    descriptionJson: data.description_json ? JSON.stringify(data.description_json) : undefined,
    access: data.access,
    color: data.color,
    parentId: data.parent_id,
  });
}

// workspaceId is the caller's workspace (route guard). A page in another
// workspace is indistinguishable from a missing one → 404, never a leaky 200.
export async function getById(db: DbClient, id: string, workspaceId: string) {
  const page = await pagesRepo.findById(db, id);
  if (!page || page.workspaceId !== workspaceId) {
    throw new HTTPException(404, { message: "Page not found" });
  }
  return page;
}

export async function list(db: DbClient, workspaceId: string) {
  return { results: await pagesRepo.listByProject(db, workspaceId) };
}

export const updatePageSchema = z
  .object({
    name: z.string().min(1).optional(),
    description_html: z.string().optional(),
    description_json: z.object({}).passthrough().optional(),
    access: z.number().optional(),
    color: z.string().optional(),
    parent_id: z.string().nullable().optional(),
    is_locked: z.number().optional(),
    archived_at: z.string().nullable().optional(),
  })
  .partial()
  .refine((d) => Object.keys(d).length > 0, { message: "At least one field required" });

// workspaceId is the caller's workspace (route guard). A page in another
// workspace is indistinguishable from a missing one → 404, never a leaky 200.
export async function update(
  db: DbClient,
  id: string,
  workspaceId: string,
  data: z.infer<typeof updatePageSchema>,
) {
  const existing = await pagesRepo.findById(db, id);
  if (!existing || existing.workspaceId !== workspaceId) {
    throw new HTTPException(404, { message: "Page not found" });
  }
  const updateData: Record<string, unknown> = { ...data };
  if (data.description_html !== undefined) {
    updateData.descriptionHtml = data.description_html;
    delete updateData.description_html;
  }
  if (data.description_json !== undefined) {
    updateData.descriptionJson = JSON.stringify(data.description_json);
    delete updateData.description_json;
  }
  if (data.parent_id !== undefined) {
    updateData.parentId = data.parent_id;
    delete updateData.parent_id;
  }
  if (data.is_locked !== undefined) {
    updateData.isLocked = data.is_locked;
    delete updateData.is_locked;
  }
  if (data.archived_at !== undefined) {
    updateData.archivedAt = data.archived_at;
    delete updateData.archived_at;
  }
  return pagesRepo.update(db, id, workspaceId, updateData);
}

export async function remove(db: DbClient, id: string, workspaceId: string) {
  const existing = await pagesRepo.findById(db, id);
  if (!existing || existing.workspaceId !== workspaceId) {
    throw new HTTPException(404, { message: "Page not found" });
  }
  await pagesRepo.remove(db, id, workspaceId);
}
