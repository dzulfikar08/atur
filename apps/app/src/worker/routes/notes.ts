import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Env } from "../lib/env";
import { getDb } from "../db/index";
import * as schema from "../db/schema";

// Personal quick notes (braindump). Every query is scoped to the session user
// — notes have no workspace dimension, so the only guard that matters is
// user_id. Mounted at /api/me/notes BEFORE meRoutes in app.ts so the static
// prefix wins (see the workspaceLinks mount-order note).
export const noteRoutes = new Hono<{ Bindings: Env }>({ strict: false });

const upsertNoteSchema = z.object({
  content: z.string().min(1, "Note cannot be empty").max(10_000),
});

noteRoutes
  .get("/", async (c) => {
    const db = getDb(c.env.DB);
    const user = c.get("user");
    const rows = await db
      .select()
      .from(schema.notes)
      .where(eq(schema.notes.userId, user.sub))
      .orderBy(desc(schema.notes.createdAt))
      .limit(200);
    return c.json({ results: rows });
  })
  .post("/", async (c) => {
    const db = getDb(c.env.DB);
    const user = c.get("user");
    const { content } = upsertNoteSchema.parse(await c.req.json());
    const now = new Date().toISOString();
    const [row] = await db
      .insert(schema.notes)
      .values({
        id: crypto.randomUUID(),
        userId: user.sub,
        content,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return c.json(row, 201);
  })
  .patch("/:id", async (c) => {
    const db = getDb(c.env.DB);
    const user = c.get("user");
    const { content } = upsertNoteSchema.parse(await c.req.json());
    const [row] = await db
      .update(schema.notes)
      .set({ content, updatedAt: new Date().toISOString() })
      .where(and(eq(schema.notes.id, c.req.param("id")!), eq(schema.notes.userId, user.sub)))
      .returning();
    if (!row) throw new HTTPException(404, { message: "Note not found" });
    return c.json(row);
  })
  .delete("/:id", async (c) => {
    const db = getDb(c.env.DB);
    const user = c.get("user");
    const [row] = await db
      .delete(schema.notes)
      .where(and(eq(schema.notes.id, c.req.param("id")!), eq(schema.notes.userId, user.sub)))
      .returning({ id: schema.notes.id });
    if (!row) throw new HTTPException(404, { message: "Note not found" });
    return c.body(null, 204);
  });
