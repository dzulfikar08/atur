# Agent Loop (tmux supervisor)

`scripts/agent-loop.sh` is an autonomous issue-driver: it watches one or more
*pinned* projects for issues tagged with an opt-in label, spawns a headless
coding-agent session per issue inside a named tmux session, gates completion
behind a code-review pass, and retries (with a hard cap) until done or parked
for a human.

The coding agent is pluggable — **Command Code (`cmd`)**, **Claude Code
(`claude`)**, or **opencode** — so you can pick your own driver and reviewer.

Everything the agents do lands in atur's own activity log and comments, so the
whole loop is auditable from the UI.

## Architecture

```
                  ┌──────────────────────────────────────────────┐
   REST list       │  agent-loop.sh (supervisor, one process)    │
   ?labels=agent-ready ──▶ queue ──▶ claim (In Progress + assign)│
   (pinned projects)     │        │                              │
                  │        ▼                                     │
                  │  tmux new-session -s atur/<seq>             │
                  │      └─ $AGENT headless "work issue <seq>…" │
                  │        │  (uses mcp__atur__* tools)         │
                  │        ▼                                     │
                  │  session exits ──▶ review gate ($AGENT)     │
                  │        │  APPROVED ──▶ Done                  │
                  │        │  CHANGES_NEEDED ──▶ retry (cap 3)   │
                  │        ▼                                     │
                  │  kill-session, park w/ comment if exhausted  │
                  └──────────────────────────────────────────────┘
   all writes: MCP (X-API-Key) at https://diatur.com/mcp
```

- **Project pinning** — `ATUR_PROJECTS` is a comma-separated list of project
  names or identifiers. Only those projects are polled. Empty = every project
  in the workspace (use sparingly).
- **Queue discovery** uses the REST route
  `GET /api/workspaces/{slug}/projects/{id}/issues?labels=agent-ready`
  because the MCP `list_issues` cannot filter by label. The REST response is
  enriched with `.labels` and `.state {id,name,group}`, so queue-state
  detection (`unstarted` / `backlog`) needs no extra lookups.
- **All writes** go through the authenticated MCP server (`update_issue`,
  `set_assignee`, `add_comment`), so every transition lands in the activity log.

## Git integration (commit + push after finish)

Optional per-issue git workflow. Everything is off by default — enable with
`ATUR_GIT_*`:

| Flag | What it does |
|------|--------------|
| `ATUR_GIT_BRANCH=1` | create a per-issue branch `atur/<seq>` (from `ATUR_GIT_MAIN`, default `master`) |
| `ATUR_GIT_COMMIT=1` | after the coding session, the supervisor stages + commits the work on the issue branch |
| `ATUR_GIT_PUSH=1` | push the issue branch to origin |
| `ATUR_GIT_MERGE=1` | after ALL reviewers approve, merge the issue branch into the default branch and push |

**Flow:**

```
claim → ensure branch atur/<seq> (if ATUR_GIT_BRANCH)
  → agent works on the branch
  → session ends → commit work (if ATUR_GIT_COMMIT)
  → reviewers inspect COMMITTED code
  → all approve → merge atur/<seq> → <main> + push (if ATUR_GIT_MERGE)
  → mark Done
  → rejected → retry on the same branch; nothing touches main
```

Safety properties:
- **Main stays clean until approval** — rejected attempts never pollute the
  default branch; feedback is addressed on the issue branch and re-reviewed.
- **Commit happens before review**, so reviewers inspect committed code, not a
  loose working tree.
- **Merge only after ALL reviewers approve** — a single `CHANGES_NEEDED` means
  no merge.
- The git identity comes from the repo config (`user.name`/`user.email`); if
  they're unset, commit fails with a warning and the loop continues (the issue
  just isn't committed).
- Pushing requires credentials for `origin` (SSH key or credential helper) to
  be available to the supervisor process.

Example:

```bash
export ATUR_GIT_BRANCH=1 ATUR_GIT_COMMIT=1 ATUR_GIT_PUSH=1 ATUR_GIT_MERGE=1
export ATUR_GIT_MAIN=master
```

## Code-review gate (write → parallel review → apply feedback)

The loop implements the classic write-and-review cycle:

```
write (coding agent session)
  → N parallel reviewers (ATUR_REVIEWERS, default 2) review the result
  → ALL must APPROVE (Promise.all semantics)
  → any CHANGES_NEEDED → feedback is posted on the issue → retry
  → next attempt's agent reads the 'Code review found issues' comment and
    addresses every point before continuing (apply feedback)
  → approved → Done
```

