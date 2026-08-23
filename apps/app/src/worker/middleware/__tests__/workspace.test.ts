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

// Rows returned by each db.select(...).limit() call, in order. An empty queue
// falls back to a workspace-id row (sibling routes' local workspace-id
// lookups). Tests hitting raw db selects (workspaces assertCanManage) push
// the exact rows they want per select.
const { selectQueue } = vi.hoisted(() => ({ selectQueue: [] as unknown[][] }));

vi.mock("../../db/index", () => ({
  getDb: vi.fn(() => ({
    select: () => {
      const rows = selectQueue.length > 0 ? selectQueue.shift()! : [{ id: "ws-1" }];
      return {
        from: () => ({
          where: () => ({
            limit: async () => rows,
          }),
        }),
      };
    },
  })),
}));

vi.mock("../../repositories/workspaces", () => ({ findBySlug: vi.fn() }));
vi.mock("../../repositories/members", () => ({
  isWorkspaceMember: vi.fn(),
  findMembership: vi.fn(),
}));

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
// Repos stay mocked while labels/sprints update+remove run through the REAL
// service, so the cross-workspace scoping logic itself is exercised.
vi.mock("../../repositories/labels", () => ({
  findById: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("../../repositories/sprints", () => ({
  findById: vi.fn(),
  softDelete: vi.fn(),
}));
vi.mock("../../services/members", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  addWorkspaceMember: vi.fn(),
  listWorkspaceMembers: vi.fn(),
  removeWorkspaceMember: vi.fn(),
}));
vi.mock("../../services/workspaces", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  update: vi.fn(),
}));
vi.mock("../../repositories/projects", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  removeMember: vi.fn(),
}));

import { projectRoutes } from "../../routes/projects";
import { labelRoutes } from "../../routes/labels";
import { sprintRoutes } from "../../routes/sprints";
import { memberRoutes } from "../../routes/members";
import { workspaceRoutes } from "../../routes/workspaces";
import { issueRoutes } from "../../routes/issues";
import * as workspaceRepo from "../../repositories/workspaces";
import * as membersRepo from "../../repositories/members";
import * as projectRepo from "../../repositories/projects";
import * as labelsRepo from "../../repositories/labels";
import * as sprintsRepo from "../../repositories/sprints";
import * as projectService from "../../services/projects";
import * as labelsService from "../../services/labels";
import * as sprintsService from "../../services/sprints";
import * as membersService from "../../services/members";
import * as workspaceService from "../../services/workspaces";

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
  app.route("/api/workspaces", workspaceRoutes);
  app.route("/api/workspaces/:slug/members", memberRoutes);
  app.route("/api/workspaces/:slug/projects", projectRoutes);
  app.route("/api/workspaces/:slug/projects/:projectId/labels", labelRoutes);
  app.route("/api/workspaces/:slug/projects/:projectId/sprints", sprintRoutes);
  app.route("/api/workspaces/:slug/projects/:projectId/issues", issueRoutes);
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
  selectQueue.length = 0;
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

