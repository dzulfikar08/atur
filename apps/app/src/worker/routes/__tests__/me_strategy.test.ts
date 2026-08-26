import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { Env } from "../../lib/env";
import { errorMiddleware } from "../../middleware/error";

vi.mock("../../db/index", () => ({ getDb: vi.fn() }));
vi.mock("../../repositories/workspaces", () => ({ listIdsByUser: vi.fn() }));

import { getDb } from "../../db/index";
import * as workspaceRepo from "../../repositories/workspaces";
import { meRoutes } from "../me";

const listIdsByUser = vi.mocked(workspaceRepo.listIdsByUser);

// Thenable that also chains like a drizzle query builder (inner/left joins
// and orderBy/limit are no-ops). Same pattern as workspace_tools.test.ts.
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

function mockDb(selectFixtures: any[][]) {
  let selectIdx = 0;
  return {
    select: () => {
      const rows = selectFixtures[Math.min(selectIdx, selectFixtures.length - 1)] ?? [];
      selectIdx++;
      const builder: any = {
        innerJoin: () => builder,
        leftJoin: () => builder,
        where: () => chainy(rows),
      };
      return {
        from: () => builder,
      };
    },
  } as any;
}

function testApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.use("*", errorMiddleware);
  // /api/me is authed globally in app.ts; stand in with a stub that sets the
  // context user the same way authMiddleware does.
  app.use("*", async (c, next) => {
    c.set("user", { sub: "user-1", email: "member@example.com" } as any);
    await next();
  });
  app.route("/api/me", meRoutes);
  return app;
}

const req = (app: Hono<{ Bindings: Env }>, path: string) =>
  app.request(path, undefined, {} as never);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/me/strategy (DEV-22)", () => {
  it("returns workspaces with strategy fields and the two newest history rows", async () => {
    listIdsByUser.mockResolvedValue(["ws-1", "ws-2"]);
    // Select order: workspaces, workspace_score_history.
    vi.mocked(getDb).mockReturnValue(
      mockDb([
        [
          {
            id: "ws-1",
            slug: "acme",
            name: "Acme",
            logo: null,
            moatScore: 4,
            aiProofScore: 3,
            strategyVerdict: "harden",
            strategyNote: "workflow lock-in",
            reviewedAt: "2026-08-26T00:00:00Z",
            deletedAt: null,
          },
        ],
        // Three history rows for ws-1 (desc) — only the two newest survive.
        [
          {
            workspaceId: "ws-1",
            moatScore: 4,
            aiProofScore: 3,
            strategyVerdict: "harden",
            strategyNote: "workflow lock-in",
            createdAt: "t3",
          },
          {
            workspaceId: "ws-1",
            moatScore: 3,
            aiProofScore: 2,
            strategyVerdict: null,
            strategyNote: null,
            createdAt: "t2",
          },
          {
            workspaceId: "ws-1",
            moatScore: 2,
            aiProofScore: 1,
            strategyVerdict: null,
            strategyNote: null,
            createdAt: "t1",
          },
        ],
      ]),
    );

    const res = await req(testApp(), "/api/me/strategy");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: any[] };
    expect(body.results).toHaveLength(1);
    const ws = body.results[0];
    expect(ws).toMatchObject({
      slug: "acme",
      moatScore: 4,
      aiProofScore: 3,
      strategyVerdict: "harden",
      reviewedAt: "2026-08-26T00:00:00Z",
    });
    expect(ws.history).toHaveLength(2);
    expect(ws.history[0]).toMatchObject({ moatScore: 4, createdAt: "t3" });
    expect(ws.history[1]).toMatchObject({ moatScore: 3, createdAt: "t2" });
    // No workspace-internal fields (ownerId etc.) leak into the response.
    expect(ws.ownerId).toBeUndefined();
  });

  it("returns [] when the user has no workspaces", async () => {
    listIdsByUser.mockResolvedValue([]);
    vi.mocked(getDb).mockReturnValue(mockDb([[]]));

    const res = await req(testApp(), "/api/me/strategy");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ results: [] });
    expect(getDb).toHaveBeenCalled();
  });
});

describe("GET /api/me/decisions (DEV-22)", () => {
  it("returns open decision issues across workspaces", async () => {
    listIdsByUser.mockResolvedValue(["ws-1"]);
    const rows = [
      {
        id: "i1",
        name: "Kill or continue",
        sequenceId: 7,
        priority: "high",
        targetDate: "2026-11-24",
        projectId: "p1",
        projectName: "Core",
        projectIdentifier: "CORE",
        workspaceSlug: "acme",
        workspaceName: "Acme",
        stateName: "Todo",
        stateColor: "#3B82F6",
      },
    ];
    vi.mocked(getDb).mockReturnValue(mockDb([rows]));

    const res = await req(testApp(), "/api/me/decisions");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ results: rows });
    expect(listIdsByUser).toHaveBeenCalledWith(expect.anything(), "user-1");
  });

  it("returns [] when the user has no workspaces", async () => {
    listIdsByUser.mockResolvedValue([]);
    vi.mocked(getDb).mockReturnValue(mockDb([[]]));

    const res = await req(testApp(), "/api/me/decisions");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ results: [] });
  });
});
