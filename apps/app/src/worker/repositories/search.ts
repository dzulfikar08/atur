import type { DbClient } from "../db/index";
import * as schema from "../db/schema";
import { eq, and, or, like, isNull } from "drizzle-orm";

export async function findWorkspaceIdBySlug(db: DbClient, slug: string) {
  const [row] = await db
    .select({ id: schema.workspaces.id })
    .from(schema.workspaces)
    .where(and(eq(schema.workspaces.slug, slug), isNull(schema.workspaces.deletedAt)))
    .limit(1);
  return row?.id ?? null;
}

export async function searchIssues(
  db: DbClient,
  params: {
    query: string;
    workspaceId?: string;
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
  return db
    .select()
    .from(schema.projects)
    .where(and(...conditions))
    .limit(params.limit);
}
