import { z } from "zod";
import type { DbClient } from "../db/index";
import * as workspaceRepo from "../repositories/workspaces";
import { HTTPException } from "hono/http-exception";
import { v4 as uuid } from "uuid";
import { nowISO } from "../lib/pagination";

export const createWorkspaceSchema = z.object({
  name: z.string().min(1).max(80),
  slug: z
    .string()
    .min(1)
    .max(48)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  logo: z.string().nullable().optional(),
  organizationSize: z.string().nullable().optional(),
  timezone: z.string().optional().default("UTC"),
  backgroundColor: z.string().nullable().optional(),
});

export const updateWorkspaceSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  logo: z.string().nullable().optional(),
  organizationSize: z.string().nullable().optional(),
  timezone: z.string().optional(),
  backgroundColor: z.string().nullable().optional(),
  // ── Portfolio strategy (DEV-22) — Moat × AI-proof rescore fields. ──
  moatScore: z.number().int().min(0).max(5).nullable().optional(),
  aiProofScore: z.number().int().min(0).max(5).nullable().optional(),
  strategyVerdict: z
    .enum(["invest", "harden", "harvest", "kill", "needs-review"])
    .nullable()
    .optional(),
  strategyNote: z.string().max(2000).nullable().optional(),
});

export async function create(
  db: DbClient,
  ownerId: string,
  data: z.infer<typeof createWorkspaceSchema>,
) {
  const existing = await workspaceRepo.findBySlug(db, data.slug);
  if (existing) {
    throw new HTTPException(409, { message: "Workspace slug already exists" });
  }
  return workspaceRepo.create(db, { ...data, ownerId });
}

export async function getBySlug(db: DbClient, slug: string) {
  const workspace = await workspaceRepo.findBySlug(db, slug);
  if (!workspace) throw new HTTPException(404, { message: "Workspace not found" });
  return workspace;
}

export async function list(db: DbClient, userId: string, offset: number, limit: number) {
  return workspaceRepo.listByUser(db, userId, offset, limit);
}

// Strategy fields that trigger a history row when they actually change.
const STRATEGY_FIELDS = ["moatScore", "aiProofScore", "strategyVerdict", "strategyNote"] as const;

export async function update(
  db: DbClient,
  slug: string,
  data: z.infer<typeof updateWorkspaceSchema>,
) {
  const workspace = await workspaceRepo.findBySlug(db, slug);
  if (!workspace) throw new HTTPException(404, { message: "Workspace not found" });

  // A rescore that actually moved a strategy field stamps reviewed_at and
  // appends a workspace_score_history row — same-values PATCHes are no-ops,
  // so history stays one row per real change (trend arrows stay honest).
  const strategyChanged = STRATEGY_FIELDS.some(
    (f) => data[f] !== undefined && data[f] !== workspace[f],
  );

  const updated = await workspaceRepo.update(db, workspace.id, {
    ...data,
    ...(strategyChanged ? { reviewedAt: nowISO() } : {}),
  });

  if (strategyChanged) {
    await workspaceRepo.insertScoreHistory(db, {
      id: uuid(),
      workspaceId: workspace.id,
      moatScore: updated.moatScore ?? null,
      aiProofScore: updated.aiProofScore ?? null,
      strategyVerdict: updated.strategyVerdict ?? null,
      strategyNote: updated.strategyNote ?? null,
      createdAt: nowISO(),
    });
  }
  return updated;
}

export async function remove(db: DbClient, slug: string) {
  const workspace = await workspaceRepo.findBySlug(db, slug);
  if (!workspace) throw new HTTPException(404, { message: "Workspace not found" });
  await workspaceRepo.softDelete(db, workspace.id);
}
