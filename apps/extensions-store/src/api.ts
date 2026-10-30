import { Hono } from "hono";
import {
  PER_PAGE_MAX,
  countDownload,
  getLatest,
  getVersion,
  latestByName,
  listLatest,
  listVersions,
  type Sort,
} from "./store";
import type { AppEnv, ListedRow, VersionRow } from "./types";

const SORTS = new Set<Sort>(["all", "name", "downloads", "recent"]);
const NAME = /^(?!\.)[a-z0-9.-]{1,64}$/;

function strings(json: string): string[] {
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

export function downloadUrl(origin: string, name: string, version: string): string {
  return `${origin}/download/${encodeURIComponent(name)}/${encodeURIComponent(version)}.zip`;
}

export function iconUrl(origin: string, row: Pick<VersionRow, "name" | "icon_key">): string | null {
  return row.icon_key ? `${origin}/api/extensions/${encodeURIComponent(row.name)}/icon` : null;
}

function author(row: VersionRow) {
  return row.author_name || row.author_github
    ? { name: row.author_name, github: row.author_github }
    : null;
}

function summary(origin: string, row: ListedRow) {
  return {
    name: row.name,
    version: row.version,
    current_version: row.version,
    description: row.description ?? "",
    categories: strings(row.categories),
    author: author(row),
    publisher: row.publisher,
    first_party: row.first_party === 1,
    downloads: row.total_downloads,
    size: row.size,
    icon_url: iconUrl(origin, row),
    published_at: row.published_at,
  };
}

function detail(origin: string, row: ListedRow) {
  return {
    ...summary(origin, row),
    permissions: strings(row.permissions),
    homepage: row.homepage,
    repository: row.repository,
    sha256: row.sha256,
    signature: row.signature,
    download_url: downloadUrl(origin, row.name, row.version),
    screenshots: strings(row.screenshot_keys).map(
      (_, index) => `${origin}/api/extensions/${encodeURIComponent(row.name)}/screenshots/${index}`,
    ),
  };
}

export function versionEntry(origin: string, row: VersionRow) {
  return {
    name: row.name,
    version: row.version,
    sha256: row.sha256,
    size: row.size,
    signature: row.signature,
    permissions: strings(row.permissions),
    download_url: downloadUrl(origin, row.name, row.version),
    downloads: row.downloads,
    yanked: row.yanked === 1,
    yanked_reason: row.yanked_reason,
    published_at: row.published_at,
  };
}

function positive(value: string | undefined, fallback: number, max: number): number {
  const number = Number.parseInt(value ?? "", 10);
  return Number.isFinite(number) && number >= 1 ? Math.min(number, max) : fallback;
}

export const api = new Hono<AppEnv>();

api.get("/api/extensions", async (c) => {
  const url = new URL(c.req.url);
  const search = (c.req.query("search") ?? "").trim().slice(0, 100);
  const category = c.req.query("category")?.trim() || null;
  const requested = c.req.query("sort") as Sort | undefined;
  const sort = requested && SORTS.has(requested) ? requested : "all";
  const page = positive(c.req.query("page"), 1, 10_000);
  const perPage = positive(c.req.query("per_page"), 24, PER_PAGE_MAX);
  const { rows, total } = await listLatest(c.env.DB, { search, category, sort, page, perPage });

  const link = (target: number): string => {
    const next = new URL(`${url.origin}/api/extensions`);
    if (search) next.searchParams.set("search", search);
    if (category) next.searchParams.set("category", category);
    next.searchParams.set("sort", sort);
    next.searchParams.set("per_page", String(perPage));
    next.searchParams.set("page", String(target));
    return next.toString();
  };
  return c.json({
    data: rows.map((row) => summary(url.origin, row)),
    links: {
      next: page * perPage < total ? link(page + 1) : null,
      prev: page > 1 ? link(page - 1) : null,
    },
    meta: { page, per_page: perPage, total },
  });
});

// Registered before `/:name` so "versions" is never read as an extension name.
api.post("/api/extensions/versions", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "body must be JSON" }, 400);
  }
  const names = (body as { names?: unknown } | null)?.names;
  if (
    !Array.isArray(names) ||
    names.length > 500 ||
    !names.every((name) => typeof name === "string" && NAME.test(name))
  ) {
    return c.json({ error: "names must be an array of at most 500 extension names" }, 400);
  }
  return c.json(await latestByName(c.env.DB, [...new Set(names as string[])]));
});

api.get("/api/extensions/:name", async (c) => {
  const row = await getLatest(c.env.DB, c.req.param("name"));
  if (!row) return c.json({ error: "extension not found" }, 404);
  return c.json({ data: detail(new URL(c.req.url).origin, row) });
});

api.get("/api/extensions/:name/versions", async (c) => {
  const name = c.req.param("name");
  const rows = await listVersions(c.env.DB, name);
  if (rows.length === 0) return c.json({ error: "extension not found" }, 404);
  const origin = new URL(c.req.url).origin;
  return c.json({ data: rows.map((row) => versionEntry(origin, row)) });
});

api.get("/api/extensions/:name/icon", async (c) => {
  const row = await getLatest(c.env.DB, c.req.param("name"));
  if (!row?.icon_key) return c.json({ error: "no icon" }, 404);
  return asset(c.env.ARCHIVES, row.icon_key, row.icon_type ?? "application/octet-stream");
});

api.get("/api/extensions/:name/screenshots/:index", async (c) => {
  const row = await getLatest(c.env.DB, c.req.param("name"));
  const keys = row ? strings(row.screenshot_keys) : [];
  const key = keys[Number.parseInt(c.req.param("index"), 10)];
  if (!key) return c.json({ error: "no screenshot" }, 404);
  return asset(c.env.ARCHIVES, key, "image/png");
});

async function asset(bucket: R2Bucket, key: string, type: string): Promise<Response> {
  const object = await bucket.get(key);
  if (!object) return Response.json({ error: "asset missing" }, { status: 404 });
  return new Response(object.body, {
    headers: {
      "content-type": type,
      "content-length": String(object.size),
      "cache-control": "public, max-age=300",
      // SVG icons are served from the store origin: never let them run script.
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "x-content-type-options": "nosniff",
    },
  });
}

// Served straight from the Worker: the client refuses redirects on download.
api.get("/download/:name/:file", async (c) => {
  const name = c.req.param("name");
  const file = c.req.param("file");
  if (!file.endsWith(".zip")) return c.json({ error: "not found" }, 404);
  const version = file.slice(0, -".zip".length);
  const row = await getVersion(c.env.DB, name, version);
  if (!row) return c.json({ error: "version not found" }, 404);
  if (row.yanked === 1) return c.json({ error: "this version was yanked" }, 410);
  const object = await c.env.ARCHIVES.get(row.archive_key);
  if (!object) return c.json({ error: "archive missing" }, 500);
  // A failed counter write must never fail the download.
  await countDownload(c.env.DB, name, version).catch(() => undefined);
  return new Response(object.body, {
    headers: {
      "content-type": "application/zip",
      "content-length": String(object.size),
      "content-disposition": `attachment; filename="${name}-${version}.zip"`,
      etag: `"${row.sha256}"`,
      "cache-control": "public, max-age=60",
      "x-content-type-options": "nosniff",
    },
  });
});
