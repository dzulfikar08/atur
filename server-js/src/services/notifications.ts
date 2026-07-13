import type { DbClient } from '../db/index'
import * as notificationsRepo from '../repositories/notifications'
import { HTTPException } from 'hono/http-exception'

export async function list(db: DbClient, userId: string, offset: number, limit: number) {
  return notificationsRepo.listByUser(db, userId, offset, limit)
}

export async function markRead(db: DbClient, id: string, _userId: string) {
  const notification = await notificationsRepo.findById(db, id)
  if (!notification) throw new HTTPException(404, { message: 'Notification not found' })
  await notificationsRepo.markRead(db, id)
}

export async function markAllRead(db: DbClient, userId: string) {
  await notificationsRepo.markAllRead(db, userId)
}

export async function unreadCount(db: DbClient, userId: string) {
  return notificationsRepo.unreadCount(db, userId)
}

export async function update(
  db: DbClient,
  id: string,
  _userId: string,
  data: { read?: boolean; archived?: boolean }
) {
  const notification = await notificationsRepo.findById(db, id)
  if (!notification) throw new HTTPException(404, { message: 'Notification not found' })
  await notificationsRepo.update(db, id, data)
}
