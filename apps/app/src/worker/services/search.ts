import type { DbClient } from "../db/index";
import * as searchRepo from "../repositories/search";

// `workspace` is a slug; resolve to id. Returns {issues, projects} to match the
// frontend SearchResult contract. Without a workspace the search is bounded to
// the caller: userId restricts results to workspaces they own or are an
// active member of — never every workspace on the instance.
export async function search(
  db: DbClient,
  query: string,
  workspace?: string,
  project?: string,
  limit = 50,
  userId?: string,
) {
  let workspaceId: string | undefined;
  if (workspace) {
    const id = await searchRepo.findWorkspaceIdBySlug(db, workspace);
    workspaceId = id ?? undefined;
  }
  let workspaceIds: string[] | undefined;
  if (!workspaceId && userId) {
    workspaceIds = await searchRepo.listWorkspaceIdsForUser(db, userId);
    if (workspaceIds.length === 0) return { issues: [], projects: [] };
  }
  const [issues, projects] = await Promise.all([
    searchRepo.searchIssues(db, { query, workspaceId, workspaceIds, projectId: project, limit }),
    searchRepo.searchProjects(db, { query, workspaceId, workspaceIds, limit }),
  ]);
  return { issues, projects };
}
