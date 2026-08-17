import type { DbClient } from "../db/index";
import * as searchRepo from "../repositories/search";

// `workspace` is a slug; resolve to id. Returns {issues, projects} to match the
// frontend SearchResult contract.
export async function search(
  db: DbClient,
  query: string,
  workspace?: string,
  project?: string,
  limit = 50,
) {
  let workspaceId: string | undefined;
  if (workspace) {
    const id = await searchRepo.findWorkspaceIdBySlug(db, workspace);
    workspaceId = id ?? undefined;
  }
  const [issues, projects] = await Promise.all([
    searchRepo.searchIssues(db, { query, workspaceId, projectId: project, limit }),
    searchRepo.searchProjects(db, { query, workspaceId, limit }),
  ]);
  return { issues, projects };
}
