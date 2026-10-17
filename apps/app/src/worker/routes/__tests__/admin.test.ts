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
    c.set("user", { sub: "user-1", email: "op@example.com" });
    await next();
  },
}));

// requireSuperuser reads users.is_superuser through select().from().where().get().
const superuserRow = vi.fn();
vi.mock("../../db/index", () => ({
  getDb: () => ({
    select: () => ({ from: () => ({ where: () => ({ get: superuserRow }) }) }),
  }),
}));

vi.mock("../../repositories/platform", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  totals: vi.fn(),
  daily: vi.fn(),
  listUsers: vi.fn(),
  getUser: vi.fn(),
  listWorkspaces: vi.fn(),
  getWorkspace: vi.fn(),
  feed: vi.fn(),
  agentUsage: vi.fn(),
}));

vi.mock("../../services/backup", () => ({ runD1Backup: vi.fn() }));

import { adminRoutes } from "../../routes/admin";
import * as platform from "../../repositories/platform";
import { runD1Backup } from "../../services/backup";

function call(path: string, init?: RequestInit) {
  const app = new Hono<{ Bindings: Env }>();
  app.use("*", errorMiddleware);
  app.route("/api/admin", adminRoutes);
  return app.request(path, init, { DB: {} } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  superuserRow.mockResolvedValue({ isSuperuser: 1 });
});

describe("platform admin routes", () => {
  it("403s a non-superuser on every route without touching the data layer", async () => {
    superuserRow.mockResolvedValue({ isSuperuser: 0 });
    for (const path of [
      "/api/admin/me",
      "/api/admin/overview",
      "/api/admin/users",
      "/api/admin/users/u-2",
      "/api/admin/workspaces",
      "/api/admin/workspaces/acme",
      "/api/admin/feed",
      "/api/admin/agents",
    ]) {
      const res = await call(path);
      expect(res.status, path).toBe(403);
    }
    expect((await call("/api/admin/backup-d1", { method: "POST" })).status).toBe(403);
    for (const fn of Object.values(platform)) {
      if (vi.isMockFunction(fn)) expect(fn).not.toHaveBeenCalled();
    }
    expect(runD1Backup).not.toHaveBeenCalled();
  });

  it("403s when the user row is missing", async () => {
    superuserRow.mockResolvedValue(undefined);
    expect((await call("/api/admin/me")).status).toBe(403);
  });

  it("lets a superuser through", async () => {
    const res = await call("/api/admin/me");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: "user-1", email: "op@example.com" });
  });

  it("404s unknown users and workspaces", async () => {
    vi.mocked(platform.getUser).mockResolvedValue(null);
    vi.mocked(platform.getWorkspace).mockResolvedValue(null);
    expect((await call("/api/admin/users/nope")).status).toBe(404);
    expect((await call("/api/admin/workspaces/nope")).status).toBe(404);
  });

  it("returns a feed cursor only when the page is full, clamping the limit", async () => {
    type FeedPage = { next_before: string | null };
    const item = (at: string) => ({ kind: "issue", id: at, at }) as never;
    vi.mocked(platform.feed).mockResolvedValue([item("t3"), item("t2")]);
    const full = (await (await call("/api/admin/feed?limit=2")).json()) as FeedPage;
    expect(full.next_before).toBe("t2");

    vi.mocked(platform.feed).mockResolvedValue([item("t1")]);
    const last = (await (
      await call("/api/admin/feed?limit=5000&workspace=acme")
    ).json()) as FeedPage;
    expect(last.next_before).toBeNull();
    expect(platform.feed).toHaveBeenLastCalledWith(expect.anything(), {
      before: undefined,
      workspace: "acme",
      actorId: undefined,
      limit: 200,
    });
  });
});
