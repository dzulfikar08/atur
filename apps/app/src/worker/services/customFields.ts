import { z } from "zod";
import type { DbClient } from "../db/index";
import * as customFieldsRepo from "../repositories/customFields";
import { HTTPException } from "hono/http-exception";

// Field settings live in the `options` TEXT column as JSON. The wire contract
// is the `settings` OBJECT the client posts ({options: SelectOption[],
// currency: "IDR"}); the legacy `options` STRING form is still tolerated on
// write so old callers keep working. Reads always return parsed `settings`.
export const fieldSettingsSchema = z.object({
  options: z
    .array(z.object({ id: z.string(), value: z.string(), color: z.string().optional() }))
    .optional(),
  currency: z.string().min(3).max(3).optional(),
});

export const createCustomFieldSchema = z.object({
  name: z.string().min(1),
  field_type: z.string().min(1),
  description: z.string().optional(),
  is_required: z.number().min(0).max(1).optional(),
  settings: fieldSettingsSchema.optional(),
  /** @deprecated legacy raw-JSON string — prefer `settings` */
  options: z.string().optional(),
});

export const updateCustomFieldSchema = z
  .object({
    name: z.string().min(1).optional(),
    field_type: z.string().min(1).optional(),
    description: z.string().optional(),
    is_required: z.number().min(0).max(1).optional(),
    settings: fieldSettingsSchema.optional(),
    /** @deprecated legacy raw-JSON string — prefer `settings` */
    options: z.string().optional(),
  })
  .partial()
  .refine((d) => Object.keys(d).length > 0, { message: "At least one field required" });

// Serialize settings (or a legacy options string) into the options column.
function encodeSettings(data: { settings?: unknown; options?: string }): string | undefined {
  if (data.settings !== undefined) return JSON.stringify(data.settings);
  return data.options;
}

export async function create(
  db: DbClient,
  projectId: string,
  workspaceId: string,
  data: z.infer<typeof createCustomFieldSchema>,
) {
  const field = await customFieldsRepo.create(db, {
    name: data.name,
    fieldType: data.field_type,
    projectId,
    workspaceId,
    description: data.description,
    isRequired: data.is_required,
    options: encodeSettings(data),
  });
  return withSettings(field);
}

// workspaceId is the caller's workspace (route guard). A field in another
// workspace is indistinguishable from a missing one → 404, never a leaky 200.
export async function getById(db: DbClient, id: string, workspaceId: string) {
  const field = await customFieldsRepo.findById(db, id);
  if (!field || field.workspaceId !== workspaceId) {
    throw new HTTPException(404, { message: "Custom field not found" });
  }
  return withSettings(field);
}

export async function list(db: DbClient, projectId: string) {
  const rows = await customFieldsRepo.listByProject(db, projectId);
  return { results: rows.map(withSettings) };
}

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
  const encoded = encodeSettings(data);
  delete updateData.settings;
  delete updateData.options;
  if (encoded !== undefined) updateData.options = encoded;
  return withSettings(await customFieldsRepo.update(db, id, workspaceId, updateData));
}

export async function remove(db: DbClient, id: string, workspaceId: string) {
  const existing = await customFieldsRepo.findById(db, id);
  if (!existing || existing.workspaceId !== workspaceId) {
    throw new HTTPException(404, { message: "Custom field not found" });
  }
  await customFieldsRepo.remove(db, id, workspaceId);
}

// Parse the options column back into a `settings` object on every read. A
// currency field without an explicit currency defaults to IDR.
type FieldRow = { id: string; fieldType: string; options: string | null } & Record<string, unknown>;
export function withSettings<T extends FieldRow>(field: T) {
  let settings: Record<string, unknown> = {};
  if (field.options) {
    try {
      const parsed = JSON.parse(field.options);
      if (Array.isArray(parsed)) settings = { options: parsed };
      else if (parsed && typeof parsed === "object") settings = parsed as Record<string, unknown>;
    } catch {
      // legacy non-JSON string — leave settings empty
    }
  }
  if (field.fieldType === "currency" && !settings.currency) settings.currency = "IDR";
  return { ...field, settings };
}
