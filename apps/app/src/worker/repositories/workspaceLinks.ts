import { eq } from "drizzle-orm";
import { getDb, type DbClient } from "../db/index";
import * as schema from "../db/schema";

export type WorkspaceLink = typeof schema.workspaceLinks.$inferSelect;

export async function findBySlug(db: DbClient, slug: string) {
  const [row] = await db
    .select()
    .from(schema.workspaceLinks)
    .where(eq(schema.workspaceLinks.workspaceSlug, slug))
    .limit(1);
  return row ?? null;
}

export async function upsertBySlug(
  db: DbClient,
  slug: string,
  fields: {
    repoUrls?: string | null;
    localPath?: string | null;
    defaultBranch?: string | null;
    herdrWorkspace?: string | null;
    notes?: string | null;
    mode?: string | null;
    autoMerge?: string | null;
  },
) {
  const now = new Date().toISOString();
  await db
    .insert(schema.workspaceLinks)
    .values({ id: crypto.randomUUID(), workspaceSlug: slug, ...fields, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: schema.workspaceLinks.workspaceSlug,
      set: { ...fields, updatedAt: now },
    });
  return findBySlug(db, slug);
}

export async function removeBySlug(db: DbClient, slug: string) {
  await db
    .delete(schema.workspaceLinks)
    .where(eq(schema.workspaceLinks.workspaceSlug, slug));
}

// listAll is MCP/admin-only: the tools/call path gates callers per workspace
// via getWorkspaceId + assertWorkspaceAdmin before widening the result set.
export async function listAll(db: ReturnType<typeof getDb>) {
  return db.select().from(schema.workspaceLinks).orderBy(schema.workspaceLinks.workspaceSlug);
}

