## Atur MCP Server (Project Management)

**Backend**: `apps/app/` — Hono on Cloudflare Workers (worker `atur-hono`), deployed at **https://app.diatur.com**. The marketing site (`apps/web/`, Astro) lives at https://diatur.com. MCP endpoint: **https://app.diatur.com/mcp**.

**Auth**: send `X-API-Key: pk_live_<key>`. Keys are SHA-256-hashed in the `api_keys` table; mint via the UI (`POST /api/users/me/api-keys`) or directly in D1 (see Registration). Session tokens (`users.token` / `plane-session` cookie) also authenticate via the same header.

**Local dev**: `cd apps/app && bun run dev` (vite dev server — worker + SPA on one origin). **Deploy**: `cd apps/app && bun run deploy`. **D1 remote**: `bunx wrangler d1 execute atur-db --remote --command "..."`. **Typecheck**: `bun run typecheck` from the repo root.

### Pre-Push Gate — REQUIRED before every `git push`

CI runs the exact same checks; a push that turns CI red is a failed push. From the repo root, run all
four and fix every failure (across ALL projects — every app and package in the monorepo — not just
the files you touched):

```bash
bun run fmt:check   # formatting (oxfmt). Fix with: bun run fmt
bun run lint        # oxlint
bun run typecheck   # @atur/app + @atur/bridge
bun run test        # app test suite
```

Rules:

- If a check fails for a reason unrelated to your change (pre-existing red), do not silently push —
  say so in the commit/PR and link the failing run, or fix it if cheap.
