import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { Env } from "../../lib/env";
import type { AuthUser } from "../../lib/token";

// The auth middleware runs globally on /api/* in production and always sets
// c.get("user") before route handlers; stub it the same way here.
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

vi.mock("../../db/index", () => ({
  getDb: vi.fn(() => ({
    // Minimal chain for the sibling routes' local resolveWorkspaceId helpers.
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [{ id: "ws-1" }],
        }),
      }),
    }),
  })),
}));

vi.mock("../../repositories/workspaces", () => ({ findBySlug: vi.fn() }));
vi.mock("../../repositories/members", () => ({ isWorkspaceMember: vi.fn() }));

vi.mock("../../services/projects", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("../../services/labels", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  create: vi.fn(),
}));
vi.mock("../../services/sprints", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  create: vi.fn(),
}));

import { projectRoutes } from "../../routes/projects";
import { labelRoutes } from "../../routes/labels";
import { sprintRoutes } from "../../routes/sprints";
import * as workspaceRepo from "../../repositories/workspaces";
import * as membersRepo from "../../repositories/members";
import * as projectService from "../../services/projects";
import * as labelsService from "../../services/labels";
import * as sprintsService from "../../services/sprints";

const WORKSPACE = {
  id: "ws-1",
  slug: "acme",
  ownerId: "owner-9",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

// Mount the real route files exactly as app.ts mounts them.
function testApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/api/workspaces/:slug/projects", projectRoutes);
  app.route("/api/workspaces/:slug/projects/:projectId/labels", labelRoutes);
  app.route("/api/workspaces/:slug/projects/:projectId/sprints", sprintRoutes);
  return app;
}

function jsonInit(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

// app.request with the Workers env bindings production provides.
function req(app: Hono<{ Bindings: Env }>, path: string, init?: RequestInit) {
  return app.request(path, init, { DB: {} } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(workspaceRepo.findBySlug).mockResolvedValue(WORKSPACE as never);
  vi.mocked(membersRepo.isWorkspaceMember).mockResolvedValue(false);
});

describe("project routes enforce workspace membership", () => {
  it("rejects create/update/delete by an authenticated non-member with 403", async () => {
    const app = testApp();

    const create = await req(
      app,
      "/api/workspaces/acme/projects",
      jsonInit("POST", { name: "Intruder Project" }),
    );
    expect(create.status).toBe(403);
    expect(projectService.create).not.toHaveBeenCalled();

    const patch = await req(
      app,
      "/api/workspaces/acme/projects/p-1",
      jsonInit("PATCH", { name: "Renamed", is_pipeline: false }),
    );
    expect(patch.status).toBe(403);
    expect(projectService.update).not.toHaveBeenCalled();

    const remove = await req(app, "/api/workspaces/acme/projects/p-1", { method: "DELETE" });
    expect(remove.status).toBe(403);
    expect(projectService.remove).not.toHaveBeenCalled();
  });

  it("returns 404 when the workspace slug does not exist", async () => {
    vi.mocked(workspaceRepo.findBySlug).mockResolvedValue(undefined as never);
    const app = testApp();

    const res = await req(app, "/api/workspaces/ghost/projects", jsonInit("POST", { name: "X" }));
    expect(res.status).toBe(404);
    expect(projectService.create).not.toHaveBeenCalled();
  });

  it("allows an active member to create a project", async () => {
    vi.mocked(membersRepo.isWorkspaceMember).mockResolvedValue(true);
    vi.mocked(projectService.create).mockResolvedValue({ id: "p-new" } as never);
    const app = testApp();

    const res = await req(
      app,
      "/api/workspaces/acme/projects",
      jsonInit("POST", { name: "Member Project" }),
    );
    expect(res.status).toBe(201);
    expect(projectService.create).toHaveBeenCalledTimes(1);
  });

  it("allows the workspace owner without needing a membership row", async () => {
    vi.mocked(workspaceRepo.findBySlug).mockResolvedValue({
      ...WORKSPACE,
      ownerId: "user-1",
    } as never);
    vi.mocked(projectService.create).mockResolvedValue({ id: "p-owner" } as never);
    const app = testApp();

    const res = await req(
      app,
      "/api/workspaces/acme/projects",
      jsonInit("POST", { name: "Owner Project" }),
    );
    expect(res.status).toBe(201);
    expect(membersRepo.isWorkspaceMember).not.toHaveBeenCalled();
  });
});

describe("sibling routes enforce workspace membership", () => {
  it("rejects label create by a non-member and allows it for a member", async () => {
    const app = testApp();
    const path = "/api/workspaces/acme/projects/p-1/labels";

    const denied = await req(app, path, jsonInit("POST", { name: "bug", color: "#ff0000" }));
    expect(denied.status).toBe(403);
    expect(labelsService.create).not.toHaveBeenCalled();

    vi.mocked(membersRepo.isWorkspaceMember).mockResolvedValue(true);
    vi.mocked(labelsService.create).mockResolvedValue({ id: "l-1" } as never);

    const allowed = await req(app, path, jsonInit("POST", { name: "bug", color: "#ff0000" }));
    expect(allowed.status).toBe(201);
    expect(labelsService.create).toHaveBeenCalledWith(
      expect.anything(),
      "ws-1",
      "p-1",
      expect.objectContaining({ name: "bug" }),
    );
  });

  it("rejects sprint create by a non-member on the project-scoped mount", async () => {
    const app = testApp();

    const res = await req(
      app,
      "/api/workspaces/acme/projects/p-1/sprints",
      jsonInit("POST", { name: "Sprint 1", start_date: "2026-01-01", end_date: "2026-01-15" }),
    );
    expect(res.status).toBe(403);
    expect(sprintsService.create).not.toHaveBeenCalled();
  });
});
