import { z } from 'zod'
import type { DbClient } from '../db/index'
import * as workspaceRepo from '../repositories/workspaces'
import * as projectRepo from '../repositories/projects'
import { HTTPException } from 'hono/http-exception'

export const createProjectSchema = z.object({
  name: z.string().min(1).max(255),
  identifier: z.string().min(1).max(12).regex(/^[A-Z0-9]+$/),
  description: z.string().nullable().optional(),
  descriptionHtml: z.string().nullable().optional(),
  emoji: z.string().nullable().optional(),
  coverImage: z.string().nullable().optional(),
  network: z.number().int().optional().default(0),
  timezone: z.string().optional().default('UTC'),
  projectLeadId: z.string().nullable().optional(),
  defaultAssigneeId: z.string().nullable().optional(),
})

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
})

export const addMemberSchema = z.object({
  memberId: z.string().uuid(),
  role: z.number().int().optional().default(15),
})

export async function create(db: DbClient, workspaceSlug: string, data: z.infer<typeof createProjectSchema>) {
  const workspace = await workspaceRepo.findBySlug(db, workspaceSlug)
  if (!workspace) throw new HTTPException(404, { message: 'Workspace not found' })
  return projectRepo.create(db, { ...data, workspaceId: workspace.id })
}

export async function getById(db: DbClient, workspaceSlug: string, projectId: string) {
  const workspace = await workspaceRepo.findBySlug(db, workspaceSlug)
  if (!workspace) throw new HTTPException(404, { message: 'Workspace not found' })
  const project = await projectRepo.findById(db, projectId)
  if (!project || project.workspaceId !== workspace.id) throw new HTTPException(404, { message: 'Project not found' })
  return project
}

export async function listByWorkspace(db: DbClient, workspaceSlug: string, offset: number, limit: number) {
  const workspace = await workspaceRepo.findBySlug(db, workspaceSlug)
  if (!workspace) throw new HTTPException(404, { message: 'Workspace not found' })
  return projectRepo.listByWorkspace(db, workspace.id, offset, limit)
}

export async function update(db: DbClient, workspaceSlug: string, projectId: string, data: z.infer<typeof updateProjectSchema>) {
  const workspace = await workspaceRepo.findBySlug(db, workspaceSlug)
  if (!workspace) throw new HTTPException(404, { message: 'Workspace not found' })
  const project = await projectRepo.findById(db, projectId)
  if (!project || project.workspaceId !== workspace.id) throw new HTTPException(404, { message: 'Project not found' })
  return projectRepo.update(db, projectId, data)
}

export async function remove(db: DbClient, workspaceSlug: string, projectId: string) {
  const workspace = await workspaceRepo.findBySlug(db, workspaceSlug)
  if (!workspace) throw new HTTPException(404, { message: 'Workspace not found' })
  const project = await projectRepo.findById(db, projectId)
  if (!project || project.workspaceId !== workspace.id) throw new HTTPException(404, { message: 'Project not found' })
  await projectRepo.softDelete(db, projectId)
}

export async function addMember(db: DbClient, workspaceSlug: string, projectId: string, data: z.infer<typeof addMemberSchema>) {
  const workspace = await workspaceRepo.findBySlug(db, workspaceSlug)
  if (!workspace) throw new HTTPException(404, { message: 'Workspace not found' })
  const project = await projectRepo.findById(db, projectId)
  if (!project || project.workspaceId !== workspace.id) throw new HTTPException(404, { message: 'Project not found' })
  return projectRepo.addMember(db, { ...data, projectId, workspaceId: workspace.id })
}

export async function removeMember(db: DbClient, workspaceSlug: string, projectId: string, memberId: string) {
  const workspace = await workspaceRepo.findBySlug(db, workspaceSlug)
  if (!workspace) throw new HTTPException(404, { message: 'Workspace not found' })
  const project = await projectRepo.findById(db, projectId)
  if (!project || project.workspaceId !== workspace.id) throw new HTTPException(404, { message: 'Project not found' })
  await projectRepo.removeMember(db, memberId)
}

export async function listMembers(db: DbClient, workspaceSlug: string, projectId: string) {
  const workspace = await workspaceRepo.findBySlug(db, workspaceSlug)
  if (!workspace) throw new HTTPException(404, { message: 'Workspace not found' })
  const project = await projectRepo.findById(db, projectId)
  if (!project || project.workspaceId !== workspace.id) throw new HTTPException(404, { message: 'Project not found' })
  return projectRepo.listMembers(db, projectId)
}
