import { Hono } from "hono";
import { eq, and, isNull } from "drizzle-orm";
import type { Context } from "hono";
import type { Env } from "../lib/env";
import { getDb } from "../db/index";
import { authMiddleware } from "../middleware/auth";
import * as schema from "../db/schema";
import { v4 as uuid } from "uuid";
import { nowISO } from "../lib/pagination";
import { HTTPException } from "hono/http-exception";
import * as usersRepo from "../repositories/users";

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function serveMe(c: Context<{ Bindings: Env }>) {
  const db = getDb(c.env.DB);
  const userId = c.get("user").sub;

  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  if (!user) return c.json({ error: "User not found" }, 404);

  const [profile] = await db
    .select()
    .from(schema.profiles)
    .where(eq(schema.profiles.userId, userId))
    .limit(1);

  const workspaces = await db
    .select({
      id: schema.workspaces.id,
      name: schema.workspaces.name,
      slug: schema.workspaces.slug,
      logo: schema.workspaces.logo,
    })
    .from(schema.workspaceMembers)
    .innerJoin(schema.workspaces, eq(schema.workspaceMembers.workspaceId, schema.workspaces.id))
    .where(
      and(eq(schema.workspaceMembers.memberId, userId), eq(schema.workspaceMembers.isActive, 1)),
    );

  return c.json({
    id: user.id,
    email: user.email,
    username: user.username,
    display_name: user.displayName,
    avatar: user.avatar,
    user_timezone: user.userTimezone,
    is_active: !!user.isActive,
    is_email_verified: !!user.isEmailVerified,
    is_password_autoset: false,
    created_at: user.createdAt,
    theme: null,
    is_onboarded: !!profile?.isOnboarded,
    is_tour_completed: !!profile?.isOnboarded,
    onboarding_step: null,
    use_case: profile?.useCase,
    role: profile?.role,
    language: profile?.language,
    workspaces,
  });
}

export const userRoutes = new Hono<{ Bindings: Env }>({ strict: false })
  .get("/me", authMiddleware, serveMe)
  .get("/me/", authMiddleware, serveMe)
  .patch("/me", authMiddleware, async (c) => {
    const db = getDb(c.env.DB);
    const userId = c.get("user").sub;
    const body = (await c.req.json().catch(() => ({}))) as {
      display_name?: string;
      username?: string;
      avatar?: string;
    };
    const patch: Record<string, unknown> = {};
    if (typeof body.display_name === "string" && body.display_name.trim())
      patch.displayName = body.display_name.trim();
    if (typeof body.username === "string" && body.username.trim()) {
      const username = body.username.trim();
      const clash = await usersRepo.findByUsername(db, username);
      if (clash && clash.id !== userId)
        throw new HTTPException(409, { message: "Username already taken" });
      patch.username = username;
    }
    if (typeof body.avatar === "string") patch.avatar = body.avatar || null;
    if (Object.keys(patch).length === 0)
      throw new HTTPException(400, { message: "No fields to update" });
    await usersRepo.updateUser(db, userId, patch);
    return serveMe(c);
  })
  .get("/me/workspaces", authMiddleware, async (c) => {
    const db = getDb(c.env.DB);
    const userId = c.get("user").sub;

    const workspaces = await db
      .select({
        id: schema.workspaces.id,
        name: schema.workspaces.name,
        slug: schema.workspaces.slug,
        logo: schema.workspaces.logo,
      })
      .from(schema.workspaceMembers)
      .innerJoin(schema.workspaces, eq(schema.workspaceMembers.workspaceId, schema.workspaces.id))
      .where(
        and(eq(schema.workspaceMembers.memberId, userId), eq(schema.workspaceMembers.isActive, 1)),
      );

    return c.json(workspaces);
  })
  .get("/me/workspaces/", authMiddleware, async (c) => {
    const db = getDb(c.env.DB);
    const userId = c.get("user").sub;

    const workspaces = await db
      .select({
        id: schema.workspaces.id,
        name: schema.workspaces.name,
        slug: schema.workspaces.slug,
        logo: schema.workspaces.logo,
      })
      .from(schema.workspaceMembers)
      .innerJoin(schema.workspaces, eq(schema.workspaceMembers.workspaceId, schema.workspaces.id))
      .where(
        and(eq(schema.workspaceMembers.memberId, userId), eq(schema.workspaceMembers.isActive, 1)),
      );

    return c.json(workspaces);
  })
  .get("/me/api-keys", authMiddleware, async (c) => {
    const db = getDb(c.env.DB);
    const userId = c.get("user").sub;
    const rows = await db
      .select({
        id: schema.apiKeys.id,
        label: schema.apiKeys.label,
        is_active: schema.apiKeys.isActive,
        expires_at: schema.apiKeys.expiresAt,
        last_used_at: schema.apiKeys.lastUsedAt,
        created_at: schema.apiKeys.createdAt,
      })
      .from(schema.apiKeys)
      .where(and(eq(schema.apiKeys.userId, userId), isNull(schema.apiKeys.deletedAt)));
    return c.json(rows);
  })
  .post("/me/api-keys", authMiddleware, async (c) => {
    const db = getDb(c.env.DB);
    const userId = c.get("user").sub;
    const body = (await c.req.json().catch(() => ({}))) as { label?: string };
    // Generate a plain key, store only its hash. The plain key is returned once.
    const raw = uuid().replace(/-/g, "") + uuid().replace(/-/g, "");
    const key = `pk_live_${raw}`;
    const keyHash = await sha256Hex(key);
    const id = uuid();
    const now = nowISO();
    await db.insert(schema.apiKeys).values({
      id,
      keyHash,
      label: body.label ?? null,
      userId,
      isActive: 1,
      createdAt: now,
      updatedAt: now,
    });
    return c.json({ id, key, label: body.label ?? null, created_at: now }, 201);
  })
  .delete("/me/api-keys/:id", authMiddleware, async (c) => {
    const db = getDb(c.env.DB);
    const userId = c.get("user").sub;
    const id = c.req.param("id")!;
    await db
      .update(schema.apiKeys)
      .set({ deletedAt: nowISO(), updatedAt: nowISO(), isActive: 0 })
      .where(and(eq(schema.apiKeys.id, id), eq(schema.apiKeys.userId, userId)));
    return c.body(null, 204);
  });
