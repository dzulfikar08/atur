import { Hono } from "hono";
import type { Env } from "../lib/env";
import { getDb } from "../db/index";
import { authMiddleware } from "../middleware/auth";
import * as membersService from "../services/members";
import { HTTPException } from "hono/http-exception";
import { eq, and, isNull } from "drizzle-orm";
import * as schema from "../db/schema";
import { z } from "zod";
import { v4 as uuid } from "uuid";
import { nowISO } from "../lib/pagination";

async function resolveWorkspaceId(env: Env["DB"], slug: string): Promise<string> {
  const db = getDb(env);
  const [ws] = await db
    .select({ id: schema.workspaces.id })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.slug, slug))
    .limit(1);
  if (!ws) throw new HTTPException(404, { message: "Workspace not found" });
  return ws.id;
}

const addMemberSchema = z.object({
  member_id: z.string().uuid(),
  role: z.number().int().optional(),
});

const inviteSchema = z.object({
  email: z.string().email(),
  role: z.number().int().optional(),
});

export const memberRoutes = new Hono<{ Bindings: Env }>({ strict: false })
  .get("/", async (c) => {
    const db = getDb(c.env.DB);
    const slug = c.req.param("slug")!;
    const workspaceId = await resolveWorkspaceId(c.env.DB, slug);
    const result = await membersService.listWorkspaceMembers(db, workspaceId);
    return c.json(result);
  })
  .post("/", authMiddleware, async (c) => {
    const db = getDb(c.env.DB);
    const slug = c.req.param("slug")!;
    const workspaceId = await resolveWorkspaceId(c.env.DB, slug);
    const body = addMemberSchema.parse(await c.req.json());
    const result = await membersService.addWorkspaceMember(
      db,
      workspaceId,
      body.member_id,
      body.role,
    );
    return c.json(result, 201);
  })
  .post("/invite", authMiddleware, async (c) => {
    const db = getDb(c.env.DB);
    const slug = c.req.param("slug")!;
    const workspaceId = await resolveWorkspaceId(c.env.DB, slug);
    const body = inviteSchema.parse(await c.req.json());
    const email = body.email.toLowerCase();

    // Find or create a member account by email (no password — they sign in via magic-link / forgot-password).
    let [user] = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
    if (!user) {
      const userId = uuid();
      const now = nowISO();
      const local =
        email
          .split("@")[0]
          ?.toLowerCase()
          .replace(/[^a-z0-9]+/g, "") || "member";
      const username = `${local}-${uuid().slice(0, 8)}`.slice(0, 48);
      await db.insert(schema.users).values({
        id: userId,
        email,
        username,
        displayName: null,
        userTimezone: "UTC",
        isActive: 1,
        isSuperuser: 0,
        isEmailVerified: 0,
        isBot: 0,
        isCustomer: 0,
        createdAt: now,
        updatedAt: now,
      });
      [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
    }

    // Idempotent: return existing membership if already present.
    const [existing] = await db
      .select()
      .from(schema.workspaceMembers)
      .where(
        and(
          eq(schema.workspaceMembers.workspaceId, workspaceId),
          eq(schema.workspaceMembers.memberId, user.id),
          isNull(schema.workspaceMembers.deletedAt),
        ),
      )
      .limit(1);
    if (existing) return c.json(existing, 200);

    const member = await membersService.addWorkspaceMember(db, workspaceId, user.id, body.role);
    return c.json(member, 201);
  })
  .delete("/:memberId", authMiddleware, async (c) => {
    const db = getDb(c.env.DB);
    const memberId = c.req.param("memberId")!;
    await membersService.removeWorkspaceMember(db, memberId);
    return c.body(null, 204);
  });
