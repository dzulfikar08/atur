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
const DEFAULT_STATES: StageSeed[] = [
  { name: "Backlog", group: "backlog", color: "#9CA3AF", key: "backlog" },
  { name: "Todo", group: "started", color: "#3B82F6", key: "todo", isDefault: true },
  { name: "In Progress", group: "started", color: "#F59E0B", key: "in_progress" },
  { name: "Done", group: "completed", color: "#22C55E", key: "done" },
  { name: "Cancelled", group: "cancelled", color: "#EF4444", key: "cancelled" },
];

// Canonical sales funnel for CRM pipelines (is_pipeline=1). "Lead" is the
// default so new deals enter at the top of the funnel; Won/Lost map to the
// terminal groups (completed/cancelled) the deal board dims and collapses.
export const SALES_STAGES: StageSeed[] = [
  { name: "Lead", group: "backlog", color: "#9CA3AF", key: "backlog", isDefault: true },
  { name: "Qualified", group: "started", color: "#3B82F6", key: "in_progress" },
  { name: "Proposal", group: "started", color: "#8B5CF6", key: "in_progress" },
  { name: "Negotiation", group: "started", color: "#F59E0B", key: "in_progress" },
  { name: "Won", group: "completed", color: "#22C55E", key: "done" },
  { name: "Lost", group: "cancelled", color: "#EF4444", key: "cancelled" },
];

export type StateKey =
  | "backlog"
  | "todo"
  | "in_progress"
  | "needs_you"
  | "need_review"
  | "done"
  | "cancelled";

type StageSeed = {
  name: string;
  group: string;
  color: string;
  key?: StateKey;
  isDefault?: boolean;
};

// Canonical key for a state: the stable cross-project identity behind
// `?state_key=` filters (ATUR-3). Known names win (so renamed-but-familiar
// states stay canonical); everything else derives from the group, which keeps
// every state reachable from canonical filters. Names match
// case-insensitively and include the localized aliases already in the
// portfolio (intip's "Jalan", WLB DEV's "Need Confirmation", family's
// "Selesai"/"Gagal"). Custom names under a standard group collapse into the
// group's key; only a truly unknown group yields null.
const NAME_TO_KEY: Record<string, StateKey> = {
  backlog: "backlog",
  todo: "todo",
  "in progress": "in_progress",
  jalan: "in_progress",
  "needs you": "needs_you",
  "need confirmation": "needs_you",
  "need review": "need_review",
  done: "done",
  selesai: "done",
  cancelled: "cancelled",
  gagal: "cancelled",
};

export function canonicalStateKey(name: string, group: string): StateKey | null {
  const byName = NAME_TO_KEY[name.trim().toLowerCase()];
  if (byName) return byName;
  switch (group) {
    case "backlog":
      return "backlog";
    case "started":
      return "in_progress";
    case "completed":
      return "done";
    case "cancelled":
      return "cancelled";
    default:
      return null;
  }
}

// Not transactional (D1 has no interactive transactions): a crash mid-seed
// leaves a partial workflow that the lazy list() branch won't retry (rows > 0).
async function seedStates(
  db: DbClient,
  projectId: string,
  stages: StageSeed[],
): Promise<string | null> {
  const project = await projectRepo.findById(db, projectId);
  if (!project) return null;
  const now = nowISO();
  let defaultId: string | null = null;
  for (let i = 0; i < stages.length; i++) {
    const s = stages[i];
    const id = uuid();
    if (s.isDefault) defaultId = id;
    await db.insert(schema.states).values({
      id,
      name: s.name,
      color: s.color,
      groupName: s.group,
      key: s.key ?? canonicalStateKey(s.name, s.group),
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

export async function seedDefaultStates(db: DbClient, projectId: string): Promise<string | null> {
  return seedStates(db, projectId, DEFAULT_STATES);
}

export async function seedSalesStates(db: DbClient, projectId: string): Promise<string | null> {
  return seedStates(db, projectId, SALES_STAGES);
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
    key: canonicalStateKey(data.name, data.group),
    description: data.description,
    slug: data.slug,
    projectId,
    workspaceId,
  });
}

// workspaceId is the caller's workspace (route guard). A state in another
// workspace is indistinguishable from a missing one → 404, never a leaky 200.
export async function getById(db: DbClient, id: string, workspaceId: string) {
  const state = await statesRepo.findById(db, id);
  if (!state || state.workspaceId !== workspaceId) {
    throw new HTTPException(404, { message: "State not found" });
  }
  return state;
}

export async function list(db: DbClient, projectId: string) {
  let rows = await statesRepo.listByProject(db, projectId);
  // UI-created projects start with no states; seed a default workflow on first
  // fetch so the State dropdown isn't empty and new issues get a default state.
  if (rows.length === 0) {
    // Pipelines get the sales funnel; everything else the Plane-style workflow.
    const project = await projectRepo.findById(db, projectId);
    if (project?.isPipeline) await seedSalesStates(db, projectId);
    else await seedDefaultStates(db, projectId);
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

// workspaceId is the caller's workspace (route guard). A state in another
// workspace is indistinguishable from a missing one → 404, never a leaky 200.
export async function update(
  db: DbClient,
  id: string,
  workspaceId: string,
  data: z.infer<typeof updateStateSchema>,
) {
  const existing = await statesRepo.findById(db, id);
  if (!existing || existing.workspaceId !== workspaceId) {
    throw new HTTPException(404, { message: "State not found" });
  }
  const updateData: Record<string, unknown> = { ...data };
  if (data.group_name !== undefined) updateData.groupName = data.group_name;
  delete updateData.group_name;
  // Key is derived, never user-authored: recompute whenever name or group moves.
  if (updateData.name !== undefined || updateData.groupName !== undefined) {
    updateData.key = canonicalStateKey(
      (updateData.name as string) ?? existing.name,
      (updateData.groupName as string) ?? existing.group,
    );
  }
  return statesRepo.update(db, id, workspaceId, updateData);
}

export async function remove(db: DbClient, id: string, workspaceId: string) {
  const existing = await statesRepo.findById(db, id);
  if (!existing || existing.workspaceId !== workspaceId) {
    throw new HTTPException(404, { message: "State not found" });
  }
  await statesRepo.remove(db, id, workspaceId);
}