describe("workspace member routes", () => {
  it("rejects member listing by a non-member with 403", async () => {
    const app = testApp();

    const res = await req(app, "/api/workspaces/acme/members");
    expect(res.status).toBe(403);
    expect(membersService.listWorkspaceMembers).not.toHaveBeenCalled();
  });

  it("lists members for an active member using the guard's workspace", async () => {
    vi.mocked(membersRepo.isWorkspaceMember).mockResolvedValue(true);
    vi.mocked(membersService.listWorkspaceMembers).mockResolvedValue({
      results: [{ id: "m-1" }],
    } as never);
    const app = testApp();

    const res = await req(app, "/api/workspaces/acme/members");
    expect(res.status).toBe(200);
    expect(membersService.listWorkspaceMembers).toHaveBeenCalledWith(expect.anything(), "ws-1");
  });

  it("scopes member removal to the caller's workspace (cross-workspace IDOR)", async () => {
    vi.mocked(membersRepo.isWorkspaceMember).mockResolvedValue(true);
    // Removal is admin-gated: give the caller an active admin membership row.
    vi.mocked(membersRepo.findMembership).mockResolvedValue({
      id: "mem-1",
      role: 20,
      isActive: 1,
    } as never);
    const app = testApp();
    // "victim-uuid" belongs to another workspace: the workspace-scoped delete
    // matches no row in ws-1 and reports false → route answers 404, so the
    // victim workspace's membership is never touched.
    vi.mocked(membersService.removeWorkspaceMember).mockResolvedValue(false);
    const victimUuid = "11111111-2222-3333-4444-555555555555";

    const denied = await req(app, `/api/workspaces/acme/members/${victimUuid}`, {
      method: "DELETE",
    });
    expect(denied.status).toBe(404);
    expect(membersService.removeWorkspaceMember).toHaveBeenCalledWith(
      expect.anything(),
      "ws-1", // the guard's workspace — never one derived from the raw UUID
      victimUuid,
    );

    // A membership in THIS workspace is removed normally.
    vi.mocked(membersService.removeWorkspaceMember).mockResolvedValue(true);
    const allowed = await req(app, "/api/workspaces/acme/members/m-1", { method: "DELETE" });
    expect(allowed.status).toBe(204);
    expect(membersService.removeWorkspaceMember).toHaveBeenCalledWith(
      expect.anything(),
      "ws-1",
      "m-1",
    );
  });
});

describe("workspace management requires an active admin", () => {
  // requireWorkspaceAdmin resolves via workspaceRepo.findBySlug + the
  // findMembership row (owner short-circuits before the row is even read).
  it("rejects a suspended admin (is_active = 0) with 403", async () => {
    vi.mocked(membersRepo.findMembership).mockResolvedValue({
      id: "mem-1",
      role: 20,
      isActive: 0,
    } as never);
    const app = testApp();

    const res = await req(
      app,
      "/api/workspaces/acme",
      jsonInit("PATCH", { name: "Hostile Rename" }),
    );
    expect(res.status).toBe(403);
    expect(workspaceService.update).not.toHaveBeenCalled();
  });

  it("rejects a plain member (role 15) with 403", async () => {
    vi.mocked(membersRepo.findMembership).mockResolvedValue({
      id: "mem-1",
      role: 15,
      isActive: 1,
    } as never);
    const app = testApp();

    const res = await req(app, "/api/workspaces/acme", { method: "DELETE" });
    expect(res.status).toBe(403);
    expect(workspaceService.update).not.toHaveBeenCalled();
  });

  it("allows an active admin to rename", async () => {
    // An active admin is also an active member — the membership gate passes
    // first, then the role gate reads the membership row.
    vi.mocked(membersRepo.isWorkspaceMember).mockResolvedValue(true);
    vi.mocked(membersRepo.findMembership).mockResolvedValue({
      id: "mem-1",
      role: 20,
      isActive: 1,
    } as never);
    vi.mocked(workspaceService.update).mockResolvedValue({ id: "ws-1" } as never);
    const app = testApp();

    const res = await req(app, "/api/workspaces/acme", jsonInit("PATCH", { name: "New Name" }));
    expect(res.status).toBe(200);
    expect(workspaceService.update).toHaveBeenCalledWith(
      expect.anything(),
      "acme",
      expect.objectContaining({ name: "New Name" }),
    );
  });

  it("404s a deleted/unknown workspace on PATCH", async () => {
    // workspaceRepo.findBySlug is deletedAt-filtered, so a soft-deleted
    // workspace resolves the same as an unknown slug.
    vi.mocked(workspaceRepo.findBySlug).mockResolvedValue(undefined as never);
    const app = testApp();

    const res = await req(
      app,
      "/api/workspaces/acme",
      jsonInit("PATCH", { name: "Hostile Rename" }),
    );
    expect(res.status).toBe(404);
    expect(workspaceService.update).not.toHaveBeenCalled();
  });
});

