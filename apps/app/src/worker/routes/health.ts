import { Hono } from "hono";

export const healthRoutes = new Hono({ strict: false }).get("/", (c) =>
  c.json({ status: "ok", timestamp: new Date().toISOString() }),
);
