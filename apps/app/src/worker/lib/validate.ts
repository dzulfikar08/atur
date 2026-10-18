import type { Context } from "hono";
import type { z } from "zod";
import { HTTPException } from "hono/http-exception";

// Public machine-facing endpoints (widget, native app, log shippers) need a 400
// with a readable reason; a bare ZodError would surface as an opaque 500.
export function parseOr400<S extends z.ZodType>(schema: S, data: unknown): z.infer<S> {
  const parsed = schema.safeParse(data);
  if (parsed.success) return parsed.data;
  const issues = parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
  const first = issues[0];
  const message = first ? `${first.path || "body"}: ${first.message}` : "Invalid request body";
  throw new HTTPException(400, {
    res: Response.json({ error: "Invalid request", message, issues }, { status: 400 }),
  });
}

// Sub-app onError for the public token-keyed routes: always `{ message }` JSON,
// never Hono's text/plain default, so widget/native/CLI callers parse one shape.
export function publicJsonError(err: Error, c: Context): Response {
  if (err instanceof HTTPException) {
    // parseOr400 already carries a JSON body.
    if (err.res) return err.getResponse();
    return c.json({ error: err.message, message: err.message }, err.status);
  }
  console.error("Unhandled public API error:", err);
  return c.json({ error: "Internal server error", message: "Internal server error" }, 500);
}
