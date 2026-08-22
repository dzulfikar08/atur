import { eq, and, isNull } from "drizzle-orm";
import type { DbClient } from "../db/index";
import { workspaceMembers, projectMembers, users } from "../db/schema";
import { v4 as uuid } from "uuid";
import { nowISO } from "../lib/pagination";

export async function listByWorkspace(db: DbClient, workspaceId: string) {
  return db
    .select({
      id: workspaceMembers.id,
      role: workspaceMembers.role,
      memberId: workspaceMembers.memberId,
      member: {
        id: users.id,
        email: users.email,
        display_name: users.displayName,
        username: users.username,
        avatar: users.avatar,
      },
    })
    .from(workspaceMembers)
    .leftJoin(users, eq(users.id, workspaceMembers.memberId))
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), isNull(workspaceMembers.deletedAt)));
}

export async function addWorkspaceMember(
  db: DbClient,
  workspaceId: string,
  memberId: string,
  role: number = 15,
) {
  const id = uuid();
  const now = nowISO();
  await db.insert(workspaceMembers).values({
    id,
    workspaceId,
    memberId,
    role,
    createdAt: now,
    updatedAt: now,
  });
  const [member] = await db
    .select()
    .from(workspaceMembers)
    .where(eq(workspaceMembers.id, id))
    .limit(1);
  return member;
}

// Soft-delete a membership scoped to the caller's workspace. A bare-UUID
// delete let any workspace member remove memberships in OTHER workspaces
// (cross-workspace IDOR). Returns true when a row in THIS workspace matched.
export async function removeWorkspaceMember(db: DbClient, workspaceId: string, id: string) {
  const rows = await db
    .update(workspaceMembers)
    .set({ deletedAt: nowISO(), updatedAt: nowISO() })
    .where(and(eq(workspaceMembers.id, id), eq(workspaceMembers.workspaceId, workspaceId)))
    .returning({ id: workspaceMembers.id });
  return rows.length > 0;
}

export async function updateRole(db: DbClient, id: string, role: number) {
  await db
    .update(workspaceMembers)
    .set({ role, updatedAt: nowISO() })
    .where(eq(workspaceMembers.id, id));
  const [member] = await db
    .select()
    .from(workspaceMembers)
    .where(eq(workspaceMembers.id, id))
    .limit(1);
  return member;
}

export async function listByProject(db: DbClient, projectId: string) {
  return db
    .select({
      id: projectMembers.id,
      role: projectMembers.role,
      memberId: projectMembers.memberId,
      member: {
        id: users.id,
        email: users.email,
        display_name: users.displayName,
        username: users.username,
        avatar: users.avatar,
      },
    })
    .from(projectMembers)
    .leftJoin(users, eq(users.id, projectMembers.memberId))
    .where(and(eq(projectMembers.projectId, projectId), isNull(projectMembers.deletedAt)));
}

export async function addProjectMember(
  db: DbClient,
  projectId: string,
  workspaceId: string,
  memberId: string,
  role: number = 15,
) {
  const id = uuid();
  const now = nowISO();
  await db.insert(projectMembers).values({
    id,
    projectId,
    workspaceId,
    memberId,
    role,
    createdAt: now,
    updatedAt: now,
  });
  const [member] = await db.select().from(projectMembers).where(eq(projectMembers.id, id)).limit(1);
  return member;
}

export async function removeProjectMember(db: DbClient, id: string) {
  await db
    .update(projectMembers)
    .set({ deletedAt: nowISO(), updatedAt: nowISO() })
    .where(eq(projectMembers.id, id));
}

// Active membership check used for asset authorization (portal assets visible to
// workspace staff; internal assets visible to a customer only when owned by a
// member of that customer's workspace).
export async function isWorkspaceMember(
  db: DbClient,
  workspaceId: string,
  memberId: string,
): Promise<boolean> {
  const [m] = await db
    .select({ id: workspaceMembers.id })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.memberId, memberId),
        eq(workspaceMembers.isActive, 1),
        isNull(workspaceMembers.deletedAt),
      ),
    )
    .limit(1);
  return !!m;
}
