import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { Env } from "../../lib/env";

vi.mock("../../middleware/auth", () => ({
  authMiddleware: vi.fn(),
  extractToken: vi.fn(() => "session-token"),
  resolveRequestUser: vi.fn(async () => ({ id: "user-1" })),
}));
vi.mock("../../repositories/customers", () => ({
  findById: vi.fn(async () => null),
  findBySessionToken: vi.fn(),
}));
vi.mock("../../repositories/members", () => ({ isWorkspaceMember: vi.fn() }));
vi.mock("../../db/index", () => ({ getDb: vi.fn() }));
vi.mock("../../services/feedback_attachments", () => ({
  authorizeFeedbackAsset: vi.fn(async () => null),
}));
vi.mock("../../repositories/assets", () => ({ findById: vi.fn() }));

import { assetRoutes } from "../../routes/assets";
import * as assetsRepo from "../../repositories/assets";
import * as customersRepo from "../../repositories/customers";
import * as membersRepo from "../../repositories/members";

const BYTES = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
const findAssetMock = vi.mocked(assetsRepo.findById);

// R2 semantics: `range` returns that slice as the body; `size` stays the
// whole object's size.
const r2Get = vi.fn(async (_key: string, opts?: { range?: { offset: number; length: number } }) => {
  const { offset = 0, length = BYTES.length } = opts?.range ?? {};
  const slice = BYTES.slice(offset, offset + length);
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(slice);
      controller.close();
    },
  });
  return { body, size: BYTES.length };
});

function get(query = "", headers: Record<string, string> = {}) {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/api/assets", assetRoutes);
  return app.fetch(new Request(`http://localhost/api/assets/a1${query}`, { headers }), {
    DB: {},
    R2: { get: r2Get },
  } as unknown as Env);
}

const asset = (contentType: string) =>
  ({
    id: "a1",
    asset: "user-1/key",
    size: BYTES.length,
    contentType,
    createdById: "user-1",
  }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  findAssetMock.mockResolvedValue(asset("video/mp4"));
});

// <video>/<audio> (and AVPlayer on iOS, which refuses media otherwise) fetch
// with `Range` to start playback and to seek.
describe("asset GET /:id byte ranges", () => {
  it("serves a requested span as 206 Partial Content", async () => {
    const res = await get("", { Range: "bytes=2-5" });
    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Range")).toBe("bytes 2-5/10");
    expect(res.headers.get("Content-Length")).toBe("4");
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([2, 3, 4, 5]);
  });

  it("handles open-ended and suffix ranges, clamping to the file", async () => {
    let res = await get("", { Range: "bytes=7-" });
    expect(res.headers.get("Content-Range")).toBe("bytes 7-9/10");
    res = await get("", { Range: "bytes=-3" });
    expect(res.headers.get("Content-Range")).toBe("bytes 7-9/10");
    res = await get("", { Range: "bytes=8-100" });
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([8, 9]);
  });

  it("answers 416 for a start past the end without reading storage", async () => {
    const res = await get("", { Range: "bytes=10-" });
    expect(res.status).toBe(416);
    expect(res.headers.get("Content-Range")).toBe("bytes */10");
    expect(r2Get).not.toHaveBeenCalled();
  });

  it("authorizes before resolving the range, so a 416 never leaks a forbidden file's size", async () => {
    // Portal upload requested by someone outside the owning workspace.
    vi.mocked(customersRepo.findById).mockResolvedValueOnce({
      id: "c1",
      workspaceId: "ws-x",
    } as never);
    vi.mocked(membersRepo.isWorkspaceMember).mockResolvedValueOnce(false);
    const res = await get("", { Range: "bytes=10-" });
    expect(res.status).toBe(403);
    expect(res.headers.get("Content-Range")).toBeNull();
  });

  it("serves the whole file for no, malformed or multi ranges, advertising range support", async () => {
    const cases: Record<string, string>[] = [
      {},
      { Range: "bytes=5-2" },
      { Range: "bytes=0-1,4-5" },
    ];
    for (const headers of cases) {
      const res = await get("", headers);
      expect(res.status).toBe(200);
      expect(res.headers.get("Accept-Ranges")).toBe("bytes");
      expect((await res.arrayBuffer()).byteLength).toBe(10);
    }
  });

  it("plays media inline", async () => {
    expect((await get()).headers.get("Content-Disposition")).toBe("inline");
    findAssetMock.mockResolvedValue(asset("audio/mpeg"));
    expect((await get()).headers.get("Content-Disposition")).toBe("inline");
  });

  it("ignores Range on resized image variants (a different body)", async () => {
    findAssetMock.mockResolvedValue(asset("image/png"));
    const res = await get("?w=100", { Range: "bytes=0-1" });
    expect(res.status).toBe(200);
    expect(res.headers.get("Accept-Ranges")).toBeNull();
  });
});
