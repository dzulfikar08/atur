import { z } from "zod";
import { HTTPException } from "hono/http-exception";
import type { DbClient } from "../db/index";
import * as factsRepo from "../repositories/contact_facts";
import * as customersRepo from "../repositories/customers";
import * as companiesService from "./companies";
import * as companiesRepo from "../repositories/companies";
import { paginatedResponse } from "../lib/pagination";
import {
  FACT_APPLY_THRESHOLD,
  bandForScore,
  evidenceMethod,
  scoreEvidence,
  type FactEvidence,
} from "./evidence";
import * as activitiesService from "./crm_activities";
import { nowISO } from "../lib/pagination";

// ── Field allowlist: fact field → target column(s) ───────────────────────────
// Agents can only write through this mapping — no arbitrary keys. Contact
// fields map to customers columns; company fields to companies columns.
// owner_id / primary_contact_id are deliberately excluded (assignment is a
// human decision, not an enrichment). industry/website/logo_url exist only
// on companies — customers has no such columns, so a contact fact naming
// them is rejected here instead of silently "applying" a write that no-ops.
const CONTACT_FIELD_COLUMNS: Record<string, string> = {
  title: "title",
  seniority: "seniority",
  function: "function",
  linkedin_url: "linkedinUrl",
  company: "company",
  phone: "phone",
  email: "email",
};
const COMPANY_FIELD_COLUMNS: Record<string, string> = {
  name: "name",
  domain: "domain",
  industry: "industry",
  website: "website",
  logo_url: "logoUrl",
  brand_color: "brandColor",
  description: "description",
  phone: "phone",
  email: "email",
};

export const recordFactSchema = z.object({
  customer_id: z.string().uuid().optional(),
  company_id: z.string().uuid().optional(),
  field: z.string().min(1).max(120),
  value: z.string().min(1).max(500),
  // Evidence entries are deduped by source (strongest method wins per source).
  evidence: z
    .array(
      z.object({
        source: z.string().min(1).max(300),
        method: z.string().min(1).max(40),
        url: z.string().max(500).optional(),
      }),
    )
    .min(1)
    .max(20),
  method: z.string().max(40).optional(),
  source_url: z.string().max(500).optional(),
  observed_at: z.string().optional(),
});

export async function recordFact(
  db: DbClient,
  workspaceId: string,
  actorId: string,
  input: z.infer<typeof recordFactSchema>,
) {
  const customerId = input.customer_id ?? null;
  const companyId = input.company_id ?? null;
  if (customerId && companyId) {
    throw new HTTPException(400, { message: "Provide either customer_id or company_id, not both" });
  }
  if (!customerId && !companyId) {
    throw new HTTPException(400, { message: "customer_id or company_id is required" });
  }

  // Resolve the target within the workspace so a foreign UUID can't be named.
  if (customerId) {
    const contact = await customersRepo.getContact(db, workspaceId, customerId);
    if (!contact) throw new HTTPException(404, { message: "Contact not found" });
  } else {
    const company = await companiesRepo.getCompany(db, workspaceId, companyId!);
    if (!company) throw new HTTPException(404, { message: "Company not found" });
  }

  const fieldColumns = customerId ? CONTACT_FIELD_COLUMNS : COMPANY_FIELD_COLUMNS;
  const column = fieldColumns[input.field];
  if (!column) {
    throw new HTTPException(400, {
      message: `Unsupported field "${input.field}" — agents can only write: ${Object.keys(fieldColumns).join(", ")}`,
    });
  }

  const evidence: FactEvidence[] = input.evidence.map((e) => ({
    source: e.source,
    method: evidenceMethod(e.method),
    ...(e.url ? { url: e.url } : {}),
  }));
  const score = scoreEvidence(evidence);
  const band = bandForScore(score);
  const observedAt = input.observed_at ?? nowISO();

  // Strong evidence auto-applies (and writes the target); weak evidence stays
  // PROPOSED until a rep settles it. Either way the fact row lands first.
  const autoApply = score >= FACT_APPLY_THRESHOLD;
  const fact = await factsRepo.createFact(db, {
    workspaceId,
    customerId: customerId ?? null,
    companyId: companyId ?? null,
    field: input.field,
    value: input.value,
    score,
    band,
    evidence: JSON.stringify(evidence),
    method: input.method ?? evidence[0]?.method ?? null,
    sourceUrl: input.source_url ?? evidence[0]?.url ?? null,
    status: autoApply ? "APPLIED" : "PROPOSED",
    observedAt,
  });

  if (autoApply) {
    await applyFactWrite(db, workspaceId, actorId, customerId ?? null, companyId ?? null, {
      id: fact.id,
      field: input.field,
      column,
      value: input.value,
      band,
      score,
    });
  }
  return { ...fact, auto_applied: autoApply };
}

