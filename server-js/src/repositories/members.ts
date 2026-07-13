import { eq, and, isNull } from 'drizzle-orm'
import type { DbClient } from '../db/index'
import { workspaceMembers, projectMembers } from '../db/schema'
import { v4 as uuid } from 'uuid'
import { nowISO } from '../lib/pagination'

export async function listByWorkspace(db: DbClient, workspaceId: string) {
  return db.select().from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), isNull(workspaceMembers.deletedAt)))
}

export async function addWorkspaceMember(db: DbClient, workspaceId: string, memberId: string, role: number = 15) {
  const id = uuid()
  const now = nowISO()
  await db.insert(workspaceMembers).values({
    id,
    workspaceId,
    memberId,
    role,
    createdAt: now,
    updatedAt: now,
  })
  const [member] = await db.select().from(workspaceMembers).where(eq(workspaceMembers.id, id)).limit(1)
  return member
}

export async function removeWorkspaceMember(db: DbClient, id: string) {
  await db.update(workspaceMembers).set({ deletedAt: nowISO(), updatedAt: nowISO() }).where(eq(workspaceMembers.id, id))
}

export async function updateRole(db: DbClient, id: string, role: number) {
  await db.update(workspaceMembers).set({ role, updatedAt: nowISO() }).where(eq(workspaceMembers.id, id))
  const [member] = await db.select().from(workspaceMembers).where(eq(workspaceMembers.id, id)).limit(1)
  return member
}

export async function listByProject(db: DbClient, projectId: string) {
  return db.select().from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), isNull(projectMembers.deletedAt)))
}

export async function addProjectMember(db: DbClient, projectId: string, workspaceId: string, memberId: string, role: number = 15) {
  const id = uuid()
  const now = nowISO()
  await db.insert(projectMembers).values({
    id,
    projectId,
    workspaceId,
    memberId,
    role,
    createdAt: now,
    updatedAt: now,
  })
  const [member] = await db.select().from(projectMembers).where(eq(projectMembers.id, id)).limit(1)
  return member
}

export async function removeProjectMember(db: DbClient, id: string) {
  await db.update(projectMembers).set({ deletedAt: nowISO(), updatedAt: nowISO() }).where(eq(projectMembers.id, id))
}
