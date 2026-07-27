import { z } from 'zod'
import type { DbClient } from '../db/index'
import * as timeEntriesRepo from '../repositories/timeEntries'
import { HTTPException } from 'hono/http-exception'
import { paginationParams, paginatedResponse, nowISO } from '../lib/pagination'
import type { Context } from 'hono'
import type { Env } from '../lib/env'

export const createTimeEntrySchema = z.object({
  duration_seconds: z.number().int().positive(),
  description: z.string().optional(),
  started_at: z.string().optional(),
  ended_at: z.string().optional().nullable(),
})

type IssueRef = { id: string; workspaceId: string }

export async function create(
  db: DbClient,
  issue: IssueRef,
  userId: string,
  data: z.infer<typeof createTimeEntrySchema>
) {
  const parsed = createTimeEntrySchema.parse(data)
  return timeEntriesRepo.create(db, {
    issueId: issue.id,
    workspaceId: issue.workspaceId,
    userId,
    durationSeconds: parsed.duration_seconds,
    description: parsed.description,
    startedAt: parsed.started_at ?? nowISO(),
    endedAt: parsed.ended_at ?? null,
  })
}

export async function list(db: DbClient, issue: IssueRef, c: Context<{ Bindings: Env }>) {
  const { offset, limit } = paginationParams(c)
  const { entries, total } = await timeEntriesRepo.listByIssue(db, issue.id, offset, limit)
  const totalSeconds = await timeEntriesRepo.totalForIssue(db, issue.id)
  return {
    ...paginatedResponse(entries, total, offset, limit),
    total_seconds: totalSeconds,
  }
}

export async function remove(db: DbClient, issue: IssueRef, entryId: string) {
  const existing = await timeEntriesRepo.findById(db, entryId)
  if (!existing || existing.deletedAt) throw new HTTPException(404, { message: 'Time entry not found' })
  await timeEntriesRepo.softDeleteForIssue(db, entryId, issue.id)
}
