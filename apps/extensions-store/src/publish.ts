import { Hono, type Context } from "hono";
import { safeEqual, sha256Hex, verifyEd25519 } from "./crypto";
import { compareSemver, isSemver } from "./semver";
import { getExtension, getVersion, highestPublished, refreshLatest } from "./store";
import type { AppEnv, Metadata, PublishedAsset } from "./types";
import { readPackageJson } from "./zip";

export const MAX_ARCHIVE = 64 * 1024 * 1024;
const MAX_ICON = 1024 * 1024;
const MAX_SCREENSHOT = 5 * 1024 * 1024;
const MAX_SCREENSHOTS = 6;
// Multipart framing, metadata and listing assets on top of the archive itself.
const MAX_BODY = MAX_ARCHIVE + MAX_ICON + MAX_SCREENSHOTS * MAX_SCREENSHOT + 1024 * 1024;

const NAME = /^(?!\.)[a-z0-9.-]{1,64}$/;
const RESERVED = new Set(["foundation", "versions"]);
const HEX64 = /^[0-9a-f]{64}$/;
const PUBLISHER = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\/[A-Za-z0-9._-]{1,100}$/;

class Rejection extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 409 | 413 | 422,
    message: string,
  ) {
    super(message);
  }
}

async function authorize(c: Context<AppEnv>): Promise<Response | null> {
  const secret = c.env.EXTENSIONS_PUBLISH_TOKEN;
  if (!secret) return c.json({ error: "publishing is not configured" }, 503);
  const header = c.req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  if (!token || !(await safeEqual(token, secret))) {
    return c.json({ error: "invalid or missing bearer token" }, 401);
  }
  return null;
}

function text(value: unknown, field: string, max: number): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || value.length > max) {
    throw new Rejection(422, `${field} must be a string of at most ${max} characters`);
  }
  return value;
}

function webUrl(value: unknown, field: string): string | null {
  const url = text(value, field, 500);
  if (url === null || url === "") return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:" || parsed.protocol === "http:") return parsed.toString();
  } catch {
    // fall through
  }
  throw new Rejection(422, `${field} must be an http(s) URL`);
}

function asset(value: unknown, field: string): PublishedAsset | null {
  if (value === null || value === undefined) return null;
  const item = value as Partial<PublishedAsset>;
  if (
    typeof item.field !== "string" ||
    typeof item.filename !== "string" ||
    typeof item.sha256 !== "string" ||
    !HEX64.test(item.sha256)
  ) {
    throw new Rejection(422, `${field} is malformed`);
  }
  return { field: item.field, filename: item.filename, sha256: item.sha256 };
}

