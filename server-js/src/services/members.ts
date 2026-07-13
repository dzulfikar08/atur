import type { DbClient } from '../db/index'
import * as membersRepo from '../repositories/members'
import { HTTPException } from 'hono/http-exception'

export async function addWorkspaceMember(db: DbClient, workspaceId: string, memberId: string, role?: number) {
  return membersRepo.addWorkspaceMember(db, workspaceId, memberId, role)
}

export async function removeWorkspaceMember(db: DbClient, id: string) {
  await membersRepo.removeWorkspaceMember(db, id)
}

export async function listWorkspaceMembers(db: DbClient, workspaceId: string) {
  return { results: await membersRepo.listByWorkspace(db, workspaceId) }
}

export async function addProjectMember(db: DbClient, projectId: string, workspaceId: string, memberId: string, role?: number) {
  return membersRepo.addProjectMember(db, projectId, workspaceId, memberId, role)
}

export async function removeProjectMember(db: DbClient, id: string) {
  await membersRepo.removeProjectMember(db, id)
}

export async function listProjectMembers(db: DbClient, projectId: string) {
  return { results: await membersRepo.listByProject(db, projectId) }
}
