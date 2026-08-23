import { eq, and, isNull } from "drizzle-orm";
import type { DbClient } from "../db/index";
import { labels } from "../db/schema";
import { v4 as uuid } from "uuid";
import { nowISO } from "../lib/pagination";

export async function listByProject(db: DbClient, projectId: string, workspaceId: string) {
  return db
    .select()
    .from(labels)
    .where(
      and(
        eq(labels.projectId, projectId),
        eq(labels.workspaceId, workspaceId),
        isNull(labels.deletedAt),
      ),
    );
}

export async function listByWorkspace(db: DbClient, workspaceId: string) {
  return db
    .select()
    .from(labels)
    .where(and(eq(labels.workspaceId, workspaceId), isNull(labels.deletedAt)));
}

export async function findById(db: DbClient, id: string) {
  const [label] = await db
    .select()
    .from(labels)
    .where(and(eq(labels.id, id), isNull(labels.deletedAt)))
    .limit(1);
  return label;
}

export async function create(
  db: DbClient,
  data: {
    name: string;
    color: string;
    workspaceId: string;
    projectId?: string;
    parentId?: string;
    description?: string;
  },
) {
  const id = uuid();
  const now = nowISO();
  await db.insert(labels).values({
    id,
    name: data.name,
    color: data.color,
    workspaceId: data.workspaceId,
    projectId: data.projectId || null,
    parentId: data.parentId || null,
    description: data.description || null,
    createdAt: now,
    updatedAt: now,
  });
  return findById(db, id);
}

// Mutations are workspace-scoped (id AND workspace_id) so a bare foreign UUID
// from another workspace can never match — the caller's workspace always comes
// from the route guard (c.get("workspace").id), never from the request body.
export async function update(
  db: DbClient,
  id: string,
  workspaceId: string,
  data: Record<string, unknown>,
) {
  await db
    .update(labels)
    .set({ ...data, updatedAt: nowISO() })
    .where(and(eq(labels.id, id), eq(labels.workspaceId, workspaceId)));
  return findById(db, id);
}

export async function remove(db: DbClient, id: string, workspaceId: string) {
  await db
    .update(labels)
    .set({ deletedAt: nowISO(), updatedAt: nowISO() })
    .where(and(eq(labels.id, id), eq(labels.workspaceId, workspaceId)));
}