export function parseMetadata(raw: unknown): Metadata {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Rejection(422, "metadata must be a JSON object");
  }
  const m = raw as Record<string, unknown>;
  if (typeof m.name !== "string" || !NAME.test(m.name) || RESERVED.has(m.name)) {
    throw new Rejection(422, "metadata.name is not a valid extension name");
  }
  if (typeof m.version !== "string" || !isSemver(m.version)) {
    throw new Rejection(422, "metadata.version must be a semver version");
  }
  if (typeof m.sha256 !== "string" || !HEX64.test(m.sha256)) {
    throw new Rejection(422, "metadata.sha256 must be 64 lowercase hex characters");
  }
  if (!Number.isSafeInteger(m.size) || (m.size as number) <= 0) {
    throw new Rejection(422, "metadata.size must be a positive integer");
  }
  if (
    !Array.isArray(m.permissions) ||
    m.permissions.length > 100 ||
    !m.permissions.every((p) => typeof p === "string" && p.length <= 64)
  ) {
    throw new Rejection(422, "metadata.permissions must be an array of permission strings");
  }
  if (new Set(m.permissions).size !== m.permissions.length) {
    throw new Rejection(422, "metadata.permissions must not repeat");
  }
  const categories = m.categories ?? [];
  if (
    !Array.isArray(categories) ||
    categories.length > 20 ||
    !categories.every((c) => typeof c === "string" && c.length > 0 && c.length <= 40)
  ) {
    throw new Rejection(422, "metadata.categories must be an array of short strings");
  }
  if (typeof m.publisher !== "string" || !PUBLISHER.test(m.publisher)) {
    throw new Rejection(422, 'metadata.publisher must be "<owner>/<repo>"');
  }
  let author: Metadata["author"] = null;
  if (m.author !== null && m.author !== undefined) {
    const a = m.author as Record<string, unknown>;
    author = {
      name: text(a.name, "author.name", 100),
      github: text(a.github, "author.github", 100),
    };
  }
  const screenshots = m.screenshots ?? [];
  if (!Array.isArray(screenshots) || screenshots.length > MAX_SCREENSHOTS) {
    throw new Rejection(422, `metadata.screenshots allows at most ${MAX_SCREENSHOTS} entries`);
  }
  return {
    name: m.name,
    version: m.version,
    sha256: m.sha256,
    size: m.size as number,
    description: text(m.description, "description", 500),
    permissions: m.permissions as string[],
    author,
    homepage: webUrl(m.homepage, "homepage"),
    repository: webUrl(m.repository, "repository"),
    categories: categories as string[],
    icon: asset(m.icon, "icon"),
    screenshots: screenshots.map((item, index) => {
      const parsed = asset(item, `screenshots[${index}]`);
      if (!parsed) throw new Rejection(422, `screenshots[${index}] is malformed`);
      return parsed;
    }),
    publisher: m.publisher,
    firstParty: m.firstParty === true,
  };
}

async function file(
  form: FormData,
  field: string,
  limit: number,
): Promise<{ bytes: Uint8Array; type: string } | null> {
  const value = form.get(field) as File | string | null;
  if (value === null) return null;
  if (typeof value === "string") {
    const bytes = new TextEncoder().encode(value);
    if (bytes.length > limit) throw new Rejection(413, `${field} is too large`);
    return { bytes, type: "" };
  }
  if (value.size > limit) throw new Rejection(413, `${field} is too large`);
  return { bytes: new Uint8Array(await value.arrayBuffer()), type: value.type };
}

function signatureField(form: FormData, field: string): string {
  const value = form.get(field);
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 256) {
    throw new Rejection(422, `${field} is required (base64 Ed25519 signature)`);
  }
  return value.trim();
}

/** The manifest section the client reads permissions from (`atur-terminal`, legacy `muxy`). */
function manifestPermissions(manifest: unknown): string[] {
  const section =
    (manifest as Record<string, Record<string, unknown> | undefined>)["atur-terminal"] ??
    (manifest as Record<string, Record<string, unknown> | undefined>)["muxy"];
  const permissions = section?.permissions ?? [];
  return Array.isArray(permissions) ? permissions.map(String) : [];
}

function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && new Set([...a, ...b]).size === a.length;
}

function imageType(filename: string, expected: "icon" | "screenshot"): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (expected === "icon" && lower.endsWith(".svg")) return "image/svg+xml";
  throw new Rejection(
    422,
    `${expected} must be ${expected === "icon" ? "an SVG or PNG" : "a PNG"}`,
  );
}

