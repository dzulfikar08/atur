import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../repositories/companies", () => ({
  findByName: vi.fn(),
  getByDomain: vi.fn(),
  getCompany: vi.fn(),
  createCompany: vi.fn(),
  updateCompany: vi.fn(),
  deleteCompany: vi.fn(),
  listCompanies: vi.fn(),
}));

import {
  createCompany,
  updateCompany,
  deleteCompany,
  getCompany,
  listCompanies,
} from "../companies";
import * as companiesRepo from "../../repositories/companies";

const db = {} as any;
const WS = "ws-1";

const findByName = vi.mocked(companiesRepo.findByName);
const getByDomain = vi.mocked(companiesRepo.getByDomain);
const getCompanyMock = vi.mocked(companiesRepo.getCompany);
const createCompanyMock = vi.mocked(companiesRepo.createCompany);
const updateCompanyMock = vi.mocked(companiesRepo.updateCompany);
const deleteCompanyMock = vi.mocked(companiesRepo.deleteCompany);
const listCompaniesMock = vi.mocked(companiesRepo.listCompanies);

const company = (overrides: Record<string, unknown> = {}) => ({
  id: "comp1",
  workspaceId: WS,
  name: "Acme",
  domain: "acme.com",
  industry: null,
  website: null,
  logoUrl: null,
  brandColor: null,
  description: null,
  ownerId: null,
  primaryContactId: null,
  createdAt: "2026-08-23T00:00:00Z",
  updatedAt: "2026-08-23T00:00:00Z",
  deletedAt: null,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("companies service", () => {
  it("createCompany rejects a duplicate name in the workspace", async () => {
    findByName.mockResolvedValue(company({ id: "other" }) as any);
    await expect(createCompany(db, WS, { name: "Acme", domain: "acme.com" })).rejects.toThrow(
      "already exists",
    );
    expect(createCompanyMock).not.toHaveBeenCalled();
  });

  it("createCompany rejects a duplicate domain even with a fresh name", async () => {
    findByName.mockResolvedValue(null);
    getByDomain.mockResolvedValue(company({ id: "other" }) as any);
    await expect(createCompany(db, WS, { name: "New Name", domain: "acme.com" })).rejects.toThrow(
      "already exists",
    );
    expect(createCompanyMock).not.toHaveBeenCalled();
  });

  it("createCompany delegates to the repo on success", async () => {
    findByName.mockResolvedValue(null);
    getByDomain.mockResolvedValue(null);
    createCompanyMock.mockResolvedValue(company() as any);
    const result = await createCompany(db, WS, { name: "Acme", domain: "acme.com" });
    expect(createCompanyMock).toHaveBeenCalledWith(db, WS, {
      name: "Acme",
      domain: "acme.com",
    });
    expect(result.id).toBe("comp1");
  });

  it("updateCompany 404s on a foreign/unknown id", async () => {
    getCompanyMock.mockResolvedValue(null);
    await expect(updateCompany(db, WS, "foreign", { name: "X" })).rejects.toThrow(
      "Company not found",
    );
    expect(updateCompanyMock).not.toHaveBeenCalled();
  });

  it("updateCompany ignores a duplicate when it is the same company", async () => {
    getCompanyMock.mockResolvedValue(company() as any);
    findByName.mockResolvedValue(company() as any); // same id = the company itself
    updateCompanyMock.mockResolvedValue(company({ name: "Acme 2" }) as any);
    const result = await updateCompany(db, WS, "comp1", { name: "Acme 2" });
    expect(result.name).toBe("Acme 2");
  });

  it("deleteCompany soft-deletes via the repo (after unlinking customers + deals)", async () => {
    getCompanyMock.mockResolvedValue(company() as any);
    // deleteCompany now unlinks customers/deals via db.update chains.
    const updateFn = vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
    });
    (db as any).update = updateFn;
    await deleteCompany(db, WS, "comp1");
    expect(updateFn).toHaveBeenCalledTimes(2); // customers + deals unlink
    expect(deleteCompanyMock).toHaveBeenCalledWith(db, WS, "comp1");
  });

  it("getCompany 404s on unknown id", async () => {
    getCompanyMock.mockResolvedValue(null);
    await expect(getCompany(db, WS, "nope")).rejects.toThrow("Company not found");
  });

  it("listCompanies returns a paginated response", async () => {
    listCompaniesMock.mockResolvedValue({ rows: [company()], total: 1 });
    const result = await listCompanies(db, WS, { search: "acme", offset: 0, limit: 50 });
    expect(result.results).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(listCompaniesMock).toHaveBeenCalledWith(db, WS, {
      search: "acme",
      offset: 0,
      limit: 50,
    });
  });
});
