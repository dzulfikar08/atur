import { describe, expect, it } from "vitest";
import { getTableName } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { handleTool } from "../../routes/mcp/index";

// 1x1 transparent PNG.
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const PNG_BYTES = Uint8Array.from(atob(PNG_B64), (ch) => ch.charCodeAt(0));

// Thenable that also chains like a drizzle query builder (same pattern as
// workspace_tools.test.ts). upload_image only needs select (findById after
// insert) and insert (createAsset).
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

function mockDb(assetRow: any) {
  const inserts: any[] = [];
  const db: any = {
    select: () => {
      const builder: any = {
        table: "",
        where: () => chainy([assetRow]),
      };
      return {
        from: (table: any) => {
          builder.table = getTableName(table);
          return builder;
        },
      };
    },
    insert: () => ({
      values: (vals: any) => {
        inserts.push(vals);
        return {};
      },
    }),
  };
  return { db, inserts };
}

function mockEnv() {
  const puts: { key: string; body: ArrayBuffer; contentType: string }[] = [];
  const env: any = {
    R2: {
      put: async (key: string, body: ArrayBuffer, opts: any) => {
        puts.push({ key, body, contentType: opts?.httpMetadata?.contentType });
        return {};
      },
    },
  };
  return { env, puts };
}

async function expectStatus(fn: () => Promise<unknown>, status: number) {
  try {
    await fn();
  } catch (err) {
    expect(err).toBeInstanceOf(HTTPException);
    expect((err as HTTPException).status).toBe(status);
    return;
  }
  throw new Error(`expected HTTPException(${status})`);
}

describe("mcp upload_image", () => {
  const USER = "u1";

  it("stores bytes in R2 and returns id/url/size/filename", async () => {
    const { db, inserts } = mockDb({ id: "asset-1", asset: "k" });
    const { env, puts } = mockEnv();

    const result = (await handleTool(
      db,
      env,
      "upload_image",
      { content_base64: PNG_B64, filename: "evidence.png" },
      USER,
    )) as any;

    expect(new Uint8Array(puts[0].body)).toEqual(PNG_BYTES);
    expect(puts[0].contentType).toBe("image/png");
    expect(puts[0].key).toMatch(new RegExp(`^${USER}/[0-9a-f-]{36}$`));
    expect(result).toEqual({
      id: "asset-1",
      url: "/api/assets/asset-1",
      size: PNG_BYTES.byteLength,
      filename: "evidence.png",
    });
    expect(inserts[0].entityId).toBeNull();
  });

  it("absolutizes the url when an origin is passed", async () => {
    const { db } = mockDb({ id: "asset-2", asset: "k" });
    const { env } = mockEnv();

    const result = (await handleTool(
      db,
      env,
      "upload_image",
      { content_base64: PNG_B64, filename: "shot.png" },
      USER,
      "https://app.diatur.com",
    )) as any;

    expect(result.url).toBe("https://app.diatur.com/api/assets/asset-2");
  });

  it("accepts data: URLs and honours an explicit mime_type", async () => {
    const { db } = mockDb({ id: "asset-3", asset: "k" });
    const { env, puts } = mockEnv();

    const result = (await handleTool(
      db,
      env,
      "upload_image",
      {
        content_base64: `data:image/jpeg;base64,${PNG_B64}`,
        filename: "capture",
        mime_type: "image/jpeg",
      },
      USER,
    )) as any;

    expect(puts[0].contentType).toBe("image/jpeg");
    expect(result.size).toBe(PNG_BYTES.byteLength);
  });

  it("accepts data: URL variants (empty MIME, charset params)", async () => {
    const { db } = mockDb({ id: "asset-8", asset: "k" });
    const { env, puts } = mockEnv();

    for (const raw of [
      `data:;base64,${PNG_B64}`,
      `data:image/png;charset=utf-8;base64,${PNG_B64}`,
    ]) {
      const result = (await handleTool(
        db,
        env,
        "upload_image",
        { content_base64: raw, filename: "shot.png" },
        USER,
      )) as any;
      expect(result.size).toBe(PNG_BYTES.byteLength);
    }
    expect(puts.map((p) => p.contentType)).toEqual(["image/png", "image/png"]);
  });

  it("keeps only the basename of a caller-supplied path", async () => {
    const { db } = mockDb({ id: "asset-4", asset: "k" });
    const { env } = mockEnv();

    const result = (await handleTool(
      db,
      env,
      "upload_image",
      { content_base64: PNG_B64, filename: "/etc/passwd/evil.png" },
      USER,
    )) as any;

    expect(result.filename).toBe("evil.png");
  });

  it("rejects missing and invalid base64 with 400", async () => {
    const { db } = mockDb({ id: "asset-5", asset: "k" });
    const { env } = mockEnv();

    await expectStatus(
      () => handleTool(db, env, "upload_image", { filename: "x.png" }, USER),
      400,
    );
    await expectStatus(
      () =>
        handleTool(
          db,
          env,
          "upload_image",
          { content_base64: "!!! not base64 !!!", filename: "x.png" },
          USER,
        ),
      400,
    );
  });

  it("rejects oversized payloads before decoding with 413", async () => {
    const { db } = mockDb({ id: "asset-6", asset: "k" });
    const { env, puts } = mockEnv();

    // Valid base64 that would decode past the cap — must be rejected on
    // length alone (R2 untouched).
    await expectStatus(
      () =>
        handleTool(
          db,
          env,
          "upload_image",
          { content_base64: "A".repeat(36 * 1024 * 1024), filename: "big.png" },
          USER,
        ),
      413,
    );
    expect(puts).toHaveLength(0);
  });

  it("ignores unsafe caller-supplied MIME types", async () => {
    const { db, inserts } = mockDb({ id: "asset-7", asset: "k" });
    const { env, puts } = mockEnv();

    const result = (await handleTool(
      db,
      env,
      "upload_image",
      {
        content_base64: PNG_B64,
        filename: "payload.html",
        mime_type: "text/html",
      },
      USER,
    )) as any;

    // Falls back to the unknown extension default, never the stored type.
    expect(puts[0].contentType).toBe("application/octet-stream");
    expect(inserts[0].contentType).toBe("application/octet-stream");
    expect(result.filename).toBe("payload.html");
  });
});