- Never weaken a check (no `--no-verify`, no skipping scripts) to get a push through.
- After `bun install`, dependency bumps, or lockfile changes, re-run the full gate: stale caches and
  new deps can break checks that passed before (e.g. vite's optimize cache on a running dev server).

### HOW TO USE ATUR — Read This First

Atur tools are prefixed `mcp__atur__`. ALWAYS pass `workspace` (slug) AND `project_id` (UUID) where accepted — do not skip them.

**Step 1: Discover the workspace and project.**

```
list_workspaces → get the slug (e.g. "opexmx", "voltrus", "cloudagni")
list_projects(workspace="<slug>") → get project UUIDs
```

Always do these FIRST in any session involving Atur. Cache the slug + project_id in your context for the rest of the conversation.

**Step 2: Get states and labels BEFORE creating/updating issues.**

```
list_states(project_id="<uuid>", workspace="<slug>") → maps state names to UUIDs
list_labels(project_id="<uuid>", workspace="<slug>") → maps label names to UUIDs
```

State UUIDs are needed for `update_issue` (changing status). Label UUIDs are needed for `create_issue` (tagging). Example states: `backlog`, `todo`, `in-progress`, `needs-you`, `need-review`, `done`, `cancelled`, `triage`.

**Step 3: Use the correct IDs in all subsequent calls.**

### Known Workspaces

| Name                  | Slug                 |
| --------------------- | -------------------- |
| OpexMX                | `opexmx`             |
| Voltrus               | `voltrus`            |
| Cowculator            | `cowculator`         |
| E-Pondok              | `e-pondok`           |
| Revklik               | `revklik`            |
| Waqtu                 | `waqtu`              |
| CloudAgni             | `cloudagni`          |
| JoyoDigitama          | `joyodigitama`       |
| WeLoveOurBaby         | `weloveourbaby`      |
| BriefOK               | `briefok`            |
| WatchFit              | `watchfit`           |
| Atur                  | `diatur`             |
| MotionCue             | `motioncue`          |
| Dzul & Allicia Family | `family`             |
| YouTube Automation    | `youtube-automation` |
| Nempel                | `nempel`             |
| Mailflare             | `mailflare`          |
| intip                 | `intip`              |
| AturPDF               | `aturpdf`            |

> **IMPORTANT**: Slugs verified 2026-09-03 (all owned by `ab39f025…` / dzulfikar). If `list_workspaces` returns different results, trust the live data.

### Common Workflows

**Create a new issue:**

```
create_issue(
  project_id="<uuid>",
  workspace="<slug>",
  name="Issue title",
  description_html="<p>Details</p>",
  priority="high|medium|low|urgent|none",
  state_id="<uuid from list_states>",       // optional, defaults to project default
  label_ids=["<uuid>", ...],                // optional
  assignee_ids=["<uuid>", ...]              // optional
)
```

**Update an issue (change state, priority, etc):**

```
update_issue(
  project_id="<uuid>",
  workspace="<slug>",
  issue_id="<issue uuid>",
  state_id="<uuid from list_states>",
  priority="high",
  name="New title"                          // optional
)
```

**Find issues:**

```
list_issues(project_id="<uuid>", workspace="<slug>", state="<state_uuid>", limit=50)
search_issues(query="search terms", workspace="<slug>")
```

**Link issues:**

```
add_issue_relation(
  project_id="<uuid>", workspace="<slug>",
  issue_id="<uuid>", related_issue_id="<uuid>",
  relation_type="blocks|blocked_by|relates_to|duplicates"
)
```

**Sprint management:**

```
list_sprints(project_id="<uuid>", workspace="<slug>")
add_issue_to_sprint(project_id="<uuid>", workspace="<slug>", sprint_id="<uuid>", issue_id="<uuid>")
```

### Issue Description Standard

Every issue MUST have a complete description using this template. No blank descriptions allowed.

**Template (HTML for `description_html`):**

```html
<h3>Context</h3>
<p>
  Why this issue exists. What problem it solves or what goal it serves. Reference related issues by
  ID (e.g. "Depends on RRD-20").
</p>

<h3>What To Do</h3>
<ul>
  <li>Specific, actionable implementation step 1</li>
  <li>Specific, actionable implementation step 2</li>
  <li>...</li>
</ul>

<h3>Acceptance Criteria</h3>
<ul>
  <li>Testable, verifiable condition 1</li>
  <li>Testable, verifiable condition 2</li>
  <li>...</li>
</ul>

<h3>Technical Notes</h3>
<ul>
  <li>Key files or modules to touch</li>
  <li>Design decisions or constraints</li>
  <li>Dependencies on other issues</li>
</ul>
```

**Rules for descriptions:**

- **Context**: Explain WHY, not just WHAT. A new team member should understand the motivation.
- **What To Do**: Numbered steps, not vague goals. "Implement X in file Y using pattern Z" not "Add feature".
- **Acceptance Criteria**: Must be binary pass/fail. "Test passes", "CLI outputs X", not "Works well".
- **Technical Notes**: Note files, crates, patterns, dependencies. Future-you will thank present-you.
- If an issue is too small for the full template, still write at least Context + Acceptance Criteria.

### Full SDLC Workflow

Follow this lifecycle for every issue you work on:

```
Todo → In Progress → Need Review → Done
         ↓                ↓
      Needs You       [Code Review]
         ↓            ↙           ↘
   human answers   Clean     Issues Found
   in a comment       ↓          ↓
         ↓          Done  Fix → Need Review (loop)
   resumes In Progress
```

**Step 1: Start work**

```
update_issue(state_id=in_progress)
// Do the development work
```

**Step 2: Blocked on a human → Needs You**

Paused mid-work is a state, not silence. Missing credential, ambiguous spec,
approval gate, third-party wait — move the issue and say exactly what you need.

```
update_issue(state_id=needs_you)
add_comment("NEEDS YOU: <the exact decision/input/approval required>")
// Human answers in a comment, then:
add_comment("Resuming: <what changed>")
update_issue(state_id=in_progress)
```

`Needs You` = agent paused mid-work awaiting human input. NOT the same as
`Need Review` (agent finished, awaiting human judgment). If a project lacks
the state, create it (Key Rule 9). WeLoveOurBaby DEV predates the convention:
its `Need Confirmation` state means the same thing — treat as Needs You.
**Step 3: Development complete → Mark for review**

```
update_issue(state_id=need_review)
add_comment("Development complete. Changed files: X, Y, Z. Key decisions: ...")
```

**Step 3.5: Log usage (AI agents only)**

After finishing work on an issue, record your token consumption so the human can
see where tokens go and evaluate agent efficiency like human KPIs:

```
create_time_entry(
  project_id, workspace, issue_id,
  duration_seconds=<wall-clock seconds spent>,
  source="agent",
  agent_name="<harness>/<agent>",       // e.g. "omp/firstmate", "codex/pane-9"
  model="<model id>",                   // e.g. "zai/glm-5.3-flash"
  input_tokens=..., output_tokens=...,  // as reported by your harness
  cache_read_tokens=..., cache_write_tokens=..., reasoning_tokens=...  // when known
)
```

Rules: one entry per task tackle; `agent_name` is required when
`source="agent"`; omit token fields you genuinely don't know rather than
guessing. Human timesheet totals exclude agent entries — usage is reported
separately via `get_agent_usage` (MCP) or `GET /api/workspaces/:slug/timesheet/agent-usage`.

**Step 4: Spawn code review sub-agent**

```
Agent(subagent_type="code-reviewer", prompt="
  Review the implementation for issue <ID>: <name>.
  Issue description: <paste description>.
  Changed files: <list files>.
  Check for: bugs, security issues, missing tests, code quality, adherence to project patterns.
  Report: list of issues found (if any) with severity and file:line references.
")
```

**Step 5a: Review clean → Mark Done**

```
update_issue(state_id=done)
add_comment("Code review passed. No issues found.")
```

**Step 5b: Review found issues → Fix → Re-review**

```
// Fix the issues found by reviewer
// Then loop back to Step 3 (mark Need Review again, spawn new review)
add_comment("Review feedback addressed: <describe fixes>")
update_issue(state_id=need_review)
```

**NEVER skip code review.** Every implementation goes through Need Review before Done. No exceptions.

### Key Rules

1. **Always pass `workspace` and `project_id`** — tools fail or use wrong context without them.
2. **`description_html` accepts HTML** — use `<h3>`, `<h4>`, `<ul><li>`, `<p>`, `<strong>`, `<code>`, `<table>` tags. Do NOT pass markdown.
3. **IDs are UUIDs** — workspace slugs are short strings (e.g. `opexmx`), but project_id, issue_id, state_id, label_id, sprint_id are all UUIDs like `73bcddf0-f5fa-4340-bbb3-40b12e98c6a6`.
4. **Batch parallel calls** — `list_states`, `list_labels`, `list_issues` can all be called in parallel when you need setup data.
5. **Get issue details with `get_issue`** — use `sequence_id` (the human-readable number, e.g. 35) OR `issue_id` (UUID). Both work.
6. **Issue relations are bidirectional** — `blocks` means "this issue blocks the related one". `blocked_by` means "this issue is blocked by the related one".
7. **No blank descriptions** — every issue must follow the Description Standard template above.
8. **Always add comments** when changing state — document WHAT changed and WHY (e.g. "Development complete, files changed: X, Y").
9. **"Need Review" and "Needs You" states must exist per project** — if missing, create them: `create_state(name="Need Review", group="started", color="#F97316")` and `create_state(name="Needs You", group="started", color="#EC4899", description="Agent paused mid-work — needs human input, decision, or approval. Agent comments exactly what it needs; human answers in a comment; agent resumes In Progress.")`.

### Headless Browser — Obscura by Default

For any headless browser task — reading a web page, scraping content, extracting
links, or smoke-fetching a deployed site — use **`obscura`** (`/usr/bin/obscura`)
by default. Do NOT install or launch Playwright/Puppeteer/Chromium for these;
reach for interactive browser tooling only when you need clicks, logins, or
screenshots (Obscura has no screenshot mode).

```
obscura fetch "https://example.com" --dump markdown      # one page → markdown
obscura fetch "https://example.com" --dump text          # rendered text
obscura fetch "https://example.com" --dump links         # every link
obscura fetch "https://example.com" --dump original      # raw HTTP body, no JS (JSON/images/JS)
obscura fetch "https://example.com" -e "document.title"  # run JS in the page
obscura serve --port 9222                                # CDP endpoint for real browser clients
obscura mcp                                              # MCP server (stdio); --http --port 3000 for HTTP
```

Rules:

- **Default flags**: `--wait 5 --timeout 30`; pass `--wait 2` for fast checks.
- **Bot-protected sites**: add `--stealth` and `--user-agent "<real UA>"`.
- **Non-HTML resources** (JSON APIs, images, raw files): `--dump original`
  bypasses the browser layer entirely.
- **Localhost / dev servers**: Obscura blocks loopback + RFC1918 by default
  (SSRF protection). Use `--allow-private-network` when fetching
  `http://localhost:N` or LAN addresses — e.g. verifying a local dev server.
- `scrape` needs a separate `obscura-worker` binary (not installed here) — for
  multiple pages, loop `obscura fetch` instead.
- Screenshots still need Playwright/`browser` tooling → see Screenshot Evidence
  Workflow below.

### Screenshot Evidence Workflow (AI Agents)

Use `upload_image` + `add_comment` to attach screenshot evidence when verifying work with Playwright or other browser automation.

**`upload_image` runs remotely — it cannot read your local disk. Read the file
yourself, base64-encode the bytes, and pass them as `content_base64`:**

```
upload_image(
  content_base64="<base64 file bytes>",   # required; a data: URL prefix is tolerated
  filename="evidence.png",                # required; the extension seeds the MIME type
  mime_type="image/png",                  # optional override (image/* and application/pdf only)
  issue_id="<uuid>",                      # optional; links the asset to an issue
)
  → { id, url, size, filename }           # url = https://app.diatur.com/api/assets/<uuid>
```

Uploads are capped at 25 MB. Stored assets live in R2 and are served through
the worker (auth-checked, XSS-safe MIME, edge image resizing via `?w=`/`?format=`).

**Workflow:**

```
1. Take screenshot with Playwright → saves to local file
2. Read the file, base64-encode it, then upload_image(content_base64=…, filename=…)
   → returns { id, url, size }
3. add_comment(
     project_id, issue_id, workspace,
     comment_html='<p>Verified: feature works as expected</p><p><img src="URL_FROM_STEP_2" alt="evidence"></p>'
   )
4. update_issue(state_id=done)  // mark complete with evidence attached
```

**Example (in Codex):**

```bash
# Take screenshot
browser_take_screenshot(filename="evidence.png")

# Base64-encode the screenshot, then upload
base64 -w0 evidence.png        # copy the output
upload_image(content_base64="<paste base64>", filename="evidence.png")
# → { "url": "https://app.diatur.com/api/assets/<uuid>" }

# Comment with embedded image
add_comment(
  project_id="<uuid>", issue_id="<uuid>", workspace="<slug>",
  comment_html='<p>✅ Verified with screenshot evidence</p><img src="https://app.diatur.com/api/assets/<uuid>" alt="evidence">'
)
```

### 50 Available Tools

| Category              | Tools                                                                                                                                    |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Workspace             | `list_workspaces`, `create_workspace`, `update_workspace`, `delete_workspace`, `list_workspace_members`                                  |
| Projects              | `list_projects`, `get_project`, `create_project`                                                                                         |
| Issues                | `list_issues`, `create_issue`, `get_issue`, `update_issue`, `delete_issue`, `search_issues`, `add_comment`, `list_comments`              |
| Issue Relations       | `list_issue_relations`, `add_issue_relation`, `remove_issue_relation`                                                                    |
| Sprints               | `list_sprints`, `create_sprint`, `get_sprint`, `update_sprint`, `add_issue_to_sprint`, `remove_issue_from_sprint`, `get_sprint_progress` |
| Modules               | `list_modules`, `get_module`, `add_issue_to_module`, `remove_issue_from_module`                                                          |
| Pages                 | `list_pages`, `get_page`, `create_page`, `update_page`                                                                                   |
| States/Labels/Members | `list_states`, `list_labels`, `list_members`, `set_assignee`                                                                             |
| Time                  | `list_time_entries`, `create_time_entry`, `delete_time_entry`, `get_agent_usage`                                                         |
| CRM Contacts          | `list_contacts`, `create_contact`, `get_contact`, `update_contact`                                                                       |
| CRM Deals             | `create_deal`, `list_deals`, `move_deal_stage`, `update_deal`                                                                            |
| Assets                | `upload_image`                                                                                                                           |

### Registration

Global Codex config (`~/.Codex.json` → `mcpServers.atur`) is **already wired to prod** (https://app.diatur.com/mcp, user scope). Restart Codex after editing to load `mcp__atur__*` tools.

**Codex**: `Codex mcp add atur --transport http https://app.diatur.com/mcp -s user -H "X-API-Key: pk_live_<KEY>"`
**Cursor** (`.cursor/mcp.json`): `{ "mcpServers": { "atur": { "url": "https://app.diatur.com/mcp", "transport": "http", "headers": { "X-API-Key": "pk_live_<KEY>" } } } }`
**Codex Desktop** (`~/Library/Application Support/Codex/claude_desktop_config.json`): `{ "mcpServers": { "atur": { "url": "https://app.diatur.com/mcp", "transport": "http", "headers": { "X-API-Key": "pk_live_<KEY>" } } } }`

**Mint a prod key via D1** (no login needed). Keys are SHA-256-hashed; only the hash is stored:

```bash
# 1. generate key + sha256 hash	node -e 'const c=require("crypto");const k="pk_live_"+c.randomBytes(32).toString("hex");console.log(k,c.createHash("sha256").update(k).digest("hex"))'
# 2. insert into prod api_keys (bind to your user id)
wrangler d1 execute atur-db --remote --command "INSERT INTO api_keys (id,key_hash,label,user_id,is_active,created_at,updated_at) VALUES ('<uuid>','<hash>','Codex','<user-uuid>',1,'<iso>','<iso>');"
```

### Control Plane — Agent Claim/Evidence Convention (DEV-29)

Atur is the control plane; the harness (herdr/omp) is the execution plane.
Harness = source of truth for live state. Atur = source of truth for intent
(issues) + history (evidence). Never gate on Atur reflecting live state.

**Before spawning an agent for a workspace**, read its binding:
`get_workspace_links(workspace: "<slug>")` (or `GET /api/workspaces/:slug/links`).
The binding carries repo(s), local checkout path, default branch, and herdr
workspace. Spawn work in a git worktree of the bound repo.

**Claim** (agent starts work):

```
add_comment: "Picked up by <agent-name> (pane <pane-id>).
Observe: https://app.diatur.com/panes/<pane-id> — live terminal of the pane
in the browser (Atur Worker authenticates; requires the atur-bridge daemon
running on the agent host with its Cloudflare Tunnel up). On the agent host
itself, `herdr pane read <pane-id> --format ansi` reads the current screen."
update_issue: state_id = In Progress
```

One claim comment per task. No progress spam — edit or reply only when there
is a decision or a blocker.

**Evidence** (agent finishes):

```
add_comment: what changed + proof (screenshot via upload_image, or test/command
output). UI work MUST attach a screenshot; CLI/test work attaches the run output.
update_issue: state_id = Need Review
```

Agents NEVER move an issue to Done and NEVER push to the default branch —
human merges. On harness restart, any issue sitting in In Progress with a dead
pane must be re-claimed or commented as crashed before new work starts, so
Atur never lies about who is working.

**Usage telemetry — harness auto-report (preferred) + self-report (fallback)**

Agents running under omp with `ATUR_API_KEY` in the pane environment report
token usage AUTOMATICALLY: the `atur-usage` hook
(`~/.omp/agent/extensions/atur-usage.ts`, source: `scripts/omp/atur-usage.ts`
in this repo) watches Atur MCP tool calls to detect the issue being tackled,
sums exact usage from session entries, and files a `source="agent"` time entry
when the agent switches issues or the session ends. No manual logging needed.
When the hook is active, do NOT also self-report — that would double-count.
Agents on harnesses without the hook still log manually per Step 3.5 above.
Both land in the same ledger and roll up identically via `get_agent_usage`.

### Control Plane — First Mate Role (liaison)

You (the omp session the human talks to) are the first mate. The human talks
to ONE agent — you — and you run the crew:

- **Dispatch**: for work in a bound workspace, use the spawn loop
  (`apps/app/scripts/spawn-loop.ts --watch slug:IDENT`) or spawn task agents
  directly. One crewmate per issue; crewmates claim via the convention above.
- **Supervise**: `spawn-loop.ts --status` is the crew table (issue, pid,
  age, link). Dead-pid claims are commented as crashed and requeued — Atur
  must never say "in progress" about a dead process.
- **Report plain outcomes**: issue links + evidence comments, not process
  narration. Escalate ONLY real decisions (ambiguity, cost, autonomy).
- **Autonomy is per-workspace** (`workspace_links.mode`): `local-only`
  (default) = agent leaves a branch, human merges; `direct-PR` = agent pushes
  - opens a PR; plus `auto_merge: yolo` = agent may merge after green gates.
    Never widen autonomy without the human saying so.
- **Task shapes**: default is SHIP (implement + evidence). Titles prefixed
  `[SCOUT]` are investigation-only — findings go in the evidence comment, no
  file changes, then Need Review.

Firstmate reference: github.com/kunchenguid/firstmate. Differences: control
state lives in Atur (not on-disk data files); the board is the Atur app.
