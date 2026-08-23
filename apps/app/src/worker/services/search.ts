import type { DbClient } from "../db/index";
import * as searchRepo from "../repositories/search";

// `workspace` is a slug; resolve to id. A workspace-less search scopes to the
// caller's accessible workspaces (owner + active member) — never all
// workspaces. Returns {issues, projects} to match the frontend SearchResult
// contract.
export async function search(
  db: DbClient,
  query: string,
  workspace: string | undefined,
  project: string | undefined,
  limit: number,
  userId: string,
) {
  let workspaceId: string | undefined;
  let workspaceIds: string[] | undefined;
  if (workspace) {
    const id = await searchRepo.findWorkspaceIdBySlug(db, workspace);
    workspaceId = id ?? undefined;
  } else {
    workspaceIds = await searchRepo.findAccessibleWorkspaceIds(db, userId);
    // A caller with no accessible workspaces gets empty results — the repo's
    // `else if (workspaceIds?.length)` would otherwise drop the filter
    // entirely and fall back to a GLOBAL search.
    if (workspaceIds.length === 0) return { issues: [], projects: [] };
  }
  const [issues, projects] = await Promise.all([
    searchRepo.searchIssues(db, { query, workspaceId, workspaceIds, projectId: project, limit }),
    searchRepo.searchProjects(db, { query, workspaceId, workspaceIds, limit }),
  ]);
  return { issues, projects };
}
