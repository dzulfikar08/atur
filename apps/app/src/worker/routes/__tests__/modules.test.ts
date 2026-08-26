import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { getTableName } from "drizzle-orm";
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

vi.mock("../../services/modules", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getById: vi.fn(),
}));

vi.mock("../../services/issues", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  enrichIssues: vi.fn(),
}));

vi.mock("../../db/index", () => ({ getDb: vi.fn() }));

import { moduleRoutes } from "../../routes/modules";
import * as modulesService from "../../services/modules";
import * as issuesService from "../../services/issues";
import * as workspaceRepo from "../../repositories/workspaces";
import * as membersRepo from "../../repositories/members";
import { getDb } from "../../db/index";

const getById = vi.mocked(modulesService.getById);
const enrichIssues = vi.mocked(issuesService.enrichIssues);
const findBySlug = vi.mocked(workspaceRepo.findBySlug);
const isWorkspaceMember = vi.mocked(membersRepo.isWorkspaceMember);
const getDbMock = vi.mocked(getDb);

const WORKSPACE = {
  id: "ws-1",
  slug: "acme",
  ownerId: "user-1",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

// Slim chainy db: the module-issues route runs one builder query
// (select({issue}).from(issues).innerJoin(moduleIssues).where(...)).
function chainy(rows: any[]) {
  const p = Promise.resolve(rows);
  const chain: any = {
    // oxlint-disable-next-line unicorn/no-thenable -- drizzle mock must be both awaitable and chainable
    then: p.then.bind(p),
    catch: p.catch.bind(p),
    finally: p.finally.bind(p),
    limit: () => chain,
    orderBy: () => chain,
    offset: () => chain,
  };
  return chain;
}

function mockDbWithRows(rows: any[]) {
  const selects: { table: string }[] = [];
  const db: any = {
    select: () => {
      const builder: any = {
        table: "",
        innerJoin: () => builder,
        where: () => {
          selects.push({ table: builder.table });
          return chainy(rows);
        },
      };
      return {
        from: (table: any) => {
          builder.table = getTableName(table);
          return builder;
        },
      };
    },
  };
  return { db, selects };
}

function testApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.use("*", errorMiddleware);
  app.route("/api/workspaces/:slug/projects/:projectId/modules", moduleRoutes);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  findBySlug.mockResolvedValue(WORKSPACE as any);
  isWorkspaceMember.mockResolvedValue(true);
});

describe("module issues route (DEV-24 enrichment)", () => {
  it("GET /:moduleId/issues returns enriched issues via enrichIssues", async () => {
    getById.mockResolvedValue({ id: "m1", workspaceId: "ws-1" } as any);
    const RAW = { id: "i1", name: "Goal", stateId: null, workspaceId: "ws-1" };
    const ENRICHED = {
      ...RAW,
      labels: [],
      assignees: [],
      state: { id: "st1", name: "Todo" },
      moduleIds: ["m1"],
    };
    const { db, selects } = mockDbWithRows([{ issue: RAW }]);
    getDbMock.mockReturnValue(db as any);
    enrichIssues.mockResolvedValue([ENRICHED as any]);

    const app = testApp();
    const res = await app.request("/api/workspaces/acme/projects/p1/modules/m1/issues", undefined, {
      DB: {},
    } as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ results: [ENRICHED] });
    // Guard ran against the resolved workspace, join read from issues.
    expect(getById).toHaveBeenCalledWith(expect.anything(), "m1", "ws-1");
    expect(selects[0]?.table).toBe("issues");
    expect(enrichIssues).toHaveBeenCalledWith(expect.anything(), [RAW]);
  });

  it("GET /:moduleId/issues 404s before any query when the module is foreign", async () => {
    getById.mockRejectedValue(new HTTPException(404, { message: "Module not found" }));
    const app = testApp();
    const res = await app.request(
      "/api/workspaces/acme/projects/p1/modules/m-foreign/issues",
      undefined,
      { DB: {} } as never,
    );
    expect(res.status).toBe(404);
    expect(enrichIssues).not.toHaveBeenCalled();
  });
});