- Reviewers run **in parallel** (background agents, `wait`ed like
  `Promise.all`), each with an independent prompt (`reviewer #1`, `#2`, …) and
  a fresh context — so they don't cross-contaminate.
- A single `CHANGES_NEEDED` fails the gate; only the rejecting reviewers'
  feedback is posted.
- Retries are capped at `ATUR_MAX_ATTEMPTS`; after that the issue is parked
  for a human.
- Tune with `ATUR_REVIEWERS=3` for higher assurance, or `1` for a single
  reviewer.

## Feature breakdown

Large features get decomposed into small, independently-worked child issues —
**each child gets its own agent session**, so no session's context balloons.

**How it works:**

1. Tag a feature issue with the breakdown label (`agent-breakdown`, or
   `ATUR_BREAKDOWN_LABEL`).
2. The loop detects breakdown-labeled issues in a queue state and runs a
   *breakdown agent* session (same agent, headless) that reads the feature and
   proposes a JSON list of child issues:
   ```json
   {"children":[{"name":"...","description_html":"<p>...</p>","priority":"medium"}]}
   ```
3. Each child is created via MCP `create_issue` with `parent_id: <feature>`
   and tagged with the work (`agent-ready`) label, so it's a **real sub-issue**
   (visible in the UI tree) and flows into the normal queue for its own
   session + review gate.
