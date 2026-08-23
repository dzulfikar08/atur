import { beforeEach, describe, expect, it, vi } from "vitest";
import { HTTPException } from "hono/http-exception";

vi.mock("../../repositories/contact_facts", () => ({
  getFact: vi.fn(),
  createFact: vi.fn(),
  updateFactStatus: vi.fn(),
  supersedeFacts: vi.fn(),
  listFacts: vi.fn(),
}));
vi.mock("../../repositories/customers", () => ({
  getContact: vi.fn(),
  updateContact: vi.fn(),
}));
vi.mock("../../repositories/companies", () => ({
  getCompany: vi.fn(),
}));
vi.mock("../companies", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  updateCompany: vi.fn(),
}));
vi.mock("../crm_activities", () => ({
  recordActivity: vi.fn(),
}));

import { recordFact, applyFact, dismissFact } from "../contact_facts";
import * as factsRepo from "../../repositories/contact_facts";
import * as customersRepo from "../../repositories/customers";
import * as companiesRepo from "../../repositories/companies";
import * as companiesService from "../companies";

const db = {} as any;
const WS = "ws-1";
const ACTOR = "user-1";
const CONTACT = { id: "c1" };

const getFactMock = vi.mocked(factsRepo.getFact);
const createFactMock = vi.mocked(factsRepo.createFact);
const updateFactStatusMock = vi.mocked(factsRepo.updateFactStatus);
const supersedeFactsMock = vi.mocked(factsRepo.supersedeFacts);
const getContactMock = vi.mocked(customersRepo.getContact);
const updateContactMock = vi.mocked(customersRepo.updateContact);
const getCompanyMock = vi.mocked(companiesRepo.getCompany);
const updateCompanyMock = vi.mocked(companiesService.updateCompany);

function fact(overrides: Record<string, unknown> = {}) {
  return {
    id: "f1",
    workspaceId: WS,
    customerId: "c1",
    companyId: null,
    field: "title",
    value: "CEO",
    score: 0.6,
    band: "PROBABLE",
    evidence: null,
    method: null,
    sourceUrl: null,
    status: "PROPOSED",
    decidedBy: null,
    decidedAt: null,
    observedAt: "2026-08-23T00:00:00Z",
    supersededAt: null,
    createdAt: "2026-08-23T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getContactMock.mockResolvedValue(CONTACT as any);
  createFactMock.mockImplementation((_db, data) =>
    Promise.resolve(fact({ ...(data as object), id: "f1" }) as any),
  );
  updateFactStatusMock.mockImplementation((_db, _ws, id, status, decidedBy) =>
    Promise.resolve(fact({ id, status, decidedBy, decidedAt: "2026-08-23T01:00:00Z" }) as any),
  );
  // applyFactWrite re-reads the fact (via repo getFact) to learn its field
  // before superseding older open facts for the same field.
  getFactMock.mockResolvedValue(fact() as any);
});

