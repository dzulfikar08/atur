import { z } from "zod";
import type { DbClient } from "../db/index";
import * as sprintsRepo from "../repositories/sprints";
import { HTTPException } from "hono/http-exception";
import { paginationParams, paginatedResponse } from "../lib/pagination";
import type { Context } from "hono";
import type { Env } from "../lib/env";

export const createSprintSchema = z.object({
  name: z.string().min(1),
  start_date: z.string(),
  end_date: z.string(),
  description: z.string().optional(),
});

export const updateSprintSchema = createSprintSchema.partial();

export const addIssueSchema = z.object({
  issue_id: z.string().uuid(),
});

export async function create(
  db: DbClient,
  data: z.infer<typeof createSprintSchema>,
  projectId: string,
  workspaceId: string,
  userId: string,
) {
  const parsed = createSprintSchema.parse(data);
  const sprint = await sprintsRepo.create(db, {
    name: parsed.name,
    description: parsed.description,
    startDate: parsed.start_date,
    endDate: parsed.end_date,
    projectId,
    workspaceId,
    ownedById: userId,
  });
  return sprint;
}

export async function getById(db: DbClient, id: string) {
  const sprint = await sprintsRepo.findById(db, id);
  if (!sprint) throw new HTTPException(404, { message: "Sprint not found" });
  return sprint;
}

export async function list(db: DbClient, projectId: string, c: Context<{ Bindings: Env }>) {
  const { offset, limit } = paginationParams(c);
  const { sprints, total } = await sprintsRepo.listByProject(db, projectId, offset, limit);
  return paginatedResponse(sprints, total, offset, limit);
}

export async function update(db: DbClient, id: string, data: z.infer<typeof updateSprintSchema>) {
  const existing = await sprintsRepo.findById(db, id);
  if (!existing) throw new HTTPException(404, { message: "Sprint not found" });
  const parsed = updateSprintSchema.parse(data);
  return sprintsRepo.update(db, id, {
    name: parsed.name,
    description: parsed.description,
    startDate: parsed.start_date,
    endDate: parsed.end_date,
  });
}

export async function remove(db: DbClient, id: string) {
  const existing = await sprintsRepo.findById(db, id);
  if (!existing) throw new HTTPException(404, { message: "Sprint not found" });
  await sprintsRepo.softDelete(db, id);
}

export async function addIssue(
  db: DbClient,
  sprintId: string,
  data: z.infer<typeof addIssueSchema>,
) {
  const parsed = addIssueSchema.parse(data);
  const sprint = await sprintsRepo.findById(db, sprintId);
  if (!sprint) throw new HTTPException(404, { message: "Sprint not found" });
  await sprintsRepo.addIssue(db, sprintId, parsed.issue_id);
}

export async function removeIssue(db: DbClient, sprintId: string, issueId: string) {
  const sprint = await sprintsRepo.findById(db, sprintId);
  if (!sprint) throw new HTTPException(404, { message: "Sprint not found" });
  await sprintsRepo.removeIssue(db, sprintId, issueId);
}
