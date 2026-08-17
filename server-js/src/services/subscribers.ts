import type { DbClient } from '../db/index'
import * as subscribersRepo from '../repositories/subscribers'

export async function listByIssue(db: DbClient, issueId: string) {
  const results = await subscribersRepo.listByIssue(db, issueId)
  return {
    results: results.map((s) => ({
      id: s.id,
      subscriber_id: s.subscriberId,
      created_at: s.createdAt,
      user: s.user
        ? {
            id: s.user.id,
            email: s.user.email,
            username: s.user.username,
            display_name: s.user.display_name,
            avatar: s.user.avatar,
          }
        : null,
    })),
  }
}

export async function isSubscribed(db: DbClient, issueId: string, userId: string) {
  return subscribersRepo.isSubscribed(db, issueId, userId)
}

export async function follow(db: DbClient, issueId: string, userId: string) {
  await subscribersRepo.subscribe(db, issueId, userId)
}

export async function unfollow(db: DbClient, issueId: string, userId: string) {
  await subscribersRepo.unsubscribe(db, issueId, userId)
}