describe("recordFact", () => {
  it("strong evidence auto-applies and writes the contact field", async () => {
    const result = await recordFact(db, WS, ACTOR, {
      customer_id: "c1",
      field: "title",
      value: "CEO",
      evidence: [
        { source: "mailbox", method: "signature" },
        { source: "linkedin.com/in/x", method: "social" },
      ],
    });

    expect(result.status).toBe("APPLIED");
    expect(result.auto_applied).toBe(true);
    // signature (0.8) + social (0.6) = 1.4 → VERIFIED.
    expect(result.band).toBe("VERIFIED");
    expect(updateContactMock).toHaveBeenCalledWith(
      db,
      WS,
      "c1",
      expect.objectContaining({ title: "CEO", enrichedAt: expect.any(String) }),
    );
    expect(supersedeFactsMock).toHaveBeenCalledWith(
      db,
      WS,
      { customerId: "c1", companyId: null },
      "title",
      "f1",
    );
  });

  it("weak evidence stays PROPOSED and does not touch the record", async () => {
    const result = await recordFact(db, WS, ACTOR, {
      customer_id: "c1",
      field: "title",
      value: "CEO",
      evidence: [{ source: "some-page", method: "web_search" }],
    });

    expect(result.status).toBe("PROPOSED");
    expect(result.auto_applied).toBe(false);
    expect(updateContactMock).not.toHaveBeenCalled();
    expect(supersedeFactsMock).not.toHaveBeenCalled();
  });

  it("rejects unsupported fields", async () => {
    await expect(
      recordFact(db, WS, ACTOR, {
        customer_id: "c1",
        field: "password",
        value: "hunter2",
        evidence: [{ source: "x", method: "manual" }],
      }),
    ).rejects.toThrow(HTTPException);
    expect(createFactMock).not.toHaveBeenCalled();
  });

  it("rejects company-only fields (industry/website/logo_url) on contacts — no silent no-op apply", async () => {
    // customers has no such columns; before the fix these auto-applied while
    // updateContact silently dropped the write (ledger claimed enrichment).
    await expect(
      recordFact(db, WS, ACTOR, {
        customer_id: "c1",
        field: "industry",
        value: "FinTech",
        evidence: [
          { source: "mailbox", method: "signature" },
          { source: "crunchbase", method: "web_search" },
        ],
      }),
    ).rejects.toThrow(HTTPException);
    expect(createFactMock).not.toHaveBeenCalled();
    expect(updateContactMock).not.toHaveBeenCalled();
  });

  it("rejects a foreign contact uuid (workspace scoped)", async () => {
    getContactMock.mockResolvedValue(null);
    await expect(
      recordFact(db, WS, ACTOR, {
        customer_id: "foreign-uuid",
        field: "title",
        value: "CEO",
        evidence: [{ source: "x", method: "manual" }],
      }),
    ).rejects.toThrow("Contact not found");
  });

  it("records company facts against companies, not contacts", async () => {
    getCompanyMock.mockResolvedValue({ id: "comp1" } as any);
    await recordFact(db, WS, ACTOR, {
      company_id: "comp1",
      field: "website",
      value: "https://acme.com",
      // Strong evidence (0.8 + 0.6 = 1.4 >= 1.0) → auto-applies to the company.
      evidence: [
        { source: "mailbox", method: "signature" },
        { source: "acme.com", method: "social" },
      ],
    });
    // Company target: the fact's customerId is empty; companyId carries the id.
    expect(createFactMock).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ customerId: null, companyId: "comp1" }),
    );
    expect(updateCompanyMock).toHaveBeenCalledWith(db, WS, "comp1", {
      website: "https://acme.com",
    });
    // Supersede scopes to the company, not a contact.
    expect(supersedeFactsMock).toHaveBeenCalledWith(
      db,
      WS,
      { customerId: null, companyId: "comp1" },
      "website",
      "f1",
    );
  });
});

describe("applyFact / dismissFact", () => {
  it("applies a PROPOSED fact through the same write path", async () => {
    getFactMock.mockResolvedValue(fact() as any);
    await applyFact(db, WS, ACTOR, "f1");
    expect(updateFactStatusMock).toHaveBeenCalledWith(db, WS, "f1", "APPLIED", ACTOR);
    expect(updateContactMock).toHaveBeenCalledWith(
      db,
      WS,
      "c1",
      expect.objectContaining({ title: "CEO" }),
    );
    expect(supersedeFactsMock).toHaveBeenCalled();
  });

  it("cannot apply a non-PROPOSED fact", async () => {
    getFactMock.mockResolvedValue(fact({ status: "APPLIED" }) as any);
    await expect(applyFact(db, WS, ACTOR, "f1")).rejects.toThrow(HTTPException);
    expect(updateContactMock).not.toHaveBeenCalled();
  });

  it("dismisses PROPOSED and APPLIED facts, stamps the decision", async () => {
    getFactMock.mockResolvedValue(fact() as any);
    const result = await dismissFact(db, WS, ACTOR, "f1");
    expect(updateFactStatusMock).toHaveBeenCalledWith(db, WS, "f1", "DISMISSED", ACTOR);
    expect(result?.status).toBe("DISMISSED");
  });

  it("cannot dismiss a fact twice", async () => {
    getFactMock.mockResolvedValue(fact({ status: "DISMISSED" }) as any);
    await expect(dismissFact(db, WS, ACTOR, "f1")).rejects.toThrow(HTTPException);
  });
});
