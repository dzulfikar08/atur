import { and, asc, eq, gt, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { DbClient } from "../db/index";
import type { Env } from "../lib/env";
import * as schema from "../db/schema";
import * as assetsService from "./assets";
import { nowISO } from "../lib/pagination";

export const FEEDBACK_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
// Unclaimed uploads are only needed for the minutes between picking a file and
// pressing submit.
export const UNCLAIMED_TTL_MS = 2 * 60 * 60 * 1000;
// Per-board ceiling on uploads nobody has attached to a submission yet, so one
// public token cannot park unbounded R2 storage no matter how many IPs it uses.
export const BOARD_UNCLAIMED_WINDOW_MS = 24 * 60 * 60 * 1000;
export const BOARD_UNCLAIMED_MAX_FILES = 50;
export const BOARD_UNCLAIMED_MAX_BYTES = 200 * 1024 * 1024;

const ALLOWED_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/plain",
]);

const startsWith = (b: Uint8Array, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);

// The multipart part header is client-declared; confirm the bytes agree for the
// binary formats so an "image/png" can't be arbitrary content.
function bytesMatch(mime: string, b: Uint8Array): boolean {
  switch (mime) {
    case "image/png":
      return startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "image/jpeg":
      return startsWith(b, [0xff, 0xd8, 0xff]);
    case "image/gif":
      return startsWith(b, [0x47, 0x49, 0x46, 0x38]);
    case "image/webp":
      return startsWith(b, [0x52, 0x49, 0x46, 0x46]) && startsWith(b, [0x57, 0x45, 0x42, 0x50], 8);
    case "application/pdf":
      return startsWith(b, [0x25, 0x50, 0x44, 0x46]);
    default:
      // text/plain: no NUL bytes in the head.
      return !b.subarray(0, 1024).includes(0);
  }
}

export function cleanFilename(raw: string | undefined): string {
  const base = (raw ?? "").split(/[\\/]/).pop() ?? "";
  // oxlint-disable-next-line no-control-regex -- stripping control chars is the point
  const cleaned = base.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "").trim();
  return (cleaned || "attachment").slice(-120);
}

export type FeedbackAttachmentResult = {
  id: string;
  url: string;
  filename: string;
  size: number;
  mime: string;
};

export async function uploadAttachment(
  db: DbClient,
  env: Env,
  board: { id: string; workspaceId: string },
  file: File,
  origin: string,
  botUserId: string,
): Promise<FeedbackAttachmentResult> {
  const mime = (file.type || "").split(";")[0].trim().toLowerCase();
  if (!ALLOWED_MIME.has(mime)) {
    throw new HTTPException(415, {
      message: "Unsupported file type. Allowed: PNG, JPEG, WebP, GIF, PDF, plain text.",
    });
  }
  if (file.size > FEEDBACK_ATTACHMENT_MAX_BYTES) {
    throw new HTTPException(413, { message: "File too large (max 10 MB)." });
  }
  if (file.size === 0) throw new HTTPException(400, { message: "File is empty." });

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!bytesMatch(mime, bytes)) {
    throw new HTTPException(415, { message: "File content does not match its type." });
  }

  // Sweep expired uploads first so they don't count against the board's cap.
  await gcUnclaimedAttachments(db, env, 10);
  const [pending] = await db
    .select({
      files: sql<number>`count(*)`,
      bytes: sql<number>`coalesce(sum(${schema.fileAssets.size}), 0)`,
    })
    .from(schema.feedbackAttachments)
    .leftJoin(schema.fileAssets, eq(schema.fileAssets.id, schema.feedbackAttachments.assetId))
    .where(
      and(
        eq(schema.feedbackAttachments.boardId, board.id),
        isNull(schema.feedbackAttachments.issueId),
        gt(
          schema.feedbackAttachments.createdAt,
          new Date(Date.now() - BOARD_UNCLAIMED_WINDOW_MS).toISOString(),
        ),
      ),
    );
  if (
    Number(pending?.files ?? 0) >= BOARD_UNCLAIMED_MAX_FILES ||
    Number(pending?.bytes ?? 0) + bytes.byteLength > BOARD_UNCLAIMED_MAX_BYTES
  ) {
    throw new HTTPException(429, {
      message: "Too many pending uploads for this board. Submit your report or try again later.",
    });
  }

  const filename = cleanFilename(file.name);
  const stored = await assetsService.uploadBytes(db, env, botUserId, {
    bytes,
    type: mime,
    size: bytes.byteLength,
  });
  await db.insert(schema.feedbackAttachments).values({
    assetId: stored.id,
    boardId: board.id,
    workspaceId: board.workspaceId,
    issueId: null,
    filename,
    createdAt: nowISO(),
  });

  return { id: stored.id, url: `${origin}${stored.url}`, filename, size: stored.size, mime };
}

export type ClaimedAttachment = { id: string; filename: string; mime: string };

// Resolve the ids a submission wants to attach: they must exist on THIS board and
// still be unclaimed, otherwise one board could pull files uploaded to another.
export async function resolveUnclaimed(
  db: DbClient,
  boardId: string,
  ids: string[],
): Promise<ClaimedAttachment[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const rows = await db
    .select({
      id: schema.feedbackAttachments.assetId,
      filename: schema.feedbackAttachments.filename,
      mime: schema.fileAssets.contentType,
    })
    .from(schema.feedbackAttachments)
    .innerJoin(schema.fileAssets, eq(schema.fileAssets.id, schema.feedbackAttachments.assetId))
    .where(
      and(
        inArray(schema.feedbackAttachments.assetId, unique),
        eq(schema.feedbackAttachments.boardId, boardId),
        isNull(schema.feedbackAttachments.issueId),
      ),
    );
  if (rows.length !== unique.length) {
    throw new HTTPException(400, { message: "Unknown or already used attachment id" });
  }
  return rows.map((r) => ({
    id: r.id,
    filename: r.filename,
    mime: r.mime ?? "application/octet-stream",
  }));
}

