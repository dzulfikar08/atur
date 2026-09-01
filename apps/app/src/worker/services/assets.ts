import { z } from "zod";
import type { DbClient } from "../db/index";
import type { Env } from "../lib/env";
import * as assetsRepo from "../repositories/assets";
import { HTTPException } from "hono/http-exception";

export const uploadSchema = z.object({
  entityId: z.string().uuid().optional(),
  entityType: z.string().optional(),
});

// Hard cap for every upload entry point (REST, portal, MCP). Without it a
// caller can stream an unbounded multipart body straight into R2.
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export async function uploadBytes(
  db: DbClient,
  env: Env,
  createdById: string,
  file: { bytes: ArrayBuffer | Uint8Array; type: string; size: number },
  entityId?: string,
  entityType?: string,
) {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new HTTPException(413, {
      message: `File too large (${file.size} bytes); uploads are capped at ${MAX_UPLOAD_BYTES} bytes`,
    });
  }

  const key = `${createdById}/${crypto.randomUUID()}`;
  const contentType = file.type || "application/octet-stream";

  await env.R2.put(key, file.bytes, {
    httpMetadata: { contentType },
  });

  const asset = await assetsRepo.createAsset(db, {
    asset: key,
    size: file.size,
    contentType,
    createdById,
    entityId,
    entityType,
  });

  return {
    id: asset.id,
    url: `/api/assets/${asset.id}`,
    size: file.size,
  };
}

export async function upload(
  db: DbClient,
  env: Env,
  createdById: string,
  file: File,
  entityId?: string,
  entityType?: string,
) {
  const buffer = await file.arrayBuffer();
  return uploadBytes(
    db,
    env,
    createdById,
    { bytes: buffer, type: file.type || "application/octet-stream", size: file.size },
    entityId,
    entityType,
  );
}

// Whether GET /api/assets/:id may serve this stored type inline. Uploads come
// from users and API callers, so the stored type is untrusted: only render
// what browsers execute nothing for, force the rest to download (see the GET
// handler). SVG downloads too — inline SVG runs scripts when navigated to
// directly. The GET handler pairs the disposition with the TRUE stored MIME,
// so <img> embeds keep rendering (they ignore Content-Disposition) while
// direct navigation downloads instead of executing on our origin.
export function serveInline(contentType: string): boolean {
  // MIME matching is case-insensitive in browsers — an uploader sending a
  // part header `Content-Type: image/SVG+XML` must not slip past the svg
  // guard and get served (and executed) inline.
  const type = contentType.trim().toLowerCase();
  return (
    (/^image\//.test(type) && !type.includes("svg")) ||
    type === "application/pdf"
  );
}

// Stored Content-Types are untrusted: both upload paths persist the multipart
// part header verbatim. Reduce to a bare, well-formed type/token pair —
// parameters stripped, MIME matching lowercased — so the value is always safe
// to emit as a response header; anything malformed falls back to octet-stream.
export function storedContentType(raw: string | null | undefined): string {
  const base = (raw ?? "").split(";")[0].trim().toLowerCase();
  return /^[-\w.+]+\/[-\w.+]+$/.test(base) ? base : "application/octet-stream";
}

export async function getAsset(db: DbClient, env: Env, id: string) {
  const asset = await assetsRepo.findById(db, id);
  if (!asset) {
    throw new HTTPException(404, { message: "Asset not found" });
  }

  if (!asset.asset) {
    throw new HTTPException(404, { message: "File not found in storage" });
  }

  const object = await env.R2.get(asset.asset);
  if (!object) {
    throw new HTTPException(404, { message: "File not found in storage" });
  }

  return {
    asset,
    body: object.body,
    contentType: asset.contentType ?? "application/octet-stream",
    size: object.size,
  };
}
