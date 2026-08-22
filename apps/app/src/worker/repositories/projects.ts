import { eq, and, isNull, sql } from "drizzle-orm";
import type { DbClient } from "../db/index";
import * as schema from "../db/schema";
import { v4 as uuid } from "uuid";
import { nowISO } from "../lib/pagination";

export async function findById(db: DbClient, id: string) {
  const [project] = await db
    .select()
    .from(schema.projects)
    .where(and(eq(schema.projects.id, id), isNull(schema.projects.deletedAt)))
    .limit(1);
  return project;
}

export async function listByWorkspace(
  db: DbClient,
  workspaceId: string,
  offset: number,
  limit: number,
  opts?: { isPipeline?: boolean },
) {
  const where = and(
    eq(schema.projects.workspaceId, workspaceId),
    isNull(schema.projects.deletedAt),
    ...(opts?.isPipeline !== undefined
      ? [eq(schema.projects.isPipeline, opts.isPipeline ? 1 : 0)]
      : []),
  );
  const rows = await db.select().from(schema.projects).where(where).limit(limit).offset(offset);
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.projects)
    .where(where);
  return { rows, total: count };
}

// Mirrors the uq_project_identifier constraint: (identifier, workspace_id)
// unique including soft-deleted rows, so collision checks must not filter
// deleted_at.
export async function identifierExists(db: DbClient, workspaceId: string, identifier: string) {
  const [row] = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(
      and(eq(schema.projects.identifier, identifier), eq(schema.projects.workspaceId, workspaceId)),
    )
    .limit(1);
  return !!row;
}

export async function create(
  db: DbClient,
  data: {
    name: string;
    identifier: string;
    workspaceId: string;
    description?: string | null;
    descriptionHtml?: string | null;
    emoji?: string | null;
    coverImage?: string | null;
    network?: number;
    timezone?: string;
    projectLeadId?: string | null;
    defaultAssigneeId?: string | null;
    isPipeline?: number;
  },
) {
  const id = uuid();
  const now = nowISO();
  await db.insert(schema.projects).values({
    id,
    name: data.name,
    identifier: data.identifier,
    workspaceId: data.workspaceId,
    description: data.description ?? null,
    descriptionHtml: data.descriptionHtml ?? null,
    emoji: data.emoji ?? null,
    coverImage: data.coverImage ?? null,
    network: data.network ?? 0,
    timezone: data.timezone ?? "UTC",
    projectLeadId: data.projectLeadId ?? null,
    defaultAssigneeId: data.defaultAssigneeId ?? null,
    isPipeline: data.isPipeline ?? 0,
    createdAt: now,
    updatedAt: now,
  });
  return findById(db, id);
}

export async function update(
  db: DbClient,
  id: string,
  data: Partial<typeof schema.projects.$inferInsert>,
) {
  await db
    .update(schema.projects)
    .set({ ...data, updatedAt: nowISO() })
    .where(eq(schema.projects.id, id));
  return findById(db, id);
}

export async function softDelete(db: DbClient, id: string) {
  await db
    .update(schema.projects)
    .set({ deletedAt: nowISO(), updatedAt: nowISO() })
    .where(eq(schema.projects.id, id));
}

export async function addMember(
  db: DbClient,
  data: {
    projectId: string;
    workspaceId: string;
    memberId: string;
    role?: number;
  },
) {
  const id = uuid();
  const now = nowISO();
  await db.insert(schema.projectMembers).values({
    id,
    projectId: data.projectId,
    workspaceId: data.workspaceId,
    memberId: data.memberId,
    role: data.role ?? 15,
    createdAt: now,
    updatedAt: now,
  });
  const [member] = await db
    .select()
    .from(schema.projectMembers)
    .where(eq(schema.projectMembers.id, id))
    .limit(1);
  return member;
}

export async function removeMember(db: DbClient, id: string) {
  await db
    .update(schema.projectMembers)
    .set({ deletedAt: nowISO(), updatedAt: nowISO() })
    .where(eq(schema.projectMembers.id, id));
}

export async function listMembers(db: DbClient, projectId: string) {
  return db
    .select({
      id: schema.projectMembers.id,
      role: schema.projectMembers.role,
      memberId: schema.projectMembers.memberId,
      username: schema.users.username,
      email: schema.users.email,
      displayName: schema.users.displayName,
      avatar: schema.users.avatar,
    })
    .from(schema.projectMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.projectMembers.memberId))
    .where(
      and(eq(schema.projectMembers.projectId, projectId), isNull(schema.projectMembers.deletedAt)),
    );
}
