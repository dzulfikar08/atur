// Project saved views — no backing table in the schema, so these are stubs
// that keep the frontend's ProjectBoard view switcher functional (empty list).
// Persistence is deferred until an issue_views table is introduced.
import { Hono } from "hono";
import type { Env } from "../lib/env";
import { authMiddleware } from "../middleware/auth";
import { v4 as uuid } from "uuid";

export const viewRoutes = new Hono<{ Bindings: Env }>({ strict: false })
  .get("/", authMiddleware, (c) => c.json({ results: [] }))
  .post("/", authMiddleware, async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      name?: string;
      query?: unknown;
      access?: string;
    };
    return c.json(
      {
        id: uuid(),
        name: body.name ?? "Untitled",
        desc: null,
        query: body.query ?? null,
        is_locked: false,
        access: body.access ?? "PUBLIC",
        is_favorite: false,
      },
      201,
    );
  })
  .delete("/:viewId", authMiddleware, (c) => c.body(null, 204));
