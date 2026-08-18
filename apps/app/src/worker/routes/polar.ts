import { Hono, type Context } from "hono";
import { and, eq, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { Env } from "../lib/env";
import { getDb } from "../db/index";
import * as schema from "../db/schema";
import * as workspaceRepo from "../repositories/workspaces";
import * as polarRepo from "../repositories/polar";
import * as polarService from "../services/polar";
import { verifyWebhookEvent } from "../lib/polar";
import { z } from "zod";

// ── Public Polar webhook receiver ────────────────────────────────────────────
// Mounted at /webhooks/polar/:slug — NOT under /api/* so no authMiddleware.
// Each workspace verifies with its own webhook secret from polar_settings.
export const polarWebhookRoutes = new Hono<{ Bindings: Env }>({ strict: false });

polarWebhookRoutes.post("/:slug", async (c) => {
  const db = getDb(c.env.DB);
  const slug = c.req.param("slug")!;
  const ws = await workspaceRepo.findBySlug(db, slug);
  if (!ws) throw new HTTPException(404, { message: "Workspace not found" });

  const settings = await polarRepo.getSettings(db, ws.id);
  const secret = settings?.webhookSecret ?? null;
  if (!settings?.webhookEnabled || !secret) {
    // Webhook not enabled for this workspace → fail closed.
    throw new HTTPException(404, { message: "Not found" });
  }

  const raw = await c.req.text();
  let event;
  try {
    event = await verifyWebhookEvent(secret, raw, c.req.header());
  } catch {
    throw new HTTPException(403, { message: "Invalid signature" });
  }

  // Fast path — a handful of D1 upserts. Responds well inside Polar's 10s
  // timeout; failures propagate as 5xx so Polar retries.
  await polarService.handleEvent(db, ws.id, event);
  return c.json({ ok: true });
});

// ── Authed Polar management API ──────────────────────────────────────────────
// Mounted under /api/workspaces/:slug/polar — global authMiddleware applies.
export const polarRoutes = new Hono<{ Bindings: Env }>({ strict: false });

const settingsSchema = z.object({
  access_token: z.string().min(1).optional(),
  webhook_secret: z.string().min(1).optional(),
  pipeline_project_id: z.string().uuid().optional().nullable(),
  default_state_id: z.string().uuid().optional().nullable(),
  webhook_enabled: z.boolean().optional(),
});

async function resolveWorkspace(c: Context<{ Bindings: Env }>) {
  const db = getDb(c.env.DB);
  const slug = c.req.param("slug")!;
  const ws = await workspaceRepo.findBySlug(db, slug);
  if (!ws) throw new HTTPException(404, { message: "Workspace not found" });
  const userId = c.get("user").sub;
  if (ws.ownerId !== userId) {
    const [m] = await db
      .select({ id: schema.workspaceMembers.id })
      .from(schema.workspaceMembers)
      .where(
        and(
          eq(schema.workspaceMembers.workspaceId, ws.id),
          eq(schema.workspaceMembers.memberId, userId),
          eq(schema.workspaceMembers.isActive, 1),
          isNull(schema.workspaceMembers.deletedAt),
        ),
      )
      .limit(1);
    if (!m) throw new HTTPException(403, { message: "Not a member of this workspace" });
  }
  return ws;
}

// API responses are snake_case DTOs (the rest of the API is snake_case; the
// drizzle rows are camelCase). Secrets are write-only — return a masked hint
// so the UI can tell "stored" from "empty" without handing values back out.
type PolarSettingsRow = Awaited<ReturnType<typeof polarRepo.getSettings>>;
type PolarLinkRow = Awaited<ReturnType<typeof polarRepo.listLinksByWorkspace>>[number];

function maskSecret(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.length < 12) return "••••";
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function settingsToDTO(workspaceId: string, s: PolarSettingsRow) {
  return {
    workspace_id: workspaceId,
    access_token: maskSecret(s?.accessToken),
    webhook_secret: maskSecret(s?.webhookSecret),
    pipeline_project_id: s?.pipelineProjectId ?? null,
    default_state_id: s?.defaultStateId ?? null,
    webhook_enabled: s?.webhookEnabled ?? 0,
    last_synced_at: s?.lastSyncedAt ?? null,
  };
}

function linkToDTO(l: PolarLinkRow) {
  return {
    id: l.id,
    polar_type: l.polarType,
    polar_id: l.polarId,
    customer_id: l.customerId,
    deal_id: l.dealId,
    last_event: l.lastEvent,
    created_at: l.createdAt,
    updated_at: l.updatedAt,
  };
}

polarRoutes.get("/settings", async (c) => {
  const db = getDb(c.env.DB);
  const ws = await resolveWorkspace(c);
  const settings = await polarRepo.getSettings(db, ws.id);
  return c.json(settingsToDTO(ws.id, settings));
});

polarRoutes.put("/settings", async (c) => {
  const db = getDb(c.env.DB);
  const ws = await resolveWorkspace(c);
  const body = settingsSchema.parse(await c.req.json());
  // Fail early: enabling the receiver without a stored secret would 404 every
  // webhook anyway.
  const existing = await polarRepo.getSettings(db, ws.id);
  const secretAfterSave = body.webhook_secret ?? existing?.webhookSecret ?? null;
  if (body.webhook_enabled === true && !secretAfterSave) {
    throw new HTTPException(400, { message: "Store a webhook secret before enabling the receiver" });
  }
  const updated = await polarRepo.upsertSettings(db, ws.id, {
    accessToken: body.access_token,
    webhookSecret: body.webhook_secret,
    pipelineProjectId: body.pipeline_project_id,
    defaultStateId: body.default_state_id,
    webhookEnabled: body.webhook_enabled === undefined ? undefined : body.webhook_enabled ? 1 : 0,
  });
  return c.json(settingsToDTO(ws.id, updated));
});

// Trigger a full backfill from the Polar REST API using the workspace's stored
// access token. Returns import counts.
polarRoutes.post("/sync", async (c) => {
  const db = getDb(c.env.DB);
  const ws = await resolveWorkspace(c);
  const settings = await polarRepo.getSettings(db, ws.id);
  if (!settings?.accessToken) {
    throw new HTTPException(400, { message: "Polar access token not configured" });
  }
  const counts = await polarService.syncAll(db, ws.id, settings.accessToken);
  return c.json({ ok: true, ...counts });
});

// List imported Polar entities for this workspace.
polarRoutes.get("/links", async (c) => {
  const db = getDb(c.env.DB);
  const ws = await resolveWorkspace(c);
  const links = await polarRepo.listLinksByWorkspace(db, ws.id);
  return c.json({ results: links.map(linkToDTO) });
});

// List Polar activity for a contact (used by the contact-detail panel).
polarRoutes.get("/contacts/:contactId/links", async (c) => {
  const db = getDb(c.env.DB);
  const ws = await resolveWorkspace(c);
  const contactId = c.req.param("contactId")!;
  const [contact] = await db
    .select({ id: schema.customers.id })
    .from(schema.customers)
    .where(and(eq(schema.customers.id, contactId), eq(schema.customers.workspaceId, ws.id)))
    .limit(1);
  if (!contact) throw new HTTPException(404, { message: "Contact not found" });
  const links = await polarRepo.listLinksByCustomer(db, contactId);
  return c.json({ results: links.map(linkToDTO) });
});
