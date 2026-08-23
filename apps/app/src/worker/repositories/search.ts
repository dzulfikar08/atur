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

// Workspaces a user may see in an unscoped search: owned, or an active
// (non-deleted) membership row. Mirrors the MCP list_workspaces scoping.
export async function listWorkspaceIdsForUser(db: DbClient, userId: string) {
  const [memberRows, ownedRows] = await Promise.all([
    db
      .select({ id: schema.workspaceMembers.workspaceId })
      .from(schema.workspaceMembers)
      .where(
        and(
          eq(schema.workspaceMembers.memberId, userId),
          eq(schema.workspaceMembers.isActive, 1),
          isNull(schema.workspaceMembers.deletedAt),
        ),
      ),
    db
      .select({ id: schema.workspaces.id })
      .from(schema.workspaces)
      .where(and(eq(schema.workspaces.ownerId, userId), isNull(schema.workspaces.deletedAt))),
  ]);
  return [...new Set([...memberRows.map((r) => r.id), ...ownedRows.map((r) => r.id)])];
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
  }
  if (params.workspaceIds) {
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
  }
  if (params.workspaceIds) {
    conditions.push(inArray(schema.projects.workspaceId, params.workspaceIds));
  }
  return db
    .select()
    .from(schema.projects)
    .where(and(...conditions))
    .limit(params.limit);
}
