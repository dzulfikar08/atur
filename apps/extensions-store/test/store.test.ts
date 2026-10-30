import { describe, expect, it } from "vitest";
import app from "../src/index";
import { compareSemver, highest, isSemver } from "../src/semver";
import { publishRequest, testEnv, TOKEN, signer } from "./helpers";

const ORIGIN = "https://extensions.diatur.com";

async function setup() {
  const { env, keys } = await testEnv();
  const call = (path: string, init?: RequestInit) =>
    app.fetch(new Request(`${ORIGIN}${path}`, init), env);
  const publish = (
    options?: Parameters<typeof publishRequest>[1],
    extra?: Parameters<typeof publishRequest>[2],
  ) => publishRequest(keys, options, extra).then((request) => app.fetch(request, env));
  const authed = (path: string, body: unknown) =>
    call(path, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  return { env, keys, call, publish, authed };
}

describe("semver", () => {
  it("orders like the client", () => {
    expect(compareSemver("1.10.0", "1.9.0")).toBeGreaterThan(0);
    expect(compareSemver("1.0.0-beta.2", "1.0.0-beta.10")).toBeLessThan(0);
    expect(compareSemver("1.0.0-rc.1", "1.0.0")).toBeLessThan(0);
    expect(compareSemver("1.0.0+build", "1.0.0")).toBe(0);
    expect(highest(["1.2.0", "1.10.0", "1.9.9"])).toBe("1.10.0");
    expect(isSemver("01.0.0")).toBe(false);
    expect(isSemver("1.0")).toBe(false);
  });
});

describe("publish", () => {
  it("publishes and serves list/detail/versions/download", async () => {
    const { call, publish } = await setup();
    const response = await publish({ deflate: true });
    expect(response.status).toBe(201);

    const list = (await (
      await call("/api/extensions?search=file&sort=all&per_page=24&page=1")
    ).json()) as any;
    expect(list.data).toHaveLength(1);
    expect(list.data[0]).toMatchObject({
      name: "files",
      version: "1.0.0",
      description: "Browse files",
    });
    expect(list.links.next).toBeNull();

    const detail = (await (await call("/api/extensions/files")).json()) as any;
    expect(detail.data).toMatchObject({
      name: "files",
      current_version: "1.0.0",
      permissions: ["files:read"],
      download_url: `${ORIGIN}/download/files/1.0.0.zip`,
    });
    expect(detail.data.signature).toMatch(/^[A-Za-z0-9+/]{86}==$/);
    expect(detail.data.sha256).toMatch(/^[0-9a-f]{64}$/);

    const download = await call("/download/files/1.0.0.zip");
    expect(download.status).toBe(200);
    expect(download.headers.get("content-type")).toBe("application/zip");
    const bytes = new Uint8Array(await download.arrayBuffer());
    expect(bytes.length).toBe(detail.data.size);
    expect(
      Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (b) =>
        b.toString(16).padStart(2, "0"),
      ).join(""),
    ).toBe(detail.data.sha256);

    const counted = (await (await call("/api/extensions/files")).json()) as any;
    expect(counted.data.downloads).toBe(1);

    const versions = await call("/api/extensions/versions", {
      method: "POST",
      body: JSON.stringify({ names: ["files", "missing"] }),
    });
    expect(await versions.json()).toEqual({ files: "1.0.0", missing: null });

    const history = (await (await call("/api/extensions/files/versions")).json()) as any;
    expect(history.data[0]).toMatchObject({ version: "1.0.0", yanked: false });
    expect(history.data[0].signature).toBe(detail.data.signature);

    const icon = await call("/api/extensions/files/icon");
    expect(icon.headers.get("content-type")).toBe("image/svg+xml");
  });

  it("accepts an archive nested in one top-level directory", async () => {
    const { publish } = await setup();
    expect((await publish({ nested: true })).status).toBe(201);
  });

  it("requires the bearer token", async () => {
    const { publish } = await setup();
    expect((await publish({}, { token: null })).status).toBe(401);
    expect((await publish({}, { token: "wrong" })).status).toBe(401);
  });

  it("is not configured without the secret", async () => {
    const { env, keys } = await setup();
    delete env.EXTENSIONS_PUBLISH_TOKEN;
    const response = await app.fetch(await publishRequest(keys), env);
    expect(response.status).toBe(503);
  });

  it("refuses versions that are not newer, even yanked ones", async () => {
    const { publish, authed } = await setup();
    expect((await publish({ version: "1.1.0" })).status).toBe(201);
    expect((await publish({ version: "1.1.0" })).status).toBe(409);
    expect((await publish({ version: "1.0.9" })).status).toBe(409);
    await authed("/api/yank", { name: "files", version: "1.1.0" });
    expect((await publish({ version: "1.1.0" })).status).toBe(409);
    expect((await publish({ version: "1.2.0" })).status).toBe(201);
  });

  it("pins the publisher to the first repository", async () => {
    const { publish } = await setup();
    expect((await publish()).status).toBe(201);
    const squat = await publish({ version: "2.0.0", publisher: "evil/repo" });
    expect(squat.status).toBe(403);
    expect(((await squat.json()) as any).error).toContain("belongs to");
  });

  it("rejects a bad signature", async () => {
    const { publish } = await setup();
    const other = await signer();
    const forged = await publish(
      {},
      {
        tamper: (form) => {
          form.set("signature", "A".repeat(86) + "==");
        },
      },
    );
    expect(forged.status).toBe(403);
    expect(other.publicKey).toBeTruthy();
  });

  it("rejects an artifact that differs from the signed metadata", async () => {
    const { publish } = await setup();
    const response = await publish(
      {},
      {
        tamper: (form) => {
          form.set("artifact", new File([new Uint8Array(10)], "x.zip"));
        },
      },
    );
    expect(response.status).toBe(422);
  });

  it("rejects archives that disagree with the metadata", async () => {
    const { publish } = await setup();
    expect((await publish({ zipVersion: "9.9.9" })).status).toBe(422);
    expect((await publish({ zipName: "other" })).status).toBe(422);
    expect((await publish({ zipPermissions: ["files:read", "commands:exec"] })).status).toBe(422);
  });

  it("rejects reserved and malformed names", async () => {
    const { publish } = await setup();
    expect((await publish({ name: "foundation" })).status).toBe(422);
    expect((await publish({ name: "versions" })).status).toBe(422);
    expect((await publish({ name: "Bad Name" })).status).toBe(422);
  });

  it("refuses oversize uploads before reading them", async () => {
    const { env } = await setup();
    const response = await app.fetch(
      new Request(`${ORIGIN}/api/publish`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${TOKEN}`,
          "content-length": String(200 * 1024 * 1024),
          "content-type": "multipart/form-data; boundary=x",
        },
        body: "x",
      }),
      env,
    );
    expect(response.status).toBe(413);
  });
});

describe("yank", () => {
  it("hides yanked versions from clients and falls back to the previous one", async () => {
    const { call, publish, authed } = await setup();
    await publish({ version: "1.0.0" });
    await publish({ version: "1.1.0" });
    expect(
      (await authed("/api/yank", { name: "files", version: "1.1.0", reason: "broken" })).status,
    ).toBe(200);
    expect((await call("/download/files/1.1.0.zip")).status).toBe(410);
    const detail = (await (await call("/api/extensions/files")).json()) as any;
    expect(detail.data.current_version).toBe("1.0.0");
    const versions = await call("/api/extensions/versions", {
      method: "POST",
      body: JSON.stringify({ names: ["files"] }),
    });
    expect(await versions.json()).toEqual({ files: "1.0.0" });

    await authed("/api/yank", { name: "files", version: "1.0.0" });
    expect((await call("/api/extensions/files")).status).toBe(404);
    expect(((await (await call("/api/extensions")).json()) as any).data).toEqual([]);

    await authed("/api/yank", { name: "files", version: "1.1.0", yanked: false });
    expect((await call("/download/files/1.1.0.zip")).status).toBe(200);
  });

  it("needs the token and an existing version", async () => {
    const { call, authed } = await setup();
    const anonymous = await call("/api/yank", { method: "POST", body: "{}" });
    expect(anonymous.status).toBe(401);
    expect((await authed("/api/yank", { name: "nope", version: "1.0.0" })).status).toBe(404);
  });
});

describe("listing", () => {
  it("filters by category, paginates with links.next and escapes search wildcards", async () => {
    const { call, publish } = await setup();
    await publish({ name: "git", description: "Source control", categories: ["vcs"] });
    await publish({ name: "files", description: "Browse files", categories: ["files"] });
    await publish({ name: "tree", description: "100% tree", categories: ["files"] });

    const byCategory = (await (await call("/api/extensions?category=files")).json()) as any;
    expect(byCategory.data.map((item: any) => item.name)).toEqual(["files", "tree"]);

    const page = (await (await call("/api/extensions?per_page=2&page=1")).json()) as any;
    expect(page.data).toHaveLength(2);
    expect(typeof page.links.next).toBe("string");
    const next = (await (
      await call(new URL(page.links.next).pathname + new URL(page.links.next).search)
    ).json()) as any;
    expect(next.data.map((item: any) => item.name)).toEqual(["tree"]);
    expect(next.links.next).toBeNull();

    const percent = (await (
      await call("/api/extensions?search=" + encodeURIComponent("%"))
    ).json()) as any;
    expect(percent.data.map((item: any) => item.name)).toEqual(["tree"]);
  });

  it("rejects malformed version batches", async () => {
    const { call } = await setup();
    const response = await call("/api/extensions/versions", {
      method: "POST",
      body: JSON.stringify({ names: [1] }),
    });
    expect(response.status).toBe(400);
  });
});

describe("pages", () => {
  it("renders the list and detail pages, escaping content", async () => {
    const { call, publish } = await setup();
    await publish({ description: "<script>alert(1)</script>" });
    const home = await call("/");
    expect(home.headers.get("content-type")).toContain("text/html");
    expect(home.headers.get("content-security-policy")).toContain("default-src 'none'");
    const html = await home.text();
    expect(html).toContain("files");
    expect(html).not.toContain("<script>alert");

    const detail = await (await call("/e/files")).text();
    expect(detail).toContain("files:read");
    expect(detail).toContain("/download/files/1.0.0.zip");
    expect(detail).not.toMatch(/muxy/i);
    expect((await call("/e/missing")).status).toBe(404);
  });
});
