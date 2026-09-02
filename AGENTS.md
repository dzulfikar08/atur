## Atur MCP Server (Project Management)

**Backend**: `apps/app/` — Hono on Cloudflare Workers (worker `atur-hono`), deployed at **https://app.diatur.com**. The marketing site (`apps/web/`, Astro) lives at https://diatur.com. MCP endpoint: **https://app.diatur.com/mcp**.

**Auth**: send `X-API-Key: pk_live_<key>`. Keys are SHA-256-hashed in the `api_keys` table; mint via the UI (`POST /api/users/me/api-keys`) or directly in D1 (see Registration). Session tokens (`users.token` / `plane-session` cookie) also authenticate via the same header.

**Local dev**: `cd apps/app && bun run dev` (vite dev server — worker + SPA on one origin). **Deploy**: `cd apps/app && bun run deploy`. **D1 remote**: `bunx wrangler d1 execute atur-db --remote --command "..."`. **Typecheck**: `bun run typecheck` from the repo root.

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

State UUIDs are needed for `update_issue` (changing status). Label UUIDs are needed for `create_issue` (tagging). Example states: `backlog`, `todo`, `in-progress`, `done`, `cancelled`, `triage`.

**Step 3: Use the correct IDs in all subsequent calls.**

### Known Workspaces

| Name          | Slug            |
| ------------- | --------------- |
| OpexMX        | `opexmx`        |
| Voltrus       | `voltrus`       |
| Cowculator    | `cowculator`    |
| E-Pondok      | `e-pondok`      |
| Revklik       | `revklik`       |
| Waqtu         | `waqtu`         |
| CloudAgni     | `cloudagni`     |
| JoyoDigitama  | `joyodigitama`  |
| WeLoveOurBaby | `weloveourbaby` |
| BriefOK       | `briefok`       |

> **IMPORTANT**: Slugs verified 2026-08-11 (all owned by `ab39f025…` / dzulfikar). If `list_workspaces` returns different results, trust the live data.

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
                         ↓
                    [Code Review]
                    ↙           ↘
               Clean          Issues Found
                ↓                  ↓
               Done         Fix → Need Review (loop)
```

**Step 1: Start work**

```
update_issue(state_id=in_progress)
// Do the development work
```

**Step 2: Development complete → Mark for review**

```
update_issue(state_id=need_review)
add_comment("Development complete. Changed files: X, Y, Z. Key decisions: ...")
```

**Step 3: Spawn code review sub-agent**

```
Agent(subagent_type="code-reviewer", prompt="
  Review the implementation for issue <ID>: <name>.
  Issue description: <paste description>.
  Changed files: <list files>.
  Check for: bugs, security issues, missing tests, code quality, adherence to project patterns.
  Report: list of issues found (if any) with severity and file:line references.
")
```

**Step 4a: Review clean → Mark Done**

```
update_issue(state_id=done)
add_comment("Code review passed. No issues found.")
```

**Step 4b: Review found issues → Fix → Re-review**

```
// Fix the issues found by reviewer
// Then loop back to Step 2 (mark Need Review again, spawn new review)
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
9. **"Need Review" state must exist per project** — if a project doesn't have it, create it: `create_state(name="Need Review", group="started", color="#F97316")`.

### Screenshot Evidence Workflow (AI Agents)

Use `upload_image` + `add_comment` to attach screenshot evidence when verifying work with Playwright or other browser automation.

**`upload_image` accepts a file path (not base64):**

```
upload_image(file_path="/absolute/path/to/screenshot.png")
  → returns { id, url, size }
```

MIME type is auto-detected from file extension. Override with optional `mime_type` param.

**Workflow:**

```
1. Take screenshot with Playwright → saves to local file
2. upload_image(file_path="/path/to/screenshot.png")
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

# Upload directly from file path
upload_image(file_path="/absolute/path/to/evidence.png")
# → { "url": "https://app.diatur.com/api/assets/<uuid>" }

# Comment with embedded image
add_comment(
  project_id="<uuid>", issue_id="<uuid>", workspace="<slug>",
  comment_html='<p>✅ Verified with screenshot evidence</p><img src="https://app.diatur.com/api/assets/<uuid>" alt="evidence">'
)
```

### 49 Available Tools

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
| Time                  | `list_time_entries`, `create_time_entry`, `delete_time_entry`                                                                            |
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
Observe: ssh <host> -t omp attach <pane-id>"
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

