import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { Env } from "../../lib/env";

vi.mock("../../middleware/auth", () => ({
  authMiddleware: vi.fn(),
  extractToken: vi.fn(),
  resolveRequestUser: vi.fn(),
}));

vi.mock("../../repositories/customers", () => ({
  findById: vi.fn(),
  findBySessionToken: vi.fn(),
}));
vi.mock("../../repositories/members", () => ({ isWorkspaceMember: vi.fn() }));
vi.mock("../../db/index", () => ({ getDb: vi.fn() }));
// serveInline stays real — the header contract under test is its consumer.
vi.mock("../../services/assets", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getAsset: vi.fn(),
}));

import { assetRoutes } from "../../routes/assets";
import { extractToken, resolveRequestUser } from "../../middleware/auth";
import { getAsset } from "../../services/assets";
import * as customersRepo from "../../repositories/customers";

const tokenMock = vi.mocked(extractToken);
const resolveMock = vi.mocked(resolveRequestUser);
const getAssetMock = vi.mocked(getAsset);
const findCustomerMock = vi.mocked(customersRepo.findById);

function testApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/api/assets", assetRoutes);
  return app;
}

function request(id: string) {
  return new Request(`http://localhost/api/assets/${id}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  tokenMock.mockReturnValue("session-token");
  resolveMock.mockResolvedValue({ id: "user-1" } as never);
  findCustomerMock.mockResolvedValue(null as never);
  getAssetMock.mockResolvedValue({
    asset: { createdById: "user-1" },
    contentType: "image/png",
    size: 42,
    body: new ReadableStream(),
  } as never);
});

// GET /:id feeds <img src="/api/assets/…"> across the app (workspace logos,
// avatars, comment attachments). <img> refuses to render images served as
// application/octet-stream — nosniff blocks them outright — so the response
// MUST carry the true stored MIME even when the disposition forces a
// download. Re-writing the type to octet-stream broke every SVG logo.
describe("asset GET /:id response headers", () => {
  it("serves SVG with its true MIME but forces download (renders in <img>, never executes)", async () => {
    getAssetMock.mockResolvedValue({
      asset: { createdById: "user-1" },
      contentType: "image/svg+xml",
      size: 4989,
      body: new ReadableStream(),
    } as never);

    const res = await testApp().fetch(request("a1"), {
      DB: {},
      R2: {},
    } as unknown as Env);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/svg+xml");
    expect(res.headers.get("Content-Disposition")).toBe("attachment");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("serves raster images inline with their true MIME", async () => {
    const res = await testApp().fetch(request("a2"), {
      DB: {},
      R2: {},
    } as unknown as Env);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("Content-Disposition")).toBe("inline");
  });

  it("still rejects anonymous requests (asset IDs are not public)", async () => {
    tokenMock.mockReturnValue(null);

    const res = await testApp().fetch(request("a3"), {
      DB: {},
      R2: {},
    } as unknown as Env);

    expect(res.status).toBe(401);
    expect(getAssetMock).not.toHaveBeenCalled();
  });

  it("normalizes case-trick SVG types before classifying (image/SVG+XML never serves inline)", async () => {
    getAssetMock.mockResolvedValue({
      asset: { createdById: "user-1" },
      contentType: "image/SVG+XML",
      size: 10,
      body: new ReadableStream(),
    } as never);

    const res = await testApp().fetch(request("a4"), {
      DB: {},
      R2: {},
    } as unknown as Env);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/svg+xml");
    expect(res.headers.get("Content-Disposition")).toBe("attachment");
  });

  it("falls back to octet-stream when the stored type is not header-safe", async () => {
    getAssetMock.mockResolvedValue({
      asset: { createdById: "user-1" },
      contentType: "not a valid\tmime",
      size: 10,
      body: new ReadableStream(),
    } as never);

    const res = await testApp().fetch(request("a5"), {
      DB: {},
      R2: {},
    } as unknown as Env);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(res.headers.get("Content-Disposition")).toBe("attachment");
  });
});
