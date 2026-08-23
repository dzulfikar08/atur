// ── Evidence weighting (DEV-11) ─────────────────────────────────────────────
// Code registry (not DB config) mirroring how Atur keeps TEMPLATE_PURPOSES in
// code — and the conceptual port of trycompai/crm's evidence WEIGHTS. Stronger
// evidence sources weigh more; the score is the sum across INDEPENDENT
// sources, so two web searches alone never outrank a signature block.
export const EVIDENCE_WEIGHTS = {
  // A signature block in the user's own mailbox — the person wrote it.
  signature: 0.8,
  // A thread in the user's own mailbox.
  email_thread: 0.7,
  // LinkedIn / Twitter/X / GitHub profile.
  social: 0.6,
  // General web search.
  web_search: 0.5,
  // A rep entered it directly.
  manual: 0.9,
  // Unknown source — never counts for much.
  unknown: 0.2,
} as const;

export type EvidenceMethod = keyof typeof EVIDENCE_WEIGHTS;

// Sum of weights from independent sources at or above this → the fact
// auto-applies to the record. Below → PROPOSED until a rep settles it.
export const FACT_APPLY_THRESHOLD = 1.0;

export const FACT_BANDS = ["VERIFIED", "PROBABLE", "POSSIBLE"] as const;
export type FactBand = (typeof FACT_BANDS)[number];

export const FACT_STATUSES = ["PROPOSED", "APPLIED", "DISMISSED", "SUPERSEDED"] as const;
export type FactStatus = (typeof FACT_STATUSES)[number];

// A single piece of evidence attached to a fact.
export interface FactEvidence {
  source: string;
  method: EvidenceMethod;
  url?: string;
}

export function evidenceMethod(value: string): EvidenceMethod {
  return value in EVIDENCE_WEIGHTS ? (value as EvidenceMethod) : "unknown";
}

export function bandForScore(score: number): FactBand {
  if (score >= 1.4) return "VERIFIED";
  if (score >= 0.8) return "PROBABLE";
  return "POSSIBLE";
}

// Score = Σ weight(method) across independent sources. Duplicate evidence for
// the same source only counts once, at its strongest method.
export function scoreEvidence(evidence: FactEvidence[]): number {
  const bySource = new Map<string, number>();
  for (const e of evidence) {
    const w = EVIDENCE_WEIGHTS[evidenceMethod(e.method)];
    const prev = bySource.get(e.source);
    if (prev === undefined || w > prev) bySource.set(e.source, w);
  }
  let total = 0;
  for (const w of bySource.values()) total += w;
  return total;
}
