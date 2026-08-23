import { beforeEach, describe, expect, it, vi } from "vitest";
import { HTTPException } from "hono/http-exception";

vi.mock("../../repositories/deals", () => ({
  getByIssue: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  listByProject: vi.fn(),
  listByCustomer: vi.fn(),
  aggregateByStageCurrency: vi.fn(),
  aggregateTerminalSince: vi.fn(),
}));
vi.mock("../../repositories/customers", () => ({
  getContact: vi.fn(),
  updateContact: vi.fn(),
}));
vi.mock("../../repositories/companies", () => ({
  getCompany: vi.fn(),
}));
vi.mock("../issues", () => ({
  create: vi.fn(),
  update: vi.fn(),
}));
vi.mock("../crm_activities", () => ({
  recordActivity: vi.fn(),
}));

import { createDeal, updateDeal } from "../crm";
import * as dealsRepo from "../../repositories/deals";
import * as customersRepo from "../../repositories/customers";
import * as companiesRepo from "../../repositories/companies";
import * as issuesService from "../issues";
import type { CustomerRow } from "../../repositories/customers";
import type { CompanyRow } from "../../repositories/companies";
import type { DealRow } from "../../repositories/deals";

type CreatedIssue = Awaited<ReturnType<typeof issuesService.create>>;

// createDeal stamps issues.external_source via db.update().set().where() —
// stub the chain; everything else goes through the mocked repos/services.
const db = {
  update: vi.fn(() => ({ set: () => ({ where: () => undefined }) })),
} as unknown as Parameters<typeof createDeal>[0];
const WS = "ws-1";
const PROJECT = "p1";

// Partial rows for mocked repo returns — the service under test only reads
// these fields, so the rest of the row shape is irrelevant here.
function row<T>(partial: Partial<T>): T {
  return partial as T;
}

const createIssueMock = vi.mocked(issuesService.create);
const createDealRowMock = vi.mocked(dealsRepo.create);
const updateDealRowMock = vi.mocked(dealsRepo.update);
const getContactMock = vi.mocked(customersRepo.getContact);
const getCompanyMock = vi.mocked(companiesRepo.getCompany);
const getByIssueMock = vi.mocked(dealsRepo.getByIssue);

beforeEach(() => {
  vi.clearAllMocks();
  createIssueMock.mockResolvedValue(row<CreatedIssue>({ id: "i1" }));
  createDealRowMock.mockResolvedValue(row<DealRow>({ id: "d1", workspaceId: WS }));
  updateDealRowMock.mockResolvedValue(row<DealRow>({ id: "d1" }));
  getContactMock.mockResolvedValue(row<CustomerRow>({ id: "c1", workspaceId: WS }));
  getCompanyMock.mockResolvedValue(row<CompanyRow>({ id: "comp1", workspaceId: WS }));
  getByIssueMock.mockResolvedValue(row<DealRow>({ id: "d1", workspaceId: WS }));
});

describe("deal customer/company link binding (DEV-9 review fix)", () => {
  it("createDeal rejects a customer uuid from another workspace before minting the issue", async () => {
    getContactMock.mockResolvedValue(null);
    await expect(
      createDeal(db, WS, PROJECT, {
        name: "New deal",
        customer_id: "foreign-customer",
      }),
    ).rejects.toThrow("Customer not found");
    // Fails fast: no orphan issue/deal rows.
    expect(createIssueMock).not.toHaveBeenCalled();
    expect(createDealRowMock).not.toHaveBeenCalled();
  });

  it("createDeal rejects a company uuid from another workspace", async () => {
    getCompanyMock.mockResolvedValue(null);
    await expect(
      createDeal(db, WS, PROJECT, {
        name: "New deal",
        company_id: "foreign-company",
      }),
    ).rejects.toThrow("Company not found");
    expect(createIssueMock).not.toHaveBeenCalled();
  });

  it("createDeal accepts links that resolve in the deal's workspace", async () => {
    await createDeal(db, WS, PROJECT, {
      name: "New deal",
      customer_id: "c1",
      company_id: "comp1",
    });
    expect(createIssueMock).toHaveBeenCalled();
    expect(createDealRowMock).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ customerId: "c1", companyId: "comp1" }),
    );
  });

  it("updateDeal rejects relinking to a foreign company, scoped to the deal's workspace", async () => {
    getCompanyMock.mockResolvedValue(null);
    await expect(updateDeal(db, PROJECT, "i1", { company_id: "foreign-company" })).rejects.toThrow(
      HTTPException,
    );
    expect(updateDealRowMock).not.toHaveBeenCalled();
  });

  it("updateDeal accepts a same-workspace relink", async () => {
    await updateDeal(db, PROJECT, "i1", { company_id: "comp1" });
    expect(updateDealRowMock).toHaveBeenCalledWith(
      db,
      "i1",
      expect.objectContaining({ companyId: "comp1" }),
    );
  });
});
