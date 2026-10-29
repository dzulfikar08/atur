import { z } from "zod";
import { HTTPException } from "hono/http-exception";
import type { DbClient } from "../db/index";
import * as linksRepo from "../repositories/workspaceLinks";

// Control-plane bindings (DEV-29): which repo(s), local checkout, branch, and
// terminal workspace (herdr workspace or Atur Terminal project, stored as
// herdr_workspace) back a given Atur workspace. Agents read these before
// spawning so they clone/attach the right context; humans maintain them.

const optionalText = z.string().min(1).max(1024).nullable().optional();

export const upsertLinkSchema = z
  .object({
    repo_urls: z.array(z.string().min(1).max(512)).max(32).nullable().optional(),
    local_path: optionalText,
    default_branch: optionalText,
    herdr_workspace: optionalText,
    notes: optionalText,
    // Autonomy (firstmate port): NULL mode = local-only; 'direct-PR' = agent
    // pushes + opens a PR; auto_merge 'yolo' additionally lets it merge after
    // green gates. Any non-null auto_merge value must be the yolo sentinel.
    mode: z.enum(["local-only", "direct-PR"]).nullable().optional(),
    auto_merge: z.literal("yolo").nullable().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "At least one field required" });

export type UpsertLinkInput = z.infer<typeof upsertLinkSchema>;

function serialize(input: UpsertLinkInput) {
  const patch: {
    repoUrls?: string | null;
    localPath?: string | null;
    defaultBranch?: string | null;
    herdrWorkspace?: string | null;
    notes?: string | null;
    mode?: string | null;
    autoMerge?: string | null;
  } = {};
  if (input.repo_urls !== undefined)
    patch.repoUrls = input.repo_urls === null ? null : JSON.stringify(input.repo_urls);
  if (input.local_path !== undefined) patch.localPath = input.local_path;
  if (input.default_branch !== undefined) patch.defaultBranch = input.default_branch;
  if (input.herdr_workspace !== undefined) patch.herdrWorkspace = input.herdr_workspace;
  if (input.notes !== undefined) patch.notes = input.notes;
  if (input.mode !== undefined) patch.mode = input.mode;
  if (input.auto_merge !== undefined) patch.autoMerge = input.auto_merge;
  return patch;
}

export function deserialize(row: NonNullable<Awaited<ReturnType<typeof linksRepo.findBySlug>>>) {
  let repoUrls: string[] | null = null;
  if (row.repoUrls) {
    try {
      const parsed: unknown = JSON.parse(row.repoUrls);
      if (Array.isArray(parsed))
        repoUrls = parsed.filter((u): u is string => typeof u === "string");
    } catch {
      repoUrls = null;
    }
  }
  return {
    workspace: row.workspaceSlug,
    repo_urls: repoUrls,
    local_path: row.localPath,
    default_branch: row.defaultBranch,
    herdr_workspace: row.herdrWorkspace,
    notes: row.notes,
    mode: row.mode,
    auto_merge: row.autoMerge,
    updated_at: row.updatedAt,
  };
}

export async function get(db: DbClient, slug: string) {
  const row = await linksRepo.findBySlug(db, slug);
  if (!row) {
    // Unknown binding == unbound workspace, not an error — agents treat this
    // as "nothing bound yet". Callers that need hard presence use admin routes.
    return null;
  }
  return deserialize(row);
}

export async function upsert(db: DbClient, slug: string, input: UpsertLinkInput) {
  const row = await linksRepo.upsertBySlug(db, slug, serialize(input));
  if (!row) throw new HTTPException(500, { message: "Failed to upsert workspace link" });
  return deserialize(row);
}

export async function remove(db: DbClient, slug: string) {
  const row = await linksRepo.findBySlug(db, slug);
  if (!row) throw new HTTPException(404, { message: "Workspace link not found" });
  await linksRepo.removeBySlug(db, slug);
}

export async function list(db: DbClient) {
  const rows = await linksRepo.listAll(db);
  return { results: rows.map((r) => deserialize(r)) };
}
