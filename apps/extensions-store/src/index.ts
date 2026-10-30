import { Hono } from "hono";
import { api } from "./api";
import { pages } from "./pages";
import { publishing } from "./publish";
import type { AppEnv } from "./types";

export const app = new Hono<AppEnv>();

app.use("*", async (c, next) => {
  await next();
  c.res.headers.set("x-content-type-options", "nosniff");
  if (c.res.headers.get("content-type")?.startsWith("text/html")) {
    c.res.headers.set(
      "content-security-policy",
      "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    );
  }
});

app.route("/", api);
app.route("/", publishing);
app.route("/", pages);

app.get("/healthz", (c) => c.json({ ok: true }));
app.notFound((c) => c.json({ error: "not found" }, 404));
app.onError((error, c) => {
  console.error(error);
  return c.json({ error: "internal error" }, 500);
});

export default app;