// Write an APPLIED fact's value to the target record + supersede prior open
// facts for the same field. Used by recordFact (auto-apply) and applyFact
// (rep decision). The fact payload comes from the caller (already fetched) so
// the write + supersede use the fact that was actually created. `column` is
// the resolved DB column (field names like linkedin_url → linkedinUrl).
async function applyFactWrite(
  db: DbClient,
  workspaceId: string,
  actorId: string,
  customerId: string | null,
  companyId: string | null,
  fact: { id: string; field: string; column: string; value: string; band: string; score: number },
) {
  if (customerId) {
    await customersRepo.updateContact(db, workspaceId, customerId, {
      [fact.column]: fact.value,
      // Enrichment rollup — the ledger wrote to this record.
      enrichedAt: nowISO(),
    });
    // CRM timeline entry (contact-level).
    await activitiesService.recordActivity(db, workspaceId, {
      customerId,
      type: "ENRICHMENT",
      subject: `Field '${fact.field}' updated via evidence`,
      body: JSON.stringify({ band: fact.band, score: fact.score }),
      createdBy: actorId,
    });
  } else {
    await companiesService.updateCompany(db, workspaceId, companyId!, {
      [fact.column]: fact.value,
    });
  }
  // Supersede older open facts for this (target, field) — the newest evidence
  // wins; history is kept via SUPERSEDED rows.
  await factsRepo.supersedeFacts(db, workspaceId, { customerId, companyId }, fact.field, fact.id);
}

// ── Rep decisions ────────────────────────────────────────────────────────────

// A rep (or trusted caller) applies a PROPOSED fact: the value is written to
// the record through the same mapping as auto-apply, provenance preserved.
export async function applyFact(
  db: DbClient,
  workspaceId: string,
  actorId: string,
  factId: string,
) {
  const fact = await factsRepo.getFact(db, workspaceId, factId);
  if (!fact) throw new HTTPException(404, { message: "Fact not found" });
  if (fact.status !== "PROPOSED") {
    throw new HTTPException(409, { message: `Fact is already ${fact.status.toLowerCase()}` });
  }
  const fieldColumns = fact.companyId ? COMPANY_FIELD_COLUMNS : CONTACT_FIELD_COLUMNS;
  const column = fieldColumns[fact.field];
  if (!column) {
    throw new HTTPException(400, { message: `Unsupported field "${fact.field}"` });
  }
  const updated = await factsRepo.updateFactStatus(db, workspaceId, factId, "APPLIED", actorId);
  await applyFactWrite(db, workspaceId, actorId, fact.customerId, fact.companyId, {
    id: fact.id,
    field: fact.field,
    column,
    value: fact.value,
    band: fact.band,
    score: fact.score,
  });
  return updated;
}

export async function dismissFact(
  db: DbClient,
  workspaceId: string,
  actorId: string,
  factId: string,
) {
  const fact = await factsRepo.getFact(db, workspaceId, factId);
  if (!fact) throw new HTTPException(404, { message: "Fact not found" });
  if (fact.status !== "PROPOSED" && fact.status !== "APPLIED") {
    throw new HTTPException(409, { message: `Fact is already ${fact.status.toLowerCase()}` });
  }
  return factsRepo.updateFactStatus(db, workspaceId, factId, "DISMISSED", actorId);
}

export async function listFacts(
  db: DbClient,
  workspaceId: string,
  opts: {
    customerId?: string;
    companyId?: string;
    status?: string;
    offset: number;
    limit: number;
  },
) {
  const { rows, total } = await factsRepo.listFacts(db, workspaceId, opts);
  return paginatedResponse(rows, total, opts.offset, opts.limit);
}
