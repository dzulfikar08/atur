import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
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

vi.mock("../../services/projectFolders", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  list: vi.fn(),
  create: vi.fn(),
  getById: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}));

import { projectFolderRoutes } from "../../routes/projectFolders";
import * as foldersService from "../../services/projectFolders";
import * as workspaceRepo from "../../repositories/workspaces";
import * as membersRepo from "../../repositories/members";

const listFolders = vi.mocked(foldersService.list);
const createFolder = vi.mocked(foldersService.create);
const updateFolder = vi.mocked(foldersService.update);
const removeFolder = vi.mocked(foldersService.remove);
const findBySlug = vi.mocked(workspaceRepo.findBySlug);
const isWorkspaceMember = vi.mocked(membersRepo.isWorkspaceMember);

const WORKSPACE = {
  id: "ws-1",
  slug: "acme",
  ownerId: "owner-9",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const FOLDER = {
  id: "f1",
  name: "Program & Evaluasi",
  color: null,
  sort_order: 65535,
  workspace_id: "ws-1",
  created_at: "2026-08-26T00:00:00Z",
  updated_at: "2026-08-26T00:00:00Z",
};

function testApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.use("*", errorMiddleware);
  app.route("/api/workspaces/:slug/folders", projectFolderRoutes);
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
  findBySlug.mockResolvedValue(WORKSPACE as any);
  isWorkspaceMember.mockResolvedValue(true);
});

describe("project folder routes (DEV-27)", () => {
  it("GET / lists folders for the resolved workspace", async () => {
    listFolders.mockResolvedValue({ results: [FOLDER], total: 1 } as any);
    const res = await testApp().request("/api/workspaces/acme/folders", undefined, {
      DB: {},
    } as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ results: [FOLDER], total: 1 });
    expect(listFolders).toHaveBeenCalledWith(expect.anything(), "ws-1", expect.anything());
  });

  it("POST / creates a folder (201)", async () => {
    createFolder.mockResolvedValue(FOLDER as any);
    const res = await testApp().request(
      "/api/workspaces/acme/folders",
      jsonInit("POST", { name: "Program & Evaluasi" }),
      { DB: {} } as never,
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual(FOLDER);
    expect(createFolder).toHaveBeenCalledWith(expect.anything(), "ws-1", {
      name: "Program & Evaluasi",
    });
  });

  it("PATCH /:id delegates to the service scoped by workspace (foreign id → 404 via service)", async () => {
    updateFolder.mockRejectedValue(new HTTPException(404, { message: "Folder not found" }));
    const res = await testApp().request(
      "/api/workspaces/acme/folders/f-foreign",
      jsonInit("PATCH", { name: "X" }),
      { DB: {} } as never,
    );
    expect(res.status).toBe(404);
    expect(updateFolder).toHaveBeenCalledWith(expect.anything(), "f-foreign", "ws-1", {
      name: "X",
    });
  });

  it("DELETE /:id soft-deletes scoped by workspace", async () => {
    removeFolder.mockResolvedValue(undefined);
    const res = await testApp().request("/api/workspaces/acme/folders/f1", { method: "DELETE" }, {
      DB: {},
    } as never);
    expect(res.status).toBe(204);
    expect(removeFolder).toHaveBeenCalledWith(expect.anything(), "f1", "ws-1");
  });

  it("non-member is rejected before the service is called", async () => {
    isWorkspaceMember.mockResolvedValue(false);
    const res = await testApp().request("/api/workspaces/acme/folders", undefined, {
      DB: {},
    } as never);
    expect(res.status).toBe(403);
    expect(listFolders).not.toHaveBeenCalled();
  });
});
