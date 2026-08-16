import { z } from 'zod'
import type { DbClient } from '../db/index'
import * as commentsRepo from '../repositories/comments'
import { HTTPException } from 'hono/http-exception'

export const createCommentSchema = z.object({
  comment_html: z.string().min(1),
  access: z.string().optional(),
})

export const updateCommentSchema = z.object({
  comment_html: z.string().min(1).optional(),
  access: z.string().optional(),
})

export async function create(
  db: DbClient,
  actorId: string,
  issueId: string,
  data: z.infer<typeof createCommentSchema>
) {
  return commentsRepo.create(db, {
    commentHtml: data.comment_html,
    access: data.access,
    issueId,
    actorId,
  })
}

export async function getById(db: DbClient, id: string) {
  const comment = await commentsRepo.findById(db, id)
  if (!comment) throw new HTTPException(404, { message: 'Comment not found' })
  return comment
}

export async function list(db: DbClient, issueId: string, offset: number, limit: number) {
  return commentsRepo.listByIssue(db, issueId, offset, limit)
}

export async function update(
  db: DbClient,
  actorId: string,
  id: string,
  data: z.infer<typeof updateCommentSchema>
) {
  const comment = await commentsRepo.findById(db, id)
  if (!comment) throw new HTTPException(404, { message: 'Comment not found' })
  if (comment.actorId !== actorId) {
    throw new HTTPException(403, { message: 'You can only edit your own comments' })
  }
  return commentsRepo.update(db, id, {
    commentHtml: data.comment_html,
    access: data.access,
  })
}

export async function remove(db: DbClient, actorId: string, id: string) {
  const comment = await commentsRepo.findById(db, id)
  if (!comment) throw new HTTPException(404, { message: 'Comment not found' })
  if (comment.actorId !== actorId) {
    throw new HTTPException(403, { message: 'You can only delete your own comments' })
  }
  await commentsRepo.remove(db, id)
}
