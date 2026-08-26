import { z } from "zod";
import type { DbClient } from "../db/index";
import { and, eq, inArray, isNull } from "drizzle-orm";
import * as schema from "../db/schema";
import * as workspaceRepo from "../repositories/workspaces";
import * as projectRepo from "../repositories/projects";
import { HTTPException } from "hono/http-exception";
import * as statesService from "./states";

export const createProjectSchema = z.object({
  name: z.string().min(1).max(255),
  identifier: z
    .string()
    .min(1)
    .max(12)
    .regex(/^[A-Z0-9]+$/)
    .optional(),
  description: z.string().nullable().optional(),
  descriptionHtml: z.string().nullable().optional(),
  emoji: z.string().nullable().optional(),
  coverImage: z.string().nullable().optional(),
  network: z.number().int().optional().default(0),
  timezone: z.string().optional().default("UTC"),
  projectLeadId: z.string().nullable().optional(),
  defaultAssigneeId: z.string().nullable().optional(),
  isPipeline: z.boolean().optional().default(false),
});

export const updateProjectSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().nullable().optional(),
  descriptionHtml: z.string().nullable().optional(),
  emoji: z.string().nullable().optional(),
  coverImage: z.string().nullable().optional(),
  network: z.number().int().optional(),
  timezone: z.string().optional(),
  projectLeadId: z.string().nullable().optional(),
  defaultAssigneeId: z.string().nullable().optional(),
  defaultStateId: z.string().nullable().optional(),
  // ClickUp-style folder grouping (DEV-27). null clears the folder.
  folderId: z.string().uuid().nullable().optional(),
  isPipeline: z.boolean().optional(),
});

export const addMemberSchema = z.object({
  memberId: z.string().uuid(),
  role: z.number().int().optional().default(15),
});

// Derive a project identifier (uppercase alnum, <=12 chars) from the name for
// callers that only send a name (e.g. the CRM pipeline dialog).
function deriveIdentifier(name: string): string {
  return (
    name
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 12) || "PIPE"
  );
}

// Config-id binding (DEV-21): defaultStateId must resolve in the project's
// workspace (alive), and lead/assignee ids must be the workspace owner or an
// active member — project config is consumed by every issue created in the
// project, so a foreign id would leak into all of them.
async function assertProjectIdsInWorkspace(
  db: DbClient,
  workspaceId: string,
  ids: { stateId?: string | null; userIds?: (string | null | undefined)[] },
) {
  if (ids.stateId) {
    const [st] = await db
      .select({ id: schema.states.id })
      .from(schema.states)
      .where(
        and(
          eq(schema.states.id, ids.stateId),
          eq(schema.states.workspaceId, workspaceId),
          isNull(schema.states.deletedAt),
        ),
      )
      .limit(1);
    if (!st) throw new HTTPException(404, { message: "State not found" });
  }
  const users = [...new Set((ids.userIds ?? []).filter((u): u is string => !!u))];
  if (users.length === 0) return;
  const [ws] = await db
    .select({ ownerId: schema.workspaces.ownerId })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId))
    .limit(1);
  if (!ws) throw new HTTPException(404, { message: "Workspace not found" });
  const rows = await db
    .select({ id: schema.workspaceMembers.memberId })
    .from(schema.workspaceMembers)
    .where(
      and(
        eq(schema.workspaceMembers.workspaceId, workspaceId),
        inArray(schema.workspaceMembers.memberId, users),
        eq(schema.workspaceMembers.isActive, 1),
        isNull(schema.workspaceMembers.deletedAt),
      ),
    );
  const ok = new Set([...rows.map((r) => r.id), ws.ownerId]);
  if (users.some((u) => !ok.has(u))) {
    throw new HTTPException(404, { message: "Assignee not found" });
  }
}

export async function create(
  db: DbClient,
  workspaceSlug: string,
  data: z.infer<typeof createProjectSchema>,
) {
  const workspace = await workspaceRepo.findBySlug(db, workspaceSlug);
  if (!workspace) throw new HTTPException(404, { message: "Workspace not found" });
  let identifier = data.identifier;
  if (!identifier) {
    const base = deriveIdentifier(data.name);
    identifier = base;
    // Keep <=12 chars while suffixing 2..99 on collisions with the unique
    // (identifier, workspace_id) constraint.
    for (
      let n = 2;
      n <= 99 && (await projectRepo.identifierExists(db, workspace.id, identifier));
      n++
    ) {
      identifier = `${base.slice(0, 10)}${n}`;
    }
    // Loop exit can leave the final candidate unchecked (suffix 99) — when
    // every candidate collides, fail with 409 instead of a UNIQUE 500.
    if (await projectRepo.identifierExists(db, workspace.id, identifier))
      throw new HTTPException(409, { message: "Could not derive a unique identifier" });
  }
  await assertProjectIdsInWorkspace(db, workspace.id, {
    userIds: [data.projectLeadId, data.defaultAssigneeId],
  });
  const project = await projectRepo.create(db, {
    ...data,
    identifier,
    workspaceId: workspace.id,
    isPipeline: data.isPipeline ? 1 : 0,
  });
  // New pipelines start with the canonical sales funnel; flagging an existing
  // project later (update) never reseeds its states.
  if (data.isPipeline && project) await statesService.seedSalesStates(db, project.id);
  return project;
}

