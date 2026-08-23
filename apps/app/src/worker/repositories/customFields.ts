import { eq, and, isNull } from "drizzle-orm";
import type { DbClient } from "../db/index";
import { customFields } from "../db/schema";
import { v4 as uuid } from "uuid";
import { nowISO } from "../lib/pagination";

export async function findById(db: DbClient, id: string) {
  const [field] = await db
    .select()
    .from(customFields)
    .where(and(eq(customFields.id, id), isNull(customFields.deletedAt)))
    .limit(1);
  return field;
}

export async function listByProject(db: DbClient, projectId: string) {
  return db
    .select()
    .from(customFields)
    .where(and(eq(customFields.projectId, projectId), isNull(customFields.deletedAt)));
}

export async function create(
  db: DbClient,
  data: {
    name: string;
    fieldType: string;
    projectId: string;
    workspaceId: string;
    description?: string;
    isRequired?: number;
    options?: string;
  },
) {
  const id = uuid();
  const now = nowISO();
  await db.insert(customFields).values({
    id,
    name: data.name,
    fieldType: data.fieldType,
    projectId: data.projectId,
    workspaceId: data.workspaceId,
    description: data.description || null,
    isRequired: data.isRequired ?? 0,
    options: data.options || null,
    createdAt: now,
    updatedAt: now,
  });
  return findById(db, id);
}

// Mutations are workspace-scoped (id AND workspace_id) — a bare foreign UUID
// from another workspace never matches. The workspace id always comes from the
// route guard (c.get("workspace").id), never the request body.
export async function update(
  db: DbClient,
  id: string,
  workspaceId: string,
  data: Record<string, unknown>,
) {
  await db
    .update(customFields)
    .set({ ...data, updatedAt: nowISO() })
    .where(and(eq(customFields.id, id), eq(customFields.workspaceId, workspaceId)));
  return findById(db, id);
}

export async function remove(db: DbClient, id: string, workspaceId: string) {
  await db
    .update(customFields)
    .set({ deletedAt: nowISO(), updatedAt: nowISO() })
    .where(and(eq(customFields.id, id), eq(customFields.workspaceId, workspaceId)));
}
