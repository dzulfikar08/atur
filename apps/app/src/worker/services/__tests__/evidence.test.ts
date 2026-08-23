import { describe, expect, it } from "vitest";
import {
  EVIDENCE_WEIGHTS,
  FACT_APPLY_THRESHOLD,
  bandForScore,
  evidenceMethod,
  scoreEvidence,
} from "../evidence";

describe("scoreEvidence", () => {
  it("sums weights across independent sources", () => {
    const score = scoreEvidence([
      { source: "mailbox", method: "signature" },
      { source: "linkedin.com/in/x", method: "social" },
    ]);
    expect(score).toBeCloseTo(EVIDENCE_WEIGHTS.signature + EVIDENCE_WEIGHTS.social);
  });

  it("dedupes the same source (strongest method wins)", () => {
    const score = scoreEvidence([
      { source: "mailbox", method: "web_search" },
      { source: "mailbox", method: "signature" },
      { source: "mailbox", method: "email_thread" },
    ]);
    // Only the strongest method for "mailbox" counts once.
    expect(score).toBeCloseTo(EVIDENCE_WEIGHTS.signature);
  });

  it("two weak independent sources can clear the apply threshold", () => {
    const score = scoreEvidence([
      { source: "a.com", method: "web_search" },
      { source: "b.com", method: "web_search" },
    ]);
    expect(score).toBeCloseTo(2 * EVIDENCE_WEIGHTS.web_search);
    expect(score).toBeGreaterThanOrEqual(FACT_APPLY_THRESHOLD);
  });

  it("two web searches from the same source do not double count", () => {
    const score = scoreEvidence([
      { source: "search-engine", method: "web_search" },
      { source: "search-engine", method: "web_search" },
    ]);
    expect(score).toBeCloseTo(EVIDENCE_WEIGHTS.web_search);
    expect(score).toBeLessThan(FACT_APPLY_THRESHOLD);
  });

  it("maps unknown methods to the unknown weight", () => {
    expect(evidenceMethod("carrier-pigeon")).toBe("unknown");
    expect(
      scoreEvidence([{ source: "x", method: "carrier-pigeon" as never }]),
    ).toBeCloseTo(EVIDENCE_WEIGHTS.unknown);
  });
});

describe("bandForScore", () => {
  it("VERIFIED at 1.4+, PROBABLE at 0.8+, else POSSIBLE", () => {
    expect(bandForScore(1.5)).toBe("VERIFIED");
    expect(bandForScore(1.4)).toBe("VERIFIED");
    expect(bandForScore(1.0)).toBe("PROBABLE");
    expect(bandForScore(0.8)).toBe("PROBABLE");
    expect(bandForScore(0.7)).toBe("POSSIBLE");
    expect(bandForScore(0)).toBe("POSSIBLE");
  });
});
