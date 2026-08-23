import { z } from "zod";
import type { DbClient } from "../db/index";
import * as customFieldsRepo from "../repositories/customFields";
import { HTTPException } from "hono/http-exception";

export const createCustomFieldSchema = z.object({
  name: z.string().min(1),
  field_type: z.string().min(1),
  description: z.string().optional(),
  is_required: z.number().min(0).max(1).optional(),
  options: z.string().optional(),
});

export async function create(
  db: DbClient,
  projectId: string,
  workspaceId: string,
  data: z.infer<typeof createCustomFieldSchema>,
) {
  return customFieldsRepo.create(db, {
    name: data.name,
    fieldType: data.field_type,
    projectId,
    workspaceId,
    description: data.description,
    isRequired: data.is_required,
    options: data.options,
  });
}

// workspaceId is the caller's workspace (route guard). A field in another
// workspace is indistinguishable from a missing one → 404, never a leaky 200.
export async function getById(db: DbClient, id: string, workspaceId: string) {
  const field = await customFieldsRepo.findById(db, id);
  if (!field || field.workspaceId !== workspaceId) {
    throw new HTTPException(404, { message: "Custom field not found" });
  }
  return field;
}

export async function list(db: DbClient, projectId: string) {
  return { results: await customFieldsRepo.listByProject(db, projectId) };
}

export const updateCustomFieldSchema = z
  .object({
    name: z.string().min(1).optional(),
    field_type: z.string().min(1).optional(),
    description: z.string().optional(),
    is_required: z.number().min(0).max(1).optional(),
    options: z.string().optional(),
  })
  .partial()
  .refine((d) => Object.keys(d).length > 0, { message: "At least one field required" });

// workspaceId is the caller's workspace (route guard). A field in another
// workspace is indistinguishable from a missing one → 404, never a leaky 200.
export async function update(
  db: DbClient,
  id: string,
  workspaceId: string,
  data: z.infer<typeof updateCustomFieldSchema>,
) {
  const existing = await customFieldsRepo.findById(db, id);
  if (!existing || existing.workspaceId !== workspaceId) {
    throw new HTTPException(404, { message: "Custom field not found" });
  }
  const updateData: Record<string, unknown> = { ...data };
  if (data.field_type !== undefined) {
    updateData.fieldType = data.field_type;
    delete updateData.field_type;
  }
  if (data.is_required !== undefined) {
    updateData.isRequired = data.is_required;
    delete updateData.is_required;
  }
  return customFieldsRepo.update(db, id, workspaceId, updateData);
}

export async function remove(db: DbClient, id: string, workspaceId: string) {
  const existing = await customFieldsRepo.findById(db, id);
  if (!existing || existing.workspaceId !== workspaceId) {
    throw new HTTPException(404, { message: "Custom field not found" });
  }
  await customFieldsRepo.remove(db, id, workspaceId);
}
