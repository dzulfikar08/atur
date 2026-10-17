import { eq, and, isNull, asc, sql } from "drizzle-orm";
import type { DbClient } from "../db/index";
import { states } from "../db/schema";
import { v4 as uuid } from "uuid";
import { nowISO } from "../lib/pagination";

// Frontend expects the state group under `group` (not `group_name`), so alias it.
const stateCols = {
  id: states.id,
  name: states.name,
  description: states.description,
  color: states.color,
  slug: states.slug,
  key: states.key,
  sequence: states.sequence,
  group: states.groupName,
  isDefault: states.isDefault,
  isTriage: states.isTriage,
  projectId: states.projectId,
  workspaceId: states.workspaceId,
  createdAt: states.createdAt,
  updatedAt: states.updatedAt,
};

// Workflow order: group first, then the state's own sequence, then name — so
// states sharing the default sequence (65535) never depend on SQLite row order.
export async function listByProject(db: DbClient, projectId: string) {
  return db
    .select(stateCols)
    .from(states)
    .where(and(eq(states.projectId, projectId), isNull(states.deletedAt)))
    .orderBy(
      sql`CASE ${states.groupName} WHEN 'backlog' THEN 0 WHEN 'unstarted' THEN 1 WHEN 'started' THEN 2 WHEN 'completed' THEN 3 WHEN 'cancelled' THEN 4 ELSE 5 END`,
      asc(states.sequence),
      asc(states.name),
    );
}

export async function findById(db: DbClient, id: string) {
  const [state] = await db
    .select(stateCols)
    .from(states)
    .where(and(eq(states.id, id), isNull(states.deletedAt)))
    .limit(1);
  return state;
}

export async function create(
  db: DbClient,
  data: {
    name: string;
    color: string;
    groupName: string;
    projectId: string;
    workspaceId: string;
    description?: string;
    slug?: string;
    key?: string | null;
  },
) {
  const id = uuid();
  const now = nowISO();
  await db.insert(states).values({
    id,
    name: data.name,
    color: data.color,
    groupName: data.groupName,
    projectId: data.projectId,
    workspaceId: data.workspaceId,
    description: data.description || null,
    slug: data.slug || null,
    key: data.key ?? null,
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
    .update(states)
    .set({ ...data, updatedAt: nowISO() })
    .where(and(eq(states.id, id), eq(states.workspaceId, workspaceId)));
  return findById(db, id);
}

export async function remove(db: DbClient, id: string, workspaceId: string) {
  await db
    .update(states)
    .set({ deletedAt: nowISO(), updatedAt: nowISO() })
    .where(and(eq(states.id, id), eq(states.workspaceId, workspaceId)));
}
