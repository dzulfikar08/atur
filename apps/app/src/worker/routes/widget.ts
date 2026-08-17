import { Hono } from "hono";
import type { Env } from "../lib/env";
import { WIDGET_JS } from "../widget/widget.js";

// Serves the embeddable widget at /widget.js. Customers include:
//   <script src="https://app.diatur.com/widget.js" data-atur-token="pk_fb_..." async></script>
// The script is cacheable (5 min) and CORS-open so any site can load it.
export const widgetRoutes = new Hono<{ Bindings: Env }>({ strict: false });

widgetRoutes.get("/", (c) =>
  c.body(WIDGET_JS, 200, {
    "Content-Type": "application/javascript; charset=utf-8",
    "Cache-Control": "public, max-age=300",
    "Access-Control-Allow-Origin": "*",
  }),
);
