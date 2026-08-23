import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { Env } from "../../lib/env";
import type { AuthUser } from "../../lib/token";
import { errorMiddleware } from "../../middleware/error";

vi.mock("../../middleware/auth", () => ({
  authMiddleware: async (
    c: { set: (k: "user", v: AuthUser) => void },
    next: () => Promise<void>,
  ) => {
    c.set("user", { sub: "user-1", email: "member@example.com" });
    await next();
  },
  optionalAuth: async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
}));

vi.mock("../../repositories/workspaces", () => ({ findBySlug: vi.fn() }));
vi.mock("../../repositories/members", () => ({
  isWorkspaceMember: vi.fn(),
  findMembership: vi.fn(),
}));

vi.mock("../../services/companies", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  listCompanies: vi.fn(),
  createCompany: vi.fn(),
  getCompany: vi.fn(),
  updateCompany: vi.fn(),
  deleteCompany: vi.fn(),
}));

import { companiesRoutes } from "../../routes/companies";
import * as companiesService from "../../services/companies";
import * as workspaceRepo from "../../repositories/workspaces";
import * as membersRepo from "../../repositories/members";

const listCompanies = vi.mocked(companiesService.listCompanies);
const createCompany = vi.mocked(companiesService.createCompany);
const getCompany = vi.mocked(companiesService.getCompany);
const updateCompany = vi.mocked(companiesService.updateCompany);
const deleteCompany = vi.mocked(companiesService.deleteCompany);
const findBySlug = vi.mocked(workspaceRepo.findBySlug);
const isWorkspaceMember = vi.mocked(membersRepo.isWorkspaceMember);

const WORKSPACE = {
  id: "ws-1",
  slug: "acme",
  ownerId: "owner-9",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const COMPANY = {
  id: "comp1",
  workspace_id: "ws-1",
  name: "Acme",
  domain: "acme.com",
  created_at: "2026-08-23T00:00:00Z",
  updated_at: "2026-08-23T00:00:00Z",
};

function testApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.use("*", errorMiddleware);
  app.route("/api/workspaces/:slug/companies", companiesRoutes);
  return app;
}

function jsonInit(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

function req(app: Hono<{ Bindings: Env }>, path: string, init?: RequestInit) {
  return app.request(path, init, { DB: {} } as never);
}

// resolveWorkspaceForCaller resolves the workspace via mocked findBySlug and
// checks membership via mocked isWorkspaceMember — wire both to pass for the
// default workspace.
function stubWorkspace() {
  findBySlug.mockResolvedValue(WORKSPACE as any);
  isWorkspaceMember.mockResolvedValue(true);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("companies routes", () => {
  it("GET / lists companies for the resolved workspace", async () => {
    stubWorkspace();
    listCompanies.mockResolvedValue({ results: [COMPANY], total: 1 } as any);

    const res = await req(testApp(), "/api/workspaces/acme/companies");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ results: [COMPANY], total: 1 });
    expect(listCompanies).toHaveBeenCalledWith(expect.anything(), "ws-1", {
      search: undefined,
      offset: 0,
      limit: 50,
    });
  });

  it("POST / creates a company (201)", async () => {
    stubWorkspace();
    createCompany.mockResolvedValue(COMPANY as any);

    const res = await req(
      testApp(),
      "/api/workspaces/acme/companies",
      jsonInit("POST", { name: "Acme", domain: "acme.com" }),
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual(COMPANY);
    expect(createCompany).toHaveBeenCalledWith(expect.anything(), "ws-1", {
      name: "Acme",
      domain: "acme.com",
    });
  });

  it("GET /:id returns the company", async () => {
    stubWorkspace();
    getCompany.mockResolvedValue(COMPANY as any);

    const res = await req(testApp(), "/api/workspaces/acme/companies/comp1");
    expect(res.status).toBe(200);
    expect(getCompany).toHaveBeenCalledWith(expect.anything(), "ws-1", "comp1");
  });

  it("PATCH /:id calls the service scoped to the resolved workspace (cross-workspace IDOR → 404 handled by service)", async () => {
    stubWorkspace();
    updateCompany.mockRejectedValue(new Error("404: Company not found"));

    const res = await req(
      testApp(),
      "/api/workspaces/acme/companies/foreign-uuid",
      jsonInit("PATCH", { name: "X" }),
    );
    expect(updateCompany).toHaveBeenCalledWith(expect.anything(), "ws-1", "foreign-uuid", {
      name: "X",
    });
    expect(res.status).toBe(500); // real service returns 404; mock rejects generic
  });

  it("DELETE /:id soft-deletes scoped to the workspace", async () => {
    stubWorkspace();
    deleteCompany.mockResolvedValue(undefined as any);

    const res = await req(testApp(), "/api/workspaces/acme/companies/comp1", {
      method: "DELETE",
    });
    expect(res.status).toBe(204);
    expect(deleteCompany).toHaveBeenCalledWith(expect.anything(), "ws-1", "comp1");
  });

  it("non-member is rejected before the service is called", async () => {
    findBySlug.mockResolvedValue(WORKSPACE as any);
    isWorkspaceMember.mockResolvedValue(false); // not owner, not member → 403
    getCompany.mockResolvedValue(COMPANY as any);

    const res = await req(testApp(), "/api/workspaces/acme/companies/comp1");
    expect(res.status).toBe(403);
    expect(getCompany).not.toHaveBeenCalled();
  });
});

