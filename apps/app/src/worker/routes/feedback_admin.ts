import { Hono } from "hono";
import type { Env } from "../lib/env";
import { getDb } from "../db/index";
import * as feedback from "../services/feedback";

// Authed admin config for a project's feedback board. Mounted under
// /api/workspaces/:slug/projects/:projectId/feedback-board, so the global
// authMiddleware (session) already gates it; the service additionally asserts
// the caller is a member of the workspace.
export const feedbackAdminRoutes = new Hono<{ Bindings: Env }>({ strict: false });

feedbackAdminRoutes
  .get("/", async (c) => {
    const db = getDb(c.env.DB);
    const user = c.get("user");
    return c.json(
      await feedback.getAdminConfig(db, c.req.param("slug")!, c.req.param("projectId")!, user.sub),
    );
  })
  .put("/", async (c) => {
    const db = getDb(c.env.DB);
    const user = c.get("user");
    const body = feedback.upsertBoardSchema.parse(await c.req.json());
    return c.json(
      await feedback.upsertAdminConfig(
        db,
        c.req.param("slug")!,
        c.req.param("projectId")!,
        user.sub,
        body,
      ),
    );
  })
  .delete("/", async (c) => {
    const db = getDb(c.env.DB);
    const user = c.get("user");
    return c.json(
      await feedback.deleteAdminConfig(
        db,
        c.req.param("slug")!,
        c.req.param("projectId")!,
        user.sub,
      ),
    );
  })
  // Identify secret (HMAC key for Atur.identify) and ingest key (log ingest):
  // POST creates or rotates, DELETE revokes.
  .post("/identify-secret", async (c) => {
    const user = c.get("user");
    return c.json(
      await feedback.setBoardSecret(
        getDb(c.env.DB),
        c.req.param("slug")!,
        c.req.param("projectId")!,
        user.sub,
        "identify_secret",
        "rotate",
      ),
    );
  })
  .delete("/identify-secret", async (c) => {
    const user = c.get("user");
    return c.json(
      await feedback.setBoardSecret(
        getDb(c.env.DB),
        c.req.param("slug")!,
        c.req.param("projectId")!,
        user.sub,
        "identify_secret",
        "revoke",
      ),
    );
  })
  .post("/ingest-key", async (c) => {
    const user = c.get("user");
    return c.json(
      await feedback.setBoardSecret(
        getDb(c.env.DB),
        c.req.param("slug")!,
        c.req.param("projectId")!,
        user.sub,
        "ingest_key",
        "rotate",
      ),
    );
  })
  .delete("/ingest-key", async (c) => {
    const user = c.get("user");
    return c.json(
      await feedback.setBoardSecret(
        getDb(c.env.DB),
        c.req.param("slug")!,
        c.req.param("projectId")!,
        user.sub,
        "ingest_key",
        "revoke",
      ),
    );
  });
