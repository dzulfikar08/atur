import { z } from "zod";
import type { DbClient } from "../db/index";
import * as modulesRepo from "../repositories/modules";
import { HTTPException } from "hono/http-exception";
import { paginationParams, paginatedResponse } from "../lib/pagination";
import type { Context } from "hono";
import type { Env } from "../lib/env";

export const createModuleSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  status: z.string().optional(),
  start_date: z.string().optional(),
  target_date: z.string().optional(),
  lead_id: z.string().uuid().optional(),
});

export const updateModuleSchema = createModuleSchema.partial();

export const addIssueSchema = z.object({
  issue_id: z.string().uuid(),
});

export async function create(
  db: DbClient,
  data: z.infer<typeof createModuleSchema>,
  projectId: string,
  workspaceId: string,
) {
  const parsed = createModuleSchema.parse(data);
  const mod = await modulesRepo.create(db, {
    name: parsed.name,
    description: parsed.description,
    status: parsed.status,
    startDate: parsed.start_date,
    targetDate: parsed.target_date,
    leadId: parsed.lead_id,
    projectId,
    workspaceId,
  });
  return mod;
}

export async function getById(db: DbClient, id: string) {
  const mod = await modulesRepo.findById(db, id);
  if (!mod) throw new HTTPException(404, { message: "Module not found" });
  return mod;
}

export async function list(db: DbClient, projectId: string, c: Context<{ Bindings: Env }>) {
  const { offset, limit } = paginationParams(c);
  const { modules, total } = await modulesRepo.listByProject(db, projectId, offset, limit);
  return paginatedResponse(modules, total, offset, limit);
}

export async function update(db: DbClient, id: string, data: z.infer<typeof updateModuleSchema>) {
  const existing = await modulesRepo.findById(db, id);
  if (!existing) throw new HTTPException(404, { message: "Module not found" });
  const parsed = updateModuleSchema.parse(data);
  return modulesRepo.update(db, id, {
    name: parsed.name,
    description: parsed.description,
    status: parsed.status,
    startDate: parsed.start_date,
    targetDate: parsed.target_date,
    leadId: parsed.lead_id,
  });
}

export async function remove(db: DbClient, id: string) {
  const existing = await modulesRepo.findById(db, id);
  if (!existing) throw new HTTPException(404, { message: "Module not found" });
  await modulesRepo.softDelete(db, id);
}

export async function addIssue(
  db: DbClient,
  moduleId: string,
  data: z.infer<typeof addIssueSchema>,
) {
  const parsed = addIssueSchema.parse(data);
  const mod = await modulesRepo.findById(db, moduleId);
  if (!mod) throw new HTTPException(404, { message: "Module not found" });
  await modulesRepo.addIssue(db, moduleId, parsed.issue_id);
}

export async function removeIssue(db: DbClient, moduleId: string, issueId: string) {
  const mod = await modulesRepo.findById(db, moduleId);
  if (!mod) throw new HTTPException(404, { message: "Module not found" });
  await modulesRepo.removeIssue(db, moduleId, issueId);
}
