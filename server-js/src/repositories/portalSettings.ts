import { eq } from 'drizzle-orm'
import type { DbClient } from '../db/index'
import * as schema from '../db/schema'
import { nowISO } from '../lib/pagination'

export async function get(db: DbClient, workspaceId: string) {
  const [row] = await db.select().from(schema.portalSettings)
    .where(eq(schema.portalSettings.workspaceId, workspaceId))
    .limit(1)
  return row ?? null
}

export async function upsert(
  db: DbClient,
  workspaceId: string,
  data: { supportProjectId: string | null; isEnabled: number }
) {
  const now = nowISO()
  await db.insert(schema.portalSettings)
    .values({
      workspaceId,
      supportProjectId: data.supportProjectId,
      isEnabled: data.isEnabled,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: schema.portalSettings.workspaceId,
      set: {
        supportProjectId: data.supportProjectId,
        isEnabled: data.isEnabled,
        updatedAt: now,
      },
    })
  return get(db, workspaceId)
}