describe("project member removal is scoped to the resolved project", () => {
  const victimUuid = "11111111-2222-3333-4444-555555555555";
  const memberPath = (id: string) => `/api/workspaces/acme/projects/p-1/members/${id}`;

  it("404s a foreign member UUID and deletes nothing (cross-project IDOR)", async () => {
    vi.mocked(membersRepo.isWorkspaceMember).mockResolvedValue(true);
    // projectRepo.findById (real) resolves p-1 under the guard's workspace.
    selectQueue.push([{ id: "p-1", workspaceId: "ws-1" }]);
    // The victim row lives in another project: scoped delete matches nothing.
    vi.mocked(projectRepo.removeMember).mockResolvedValue(false);
    const app = testApp();

    const res = await req(app, memberPath(victimUuid), { method: "DELETE" });
    expect(res.status).toBe(404);
    expect(projectRepo.removeMember).toHaveBeenCalledWith(
      expect.anything(),
      "p-1", // the guard/workspace-resolved project — never from the raw UUID
      victimUuid,
    );
  });

  it("removes a membership of the resolved project normally", async () => {
    vi.mocked(membersRepo.isWorkspaceMember).mockResolvedValue(true);
    selectQueue.push([{ id: "p-1", workspaceId: "ws-1" }]);
    vi.mocked(projectRepo.removeMember).mockResolvedValue(true);
    const app = testApp();

    const res = await req(app, memberPath("pm-1"), { method: "DELETE" });
    expect(res.status).toBe(204);
    expect(projectRepo.removeMember).toHaveBeenCalledWith(expect.anything(), "p-1", "pm-1");
  });

  it("404s when the project belongs to a different workspace", async () => {
    vi.mocked(membersRepo.isWorkspaceMember).mockResolvedValue(true);
    selectQueue.push([{ id: "p-1", workspaceId: "ws-other" }]);
    const app = testApp();

    const res = await req(app, memberPath("pm-1"), { method: "DELETE" });
    expect(res.status).toBe(404);
    expect(projectRepo.removeMember).not.toHaveBeenCalled();
  });
});

