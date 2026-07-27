# Feedback portal + embeddable widget — Atur issue draft

Ready to paste into Atur once MCP is connected. Work is **done + verified** → create into `Need Review`, then run code-review subagent, then `Done`.

- **Workspace:** `plane-pmo` (or your choosing)
- **Project:** pick (no atur-dev project known)
- **Title:** `Feedback portal + embeddable widget`
- **Priority:** `high`
- **State on create:** `Need Review` (create the state if missing: name "Need Review", group "started", color "#F97316")

## Connect Atur MCP first (then restart Claude Code so it binds)

```bash
cd ~/Documents/cobacoba/plane-pmo && \
  PLANE_DB_URL="sqlite:./data/plane.db" PLANE_MCP_AUTH=true ./target/release/atur serve
claude mcp add atur --transport http http://localhost:8080/mcp -s user -H "X-API-Key: pk_live_<KEY>"
```

## Description (paste as HTML)

```html
<h3>Context</h3>
<p>Atur had no public customer surface. A separate effort covers the support portal (helpdesk tickets). This issue delivers a distinct <strong>feedback portal</strong> — customers submit ideas, upvote, comment, and watch status (Canny/Featurebase style). Feedback lands as tagged issues inside an existing project so the team triages it alongside normal work. An embeddable <code>&lt;script&gt;</code> lets customers mount a floating bubble on their own site that opens the full board, wired to the platform via an unguessable public token.</p>

<h3>What To Do</h3>
<ul>
<li>New tables <code>feedback_boards</code>, <code>feedback_votes</code>, <code>feedback_meta</code> + seeded <code>feedback-bot</code> user (migration <code>server-js/migrations/2026-07-27-feedback-portal.sql</code>).</li>
<li>Public, token-keyed API (no session): <code>server-js/src/routes/feedback.ts</code> → <code>/public/feedback/:token/*</code> (board, items, votes, comments). Service/repo under <code>src/{services,repositories}/feedback.ts</code>.</li>
<li>Rate limiting via <code>RATE_LIMIT</code> KV (<code>src/lib/rateLimit.ts</code>): submit 10/min, vote 30/min, comment 20/min.</li>
<li>Embed widget: <code>src/routes/widget.ts</code> + <code>src/widget/widget.js.ts</code> served at <code>/widget.js</code> (shadow-DOM bubble → iframe popover).</li>
<li>Authed admin config: <code>src/routes/feedback_admin.ts</code> → <code>/api/workspaces/:slug/projects/:projectId/feedback-board</code> (GET/PUT/DELETE; mints token, ensures <code>feedback</code> label, picks default state).</li>
<li>Frontend: <code>frontend/src/pages/feedback/FeedbackPortalPage.tsx</code> at <code>/feedback/:token</code> (<code>?embed=1</code> = frameless), public client <code>lib/feedbackApi.ts</code>, admin section <code>components/projects/FeedbackBoardSettings.tsx</code> (new "Feedback" tab in ProjectSettingsPage), <code>lib/api.ts</code> methods+type.</li>
<li>Wire routes in <code>app.ts</code>; add <code>/widget.js</code> + <code>/public/</code> to the worker-handled set in <code>index.ts</code>.</li>
</ul>

<h3>Acceptance Criteria</h3>
<ul>
<li>Admin enables a board → <code>public_token</code> returned, <code>feedback</code> label + default state set.</li>
<li><code>POST /public/feedback/:token/items</code> creates an issue tagged <code>external_source='feedback'</code>; only those appear on the public board (internal issues stay private).</li>
<li>Vote toggles: same voter second call removes the vote (count → 0); different voter increments. Upvote-only, dedup by hashed identity.</li>
<li>Rate limit: 11th submit in a minute → 429.</li>
<li><code>/feedback/:token</code> renders board, submit dialog, voting, item detail+comments; <code>?embed=1</code> frameless.</li>
<li>Customer <code>&lt;script src="…/widget.js" data-atur-token="…"&gt;</code> renders bubble; click opens popover iframe; submit/vote work; host page styles isolated (shadow DOM).</li>
<li>Security: bogus token → 404; admin route without session → 401; XSS-safe (public input rendered as React text, never <code>dangerouslySetInnerHTML</code>).</li>
<li><code>tsc --noEmit</code> clean for both <code>server-js</code> and <code>frontend</code>; <code>npm run build</code> succeeds.</li>
</ul>

<h3>Technical Notes</h3>
<ul>
<li><strong>Route:</strong> page is <code>/feedback/:token</code>, NOT <code>/portal/:token</code> — the support-portal agent mounted their API at <code>/portal</code>, which would intercept a <code>/portal/&lt;token&gt;</code> GET and 404 before reaching the SPA. Public API <code>/public/feedback/:token</code> never conflicted.</li>
<li><strong>XSS:</strong> public input stored as escaped HTML (<code>description_html</code>/<code>comment_html</code> for the internal view) AND plain text (<code>description_stripped</code>/<code>comment_stripped</code>). Portal renders only the plain-text fields as React <code>{text}</code>.</li>
<li><strong>Token:</strong> <code>pk_fb_&lt;uuid&gt;</code>. <strong>Voter hash:</strong> SHA-256(email || ip+ua + in-code salt).</li>
<li><strong>Comment actor:</strong> <code>issue_comments.actor_id</code> is NOT NULL FK→users, so all public comments are authored by the seeded <code>feedback-bot</code> user (<code>feedbac0-0000-0000-0000-000000000000</code>).</li>
<li><strong>Prod deploy TODO:</strong> run the migration on remote D1 — <code>wrangler d1 execute DB --remote --file=server-js/migrations/2026-07-27-feedback-portal.sql</code> (only tested <code>--local</code>).</li>
<li>Verified locally via <code>wrangler dev</code>: full submit/vote-toggle/comment flow + 404/401 gating confirmed.</li>
</ul>
```

## After create

```
update_issue(state_id=<Need Review uuid>)
# spawn code-reviewer subagent on the changed files
# → clean: update_issue(state_id=<Done uuid>) + add_comment("Code review passed.")
```
