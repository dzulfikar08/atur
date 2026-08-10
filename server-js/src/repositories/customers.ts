import { eq, and, isNull, desc, sql, or, like } from 'drizzle-orm'
import type { DbClient } from '../db/index'
import * as schema from '../db/schema'
import { v4 as uuid } from 'uuid'
import { nowISO } from '../lib/pagination'
import * as usersRepo from './users'

export interface CustomerRow {
  id: string
  workspaceId: string
  userId: string | null
  email: string | null
  name: string | null
  company: string | null
  phone: string | null
  status: string
  source: string | null
  username: string | null
  sessionToken: string | null
}

// Contact fields live on the customers row now; users is LEFT-joined only for
// the legacy username (portal customers) and the soft-delete filter.
const contactSelect = {
  id: schema.customers.id,
  workspaceId: schema.customers.workspaceId,
  userId: schema.customers.userId,
  email: schema.customers.email,
  name: schema.customers.name,
  company: schema.customers.company,
  phone: schema.customers.phone,
  status: schema.customers.status,
  source: schema.customers.source,
  username: schema.users.username,
  sessionToken: schema.customers.sessionToken,
}

// Portal session lookup — mirrors usersRepo.findByToken but against
// customers.session_token (so portal sessions are isolated from /api/*).
export async function findBySessionToken(db: DbClient, token: string): Promise<CustomerRow | null> {
  const [row] = await db
    .select(contactSelect)
    .from(schema.customers)
    .leftJoin(schema.users, eq(schema.users.id, schema.customers.userId))
    .where(and(
      eq(schema.customers.sessionToken, token),
      isNull(schema.users.deletedAt),
    ))
    .limit(1)
  return row ?? null
}


// Asset-authz lookup: is this id a portal customer? Returns the workspace so a
// main-app requester can be checked for membership. Direct select (no user join)
// so it resolves leads (user_id NULL) too.
export async function findById(db: DbClient, id: string): Promise<{ id: string; workspaceId: string } | null> {
  const [row] = await db
    .select({ id: schema.customers.id, workspaceId: schema.customers.workspaceId })
    .from(schema.customers)
    .where(eq(schema.customers.id, id))
    .limit(1)
  return row ?? null
}

// CRM identity lookup keyed on (workspace, email). Email now lives on customers,
// so this resolves leads (user_id NULL) too.
export async function findByWorkspaceEmail(db: DbClient, workspaceId: string, email: string): Promise<CustomerRow | null> {
  const [row] = await db
    .select(contactSelect)
    .from(schema.customers)
    .leftJoin(schema.users, eq(schema.users.id, schema.customers.userId))
    .where(and(
      eq(schema.customers.workspaceId, workspaceId),
      eq(schema.customers.email, email),
      isNull(schema.users.deletedAt),
    ))
    .limit(1)
  return row ?? null
}

// Unique username derived from the email local-part, with a short random
// suffix to avoid collisions with existing members.
function deriveUsername(email: string): string {
  const local = email.split('@')[0]?.toLowerCase().replace(/[^a-z0-9]+/g, '') || 'customer'
  const suffix = uuid().slice(0, 8)
  const base = `${local}-${suffix}`.slice(0, 48)
  return base
}

// Idempotent: return the existing customer for (workspace, email) or create a
// users row (is_customer=1, no password, no token) + a customers row. Portal
// customers need the users row to satisfy issue_comments.actor_id; CRM leads
// (created via createLead) skip it entirely.
export async function ensure(db: DbClient, workspaceId: string, opts: { email: string; name?: string | null }): Promise<CustomerRow> {
  const existing = await findByWorkspaceEmail(db, workspaceId, opts.email)
  if (existing) {
    // Backfill a missing name on the customers row (and users.display_name).
    if (!existing.name && opts.name) {
      await db.update(schema.customers)
        .set({ name: opts.name, updatedAt: nowISO() })
        .where(eq(schema.customers.id, existing.id))
      if (existing.userId) {
        await db.update(schema.users)
          .set({ displayName: opts.name, updatedAt: nowISO() })
          .where(eq(schema.users.id, existing.userId))
      }
    }
    return existing
  }

  const now = nowISO()
  // Reuse an existing users row (member/admin/invited) if one already exists
  // for this email — users.email is UNIQUE, so a blind insert collides.
  const existingUser = await usersRepo.findByEmail(db, opts.email)
  const userId = existingUser?.id ?? uuid()
  if (!existingUser) {
    await db.insert(schema.users).values({
      id: userId,
      email: opts.email,
      username: deriveUsername(opts.email),
      displayName: opts.name ?? null,
      userTimezone: 'UTC',
      isActive: 1,
      isSuperuser: 0,
      isEmailVerified: 1,
      isBot: 0,
      isCustomer: 1,
      createdAt: now,
      updatedAt: now,
    })
  }

  const customerId = uuid()
  await db.insert(schema.customers).values({
    id: customerId,
    workspaceId,
    userId,
    email: opts.email,
    name: opts.name ?? null,
    status: 'active',
    sessionToken: null,
    createdAt: now,
    updatedAt: now,
  })

  const created = await findByWorkspaceEmail(db, workspaceId, opts.email)
  return created!
}

