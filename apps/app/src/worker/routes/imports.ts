import { Hono } from "hono";
import type { Env } from "../lib/env";
import { getDb } from "../db/index";
import { authMiddleware } from "../middleware/auth";
import { requireWorkspaceMember } from "../middleware/workspace";
import * as importService from "../services/imports";

export const importRoutes = new Hono<{ Bindings: Env }>({ strict: false })
  .get("/", authMiddleware, requireWorkspaceMember, async (c) => {
    const db = getDb(c.env.DB);
    const imports = await importService.list(db, c.get("workspace").id);
    return c.json(imports);
  })
  .post("/", authMiddleware, requireWorkspaceMember, async (c) => {
    const db = getDb(c.env.DB);
    const user = c.get("user");
    const body = importService.createImportSchema.parse(await c.req.json());
    const imp = await importService.create(db, user.sub, c.get("workspace").id, body);
    return c.json(imp, 201);
  });
