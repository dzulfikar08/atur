import { eq, and, desc, isNull, count } from "drizzle-orm";
import type { DbClient } from "../db/index";
import * as schema from "../db/schema";
import { v4 as uuid } from "uuid";
import { nowISO } from "../lib/pagination";

export async function findById(db: DbClient, id: string) {
  const [mod] = await db.select().from(schema.modules).where(eq(schema.modules.id, id)).limit(1);
  return mod ?? null;
}

export async function listByProject(
  db: DbClient,
  projectId: string,
  offset: number,
  limit: number,
) {
  const modules = await db
    .select()
    .from(schema.modules)
    .where(and(eq(schema.modules.projectId, projectId), isNull(schema.modules.deletedAt)))
    .orderBy(desc(schema.modules.createdAt))
    .offset(offset)
    .limit(limit);
  const [{ total }] = await db
    .select({ total: count() })
    .from(schema.modules)
    .where(and(eq(schema.modules.projectId, projectId), isNull(schema.modules.deletedAt)));
  return { modules, total };
}

export async function create(
  db: DbClient,
  data: {
    name: string;
    description?: string | null;
    status?: string | null;
    startDate?: string | null;
    targetDate?: string | null;
    leadId?: string | null;
    projectId: string;
    workspaceId: string;
  },
) {
  const id = uuid();
  const now = nowISO();
  await db.insert(schema.modules).values({
    id,
    name: data.name,
    description: data.description ?? null,
    status: data.status ?? "planned",
    startDate: data.startDate ?? null,
    targetDate: data.targetDate ?? null,
    leadId: data.leadId ?? null,
    projectId: data.projectId,
    workspaceId: data.workspaceId,
    createdAt: now,
    updatedAt: now,
  });
  return findById(db, id);
}

export async function update(
  db: DbClient,
  id: string,
  data: {
    name?: string;
    description?: string | null;
    status?: string | null;
    startDate?: string | null;
    targetDate?: string | null;
    leadId?: string | null;
  },
) {
  await db
    .update(schema.modules)
    .set({ ...data, updatedAt: nowISO() })
    .where(eq(schema.modules.id, id));
  return findById(db, id);
}

export async function softDelete(db: DbClient, id: string) {
  const now = nowISO();
  await db
    .update(schema.modules)
    .set({ deletedAt: now, updatedAt: now })
    .where(eq(schema.modules.id, id));
}

export async function addIssue(db: DbClient, moduleId: string, issueId: string) {
  const id = uuid();
  const now = nowISO();
  await db
    .insert(schema.moduleIssues)
    .values({ id, moduleId, issueId, createdAt: now, updatedAt: now });
}

export async function removeIssue(db: DbClient, moduleId: string, issueId: string) {
  await db
    .delete(schema.moduleIssues)
    .where(
      and(eq(schema.moduleIssues.moduleId, moduleId), eq(schema.moduleIssues.issueId, issueId)),
    );
}

export async function listIssues(db: DbClient, moduleId: string, offset: number, limit: number) {
  const issues = await db
    .select()
    .from(schema.moduleIssues)
    .where(eq(schema.moduleIssues.moduleId, moduleId))
    .offset(offset)
    .limit(limit);
  const [{ total }] = await db
    .select({ total: count() })
    .from(schema.moduleIssues)
    .where(eq(schema.moduleIssues.moduleId, moduleId));
  return { issues, total };
}
