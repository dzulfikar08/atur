import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { Env } from "../../lib/env";
import type { AuthUser } from "../../lib/token";
import { errorMiddleware } from "../../middleware/error";
import * as schema from "../../db/schema";

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

vi.mock("../../services/projects", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  listByWorkspace: vi.fn(),
  create: vi.fn(),
  getById: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  listMembers: vi.fn(),
  addMember: vi.fn(),
  removeMember: vi.fn(),
}));

import { projectRoutes } from "../../routes/projects";
import * as projectService from "../../services/projects";
import * as workspaceRepo from "../../repositories/workspaces";
import * as membersRepo from "../../repositories/members";

const listByWorkspace = vi.mocked(projectService.listByWorkspace);
const createProject = vi.mocked(projectService.create);
const updateProject = vi.mocked(projectService.update);
const removeProject = vi.mocked(projectService.remove);
const findBySlug = vi.mocked(workspaceRepo.findBySlug);
const isWorkspaceMember = vi.mocked(membersRepo.isWorkspaceMember);

type WorkspaceRow = typeof schema.workspaces.$inferSelect;
type ProjectRow = typeof schema.projects.$inferSelect;
type ProjectPage = { rows: ProjectRow[]; total: number };

// Fixtures are intentionally partial stand-ins for full Drizzle rows; cast
// through unknown because the tests only rely on the fields they declare.
const asRows = <T,>(value: object): T => value as unknown as T;

const WORKSPACE = asRows<WorkspaceRow>({
  id: "ws-1",
  slug: "acme",
  ownerId: "owner-9",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
});

const PROJECT = asRows<ProjectRow>({
  id: "p1",
  name: "Development",
  identifier: "DEV",
  workspaceId: "ws-1",
  isPipeline: 0,
  createdAt: "2026-08-01T00:00:00Z",
  updatedAt: "2026-08-01T00:00:00Z",
  deletedAt: null,
});

function testApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.use("*", errorMiddleware);
  app.route("/api/workspaces/:slug/projects", projectRoutes);
  return app;
}

function jsonInit(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  findBySlug.mockResolvedValue(WORKSPACE);
  isWorkspaceMember.mockResolvedValue(true);
});

describe("project routes (DEV-5 hardening)", () => {
  it("GET / lists projects for the resolved workspace", async () => {
    listByWorkspace.mockResolvedValue({ rows: [PROJECT], total: 1 } satisfies ProjectPage);
    const res = await testApp().request("/api/workspaces/acme/projects", undefined, {
      DB: {},
    } as never);
    expect(res.status).toBe(200);
    expect(listByWorkspace).toHaveBeenCalledWith(
      expect.anything(),
      "acme",
      0,
      expect.any(Number),
      undefined,
    );
  });

  it("POST / creates a project (201)", async () => {
    createProject.mockResolvedValue(PROJECT);
    const res = await testApp().request(
      "/api/workspaces/acme/projects",
      jsonInit("POST", { name: "Development", identifier: "DEV" }),
      { DB: {} } as never,
    );
    expect(res.status).toBe(201);
    expect(createProject).toHaveBeenCalledWith(expect.anything(), "acme", {
      name: "Development",
      identifier: "DEV",
      network: 0,
      timezone: "UTC",
      isPipeline: false,
    });
  });

  it("PATCH /:projectId updates (incl. is_pipeline flip)", async () => {
    updateProject.mockResolvedValue(asRows<ProjectRow>({ ...PROJECT, isPipeline: 1 }));
    const res = await testApp().request(
      "/api/workspaces/acme/projects/p1",
      jsonInit("PATCH", { isPipeline: true }),
      { DB: {} } as never,
    );
    expect(res.status).toBe(200);
    expect(updateProject).toHaveBeenCalledWith(expect.anything(), "acme", "p1", {
      isPipeline: true,
    });
  });

  it("DELETE /:projectId removes scoped to the workspace", async () => {
    removeProject.mockResolvedValue(undefined);
    const res = await testApp().request("/api/workspaces/acme/projects/p1", {
      method: "DELETE",
    }, { DB: {} } as never);
    expect(res.status).toBe(204);
    expect(removeProject).toHaveBeenCalledWith(expect.anything(), "acme", "p1");
  });

  it("non-member cannot POST / (403 before the service runs)", async () => {
    isWorkspaceMember.mockResolvedValue(false);
    const res = await testApp().request(
      "/api/workspaces/acme/projects",
      jsonInit("POST", { name: "Sneaky", identifier: "SNK" }),
      { DB: {} } as never,
    );
    expect(res.status).toBe(403);
    expect(createProject).not.toHaveBeenCalled();
  });

  it("non-member cannot PATCH /:projectId (403 before the service runs)", async () => {
    isWorkspaceMember.mockResolvedValue(false);
    const res = await testApp().request(
      "/api/workspaces/acme/projects/p1",
      jsonInit("PATCH", { isPipeline: true }),
      { DB: {} } as never,
    );
    expect(res.status).toBe(403);
    expect(updateProject).not.toHaveBeenCalled();
  });

  it("non-member cannot DELETE /:projectId (403 before the service runs)", async () => {
    isWorkspaceMember.mockResolvedValue(false);
    const res = await testApp().request("/api/workspaces/acme/projects/p1", {
      method: "DELETE",
    }, { DB: {} } as never);
    expect(res.status).toBe(403);
    expect(removeProject).not.toHaveBeenCalled();
  });

  it("non-member cannot POST /:projectId/members (403 before the service runs)", async () => {
    isWorkspaceMember.mockResolvedValue(false);
    const res = await testApp().request(
      "/api/workspaces/acme/projects/p1/members",
      jsonInit("POST", { userId: "u-2", role: 10 }),
      { DB: {} } as never,
    );
    expect(res.status).toBe(403);
    expect(projectService.addMember).not.toHaveBeenCalled();
  });

  it("non-member cannot DELETE /:projectId/members/:memberId (403 before the service runs)", async () => {
    isWorkspaceMember.mockResolvedValue(false);
    const res = await testApp().request(
      "/api/workspaces/acme/projects/p1/members/m-1",
      { method: "DELETE" },
      { DB: {} } as never,
    );
    expect(res.status).toBe(403);
    expect(projectService.removeMember).not.toHaveBeenCalled();
  });
});
