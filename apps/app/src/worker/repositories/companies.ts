import { eq, and, isNull, desc, like, or, sql } from "drizzle-orm";
import type { DbClient } from "../db/index";
import * as schema from "../db/schema";
import { v4 as uuid } from "uuid";
import { nowISO } from "../lib/pagination";

export interface CompanyRow {
  id: string;
  workspaceId: string;
  name: string;
  domain: string | null;
  industry: string | null;
  website: string | null;
  logoUrl: string | null;
  brandColor: string | null;
  description: string | null;
  ownerId: string | null;
  primaryContactId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  deletedAt: string | null;
}

export const companySelect = {
  id: schema.companies.id,
  workspaceId: schema.companies.workspaceId,
  name: schema.companies.name,
  domain: schema.companies.domain,
  industry: schema.companies.industry,
  website: schema.companies.website,
  logoUrl: schema.companies.logoUrl,
  brandColor: schema.companies.brandColor,
  description: schema.companies.description,
  ownerId: schema.companies.ownerId,
  primaryContactId: schema.companies.primaryContactId,
  createdAt: schema.companies.createdAt,
  updatedAt: schema.companies.updatedAt,
  deletedAt: schema.companies.deletedAt,
};

export async function listCompanies(
  db: DbClient,
  workspaceId: string,
  opts: { search?: string; offset: number; limit: number },
): Promise<{ rows: CompanyRow[]; total: number }> {
  const conditions = [
    eq(schema.companies.workspaceId, workspaceId),
    isNull(schema.companies.deletedAt),
  ];
  if (opts.search) {
    const q = `%${opts.search}%`;
    conditions.push(
      or(
        like(schema.companies.name, q),
        like(schema.companies.domain, q),
        like(schema.companies.industry, q),
      )!,
    );
  }
  const where = and(...conditions);

  const [countRow] = await db
    .select({ total: sql<number>`count(*)` })
    .from(schema.companies)
    .where(where);
  const rows = await db
    .select(companySelect)
    .from(schema.companies)
    .where(where)
    .orderBy(desc(schema.companies.createdAt))
    .offset(opts.offset)
    .limit(opts.limit);

  return { rows, total: countRow.total };
}

export async function getCompany(
  db: DbClient,
  workspaceId: string,
  companyId: string,
): Promise<CompanyRow | null> {
  const [row] = await db
    .select(companySelect)
    .from(schema.companies)
    .where(
      and(
        eq(schema.companies.id, companyId),
        eq(schema.companies.workspaceId, workspaceId),
        isNull(schema.companies.deletedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function getByDomain(
  db: DbClient,
  workspaceId: string,
  domain: string,
): Promise<CompanyRow | null> {
  const [row] = await db
    .select(companySelect)
    .from(schema.companies)
    .where(
      and(
        eq(schema.companies.workspaceId, workspaceId),
        eq(schema.companies.domain, domain),
        isNull(schema.companies.deletedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

// Look up a company by name in the workspace (used to auto-link contacts whose
// company string matches an existing org). Case-insensitive exact match first,
// else the most recent company whose name contains the string.
export async function findByName(
  db: DbClient,
  workspaceId: string,
  name: string,
): Promise<CompanyRow | null> {
  const [row] = await db
    .select(companySelect)
    .from(schema.companies)
    .where(
      and(
        eq(schema.companies.workspaceId, workspaceId),
        eq(schema.companies.name, name),
        isNull(schema.companies.deletedAt),
      ),
    )
    .limit(1);
  if (row) return row;
  const [fuzzy] = await db
    .select(companySelect)
    .from(schema.companies)
    .where(
      and(
        eq(schema.companies.workspaceId, workspaceId),
        like(schema.companies.name, `%${name}%`),
        isNull(schema.companies.deletedAt),
      ),
    )
    .orderBy(desc(schema.companies.createdAt))
    .limit(1);
  return fuzzy ?? null;
}

export async function createCompany(
  db: DbClient,
  workspaceId: string,
  data: {
    name: string;
    domain?: string | null;
    industry?: string | null;
    website?: string | null;
    logoUrl?: string | null;
    brandColor?: string | null;
    description?: string | null;
    ownerId?: string | null;
    primaryContactId?: string | null;
  },
): Promise<CompanyRow> {
  const now = nowISO();
  const id = uuid();
  await db.insert(schema.companies).values({
    id,
    workspaceId,
    name: data.name,
    domain: data.domain ?? null,
    industry: data.industry ?? null,
    website: data.website ?? null,
    logoUrl: data.logoUrl ?? null,
    brandColor: data.brandColor ?? null,
    description: data.description ?? null,
    ownerId: data.ownerId ?? null,
    primaryContactId: data.primaryContactId ?? null,
    createdAt: now,
    updatedAt: now,
  });
  const created = await getCompany(db, workspaceId, id);
  return created!;
}

export async function updateCompany(
  db: DbClient,
  workspaceId: string,
  companyId: string,
  patch: {
    name?: string;
    domain?: string | null;
    industry?: string | null;
    website?: string | null;
    logoUrl?: string | null;
    brandColor?: string | null;
    description?: string | null;
    ownerId?: string | null;
    primaryContactId?: string | null;
  },
): Promise<CompanyRow | null> {
  const set: Record<string, unknown> = { updatedAt: nowISO() };
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.domain !== undefined) set.domain = patch.domain;
  if (patch.industry !== undefined) set.industry = patch.industry;
  if (patch.website !== undefined) set.website = patch.website;
  if (patch.logoUrl !== undefined) set.logoUrl = patch.logoUrl;
  if (patch.brandColor !== undefined) set.brandColor = patch.brandColor;
  if (patch.description !== undefined) set.description = patch.description;
  if (patch.ownerId !== undefined) set.ownerId = patch.ownerId;
  if (patch.primaryContactId !== undefined) set.primaryContactId = patch.primaryContactId;
  await db
    .update(schema.companies)
    .set(set)
    .where(
      and(
        eq(schema.companies.id, companyId),
        eq(schema.companies.workspaceId, workspaceId),
        isNull(schema.companies.deletedAt),
      ),
    );
  return getCompany(db, workspaceId, companyId);
}

// Soft delete. Customer/deal company links are ON DELETE SET NULL at the DB
// layer — contacts keep their company string, just unlinked.
export async function deleteCompany(
  db: DbClient,
  workspaceId: string,
  companyId: string,
): Promise<void> {
  await db
    .update(schema.companies)
    .set({ deletedAt: nowISO(), updatedAt: nowISO() })
    .where(
      and(
        eq(schema.companies.id, companyId),
        eq(schema.companies.workspaceId, workspaceId),
        isNull(schema.companies.deletedAt),
      ),
    );
}