export async function claimAttachments(db: DbClient, issueId: string, ids: string[]) {
  if (ids.length === 0) return;
  await db
    .update(schema.feedbackAttachments)
    .set({ issueId })
    .where(
      and(
        inArray(schema.feedbackAttachments.assetId, ids),
        isNull(schema.feedbackAttachments.issueId),
      ),
    );
}

// Removes uploads nobody claimed within the TTL (R2 object, asset row, attachment row).
export async function gcUnclaimedAttachments(
  db: DbClient,
  env: Env,
  limit = 200,
  now = Date.now(),
): Promise<number> {
  const cutoff = new Date(now - UNCLAIMED_TTL_MS).toISOString();
  const stale = await db
    .select({ id: schema.feedbackAttachments.assetId, key: schema.fileAssets.asset })
    .from(schema.feedbackAttachments)
    .leftJoin(schema.fileAssets, eq(schema.fileAssets.id, schema.feedbackAttachments.assetId))
    .where(
      and(
        isNull(schema.feedbackAttachments.issueId),
        lt(schema.feedbackAttachments.createdAt, cutoff),
      ),
    )
    .limit(limit);
  if (stale.length === 0) return 0;

  const keys = stale.map((s) => s.key).filter((k): k is string => !!k);
  if (keys.length) await env.R2.delete(keys);
  const ids = stale.map((s) => s.id);
  await db
    .delete(schema.feedbackAttachments)
    .where(inArray(schema.feedbackAttachments.assetId, ids));
  await db.delete(schema.fileAssets).where(inArray(schema.fileAssets.id, ids));
  return ids.length;
}

// Read-access rule for GET /api/assets/:id. Returns null when the asset is not a
// feedback attachment (the caller falls back to the generic owner rules).
//  - workspace members: any attachment of their workspace
//  - portal customers: only attachments on an issue they filed — a support
//    ticket tied to them, or an idea/report authored with their verified email
export async function authorizeFeedbackAsset(
  db: DbClient,
  assetId: string,
  requester:
    | { kind: "member"; isMember: (workspaceId: string) => Promise<boolean> }
    | { kind: "customer"; customerId: string; workspaceId: string; email: string | null },
): Promise<boolean | null> {
  const [att] = await db
    .select()
    .from(schema.feedbackAttachments)
    .where(eq(schema.feedbackAttachments.assetId, assetId))
    .limit(1);
  if (!att) return null;

  if (requester.kind === "member") return requester.isMember(att.workspaceId);

  if (requester.workspaceId !== att.workspaceId || !att.issueId) return false;
  const email = requester.email?.trim().toLowerCase();
  const [owned] = await db
    .select({ issueId: schema.issues.id })
    .from(schema.issues)
    .leftJoin(schema.supportTickets, eq(schema.supportTickets.issueId, schema.issues.id))
    .leftJoin(schema.feedbackMeta, eq(schema.feedbackMeta.issueId, schema.issues.id))
    .where(
      and(
        eq(schema.issues.id, att.issueId),
        isNull(schema.issues.deletedAt),
        or(
          eq(schema.supportTickets.customerId, requester.customerId),
          email
            ? and(
                sql`lower(${schema.feedbackMeta.authorEmail}) = ${email}`,
                eq(schema.feedbackMeta.identityVerified, 1),
              )
            : undefined,
        ),
      ),
    )
    .limit(1);
  return !!owned;
}

export type IssueFeedbackAttachment = {
  id: string;
  filename: string;
  content_type: string;
  size: number | null;
  url: string;
  created_at: string;
};

// Files a feedback submission claimed for this issue. These live in
// feedback_attachments (not issue_attachments), so the generic issue
// attachments endpoint never sees them. `url` is served by GET /api/assets/:id
// to workspace members; `origin` makes it absolute when the caller has one.
export async function listIssueAttachments(
  db: DbClient,
  issueId: string,
  origin = "",
): Promise<IssueFeedbackAttachment[]> {
  const rows = await db
    .select({
      id: schema.feedbackAttachments.assetId,
      filename: schema.feedbackAttachments.filename,
      createdAt: schema.feedbackAttachments.createdAt,
      contentType: schema.fileAssets.contentType,
      size: schema.fileAssets.size,
    })
    .from(schema.feedbackAttachments)
    .innerJoin(schema.fileAssets, eq(schema.fileAssets.id, schema.feedbackAttachments.assetId))
    .where(
      and(eq(schema.feedbackAttachments.issueId, issueId), isNull(schema.fileAssets.deletedAt)),
    )
    .orderBy(asc(schema.feedbackAttachments.createdAt), asc(schema.feedbackAttachments.assetId));
  return rows.map((r) => ({
    id: r.id,
    filename: r.filename,
    content_type: r.contentType ?? "application/octet-stream",
    size: r.size,
    url: `${origin}/api/assets/${r.id}`,
    created_at: r.createdAt,
  }));
}
