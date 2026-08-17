import { eq, and, desc, isNull, count } from "drizzle-orm";
import type { DbClient } from "../db/index";
import * as schema from "../db/schema";
import { v4 as uuid } from "uuid";
import { nowISO } from "../lib/pagination";

export async function findById(db: DbClient, id: string) {
  const [cycle] = await db.select().from(schema.cycles).where(eq(schema.cycles.id, id)).limit(1);
  return cycle ?? null;
}

export async function listByProject(
  db: DbClient,
  projectId: string,
  offset: number,
  limit: number,
) {
  const cycles = await db
    .select()
    .from(schema.cycles)
    .where(and(eq(schema.cycles.projectId, projectId), isNull(schema.cycles.deletedAt)))
    .orderBy(desc(schema.cycles.createdAt))
    .offset(offset)
    .limit(limit);
  const [{ total }] = await db
    .select({ total: count() })
    .from(schema.cycles)
    .where(and(eq(schema.cycles.projectId, projectId), isNull(schema.cycles.deletedAt)));
  return { cycles, total };
}

export async function create(
  db: DbClient,
  data: {
    name: string;
    description?: string | null;
    startDate?: string | null;
    endDate?: string | null;
    projectId: string;
    workspaceId: string;
    ownedById: string;
  },
) {
  const id = uuid();
  const now = nowISO();
  await db.insert(schema.cycles).values({
    id,
    name: data.name,
    description: data.description ?? null,
    startDate: data.startDate ?? null,
    endDate: data.endDate ?? null,
    projectId: data.projectId,
    workspaceId: data.workspaceId,
    ownedById: data.ownedById,
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
    startDate?: string | null;
    endDate?: string | null;
  },
) {
  await db
    .update(schema.cycles)
    .set({ ...data, updatedAt: nowISO() })
    .where(eq(schema.cycles.id, id));
  return findById(db, id);
}

export async function softDelete(db: DbClient, id: string) {
  const now = nowISO();
  await db
    .update(schema.cycles)
    .set({ deletedAt: now, updatedAt: now })
    .where(eq(schema.cycles.id, id));
}

export async function addIssue(db: DbClient, cycleId: string, issueId: string) {
  const id = uuid();
  const now = nowISO();
  await db
    .insert(schema.cycleIssues)
    .values({ id, cycleId, issueId, createdAt: now, updatedAt: now });
}

export async function removeIssue(db: DbClient, cycleId: string, issueId: string) {
  await db
    .delete(schema.cycleIssues)
    .where(and(eq(schema.cycleIssues.cycleId, cycleId), eq(schema.cycleIssues.issueId, issueId)));
}

export async function listIssues(db: DbClient, cycleId: string, offset: number, limit: number) {
  const issues = await db
    .select()
    .from(schema.cycleIssues)
    .where(eq(schema.cycleIssues.cycleId, cycleId))
    .offset(offset)
    .limit(limit);
  const [{ total }] = await db
    .select({ total: count() })
    .from(schema.cycleIssues)
    .where(eq(schema.cycleIssues.cycleId, cycleId));
  return { issues, total };
}