// Create a CRM lead — a contact with NO auth account (user_id NULL). Dedupes
// on (workspace, email); if a contact exists there, backfill any newly
// provided fields and return it.
export async function createLead(
  db: DbClient,
  workspaceId: string,
  opts: { email: string; name?: string | null; company?: string | null; phone?: string | null; source?: string | null }
): Promise<CustomerRow> {
  const existing = await findByWorkspaceEmail(db, workspaceId, opts.email)
  if (existing) {
    const patch: Record<string, unknown> = { updatedAt: nowISO() }
    if (!existing.name && opts.name) patch.name = opts.name
    if (!existing.company && opts.company) patch.company = opts.company
    if (!existing.phone && opts.phone) patch.phone = opts.phone
    if (!existing.source && opts.source) patch.source = opts.source
    if (Object.keys(patch).length > 1) {
      await db.update(schema.customers).set(patch).where(eq(schema.customers.id, existing.id))
    }
    return existing
  }

  const now = nowISO()
  await db.insert(schema.customers).values({
    id: uuid(),
    workspaceId,
    userId: null,
    email: opts.email,
    name: opts.name ?? null,
    company: opts.company ?? null,
    phone: opts.phone ?? null,
    status: 'lead',
    source: opts.source ?? null,
    sessionToken: null,
    createdAt: now,
    updatedAt: now,
  })

  const created = await findByWorkspaceEmail(db, workspaceId, opts.email)
  return created!
}

export async function listContacts(
  db: DbClient,
  workspaceId: string,
  opts: { status?: string; search?: string; offset: number; limit: number }
): Promise<{ rows: CustomerRow[]; total: number }> {
  const conditions = [eq(schema.customers.workspaceId, workspaceId)]
  if (opts.status) conditions.push(eq(schema.customers.status, opts.status))
  if (opts.search) {
    const q = `%${opts.search}%`
    conditions.push(or(like(schema.customers.email, q), like(schema.customers.name, q), like(schema.customers.company, q))!)
  }
  const where = and(...conditions)

  const [countRow] = await db.select({ total: sql<number>`count(*)` }).from(schema.customers).where(where)
  const rows = await db.select(contactSelect)
    .from(schema.customers)
    .leftJoin(schema.users, eq(schema.users.id, schema.customers.userId))
    .where(where)
    .orderBy(desc(schema.customers.createdAt))
    .offset(opts.offset)
    .limit(opts.limit)

  return { rows, total: countRow.total }
}

export async function getContact(db: DbClient, workspaceId: string, customerId: string): Promise<CustomerRow | null> {
  const [row] = await db.select(contactSelect)
    .from(schema.customers)
    .leftJoin(schema.users, eq(schema.users.id, schema.customers.userId))
    .where(and(eq(schema.customers.id, customerId), eq(schema.customers.workspaceId, workspaceId)))
    .limit(1)
  return row ?? null
}

export async function updateContact(
  db: DbClient,
  workspaceId: string,
  customerId: string,
  patch: { name?: string | null; company?: string | null; phone?: string | null; status?: string; source?: string | null; email?: string | null }
): Promise<CustomerRow | null> {
  const set: Record<string, unknown> = { updatedAt: nowISO() }
  if (patch.name !== undefined) set.name = patch.name
  if (patch.company !== undefined) set.company = patch.company
  if (patch.phone !== undefined) set.phone = patch.phone
  if (patch.status !== undefined) set.status = patch.status
  if (patch.source !== undefined) set.source = patch.source
  if (patch.email !== undefined) set.email = patch.email
  await db.update(schema.customers).set(set)
    .where(and(eq(schema.customers.id, customerId), eq(schema.customers.workspaceId, workspaceId)))
  return getContact(db, workspaceId, customerId)
}

// Hard delete. Note: cascades through support_tickets.customer_id (ON DELETE
// CASCADE) and nulls deals.customer_id (ON DELETE SET NULL) at the DB layer.
// The service layer guards against deleting a contact that still has tickets.
export async function deleteContact(db: DbClient, workspaceId: string, customerId: string): Promise<void> {
  await db.delete(schema.customers)
    .where(and(eq(schema.customers.id, customerId), eq(schema.customers.workspaceId, workspaceId)))
}

export async function setSessionToken(db: DbClient, customerId: string, token: string) {
  await db.update(schema.customers)
    .set({ sessionToken: token, updatedAt: nowISO() })
    .where(eq(schema.customers.id, customerId))
}

export async function clearSessionToken(db: DbClient, customerId: string) {
  await db.update(schema.customers)
    .set({ sessionToken: null, updatedAt: nowISO() })
    .where(eq(schema.customers.id, customerId))
}
