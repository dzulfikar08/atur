import type { DbClient } from "../db/index";
import * as schema from "../db/schema";
import { eq, and, or, like, isNull, inArray } from "drizzle-orm";

export async function findWorkspaceIdBySlug(db: DbClient, slug: string) {
  const [row] = await db
    .select({ id: schema.workspaces.id })
    .from(schema.workspaces)
    .where(and(eq(schema.workspaces.slug, slug), isNull(schema.workspaces.deletedAt)))
    .limit(1);
  return row?.id ?? null;
}

// Workspace ids the user can access: workspaces they own, or where they are an
// active, non-deleted member. Mirrors the MCP list_workspaces filter — the
// scope for a workspace-agnostic search so it never returns rows from
// workspaces the caller doesn't belong to.
export async function findAccessibleWorkspaceIds(db: DbClient, userId: string) {
  const memberRows = await db
    .select({ workspaceId: schema.workspaceMembers.workspaceId })
    .from(schema.workspaceMembers)
    .where(
      and(
        eq(schema.workspaceMembers.memberId, userId),
        eq(schema.workspaceMembers.isActive, 1),
        isNull(schema.workspaceMembers.deletedAt),
      ),
    );
  const memberWsIds = memberRows.map((r) => r.workspaceId);
  const ownerRows = await db
    .select({ id: schema.workspaces.id })
    .from(schema.workspaces)
    .where(and(eq(schema.workspaces.ownerId, userId), isNull(schema.workspaces.deletedAt)));
  const ownerIds = ownerRows.map((r) => r.id);
  return memberWsIds.length || ownerIds.length ? [...new Set([...memberWsIds, ...ownerIds])] : [];
}

export async function searchIssues(
  db: DbClient,
  params: {
    query: string;
    workspaceId?: string;
    workspaceIds?: string[];
    projectId?: string;
    limit: number;
  },
) {
  const searchPattern = `%${params.query}%`;
  const conditions = [
    isNull(schema.issues.deletedAt),
    or(
      like(schema.issues.name, searchPattern),
      like(schema.issues.descriptionStripped, searchPattern),
    ),
  ];
  if (params.workspaceId) {
    conditions.push(eq(schema.issues.workspaceId, params.workspaceId));
  } else if (params.workspaceIds?.length) {
    conditions.push(inArray(schema.issues.workspaceId, params.workspaceIds));
  }
  if (params.projectId) {
    conditions.push(eq(schema.issues.projectId, params.projectId));
  }
  return db
    .select()
    .from(schema.issues)
    .where(and(...conditions))
    .limit(params.limit);
}

export async function searchProjects(
  db: DbClient,
  params: {
    query: string;
    workspaceId?: string;
    workspaceIds?: string[];
    limit: number;
  },
) {
  const searchPattern = `%${params.query}%`;
  const conditions = [
    isNull(schema.projects.deletedAt),
    or(like(schema.projects.name, searchPattern), like(schema.projects.description, searchPattern)),
  ];
  if (params.workspaceId) {
    conditions.push(eq(schema.projects.workspaceId, params.workspaceId));
  } else if (params.workspaceIds?.length) {
    conditions.push(inArray(schema.projects.workspaceId, params.workspaceIds));
  }
  return db
    .select()
    .from(schema.projects)
    .where(and(...conditions))
    .limit(params.limit);
}