export async function getById(db: DbClient, workspaceSlug: string, projectId: string) {
  const workspace = await workspaceRepo.findBySlug(db, workspaceSlug);
  if (!workspace) throw new HTTPException(404, { message: "Workspace not found" });
  const project = await projectRepo.findById(db, projectId);
  if (!project || project.workspaceId !== workspace.id)
    throw new HTTPException(404, { message: "Project not found" });
  return project;
}

export async function listByWorkspace(
  db: DbClient,
  workspaceSlug: string,
  offset: number,
  limit: number,
  opts?: { isPipeline?: boolean },
) {
  const workspace = await workspaceRepo.findBySlug(db, workspaceSlug);
  if (!workspace) throw new HTTPException(404, { message: "Workspace not found" });
  return projectRepo.listByWorkspace(db, workspace.id, offset, limit, opts);
}

export async function update(
  db: DbClient,
  workspaceSlug: string,
  projectId: string,
  data: z.infer<typeof updateProjectSchema>,
) {
  const workspace = await workspaceRepo.findBySlug(db, workspaceSlug);
  if (!workspace) throw new HTTPException(404, { message: "Workspace not found" });
  const project = await projectRepo.findById(db, projectId);
  if (!project || project.workspaceId !== workspace.id)
    throw new HTTPException(404, { message: "Project not found" });
  await assertProjectIdsInWorkspace(db, workspace.id, {
    stateId: data.defaultStateId,
    userIds: [data.projectLeadId, data.defaultAssigneeId],
  });
  // Folder must live in the project's workspace — same binding rule as
  // states/assignees above (a foreign folder id would leak grouping names).
  if (data.folderId) {
    const [folder] = await db
      .select({ id: schema.projectFolders.id })
      .from(schema.projectFolders)
      .where(
        and(
          eq(schema.projectFolders.id, data.folderId),
          eq(schema.projectFolders.workspaceId, workspace.id),
          isNull(schema.projectFolders.deletedAt),
        ),
      )
      .limit(1);
    if (!folder) throw new HTTPException(404, { message: "Folder not found" });
  }
  // Boolean → 0/1 int for the sqlite column; never reseeds states — flagging an
  // existing project must not touch its workflow.
  const { isPipeline, ...rest } = data;
  return projectRepo.update(db, projectId, {
    ...rest,
    ...(isPipeline !== undefined ? { isPipeline: isPipeline ? 1 : 0 } : {}),
  });
}

export async function remove(db: DbClient, workspaceSlug: string, projectId: string) {
  const workspace = await workspaceRepo.findBySlug(db, workspaceSlug);
  if (!workspace) throw new HTTPException(404, { message: "Workspace not found" });
  const project = await projectRepo.findById(db, projectId);
  if (!project || project.workspaceId !== workspace.id)
    throw new HTTPException(404, { message: "Project not found" });
  await projectRepo.softDelete(db, projectId);
}

export async function addMember(
  db: DbClient,
  workspaceSlug: string,
  projectId: string,
  data: z.infer<typeof addMemberSchema>,
) {
  const workspace = await workspaceRepo.findBySlug(db, workspaceSlug);
  if (!workspace) throw new HTTPException(404, { message: "Workspace not found" });
  const project = await projectRepo.findById(db, projectId);
  if (!project || project.workspaceId !== workspace.id)
    throw new HTTPException(404, { message: "Project not found" });
  return projectRepo.addMember(db, { ...data, projectId, workspaceId: workspace.id });
}

export async function removeMember(
  db: DbClient,
  workspaceSlug: string,
  projectId: string,
  memberId: string,
) {
  const workspace = await workspaceRepo.findBySlug(db, workspaceSlug);
  if (!workspace) throw new HTTPException(404, { message: "Workspace not found" });
  const project = await projectRepo.findById(db, projectId);
  if (!project || project.workspaceId !== workspace.id)
    throw new HTTPException(404, { message: "Project not found" });
  const removed = await projectRepo.removeMember(db, project.id, memberId);
  if (!removed) throw new HTTPException(404, { message: "Member not found" });
}

export async function listMembers(db: DbClient, workspaceSlug: string, projectId: string) {
  const workspace = await workspaceRepo.findBySlug(db, workspaceSlug);
  if (!workspace) throw new HTTPException(404, { message: "Workspace not found" });
  const project = await projectRepo.findById(db, projectId);
  if (!project || project.workspaceId !== workspace.id)
    throw new HTTPException(404, { message: "Project not found" });
  return projectRepo.listMembers(db, projectId);
}
