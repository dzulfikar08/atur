import { eq } from 'drizzle-orm'
import type { DbClient } from '../db/index'
import { fileAssets } from '../db/schema'
import { v4 as uuid } from 'uuid'
import { nowISO } from '../lib/pagination'

export async function findById(db: DbClient, id: string) {
  const [asset] = await db.select().from(fileAssets).where(eq(fileAssets.id, id)).limit(1)
  return asset
}

export async function createAsset(
  db: DbClient,
  data: {
    asset: string
    size?: number
    contentType?: string
    createdById: string
    entityId?: string
    entityType?: string
  }
) {
  const id = uuid()
  const now = nowISO()
  await db.insert(fileAssets).values({
    id,
    asset: data.asset,
    size: data.size ?? null,
    contentType: data.contentType ?? null,
    createdById: data.createdById,
    entityId: data.entityId ?? null,
    entityType: data.entityType ?? null,
    isUploaded: 1,
    createdAt: now,
    updatedAt: now,
  })
  return findById(db, id)
}

export async function deleteAsset(db: DbClient, id: string) {
  await db.update(fileAssets).set({ deletedAt: nowISO(), updatedAt: nowISO() }).where(eq(fileAssets.id, id))
}
