import { z } from "zod";
import type { DbClient } from "../db/index";
import * as cyclesRepo from "../repositories/cycles";
import { HTTPException } from "hono/http-exception";
import { paginationParams, paginatedResponse } from "../lib/pagination";
import type { Context } from "hono";
import type { Env } from "../lib/env";

export const createCycleSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
});

export const updateCycleSchema = createCycleSchema.partial();

export const addIssueSchema = z.object({
  issue_id: z.string().uuid(),
});

export async function create(
  db: DbClient,
  data: z.infer<typeof createCycleSchema>,
  projectId: string,
  workspaceId: string,
  userId: string,
) {
  const parsed = createCycleSchema.parse(data);
  const cycle = await cyclesRepo.create(db, {
    name: parsed.name,
    description: parsed.description,
    startDate: parsed.start_date,
    endDate: parsed.end_date,
    projectId,
    workspaceId,
    ownedById: userId,
  });
  return cycle;
}

export async function getById(db: DbClient, id: string) {
  const cycle = await cyclesRepo.findById(db, id);
  if (!cycle) throw new HTTPException(404, { message: "Cycle not found" });
  return cycle;
}

export async function list(db: DbClient, projectId: string, c: Context<{ Bindings: Env }>) {
  const { offset, limit } = paginationParams(c);
  const { cycles, total } = await cyclesRepo.listByProject(db, projectId, offset, limit);
  return paginatedResponse(cycles, total, offset, limit);
}

// workspaceId is the caller's workspace (route guard). A cycle in another
// workspace is indistinguishable from a missing one → 404, never a leaky 200.
export async function update(
  db: DbClient,
  id: string,
  workspaceId: string,
  data: z.infer<typeof updateCycleSchema>,
) {
  const existing = await cyclesRepo.findById(db, id);
  if (!existing || existing.workspaceId !== workspaceId) {
    throw new HTTPException(404, { message: "Cycle not found" });
  }
  const parsed = updateCycleSchema.parse(data);
  return cyclesRepo.update(db, id, workspaceId, {
    name: parsed.name,
    description: parsed.description,
    startDate: parsed.start_date,
    endDate: parsed.end_date,
  });
}

export async function remove(db: DbClient, id: string, workspaceId: string) {
  const existing = await cyclesRepo.findById(db, id);
  if (!existing || existing.workspaceId !== workspaceId) {
    throw new HTTPException(404, { message: "Cycle not found" });
  }
  await cyclesRepo.softDelete(db, id, workspaceId);
}

export async function addIssue(
  db: DbClient,
  cycleId: string,
  workspaceId: string,
  data: z.infer<typeof addIssueSchema>,
) {
  const parsed = addIssueSchema.parse(data);
  const cycle = await cyclesRepo.findById(db, cycleId);
  if (!cycle || cycle.workspaceId !== workspaceId) {
    throw new HTTPException(404, { message: "Cycle not found" });
  }
  await cyclesRepo.addIssue(db, cycleId, parsed.issue_id);
}

export async function removeIssue(
  db: DbClient,
  cycleId: string,
  workspaceId: string,
  issueId: string,
) {
  const cycle = await cyclesRepo.findById(db, cycleId);
  if (!cycle || cycle.workspaceId !== workspaceId) {
    throw new HTTPException(404, { message: "Cycle not found" });
  }
  await cyclesRepo.removeIssue(db, cycleId, issueId);
}