async function publish(c: Context<AppEnv>): Promise<Response> {
  const declared = Number(c.req.header("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY) {
    throw new Rejection(413, `upload exceeds the ${MAX_ARCHIVE / 1024 / 1024} MiB archive limit`);
  }
  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    throw new Rejection(400, "body must be multipart/form-data");
  }

  const archive = await file(form, "artifact", MAX_ARCHIVE);
  const metadataFile = await file(form, "metadata", 256 * 1024);
  if (!archive || !metadataFile) throw new Rejection(422, "artifact and metadata are required");
  const signature = signatureField(form, "signature");
  const metadataSignature = signatureField(form, "metadataSignature");

  let metadata: Metadata;
  try {
    metadata = parseMetadata(JSON.parse(new TextDecoder().decode(metadataFile.bytes)));
  } catch (error) {
    if (error instanceof Rejection) throw error;
    throw new Rejection(422, "metadata is not valid JSON");
  }
  for (const [header, expected] of [
    ["x-extension-name", metadata.name],
    ["x-extension-version", metadata.version],
    ["x-extension-sha256", metadata.sha256],
  ] as const) {
    const given = c.req.header(header);
    if (given !== undefined && given !== expected) {
      throw new Rejection(422, `${header} does not match metadata`);
    }
  }

  if (archive.bytes.length !== metadata.size) {
    throw new Rejection(422, "artifact size does not match metadata.size");
  }
  if ((await sha256Hex(archive.bytes)) !== metadata.sha256) {
    throw new Rejection(422, "artifact sha256 does not match metadata.sha256");
  }
  const pubkey = c.env.SIGNING_PUBKEY;
  if (
    !(await verifyEd25519(pubkey, signature, archive.bytes)) ||
    !(await verifyEd25519(pubkey, metadataSignature, metadataFile.bytes))
  ) {
    throw new Rejection(403, "signature does not verify against the store signing key");
  }

  let manifest: unknown;
  try {
    manifest = await readPackageJson(archive.bytes);
  } catch (error) {
    throw new Rejection(422, `archive: ${error instanceof Error ? error.message : "unreadable"}`);
  }
  const identity = manifest as { name?: unknown; version?: unknown };
  if (identity.name !== metadata.name || identity.version !== metadata.version) {
    throw new Rejection(422, "archive package.json name/version does not match metadata");
  }
  if (!sameSet(manifestPermissions(manifest), metadata.permissions)) {
    throw new Rejection(422, "archive permissions do not match metadata.permissions");
  }

  // Listing assets declared in the metadata must arrive with matching hashes.
  const assets: { key: string; bytes: Uint8Array; type: string }[] = [];
  const prefix = `assets/${metadata.name}/${metadata.version}`;
  let iconKey: string | null = null;
  let iconType: string | null = null;
  if (metadata.icon) {
    const upload = await file(form, metadata.icon.field, MAX_ICON);
    if (!upload) throw new Rejection(422, `missing upload for ${metadata.icon.field}`);
    if ((await sha256Hex(upload.bytes)) !== metadata.icon.sha256) {
      throw new Rejection(422, "icon sha256 does not match metadata");
    }
    iconType = imageType(metadata.icon.filename, "icon");
    iconKey = `${prefix}/icon`;
    assets.push({ key: iconKey, bytes: upload.bytes, type: iconType });
  }
  const screenshotKeys: string[] = [];
  for (const [index, shot] of metadata.screenshots.entries()) {
    const upload = await file(form, shot.field, MAX_SCREENSHOT);
    if (!upload) throw new Rejection(422, `missing upload for ${shot.field}`);
    if ((await sha256Hex(upload.bytes)) !== shot.sha256) {
      throw new Rejection(422, `${shot.field} sha256 does not match metadata`);
    }
    const type = imageType(shot.filename, "screenshot");
    const key = `${prefix}/screenshot-${index}`;
    screenshotKeys.push(key);
    assets.push({ key, bytes: upload.bytes, type });
  }

  const { DB: db, ARCHIVES: bucket } = c.env;
  const existing = await getExtension(db, metadata.name);
  if (existing && existing.publisher !== metadata.publisher) {
    throw new Rejection(
      403,
      `the name "${metadata.name}" belongs to ${existing.publisher}, not ${metadata.publisher}`,
    );
  }
  const highest = await highestPublished(db, metadata.name);
  if (highest !== null && compareSemver(metadata.version, highest) <= 0) {
    throw new Rejection(409, `version ${metadata.version} is not newer than ${highest}`);
  }
  if (await getVersion(db, metadata.name, metadata.version)) {
    throw new Rejection(409, `${metadata.name}@${metadata.version} already exists`);
  }

  const archiveKey = `archives/${metadata.name}/${metadata.version}.zip`;
  const written = [archiveKey, ...assets.map((item) => item.key)];
  try {
    await bucket.put(archiveKey, archive.bytes, {
      sha256: metadata.sha256,
      httpMetadata: { contentType: "application/zip" },
    });
    for (const item of assets) {
      await bucket.put(item.key, item.bytes, { httpMetadata: { contentType: item.type } });
    }
    const now = Date.now();
    await db.batch([
      db
        .prepare(
          `INSERT INTO extensions (name, publisher, first_party, latest_version, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (name) DO UPDATE SET latest_version = excluded.latest_version,
             updated_at = excluded.updated_at`,
        )
        .bind(
          metadata.name,
          metadata.publisher,
          metadata.firstParty ? 1 : 0,
          metadata.version,
          now,
          now,
        ),
      db
        .prepare(
          `INSERT INTO extension_versions (name, version, sha256, size, signature, metadata_signature,
             description, permissions, categories, author_name, author_github, homepage, repository,
             archive_key, icon_key, icon_type, screenshot_keys, published_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          metadata.name,
          metadata.version,
          metadata.sha256,
          metadata.size,
          signature,
          metadataSignature,
          metadata.description,
          JSON.stringify(metadata.permissions),
          JSON.stringify(metadata.categories),
          metadata.author?.name ?? null,
          metadata.author?.github ?? null,
          metadata.homepage,
          metadata.repository,
          archiveKey,
          iconKey,
          iconType,
          JSON.stringify(screenshotKeys),
          now,
        ),
    ]);
  } catch (error) {
    const conflict = error instanceof Error && /UNIQUE|constraint/i.test(error.message);
    // A unique violation means another publish won the race and owns these keys.
    if (!conflict) await bucket.delete(written).catch(() => undefined);
    if (conflict) throw new Rejection(409, `${metadata.name}@${metadata.version} already exists`);
    throw error;
  }

  return c.json(
    {
      ok: true,
      name: metadata.name,
      version: metadata.version,
      sha256: metadata.sha256,
      size: metadata.size,
      url: `${new URL(c.req.url).origin}/e/${encodeURIComponent(metadata.name)}`,
    },
    201,
  );
}

async function yank(c: Context<AppEnv>): Promise<Response> {
  let body: { name?: unknown; version?: unknown; yanked?: unknown; reason?: unknown };
  try {
    body = await c.req.json();
  } catch {
    throw new Rejection(400, "body must be JSON");
  }
  if (typeof body.name !== "string" || typeof body.version !== "string") {
    throw new Rejection(422, "name and version are required");
  }
  const yanked = body.yanked === undefined ? true : body.yanked === true;
  const reason = text(body.reason, "reason", 300);
  const db = c.env.DB;
  const row = await getVersion(db, body.name, body.version);
  if (!row) return c.json({ error: "version not found" }, 404);
  await db
    .prepare(
      "UPDATE extension_versions SET yanked = ?, yanked_reason = ?, yanked_at = ? WHERE name = ? AND version = ?",
    )
    .bind(
      yanked ? 1 : 0,
      yanked ? reason : null,
      yanked ? Date.now() : null,
      body.name,
      body.version,
    )
    .run();
  const latest = await refreshLatest(db, body.name);
  return c.json({
    ok: true,
    name: body.name,
    version: body.version,
    yanked,
    latest_version: latest,
  });
}

export const publishing = new Hono<AppEnv>();

for (const [path, handler] of [
  ["/api/publish", publish],
  ["/api/yank", yank],
] as const) {
  publishing.post(path, async (c) => {
    const denied = await authorize(c);
    if (denied) return denied;
    try {
      return await handler(c);
    } catch (error) {
      if (error instanceof Rejection) return c.json({ error: error.message }, error.status);
      throw error;
    }
  });
}
