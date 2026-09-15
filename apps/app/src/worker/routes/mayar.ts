import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Env } from "../lib/env";
import { getDb } from "../db/index";
import * as mayarRepo from "../repositories/mayar";
import * as mayarService from "../services/mayar";
import { authMiddleware } from "../middleware/auth";
import { requireWorkspaceMember } from "../middleware/workspace";
import { z } from "zod";

// ── Mayar management API ───────────────────────────────────────────
// Mounted under /api/workspaces/:slug/mayar — global authMiddleware applies.
export const mayarRoutes = new Hono<{ Bindings: Env }>({ strict: false });

const settingsSchema = z.object({
  api_key: z.string().min(1).optional(),
  api_version: z.enum(["v1", "v2"]).optional(),
});

function settingsToDTO(workspaceId: string, s: Awaited<ReturnType<typeof mayarRepo.getSettings>>) {
  return {
    workspaceId,
    apiKeyHint: s?.apiKey ? `${s.apiKey.slice(0, 4)}…${s.apiKey.slice(-4)}` : null,
    apiVersion: s?.apiVersion ?? "v1",
    lastSyncedAt: s?.lastSyncedAt ?? null,
    createdAt: s?.createdAt ?? null,
    updatedAt: s?.updatedAt ?? null,
  };
}

// GET /api/workspaces/:slug/mayar/settings
mayarRoutes.get("/settings", authMiddleware, requireWorkspaceMember, async (c) => {
  const db = getDb(c.env.DB);
  const workspaceId = c.get("workspace").id;
  const settings = await mayarService.getSettings(db, workspaceId);
  return c.json(settingsToDTO(workspaceId, settings));
});

// PUT /api/workspaces/:slug/mayar/settings
mayarRoutes.put("/settings", authMiddleware, requireWorkspaceMember, async (c) => {
  const db = getDb(c.env.DB);
  const workspaceId = c.get("workspace").id;
  const body = settingsSchema.parse(await c.req.json());
  const settings = await mayarService.saveSettings(db, workspaceId, {
    apiKey: body.api_key,
    apiVersion: body.api_version,
  });
  return c.json(settingsToDTO(workspaceId, settings), 201);
});

// POST /api/workspaces/:slug/mayar/sync
// Sync paid transactions from Mayar API.
mayarRoutes.post("/sync", authMiddleware, requireWorkspaceMember, async (c) => {
  const db = getDb(c.env.DB);
  const workspaceId = c.get("workspace").id;
  const body = z.object({ apiVersion: z.enum(["v1", "v2"]).optional() }).parse(await c.req.json());

  const settings = await mayarService.getSettings(db, workspaceId);
  if (!settings?.apiKey) {
    throw new HTTPException(400, { message: "Mayar API key not configured" });
  }

  const result = await mayarService.syncPaidTransactions(
    db,
    workspaceId,
    settings.apiKey,
    body.apiVersion ?? settings.apiVersion,
  );
  return c.json(result);
});

// GET /api/workspaces/:slug/mayar/transactions
mayarRoutes.get("/transactions", authMiddleware, requireWorkspaceMember, async (c) => {
  const db = getDb(c.env.DB);
  const workspaceId = c.get("workspace").id;
  const status = c.req.query("status") ?? undefined;
  const limit = Math.min(Number(c.req.query("limit") ?? 50), 100);
  const offset = Number(c.req.query("offset") ?? 0);

  const { rows, total } = await mayarService.listTransactions(db, workspaceId, {
    status,
    limit,
    offset,
  });
  return c.json({ results: rows, total });
});

// GET /api/workspaces/:slug/mayar/revenue
mayarRoutes.get("/revenue", authMiddleware, requireWorkspaceMember, async (c) => {
  const db = getDb(c.env.DB);
  const workspaceId = c.get("workspace").id;
  const summary = await mayarService.getRevenueSummary(db, workspaceId);
  return c.json(summary);
});

// GET /api/workspaces/:slug/mayar/balance
mayarRoutes.get("/balance", authMiddleware, requireWorkspaceMember, async (c) => {
  const db = getDb(c.env.DB);
  const workspaceId = c.get("workspace").id;
  const settings = await mayarService.getSettings(db, workspaceId);
  if (!settings?.apiKey) {
    throw new HTTPException(400, { message: "Mayar API key not configured" });
  }

  const balance = await mayarService.getAccountBalance(db, settings.apiKey, settings.apiVersion);
  return c.json(balance);
});

// GET /api/workspaces/:slug/mayar/daily
mayarRoutes.get("/daily", authMiddleware, requireWorkspaceMember, async (c) => {
  const db = getDb(c.env.DB);
  const workspaceId = c.get("workspace").id;
  const settings = await mayarService.getSettings(db, workspaceId);
  if (!settings?.apiKey) {
    throw new HTTPException(400, { message: "Mayar API key not configured" });
  }

  const daily = await mayarService.syncDailyTransactions(
    db,
    workspaceId,
    settings.apiKey,
    settings.apiVersion,
  );
  return c.json(daily);
});
