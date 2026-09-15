import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Env } from "../lib/env";
import { getDb } from "../db/index";
import * as paywuzRepo from "../repositories/paywuz";
import * as paywuzService from "../services/paywuz";
import { authMiddleware } from "../middleware/auth";
import { requireWorkspaceMember } from "../middleware/workspace";
import { z } from "zod";

// ── Paywuz management API ──────────────────────────────────────────
// Mounted under /api/workspaces/:slug/paywuz — global authMiddleware applies.
export const paywuzRoutes = new Hono<{ Bindings: Env }>({ strict: false });

const settingsSchema = z.object({
  api_key: z.string().min(1).optional(),
  environment: z.enum(["sandbox", "production"]).optional(),
});

function settingsToDTO(workspaceId: string, s: Awaited<ReturnType<typeof paywuzRepo.getSettings>>) {
  return {
    workspaceId,
    apiKeyHint: s?.apiKey ? `${s.apiKey.slice(0, 4)}…${s.apiKey.slice(-4)}` : null,
    environment: s?.environment ?? "sandbox",
    lastSyncedAt: s?.lastSyncedAt ?? null,
    createdAt: s?.createdAt ?? null,
    updatedAt: s?.updatedAt ?? null,
  };
}

// GET /api/workspaces/:slug/paywuz/settings
paywuzRoutes.get("/settings", authMiddleware, requireWorkspaceMember, async (c) => {
  const db = getDb(c.env.DB);
  const workspaceId = c.get("workspace").id;
  const settings = await paywuzService.getSettings(db, workspaceId);
  return c.json(settingsToDTO(workspaceId, settings));
});

// PUT /api/workspaces/:slug/paywuz/settings
paywuzRoutes.put("/settings", authMiddleware, requireWorkspaceMember, async (c) => {
  const db = getDb(c.env.DB);
  const workspaceId = c.get("workspace").id;
  const body = settingsSchema.parse(await c.req.json());
  const settings = await paywuzService.saveSettings(db, workspaceId, {
    apiKey: body.api_key,
    environment: body.environment,
  });
  return c.json(settingsToDTO(workspaceId, settings), 201);
});

// POST /api/workspaces/:slug/paywuz/sync
// Trigger a sync for specific order IDs (or all stored orders).
paywuzRoutes.post("/sync", authMiddleware, requireWorkspaceMember, async (c) => {
  const db = getDb(c.env.DB);
  const workspaceId = c.get("workspace").id;
  const body = z.object({ orderIds: z.array(z.string()) }).parse(await c.req.json());

  const settings = await paywuzService.getSettings(db, workspaceId);
  if (!settings?.apiKey) {
    throw new HTTPException(400, { message: "Paywuz API key not configured" });
  }

  const results = await paywuzService.syncAllTransactions(
    db,
    workspaceId,
    settings.apiKey,
    body.orderIds,
  );

  await paywuzRepo.upsertSettings(db, workspaceId, { lastSyncedAt: new Date().toISOString() });
  return c.json({ results });
});

// GET /api/workspaces/:slug/paywuz/transactions
paywuzRoutes.get("/transactions", authMiddleware, requireWorkspaceMember, async (c) => {
  const db = getDb(c.env.DB);
  const workspaceId = c.get("workspace").id;
  const status = c.req.query("status") ?? undefined;
  const limit = Math.min(Number(c.req.query("limit") ?? 50), 100);
  const offset = Number(c.req.query("offset") ?? 0);

  const { rows, total } = await paywuzService.listTransactions(db, workspaceId, {
    status,
    limit,
    offset,
  });
  return c.json({ results: rows, total });
});

// GET /api/workspaces/:slug/paywuz/revenue
paywuzRoutes.get("/revenue", authMiddleware, requireWorkspaceMember, async (c) => {
  const db = getDb(c.env.DB);
  const workspaceId = c.get("workspace").id;
  const summary = await paywuzService.getRevenueSummary(db, workspaceId);
  return c.json(summary);
});

// GET /api/workspaces/:slug/paywuz/transactions/:orderId
paywuzRoutes.get("/transactions/:orderId", authMiddleware, requireWorkspaceMember, async (c) => {
  const db = getDb(c.env.DB);
  const workspaceId = c.get("workspace").id;
  const orderId = c.req.param("orderId")!;

  const settings = await paywuzService.getSettings(db, workspaceId);
  if (!settings?.apiKey) {
    throw new HTTPException(400, { message: "Paywuz API key not configured" });
  }

  const result = await paywuzService.syncTransaction(db, workspaceId, settings.apiKey, orderId);
  return c.json(result);
});
