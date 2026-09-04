import { z } from "zod";
import type { DbClient } from "../db/index";
import * as timeEntriesRepo from "../repositories/timeEntries";
import { HTTPException } from "hono/http-exception";
import { paginationParams, paginatedResponse, nowISO } from "../lib/pagination";
import type { Context } from "hono";
import type { Env } from "../lib/env";

export const createTimeEntrySchema = z.object({
  duration_seconds: z.number().int().positive(),
  description: z.string().optional(),
  started_at: z.string().optional(),
  ended_at: z.string().optional().nullable(),
  // Agent telemetry (optional; humans omit). Tokens must be non-negative ints.
  source: z.enum(["human", "agent"]).optional(),
  agent_name: z.string().max(200).optional(),
  model: z.string().max(200).optional(),
  input_tokens: z.number().int().nonnegative().optional(),
  output_tokens: z.number().int().nonnegative().optional(),
  cache_read_tokens: z.number().int().nonnegative().optional(),
  cache_write_tokens: z.number().int().nonnegative().optional(),
  reasoning_tokens: z.number().int().nonnegative().optional(),
});

type IssueRef = { id: string; workspaceId: string };

export async function create(
  db: DbClient,
  issue: IssueRef,
  userId: string,
  data: z.infer<typeof createTimeEntrySchema>,
) {
  const parsed = createTimeEntrySchema.parse(data);
  return timeEntriesRepo.create(db, {
    issueId: issue.id,
    workspaceId: issue.workspaceId,
    userId,
    durationSeconds: parsed.duration_seconds,
    description: parsed.description,
    startedAt: parsed.started_at ?? nowISO(),
    endedAt: parsed.ended_at ?? null,
    source: parsed.source ?? "human",
    agentName: parsed.agent_name ?? null,
    model: parsed.model ?? null,
    inputTokens: parsed.input_tokens ?? null,
    outputTokens: parsed.output_tokens ?? null,
    cacheReadTokens: parsed.cache_read_tokens ?? null,
    cacheWriteTokens: parsed.cache_write_tokens ?? null,
    reasoningTokens: parsed.reasoning_tokens ?? null,
  });
}

export async function list(db: DbClient, issue: IssueRef, c: Context<{ Bindings: Env }>) {
  const { offset, limit } = paginationParams(c);
  const { entries, total } = await timeEntriesRepo.listByIssue(db, issue.id, offset, limit);
  const totalSeconds = await timeEntriesRepo.totalForIssue(db, issue.id);
  return {
    ...paginatedResponse(entries, total, offset, limit),
    total_seconds: totalSeconds,
  };
}

export async function remove(db: DbClient, issue: IssueRef, entryId: string) {
  const existing = await timeEntriesRepo.findById(db, entryId);
  if (!existing || existing.deletedAt)
    throw new HTTPException(404, { message: "Time entry not found" });
  await timeEntriesRepo.softDeleteForIssue(db, entryId, issue.id);
}
