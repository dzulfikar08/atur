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

vi.mock("../../services/workspaceLinks", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  get: vi.fn(),
  upsert: vi.fn(),
  remove: vi.fn(),
  list: vi.fn(),
}));

import { workspaceLinkRoutes, workspaceLinksListRoute } from "../../routes/workspaceLinks";
import * as linksService from "../../services/workspaceLinks";
import * as workspaceRepo from "../../repositories/workspaces";
import * as membersRepo from "../../repositories/members";

const getLink = vi.mocked(linksService.get);
const upsertLink = vi.mocked(linksService.upsert);
const removeLink = vi.mocked(linksService.remove);
const listLinks = vi.mocked(linksService.list);
const findBySlug = vi.mocked(workspaceRepo.findBySlug);
const isWorkspaceMember = vi.mocked(membersRepo.isWorkspaceMember);
const findMembership = vi.mocked(membersRepo.findMembership);

// Owner is deliberately NOT the mocked auth user (user-1), so admin-gated
// routes take the findMembership role path — the same branch real members hit.
const WORKSPACE = {
  id: "ws-1",
  slug: "acme",
  ownerId: "owner-9",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const LINK = {
  workspace: "acme",
  repo_urls: ["owner/repo"],
  local_path: "/srv/acme",
  default_branch: null,
  herdr_workspace: null,
  notes: null,
  mode: null,
  auto_merge: null,
  updated_at: "2026-09-02T00:00:00Z",
};

function testApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.use("*", errorMiddleware);
  app.route("/api/workspaces/:slug/links", workspaceLinkRoutes);
  app.route("/api/workspaces", workspaceLinksListRoute);
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
  findBySlug.mockResolvedValue(WORKSPACE as never);
  isWorkspaceMember.mockResolvedValue(true);
});

describe("workspace link routes (DEV-29 control plane)", () => {
  it("GET / returns the binding for a member", async () => {
    getLink.mockResolvedValue(LINK);
    const res = await testApp().request("/api/workspaces/acme/links", undefined, {
      DB: {},
    } as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(LINK);
    expect(getLink).toHaveBeenCalledWith(expect.anything(), "acme");
  });

  it("GET / returns null body for an unbound workspace", async () => {
    getLink.mockResolvedValue(null);
    const res = await testApp().request("/api/workspaces/acme/links", undefined, {
      DB: {},
    } as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();
  });

  it("non-member cannot GET / (403 before the service runs)", async () => {
    isWorkspaceMember.mockResolvedValue(false);
    const res = await testApp().request("/api/workspaces/acme/links", undefined, {
      DB: {},
    } as never);
    expect(res.status).toBe(403);
    expect(getLink).not.toHaveBeenCalled();
  });

  it("PUT / upserts for an admin member", async () => {
    findMembership.mockResolvedValue({ isActive: 1, role: 20 } as never);
    upsertLink.mockResolvedValue(LINK);
    const res = await testApp().request(
      "/api/workspaces/acme/links",
      jsonInit("PUT", { repo_urls: ["owner/repo"], local_path: "/srv/acme" }),
      { DB: {} } as never,
    );
    expect(res.status).toBe(200);
    expect(upsertLink).toHaveBeenCalledWith(expect.anything(), "acme", {
      repo_urls: ["owner/repo"],
      local_path: "/srv/acme",
    });
  });

  it("PUT / accepts autonomy mode + auto_merge and passes them through", async () => {
    findMembership.mockResolvedValue({ isActive: 1, role: 20 } as never);
    upsertLink.mockResolvedValue({ ...LINK, mode: "direct-PR", auto_merge: "yolo" });
    const res = await testApp().request(
      "/api/workspaces/acme/links",
      jsonInit("PUT", { mode: "direct-PR", auto_merge: "yolo" }),
      { DB: {} } as never,
    );
    expect(res.status).toBe(200);
    expect(upsertLink).toHaveBeenCalledWith(expect.anything(), "acme", {
      mode: "direct-PR",
      auto_merge: "yolo",
    });
  });

  it("PUT / rejects unknown autonomy values (service never runs)", async () => {
    findMembership.mockResolvedValue({ isActive: 1, role: 20 } as never);
    const res = await testApp().request(
      "/api/workspaces/acme/links",
      jsonInit("PUT", { mode: "yolo" }),
      { DB: {} } as never,
    );
    // Repo-wide convention: inline zod parse failures bubble via
    // errorMiddleware (500) — the invariant is that the service never executes.
    expect([400, 500]).toContain(res.status);
    expect(upsertLink).not.toHaveBeenCalled();
  });

  it("PUT / is owner-or-admin only (plain member → 403)", async () => {
    findMembership.mockResolvedValue({ isActive: 1, role: 5 } as never);
    const res = await testApp().request(
      "/api/workspaces/acme/links",
      jsonInit("PUT", { notes: "nope" }),
      { DB: {} } as never,
    );
    expect(res.status).toBe(403);
    expect(upsertLink).not.toHaveBeenCalled();
  });

  it("DELETE / removes for an admin member", async () => {
    findMembership.mockResolvedValue({ isActive: 1, role: 30 } as never);
    removeLink.mockResolvedValue(undefined);
    const res = await testApp().request(
      "/api/workspaces/acme/links",
      {
        method: "DELETE",
      },
      { DB: {} } as never,
    );
    expect(res.status).toBe(204);
    expect(removeLink).toHaveBeenCalledWith(expect.anything(), "acme");
  });

  it("non-member cannot DELETE / (403 before the service runs)", async () => {
    isWorkspaceMember.mockResolvedValue(false);
    const res = await testApp().request(
      "/api/workspaces/acme/links",
      {
        method: "DELETE",
      },
      { DB: {} } as never,
    );
    expect(res.status).toBe(403);
    expect(removeLink).not.toHaveBeenCalled();
  });

  it("GET /links (unscoped) lists all bindings on auth alone", async () => {
    listLinks.mockResolvedValue({ results: [LINK] });
    const res = await testApp().request("/api/workspaces/links", undefined, {
      DB: {},
    } as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ results: [LINK] });
    expect(listLinks).toHaveBeenCalledTimes(1);
    // Auth-only gate — mirrors MCP get_workspace_links: no workspace
    // resolution or membership lookup may run for the unscoped read.
    expect(findBySlug).not.toHaveBeenCalled();
    expect(isWorkspaceMember).not.toHaveBeenCalled();
  });
});
