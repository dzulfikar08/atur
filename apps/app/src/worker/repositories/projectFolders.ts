import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import type { DbClient } from "../db/index";
import * as schema from "../db/schema";
import { nowISO } from "../lib/pagination";
import { v4 as uuid } from "uuid";

export async function findById(db: DbClient, id: string) {
  const [folder] = await db
    .select()
    .from(schema.projectFolders)
    .where(and(eq(schema.projectFolders.id, id), isNull(schema.projectFolders.deletedAt)))
    .limit(1);
  return folder ?? null;
}

export async function listByWorkspace(
  db: DbClient,
  workspaceId: string,
  offset: number,
  limit: number,
) {
  const where = and(
    eq(schema.projectFolders.workspaceId, workspaceId),
    isNull(schema.projectFolders.deletedAt),
  );
  const folders = await db
    .select()
    .from(schema.projectFolders)
    .where(where)
    .orderBy(asc(schema.projectFolders.sortOrder), desc(schema.projectFolders.createdAt))
    .offset(offset)
    .limit(limit);
  // Separate count — page length would silently truncate >limit folders and
  // break paginatedResponse's next_offset.
  const [counted] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.projectFolders)
    .where(where);
  return { folders, total: Number(counted?.count ?? 0) };
}

export async function create(
  db: DbClient,
  data: { name: string; color?: string | null; sortOrder?: number; workspaceId: string },
) {
  const id = uuid();
  const now = nowISO();
  await db.insert(schema.projectFolders).values({
    id,
    name: data.name,
    color: data.color ?? null,
    sortOrder: data.sortOrder ?? 65535.0,
    workspaceId: data.workspaceId,
    createdAt: now,
    updatedAt: now,
  });
  return findById(db, id);
}

export async function update(
  db: DbClient,
  id: string,
  workspaceId: string,
  data: Partial<typeof schema.projectFolders.$inferInsert>,
) {
  await db
    .update(schema.projectFolders)
    .set({ ...data, updatedAt: nowISO() })
    .where(
      and(eq(schema.projectFolders.id, id), eq(schema.projectFolders.workspaceId, workspaceId)),
    );
  return findById(db, id);
}

export async function softDelete(db: DbClient, id: string, workspaceId: string) {
  const now = nowISO();
  await db
    .update(schema.projectFolders)
    .set({ deletedAt: now, updatedAt: now })
    .where(
      and(eq(schema.projectFolders.id, id), eq(schema.projectFolders.workspaceId, workspaceId)),
    );
}
