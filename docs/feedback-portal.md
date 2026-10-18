# Feedback + support portal (DEV-39)

One public surface for what customers tell you: **ideas** (feedback board), **tickets**
(bug reports and questions) and a **changelog**, plus **log ingest** for your servers. Everything
lands as issues in a project of your workspace.

| Piece                 | URL                                              |
| --------------------- | ------------------------------------------------ |
| Portal                | `https://app.diatur.com/portal/<workspace-slug>` |
| Widget script         | `https://app.diatur.com/widget.js`               |
| Board config (public) | `GET /api/feedback/<board-token>/config`         |
| Upload attachment     | `POST /api/feedback/<board-token>/attachments`   |
| Submit item           | `POST /api/feedback/<board-token>/items`         |
| Log ingest            | `POST /api/ingest/<ingest-key>`                  |

Enable a board in **Project settings → Feedback board**. That page shows the embed snippet,
the identify secret and the ingest key. `/feedback/<board-token>` still works and redirects to the
Ideas tab of the portal.

## Portal

`/portal/<slug>` has three tabs:

- **Ideas** – the public boards of the workspace (vote, comment, post ideas). `?board=<token>`
  selects a board, `?item=<id>` opens an idea.
- **Support** – everything the signed-in person filed: tickets (bug reports, questions, portal
  tickets) and ideas they posted. Needs sign-in.
- **Changelog** – ideas whose state is in the _completed_ group, newest first.

Sign-in is one email OTP per workspace. "Everything you filed" is matched by the **verified**
email of the OTP login. A report counts only when its email is trusted: the board has no identify
secret, or the reporter's `Atur.identify()` signature verified. Reports with an unsigned email on a
board that has a secret are kept for the team (shown "unverified" in the issue) but never appear in
anyone's portal.

Attachments are served by `/api/assets/<id>` to workspace members and, in the portal, only to the
person who filed the issue they are attached to.

## Embed the widget

```html
<script>
  window.Atur = window.Atur || { q: [] };
</script>
<script
  src="https://app.diatur.com/widget.js"
  data-atur-token="pk_fb_…"
  data-app-version="2.4.1"
  async
></script>
```

Put it in `<head>` (without `async`) if you want console errors and failed requests from page
load to be captured; the widget only sees what happens after it runs.

Attributes:

| Attribute            | Meaning                                                                       |
| -------------------- | ----------------------------------------------------------------------------- |
| `data-atur-token`    | Board token (required).                                                       |
| `data-app-version`   | Your release, attached to every report.                                       |
| `data-atur-position` | `bottom-right` (default), `bottom-left`, `top-right`, `top-left`.             |
| `data-atur-context`  | `off` disables all automatic context capture and the fetch/XHR/console hooks. |

The panel has three modes — **Feedback** (idea), **Report a bug** and **Get help** (both create
tickets) — a **Capture screenshot** button and **Attach file** (PNG/JPEG/WebP/GIF/PDF/text, 10 MB,
up to 5). Screenshots render the visible viewport client-side by serializing the DOM into an SVG
(no library, no prompt); when the browser can't rasterize the page it falls back to a single
`getDisplayMedia` frame, which shows the browser's own consent prompt.

JavaScript API: `Atur.identify(user)`, `Atur.open("idea" | "bug" | "help")`, `Atur.close()`.
Calls made before the script loads can be queued: `Atur.q.push(["identify", { … }])`.

### Automatic context

Unless `data-atur-context="off"`, each report carries: page URL (values of query parameters that
look like secrets — `token`, `key`, `secret`, `auth`, `session`, … — are replaced with `REDACTED`),
user agent, viewport, `data-app-version`, language/screen, the last **20 console errors** (including
uncaught errors and unhandled rejections) and the last **20 failed fetch/XHR requests** (method, URL
**without query string**, status; `0` = network error). The server redacts again before storing.
It is stored structured (`feedback_meta.context_json`) and rendered in the issue description as a
collapsible **Context** block.

### Identify

```js
Atur.identify({ id: "user-42", email: "ana@example.com", name: "Ana", signature });
```

With an **identify secret** on the board (create it in the board settings), the email is trusted
only when `signature = hex(HMAC-SHA256(secret, id))`. Compute it on **your server**, never in the
browser:

```js
const signature = crypto
  .createHmac("sha256", process.env.ATUR_IDENTIFY_SECRET)
  .update(String(user.id))
  .digest("hex");
```

Without a secret on the board, the email is accepted as typed but never marked verified.
Rotating the secret invalidates old signatures immediately; removing it turns enforcement off.

## Submit from anywhere (native app, scripts)

```http
POST /api/feedback/<token>/attachments      multipart field "file"   →  201 { id, url, filename, size, mime }
POST /api/feedback/<token>/items            application/json         →  201 { id, sequence_id, url }
```

Item body: `{ title (3-120), description?, email?, name?, kind?: "idea"|"bug"|"question",
source?: "portal"|"widget"|"native"|"api", context?: {…}, attachment_ids?: string[] (≤5),
external_user?: { id, email?, name?, signature? } }`. `kind` `bug`/`question` create a support
ticket (visible under Support for that email); `idea` stays on the board. Unclaimed uploads older than
24 h are deleted by the daily cron (and opportunistically on upload). Public endpoints are rate
limited; errors return JSON with `message`.

The Atur mobile app files its in-app reports to Atur's own board this way
(`source: "native"`).

## Log ingest

Create an **ingest key** in the board settings, then:

```bash
curl -X POST https://app.diatur.com/api/ingest/<ingest-key> \
  -H 'content-type: application/json' \
  -d '{
    "message": "Payment 123 failed",
    "level": "error",
    "service": "api",
    "environment": "production",
    "stack": "Error: Payment failed\n    at pay (/srv/pay.js:10:3)",
    "context": { "user": "u1" },
    "logs": ["charge started", "gateway timeout"]
  }'
# → { "issue_id": "…", "sequence_id": 103, "occurrences": 1, "created": true }
```

Body: `message` (required), `level` (`error` default / `warning` / `info`), `fingerprint?`, `stack?`,
`service?`, `environment?`, `context?` (object), `logs?` (≤ 50 lines). The key in the path is the
credential; keep it on your servers. Rotate or revoke it in the board settings (revoked → `404`).

Grouping: the default fingerprint is `sha256(service | normalized message | top stack frame)` where
digits/UUIDs/hex in the message and line numbers in the frame are masked, so "Payment 123 failed"
and "Payment 456 failed" group together. Pass your own `fingerprint` to override.

The first occurrence creates one issue (`priority` high/medium/low by level, no portal visibility).
Every further occurrence increments the counter and rewrites two machine-managed blocks at the top
and bottom of the description — **Occurrences / First seen / Last seen** and the **context + recent
logs of the latest occurrence** — so human edits in between are preserved. If the team deletes the
issue, the next occurrence opens a fresh one. Ingest is limited to 120 requests/minute per key.