4. The feature itself is moved to Done (it's not worked directly).

**Parent-child support:** the Hono backend now accepts `parent_id` on issue
create (REST + MCP) and exposes `GET /issues/{id}/sub-issues`, so children
render as a sub-issue tree in the frontend `IssueDetail` view. The breakdown
agent still copies the feature's context into each child's `description_html`
plus file/crate hints, so each session is self-contained.

**Idempotency:** `break_down_issue` checks the sub-issues endpoint — if the
feature already has children, it skips. Re-runs never duplicate children.

To re-break-down (e.g. after a human edits the feature), delete the children
(or remove the breakdown label), then re-tag the feature.

## Per-session context

Every spawned session gets a focused but sufficient context envelope:

| Piece | Source |
|-------|--------|
| Repo path | `ATUR_REPO_DIR` |
| Project name + workspace slug | resolved at drain time from `list_projects` |
| Issue id + sequence | the queue item |
| Full description / acceptance criteria | the agent reads `get_issue` |
| History / prior agent comments | the agent reads `list_comments` |

**Retry context** — with `cmd`, retries resume the issue's own session via an
explicit `--resume <sessionId>` (captured from the first run's JSON result
frame). This is deliberate: `cmd` keys headless sessions by working directory,
so `--continue` would resume whichever session ran last in the repo — which,
under `ATUR_MAX_CONCURRENCY > 1`, may be another issue's or a reviewer's
session. Pin the session id per issue and retries always continue the right
conversation. The JSON result frame also exposes per-run `usage` for token
metering.

The prompt tells the agent exactly what to read and what's expected, so a
session never needs the whole feature or whole repo in context — it pulls what
it needs via MCP and the filesystem.

## Conventions

| Concept | Value |
|---------|-------|
| Opt-in label | `agent-ready` (create per workspace) |
| Queue states | **Backlog** or **Todo** (by name; Todo is group `started` in the Hono backend, `unstarted` in the Rust backend) |
| Claim | move to a `started` state named **In Progress**, assign the agent user |
| Review gate | a `started` state named **Need Review** |
| Confirmation | a `started` state named **Need Confirmation** — agent parks here for a human decision |
| Done | a `completed` state named **Done** |

If a project lacks "In Progress" or "Done", the loop skips it (log warning).
If it lacks "Need Review", the review gate is skipped and the issue goes
straight to Done after the coding session — set one up if you want the gate:

```
POST /api/workspaces/{slug}/projects/{projectId}/states
{ "name": "Need Review", "group": "started", "color": "#F97316" }
```

(Requires the session cookie; the MCP server has no `create_state` tool.)

## Human confirmation gate

When the coding agent hits something it must not decide alone — ambiguous
requirements, a plan needing human sign-off, credentials/secrets, destructive
actions — it is instructed to:

1. Post a comment explaining exactly what it needs and why
2. Move the issue to **Need Confirmation**
3. Stop working

The supervisor detects that state after the session ends and **pauses** the
issue: no review gate runs, no retry is spawned, no attempt is burned, and the
tmux session is left alive so a human can reattach and inspect. The loop logs
`pause  <seq>: agent requested human confirmation — parked`.

To resume, a human moves the issue back to **Todo**, **In Progress**, or
**Done** (or removes the `agent-ready` label). The next poll picks it up
again. If the project lacks a "Need Confirmation" state, the agent's attempt
just can't park — so create it per project alongside the others.

## Choosing an agent

`ATUR_AGENT=cmd|claude|opencode` selects the coding agent. Each has its own
headless invocation and verdict parser (all verified against the real CLIs):

| Agent | Work invocation | Review invocation |
|-------|-----------------|-------------------|
| `cmd` (default) | `cmd -p "<prompt>" --yolo --max-turns 100` | `cmd -p "<prompt>" --output-format json --yolo --max-turns 50` |
| `claude` | `claude --dangerously-skip-permissions -p "<prompt>"` | `claude --dangerously-skip-permissions --output-format json -p "<prompt>"` |
| `opencode` | `opencode run "<prompt>" --auto` | `opencode run "<prompt>" --auto --format json` |

Notes:
- `cmd` retries use `-p --continue`, so a retry **carries the previous
  attempt's session context** (headless sessions are kept per-directory).
- The review gate asks for an `APPROVED`/`CHANGES_NEEDED` verdict line; the
  supervisor parses it per-agent from the JSON output.
- The agent binary must be on `PATH` — the supervisor fails fast if not.

### MCP registration per agent

All agents need the atur MCP server so they can read/update issues. Register
once per machine:

```bash
# Command Code
cmd mcp add --transport http atur https://diatur.com/mcp -s user -H "X-API-Key: pk_live_<KEY>"

# Claude Code (already wired per CLAUDE.md)
claude mcp add atur --transport http https://diatur.com/mcp -s user -H "X-API-Key: pk_live_<KEY>"

# opencode (uses ~/.config/opencode/opencode.json)
# add an mcp entry: { "atur": { "type": "http", "url": "https://diatur.com/mcp",
#   "headers": { "X-API-Key": "pk_live_<KEY>" } } }
```

## Setup

1. **Create the agent user** in atur (a normal workspace member). Give it a
   real email, e.g. `agent@diatur.com`, and note its workspace membership.
2. **Mint an API key** for that user (UI → Settings → MCP / AI Integration,
   or via D1 per CLAUDE.md Registration).
3. **Create the labels** in the workspace: `agent-ready` (work opt-in) and,
   for feature decomposition, `agent-breakdown`.
4. **Create the states** per project: `Need Review` and `Need Confirmation`
   (both group `started`) if they don't already exist:
   ```bash
   curl -b <session-cookie> -X POST https://diatur.com/api/workspaces/<slug>/projects/<projectId>/states \
     -H 'Content-Type: application/json' \
     -d '{"name":"Need Review","group":"started","color":"#F97316"}'
   curl -b <session-cookie> -X POST https://diatur.com/api/workspaces/<slug>/projects/<projectId>/states \
     -H 'Content-Type: application/json' \
     -d '{"name":"Need Confirmation","group":"started","color":"#8B5CF6"}'
   ```
5. **Register the MCP server** for your chosen agent (above).
6. **Tag an issue** `agent-ready` and put it in Todo/Backlog.
7. **Run the loop** for the projects you care about:

```bash
export ATUR_API_KEY="pk_live_..."
export ATUR_WORKSPACE="opexmx"
export ATUR_PROJECTS="My App,Backend API"     # names or identifiers, comma-separated
export ATUR_AGENT="cmd"                        # cmd | claude | opencode
export ATUR_AGENT_EMAIL="agent@diatur.com"
scripts/agent-loop.sh
```

Run it under a process manager so it survives reboots and keeps polling:

```bash
# tmux, e.g. inside a "supervisor" session
tmux new-session -d -s supervisor 'ATUR_WORKSPACE=opexmx ATUR_PROJECTS="My App" scripts/agent-loop.sh >> /var/log/atur-agent-loop.log 2>&1'
# or systemd/launchd — it never exits on transient errors, just backs off
```

## Env vars

| Var | Default | Meaning |
|-----|---------|---------|
| `ATUR_API_URL` | `https://diatur.com/mcp` | MCP endpoint |
| `ATUR_API_KEY` | — (required) | `X-API-Key` header |
| `ATUR_WORKSPACE` | — (required) | workspace slug |
| `ATUR_PROJECTS` | (all) | comma-separated project names/identifiers to watch |
| `ATUR_AGENT` | `cmd` | `cmd` \| `claude` \| `opencode` |
| `ATUR_LABEL` | `agent-ready` | opt-in label name |
| `ATUR_BREAKDOWN_LABEL` | `agent-breakdown` | label marking feature issues to break down into child issues |
| `ATUR_MAX_CONCURRENCY` | `2` | max simultaneous agent sessions |
| `ATUR_MAX_ATTEMPTS` | `3` | max coding+review cycles per issue |
| `ATUR_REVIEWERS` | `2` | parallel reviewers per review gate (all must approve) |
| `ATUR_MAX_TURNS_WORK` | `50` | token budget (max-turns) per work session |
| `ATUR_MAX_TURNS_REVIEW` | `20` | token budget (max-turns) per reviewer session |
| `ATUR_ATTEMPT_TIMEOUT_MIN` | `90` | max minutes a session may run before it's killed |
| `ATUR_POLL_INTERVAL` | `60` | seconds between queue polls |
| `ATUR_REPO_DIR` | repo root | cwd for agent sessions |
| `ATUR_AGENT_EMAIL` | `agent@diatur.com` | assignee for claimed issues |
| `ATUR_DRY_RUN` | `0` | `1` = log only, never spawn sessions |
| `ATUR_GIT_BRANCH` | `0` | `1` = per-issue branch `atur/<seq>` |
| `ATUR_GIT_COMMIT` | `0` | `1` = commit work after the coding session |
| `ATUR_GIT_PUSH` | `0` | `1` = push the issue branch |
| `ATUR_GIT_MERGE` | `0` | `1` = merge branch → main + push after approval |
| `ATUR_GIT_MAIN` | `master` | default branch to merge into |

## Ops

```bash
# watch a live agent session
tmux attach -t atur/<sequence_id>

# list sessions
tmux ls | grep '^atur/'

# kill the whole supervisor + all agent sessions
tmux kill-session -t supervisor
tmux kill-server   # careful: kills every tmux session on the machine

# park everything: remove the agent-ready label from issues, or
# just stop the supervisor process.
```

## Failure modes

- **Session hangs** → `ATUR_ATTEMPT_TIMEOUT_MIN` kills it; the review gate runs
  against whatever was produced; if nothing changed, review fails and it
  retries.
- **Review loop** → after `ATUR_MAX_ATTEMPTS`, the loop posts
  `Agent loop exhausted N attempts. Needs human review.` and leaves the issue
  in its current state for a human.
- **Human confirmation requested** → the agent moved the issue to Need
  Confirmation; the loop pauses (no retry, no attempt burn, tmux session kept
  alive). A human reviews the agent's comment, then moves the issue back to
  Todo/In Progress (resume) or Done/Cancelled (close).
- **Cost runaway** → the guardrails are: opt-in label, project pinning,
  concurrency cap, per-attempt timeout, hard attempt cap, and the review gate
  (which only APPROVEs, never rubber-stamps). Start with
  `MAX_CONCURRENCY=1`, one pinned project, and a `dry-run` pass:
  ```bash
  ATUR_DRY_RUN=1 ATUR_API_KEY=... ATUR_WORKSPACE=... ATUR_PROJECTS="My App" scripts/agent-loop.sh
  ```
  Dry run still polls, claims (moves to In Progress + assigns), and runs the
  review gate, but never spawns a tmux session — good for validating config and
  state resolution against live data.
- **Multi-project collision** → the claim step (move to In Progress + assign)
  is the lock; the queue only ever picks up issues still in Backlog/Todo, so a
  claimed issue is never double-picked.
- **Unknown project in `ATUR_PROJECTS`** → warned and skipped; if *none*
  resolve, the loop fails fast with a clear message.

## Extending

- **Per-issue context** — the spawned prompt already tells the agent to read
  `get_issue`/`list_comments`. Drop more context (acceptance criteria, related
  issues) into the prompt in `run_attempt`.
- **Slack/notify on park** — hook the `fail` branch in `main` to a webhook.
- **Sprint-slicing** — change the queue query to filter by
  `cycle_issues` (sprint) instead of label if you want per-sprint cadence.
- **New agent** — add a branch to `agent_headless` and `agent_verdict`
  (both are centralized at the top of the script).
