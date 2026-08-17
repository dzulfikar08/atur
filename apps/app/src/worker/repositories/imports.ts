import type { DbClient } from "../db/index";
import * as schema from "../db/schema";
import { v4 as uuid } from "uuid";
import { nowISO } from "../lib/pagination";
import { eq } from "drizzle-orm";

export async function create(
  db: DbClient,
  data: {
    service: string;
    workspaceId: string;
    projectId?: string;
    createdById: string;
    data?: string;
    metadata?: string;
  },
) {
  const id = uuid();
  const now = nowISO();
  await db.insert(schema.imports).values({
    id,
    service: data.service,
    workspaceId: data.workspaceId,
    projectId: data.projectId,
    createdById: data.createdById,
    data: data.data,
    metadata: data.metadata,
    status: "queued",
    createdAt: now,
    updatedAt: now,
  });
  return findById(db, id);
}

export async function listByWorkspace(db: DbClient, workspaceId: string) {
  return db.select().from(schema.imports).where(eq(schema.imports.workspaceId, workspaceId));
}

export async function findById(db: DbClient, id: string) {
  const [imp] = await db.select().from(schema.imports).where(eq(schema.imports.id, id)).limit(1);
  return imp;
}

export async function updateStatus(db: DbClient, id: string, status: string) {
  await db
    .update(schema.imports)
    .set({ status, updatedAt: nowISO() })
    .where(eq(schema.imports.id, id));
  return findById(db, id);
}
