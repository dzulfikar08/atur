import type { DbClient } from "../db/index";
import * as schema from "../db/schema";
import { v4 as uuid } from "uuid";
import { nowISO } from "../lib/pagination";
import { eq, desc } from "drizzle-orm";

export async function create(
  db: DbClient,
  data: {
    service: string;
    workspaceId: string;
    projectId?: string;
    createdById: string;
    metadata?: string;
  },
) {
  const id = uuid();
  const now = nowISO();
  await db.insert(schema.exports_).values({
    id,
    service: data.service,
    workspaceId: data.workspaceId,
    projectId: data.projectId,
    createdById: data.createdById,
    metadata: data.metadata,
    status: "queued",
    createdAt: now,
    updatedAt: now,
  });
  return findById(db, id);
}

export async function listByWorkspace(db: DbClient, workspaceId: string) {
  return db
    .select()
    .from(schema.exports_)
    .where(eq(schema.exports_.workspaceId, workspaceId))
    .orderBy(desc(schema.exports_.createdAt));
}

export async function findById(db: DbClient, id: string) {
  const [exp] = await db.select().from(schema.exports_).where(eq(schema.exports_.id, id)).limit(1);
  return exp;
}
