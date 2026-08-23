import { eq, and, isNull } from "drizzle-orm";
import type { DbClient } from "../db/index";
import { pages } from "../db/schema";
import { v4 as uuid } from "uuid";
import { nowISO } from "../lib/pagination";

export async function findById(db: DbClient, id: string) {
  const [page] = await db
    .select()
    .from(pages)
    .where(and(eq(pages.id, id), isNull(pages.deletedAt)))
    .limit(1);
  return page;
}

export async function listByWorkspace(db: DbClient, workspaceId: string) {
  return db
    .select()
    .from(pages)
    .where(and(eq(pages.workspaceId, workspaceId), isNull(pages.deletedAt)));
}

export async function listByProject(db: DbClient, workspaceId: string) {
  return db
    .select()
    .from(pages)
    .where(and(eq(pages.workspaceId, workspaceId), isNull(pages.deletedAt)));
}

export async function create(
  db: DbClient,
  data: {
    name: string;
    workspaceId: string;
    ownedById: string;
    descriptionHtml?: string;
    descriptionJson?: string;
    descriptionStripped?: string;
    access?: number;
    color?: string;
    parentId?: string;
  },
) {
  const id = uuid();
  const now = nowISO();
  await db.insert(pages).values({
    id,
    name: data.name,
    workspaceId: data.workspaceId,
    ownedById: data.ownedById,
    descriptionHtml: data.descriptionHtml || null,
    descriptionJson: data.descriptionJson || null,
    descriptionStripped: data.descriptionStripped || null,
    access: data.access ?? 0,
    color: data.color || null,
    parentId: data.parentId || null,
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
    .update(pages)
    .set({ ...data, updatedAt: nowISO() })
    .where(and(eq(pages.id, id), eq(pages.workspaceId, workspaceId)));
  return findById(db, id);
}

export async function remove(db: DbClient, id: string, workspaceId: string) {
  await db
    .update(pages)
    .set({ deletedAt: nowISO(), updatedAt: nowISO() })
    .where(and(eq(pages.id, id), eq(pages.workspaceId, workspaceId)));
}
