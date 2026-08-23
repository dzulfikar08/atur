import { z } from "zod";
import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { DbClient } from "../db/index";
import * as schema from "../db/schema";
import * as companiesRepo from "../repositories/companies";
import * as customersRepo from "../repositories/customers";
import * as membersRepo from "../repositories/members";
import { paginatedResponse } from "../lib/pagination";
import { nowISO } from "../lib/pagination";

// CamelCase input (contacts pattern): snakeCaseMiddleware converts response
// keys to snake_case on the wire.
export const createCompanySchema = z.object({
  name: z.string().min(1).max(200),
  domain: z.string().max(253).optional(),
  industry: z.string().max(120).optional(),
  website: z.string().max(300).optional(),
  logoUrl: z.string().max(500).optional(),
  brandColor: z.string().max(20).optional(),
  description: z.string().max(2000).optional(),
  ownerId: z.string().uuid().optional(),
  primaryContactId: z.string().uuid().optional(),
});
export const updateCompanySchema = createCompanySchema.partial();

// DEV-21 class: entity ids stored on a company (owner, primary contact) must
// resolve in THIS workspace before they're persisted — a foreign user/contact
// UUID that merely exists platform-wide must not be storable as a reference.
async function assertCompanyRefsInWorkspace(
  db: DbClient,
  workspaceId: string,
  data: { ownerId?: string; primaryContactId?: string },
) {
  if (data.ownerId) {
    const isMember = await membersRepo.isWorkspaceMember(db, workspaceId, data.ownerId);
    if (!isMember) {
      throw new HTTPException(404, { message: "Owner is not a member of this workspace" });
    }
  }
  if (data.primaryContactId) {
    const contact = await customersRepo.getContact(db, workspaceId, data.primaryContactId);
    if (!contact) {
      throw new HTTPException(404, { message: "Primary contact not found in this workspace" });
    }
  }
}

export async function createCompany(
  db: DbClient,
  workspaceId: string,
  data: z.infer<typeof createCompanySchema>,
) {
  await assertCompanyRefsInWorkspace(db, workspaceId, data);
  // Duplicate name/domain within the workspace → 409 (mirrors variant name
  // collisions). Domain uniqueness is enforced by a unique index when set;
  // the explicit check gives a clean error for names too.
  const existing = await findDuplicate(db, workspaceId, data.name, data.domain);
  if (existing) {
    throw new HTTPException(409, { message: "A company with this name or domain already exists" });
  }
  return companiesRepo.createCompany(db, workspaceId, data);
}

async function findDuplicate(db: DbClient, workspaceId: string, name: string, domain?: string) {
  const byName = await companiesRepo.findByName(db, workspaceId, name);
  if (byName && byName.name.toLowerCase() === name.toLowerCase()) return byName;
  if (domain) {
    const byDomain = await companiesRepo.getByDomain(db, workspaceId, domain);
    if (byDomain) return byDomain;
  }
  return null;
}

export async function listCompanies(
  db: DbClient,
  workspaceId: string,
  opts: { search?: string; offset: number; limit: number },
) {
  const { rows, total } = await companiesRepo.listCompanies(db, workspaceId, opts);
  return paginatedResponse(rows, total, opts.offset, opts.limit);
}

export async function getCompany(db: DbClient, workspaceId: string, companyId: string) {
  const company = await companiesRepo.getCompany(db, workspaceId, companyId);
  if (!company) throw new HTTPException(404, { message: "Company not found" });
  return company;
}

export async function updateCompany(
  db: DbClient,
  workspaceId: string,
  companyId: string,
  data: z.infer<typeof updateCompanySchema>,
) {
  const existing = await companiesRepo.getCompany(db, workspaceId, companyId);
  if (!existing) throw new HTTPException(404, { message: "Company not found" });
  await assertCompanyRefsInWorkspace(db, workspaceId, data);
  if (data.name || data.domain) {
    const dup = await findDuplicate(
      db,
      workspaceId,
      data.name ?? existing.name,
      data.domain !== undefined ? (data.domain ?? undefined) : (existing.domain ?? undefined),
    );
    if (dup && dup.id !== companyId) {
      throw new HTTPException(409, {
        message: "A company with this name or domain already exists",
      });
    }
  }
  const company = await companiesRepo.updateCompany(db, workspaceId, companyId, data);
  if (!company) throw new HTTPException(404, { message: "Company not found" });
  return company;
}

export async function deleteCompany(db: DbClient, workspaceId: string, companyId: string) {
  const company = await companiesRepo.getCompany(db, workspaceId, companyId);
  if (!company) throw new HTTPException(404, { message: "Company not found" });
  // Soft delete. The DB FKs are ON DELETE SET NULL, but a soft delete doesn't
  // fire them — unlink customers + deals explicitly so contact/deal rows keep
  // their data and just lose the account link.
  await db
    .update(schema.customers)
    .set({ companyId: null, updatedAt: nowISO() })
    .where(eq(schema.customers.companyId, companyId));
  await db
    .update(schema.deals)
    .set({ companyId: null, updatedAt: nowISO() })
    .where(eq(schema.deals.companyId, companyId));
  await companiesRepo.deleteCompany(db, workspaceId, companyId);
}