describe("cross-workspace object writes are scoped to the caller's workspace", () => {
  // The REAL service update/remove run here (only the repo layer is mocked),
  // so these exercise the resolve-then-compare + scoped where logic itself.
  const victimUuid = "11111111-2222-3333-4444-555555555555";

  it("404s a foreign label PATCH and never reaches the repo (labels)", async () => {
    vi.mocked(membersRepo.isWorkspaceMember).mockResolvedValue(true);
    // The label exists — but in another workspace.
    vi.mocked(labelsRepo.findById).mockResolvedValue({
      id: victimUuid,
      workspaceId: "ws-other",
      deletedAt: null,
    } as never);
    const app = testApp();

    const res = await req(
      app,
      `/api/workspaces/acme/projects/p-1/labels/${victimUuid}`,
      jsonInit("PATCH", { name: "Hostile Rename" }),
    );
    expect(res.status).toBe(404);
    expect(labelsRepo.update).not.toHaveBeenCalled();

    // A label in the caller's own workspace updates via the scoped repo call.
    vi.mocked(labelsRepo.findById).mockResolvedValue({
      id: "l-1",
      workspaceId: "ws-1",
      deletedAt: null,
    } as never);
    vi.mocked(labelsRepo.update).mockResolvedValue({ id: "l-1" } as never);
    const allowed = await req(
      app,
      "/api/workspaces/acme/projects/p-1/labels/l-1",
      jsonInit("PATCH", { name: "Renamed" }),
    );
    expect(allowed.status).toBe(200);
    expect(labelsRepo.update).toHaveBeenCalledWith(
      expect.anything(),
      "l-1",
      "ws-1", // the guard's workspace — never one derived from the raw UUID
      expect.objectContaining({ name: "Renamed" }),
    );
  });

  it("404s a foreign sprint DELETE and never soft-deletes (sprints)", async () => {
    vi.mocked(membersRepo.isWorkspaceMember).mockResolvedValue(true);
    vi.mocked(sprintsRepo.findById).mockResolvedValue({
      id: victimUuid,
      workspaceId: "ws-other",
      deletedAt: null,
    } as never);
    const app = testApp();

    const res = await req(app, `/api/workspaces/acme/projects/p-1/sprints/${victimUuid}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(404);
    expect(sprintsRepo.softDelete).not.toHaveBeenCalled();

    // The same UUID in the caller's workspace soft-deletes normally.
    vi.mocked(sprintsRepo.findById).mockResolvedValue({
      id: "s-1",
      workspaceId: "ws-1",
      deletedAt: null,
    } as never);
    const allowed = await req(app, "/api/workspaces/acme/projects/p-1/sprints/s-1", {
      method: "DELETE",
    });
    expect(allowed.status).toBe(200);
    expect(sprintsRepo.softDelete).toHaveBeenCalledWith(expect.anything(), "s-1", "ws-1");
  });
});

describe("read routes enforce workspace membership", () => {
  it("rejects issue listing and detail by a non-member with 403", async () => {
    const app = testApp();

    const list = await req(app, "/api/workspaces/acme/projects/p-1/issues");
    expect(list.status).toBe(403);

    const detail = await req(app, "/api/workspaces/acme/projects/p-1/issues/1");
    expect(detail.status).toBe(403);
  });

  it("rejects member listing by a non-member with 403", async () => {
    const app = testApp();

    const res = await req(app, "/api/workspaces/acme/members");
    expect(res.status).toBe(403);
    expect(membersService.listWorkspaceMembers).not.toHaveBeenCalled();
  });
});

describe("member invite/remove require an active admin", () => {
  const invite = jsonInit("POST", { email: "newbie@example.com" });

  it("rejects a plain member's invite with 403", async () => {
    vi.mocked(membersRepo.isWorkspaceMember).mockResolvedValue(true);
    vi.mocked(membersRepo.findMembership).mockResolvedValue({
      id: "mem-1",
      role: 15,
      isActive: 1,
    } as never);
    const app = testApp();

    const res = await req(app, "/api/workspaces/acme/members/invite", invite);
    expect(res.status).toBe(403);
    expect(membersService.addWorkspaceMember).not.toHaveBeenCalled();
  });

  it("rejects a suspended admin's invite with 403", async () => {
    vi.mocked(membersRepo.isWorkspaceMember).mockResolvedValue(true);
    vi.mocked(membersRepo.findMembership).mockResolvedValue({
      id: "mem-1",
      role: 20,
      isActive: 0,
    } as never);
    const app = testApp();

    const res = await req(app, "/api/workspaces/acme/members/invite", invite);
    expect(res.status).toBe(403);
    expect(membersService.addWorkspaceMember).not.toHaveBeenCalled();
  });

  it("lets an active admin invite (idempotent 200 via the existing-member path)", async () => {
    vi.mocked(membersRepo.isWorkspaceMember).mockResolvedValue(true);
    vi.mocked(membersRepo.findMembership).mockResolvedValue({
      id: "mem-1",
      role: 20,
      isActive: 1,
    } as never);
    const app = testApp();

    const res = await req(app, "/api/workspaces/acme/members/invite", invite);
    expect(res.status).toBe(200);
  });

  it("rejects a plain member's member removal with 403", async () => {
    vi.mocked(membersRepo.isWorkspaceMember).mockResolvedValue(true);
    vi.mocked(membersRepo.findMembership).mockResolvedValue({
      id: "mem-1",
      role: 15,
      isActive: 1,
    } as never);
    const app = testApp();

    const res = await req(app, "/api/workspaces/acme/members/m-2", { method: "DELETE" });
    expect(res.status).toBe(403);
    expect(membersService.removeWorkspaceMember).not.toHaveBeenCalled();
  });
});
