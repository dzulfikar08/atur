import { Hono, type Context } from "hono";
import { and, eq, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { Env } from "../lib/env";
import { getDb } from "../db/index";
import { paginationParams } from "../lib/pagination";
import * as schema from "../db/schema";
import * as workspaceRepo from "../repositories/workspaces";
import * as crmService from "../services/crm";

// Admin CRM contacts API. Mounted under /api/workspaces/:slug/contacts, so the
// global authMiddleware already applies; each handler re-checks membership.
export const contactsRoutes = new Hono<{ Bindings: Env }>({ strict: false });

async function resolveWorkspace(c: Context<{ Bindings: Env }>) {
  const db = getDb(c.env.DB);
  const slug = c.req.param("slug")!;
  const ws = await workspaceRepo.findBySlug(db, slug);
  if (!ws) throw new HTTPException(404, { message: "Workspace not found" });
  return ws;
}

async function assertMember(
  db: ReturnType<typeof getDb>,
  ws: { id: string; ownerId: string },
  userId: string,
) {
  if (ws.ownerId === userId) return;
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

contactsRoutes.get("/", async (c) => {
  const db = getDb(c.env.DB);
  const ws = await resolveWorkspace(c);
  await assertMember(db, ws, c.get("user").sub);
  const { offset, limit } = paginationParams(c);
  const result = await crmService.listContacts(db, ws.id, {
    status: c.req.query("status"),
    search: c.req.query("search"),
    offset,
    limit,
  });
  return c.json(result);
});

contactsRoutes.post("/", async (c) => {
  const db = getDb(c.env.DB);
  const ws = await resolveWorkspace(c);
  await assertMember(db, ws, c.get("user").sub);
  const body = crmService.createContactSchema.parse(await c.req.json());
  const contact = await crmService.createContact(db, ws.id, body);
  return c.json(contact, 201);
});

contactsRoutes.get("/:id", async (c) => {
  const db = getDb(c.env.DB);
  const ws = await resolveWorkspace(c);
  await assertMember(db, ws, c.get("user").sub);
  const result = await crmService.getContact(db, ws.id, c.req.param("id")!);
  return c.json(result);
});

contactsRoutes.patch("/:id", async (c) => {
  const db = getDb(c.env.DB);
  const ws = await resolveWorkspace(c);
  await assertMember(db, ws, c.get("user").sub);
  const body = crmService.updateContactSchema.parse(await c.req.json());
  const contact = await crmService.updateContact(db, ws.id, c.req.param("id")!, body);
  return c.json(contact);
});

contactsRoutes.delete("/:id", async (c) => {
  const db = getDb(c.env.DB);
  const ws = await resolveWorkspace(c);
  await assertMember(db, ws, c.get("user").sub);
  await crmService.deleteContact(db, ws.id, c.req.param("id")!);
  return c.body(null, 204);
});
