import { and, eq } from "drizzle-orm";
import type { DbClient } from "../db/index";
import * as schema from "../db/schema";
import { v4 as uuid } from "uuid";
import { nowISO } from "../lib/pagination";
import type { TemplatePurpose } from "../services/crm_email_templates";

export interface EmailVariantRow {
  id: string;
  workspaceId: string;
  purpose: string;
  name: string;
  subject: string;
  body: string;
  isHtml: number;
  isDefault: number;
  createdAt: string | null;
  updatedAt: string | null;
}

// All variants for a workspace (group by purpose client-side).
export async function listVariants(db: DbClient, workspaceId: string): Promise<EmailVariantRow[]> {
  return db
    .select()
    .from(schema.crmEmailVariants)
    .where(eq(schema.crmEmailVariants.workspaceId, workspaceId))
    .orderBy(schema.crmEmailVariants.purpose, schema.crmEmailVariants.name);
}

export async function getVariant(
  db: DbClient,
  workspaceId: string,
  variantId: string,
): Promise<EmailVariantRow | null> {
  const [row] = await db
    .select()
    .from(schema.crmEmailVariants)
    .where(
      and(eq(schema.crmEmailVariants.id, variantId), eq(schema.crmEmailVariants.workspaceId, workspaceId)),
    )
    .limit(1);
  return row ?? null;
}

export interface VariantInput {
  purpose: TemplatePurpose;
  name: string;
  subject: string;
  body: string;
  isHtml?: boolean;
}

// Create a variant. First variant for a (workspace, purpose) automatically
// becomes that purpose's default. Throws on the unique (workspace, purpose,
// name) constraint — callers map that to a 409.
export async function createVariant(
  db: DbClient,
  workspaceId: string,
  data: VariantInput,
): Promise<EmailVariantRow> {
  const existingForPurpose = await db
    .select({ id: schema.crmEmailVariants.id })
    .from(schema.crmEmailVariants)
    .where(
      and(
        eq(schema.crmEmailVariants.workspaceId, workspaceId),
        eq(schema.crmEmailVariants.purpose, data.purpose),
      ),
    )
    .limit(1);
  const isFirst = existingForPurpose.length === 0;

  const now = nowISO();
  await db.insert(schema.crmEmailVariants).values({
    id: uuid(),
    workspaceId,
    purpose: data.purpose,
    name: data.name,
    subject: data.subject,
    body: data.body,
    isHtml: data.isHtml ? 1 : 0,
    isDefault: isFirst ? 1 : 0,
    createdAt: now,
    updatedAt: now,
  });

  const [row] = await db
    .select()
    .from(schema.crmEmailVariants)
    .where(
      and(
        eq(schema.crmEmailVariants.workspaceId, workspaceId),
        eq(schema.crmEmailVariants.purpose, data.purpose),
        eq(schema.crmEmailVariants.name, data.name),
      ),
    )
    .limit(1);
  return row!;
}

export async function updateVariant(
  db: DbClient,
  workspaceId: string,
  variantId: string,
  data: Partial<{ name: string; subject: string; body: string; isHtml: boolean }>,
): Promise<void> {
  await db
    .update(schema.crmEmailVariants)
    .set({
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.subject !== undefined ? { subject: data.subject } : {}),
      ...(data.body !== undefined ? { body: data.body } : {}),
      ...(data.isHtml !== undefined ? { isHtml: data.isHtml ? 1 : 0 } : {}),
      updatedAt: nowISO(),
    })
    .where(
      and(eq(schema.crmEmailVariants.id, variantId), eq(schema.crmEmailVariants.workspaceId, workspaceId)),
    );
}

export async function deleteVariant(db: DbClient, workspaceId: string, variantId: string): Promise<void> {
  await db
    .delete(schema.crmEmailVariants)
    .where(
      and(eq(schema.crmEmailVariants.id, variantId), eq(schema.crmEmailVariants.workspaceId, workspaceId)),
    );
}

// Flag one variant as its purpose's default (clears the previous flag).
// If the flagged variant was the only one, the purpose falls back to the
// curated code default when the row is deleted.
export async function setDefaultVariant(
  db: DbClient,
  workspaceId: string,
  variantId: string,
): Promise<void> {
  const variant = await getVariant(db, workspaceId, variantId);
  if (!variant) return;

  await db
    .update(schema.crmEmailVariants)
    .set({ isDefault: 0, updatedAt: nowISO() })
    .where(
      and(
        eq(schema.crmEmailVariants.workspaceId, workspaceId),
        eq(schema.crmEmailVariants.purpose, variant.purpose),
        eq(schema.crmEmailVariants.isDefault, 1),
      ),
    );
  await db
    .update(schema.crmEmailVariants)
    .set({ isDefault: 1, updatedAt: nowISO() })
    .where(and(eq(schema.crmEmailVariants.id, variantId), eq(schema.crmEmailVariants.workspaceId, workspaceId)));
}

// Resolve the variant to send: the requested one (validated to belong to the
// workspace + purpose), else the purpose's default-flagged variant, else null
// (caller falls back to the curated code default).
export async function resolveVariant(
  db: DbClient,
  workspaceId: string,
  purpose: TemplatePurpose,
  variantId?: string,
): Promise<EmailVariantRow | null> {
  if (variantId) {
    const v = await getVariant(db, workspaceId, variantId);
    if (v && v.purpose === purpose) return v;
    // Unknown/mismatched variant id: fall through to the default rather than
    // failing the send — the caller cannot distinguish stale ids from typos.
  }
  const [row] = await db
    .select()
    .from(schema.crmEmailVariants)
    .where(
      and(
        eq(schema.crmEmailVariants.workspaceId, workspaceId),
        eq(schema.crmEmailVariants.purpose, purpose),
        eq(schema.crmEmailVariants.isDefault, 1),
      ),
    )
    .limit(1);
  return row ?? null;
}
