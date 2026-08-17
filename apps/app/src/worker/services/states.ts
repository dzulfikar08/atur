import { z } from "zod";
import { v4 as uuid } from "uuid";
import { eq, and, isNull } from "drizzle-orm";
import type { DbClient } from "../db/index";
import * as schema from "../db/schema";
import * as statesRepo from "../repositories/states";
import * as projectRepo from "../repositories/projects";
import { nowISO } from "../lib/pagination";
import { HTTPException } from "hono/http-exception";

// Plane-style default workflow. Seeded lazily for any project that has no
// states yet (UI-created projects start stateless). "Todo" is the default so
// new issues land somewhere visible instead of a null state.
const DEFAULT_STATES: { name: string; group: string; color: string; isDefault?: boolean }[] = [
  { name: "Backlog", group: "backlog", color: "#9CA3AF" },
  { name: "Todo", group: "started", color: "#3B82F6", isDefault: true },
  { name: "In Progress", group: "started", color: "#F59E0B" },
  { name: "Done", group: "completed", color: "#22C55E" },
  { name: "Cancelled", group: "cancelled", color: "#EF4444" },
];

export async function seedDefaultStates(db: DbClient, projectId: string): Promise<string | null> {
  const project = await projectRepo.findById(db, projectId);
  if (!project) return null;
  const now = nowISO();
  let defaultId: string | null = null;
  for (let i = 0; i < DEFAULT_STATES.length; i++) {
    const s = DEFAULT_STATES[i];
    const id = uuid();
    if (s.isDefault) defaultId = id;
    await db.insert(schema.states).values({
      id,
      name: s.name,
      color: s.color,
      groupName: s.group,
      sequence: i * 10000,
      isDefault: s.isDefault ? 1 : 0,
      isTriage: 0,
      projectId,
      workspaceId: project.workspaceId,
      createdAt: now,
      updatedAt: now,
    });
  }
  // Point the project at its default state so new issues pick it up.
  if (defaultId && !project.defaultStateId) {
    await db
      .update(schema.projects)
      .set({ defaultStateId: defaultId, updatedAt: now })
      .where(and(eq(schema.projects.id, projectId), isNull(schema.projects.deletedAt)));
  }
  return defaultId;
}

export const createStateSchema = z.object({
  name: z.string().min(1),
  color: z.string().optional(),
  group: z.string().min(1),
  description: z.string().optional(),
  slug: z.string().optional(),
});

export async function create(
  db: DbClient,
  projectId: string,
  workspaceId: string,
  data: z.infer<typeof createStateSchema>,
) {
  return statesRepo.create(db, {
    name: data.name,
    color: data.color || "#808080",
    groupName: data.group,
    description: data.description,
    slug: data.slug,
    projectId,
    workspaceId,
  });
}

export async function getById(db: DbClient, id: string) {
  const state = await statesRepo.findById(db, id);
  if (!state) throw new HTTPException(404, { message: "State not found" });
  return state;
}

export async function list(db: DbClient, projectId: string) {
  let rows = await statesRepo.listByProject(db, projectId);
  // UI-created projects start with no states; seed a default workflow on first
  // fetch so the State dropdown isn't empty and new issues get a default state.
  if (rows.length === 0) {
    await seedDefaultStates(db, projectId);
    rows = await statesRepo.listByProject(db, projectId);
  }
  return { results: rows };
}

export const updateStateSchema = z
  .object({
    name: z.string().min(1).optional(),
    color: z.string().optional(),
    group_name: z.string().min(1).optional(),
    description: z.string().optional(),
    slug: z.string().optional(),
  })
  .partial()
  .refine((d) => Object.keys(d).length > 0, { message: "At least one field required" });

export async function update(db: DbClient, id: string, data: z.infer<typeof updateStateSchema>) {
  const existing = await statesRepo.findById(db, id);
  if (!existing) throw new HTTPException(404, { message: "State not found" });
  const updateData: Record<string, unknown> = { ...data };
  if (data.group_name !== undefined) updateData.groupName = data.group_name;
  delete updateData.group_name;
  return statesRepo.update(db, id, updateData);
}

export async function remove(db: DbClient, id: string) {
  const existing = await statesRepo.findById(db, id);
  if (!existing) throw new HTTPException(404, { message: "State not found" });
  await statesRepo.remove(db, id);
}
