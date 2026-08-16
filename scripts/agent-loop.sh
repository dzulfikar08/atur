#!/usr/bin/env bash
#
# agent-loop.sh — Atur autonomous issue loop (tmux supervisor).
#
# Polls one or more *pinned* projects for issues tagged with the opt-in label,
# claims them by moving them to In Progress, spawns one headless coding-agent
# session per issue inside a named tmux session, and gates completion behind a
# code-review pass.
#
# Supported coding agents (ATUR_AGENT): cmd (Command Code), claude, opencode.
#
# Conventions (see docs/agent-loop.md):
#   - Opt-in label:  "agent-ready"  (create it per workspace: list_labels)
#   - Queue states:  Todo (group "unstarted") — optionally Backlog
#   - In-progress:   group "started"  (e.g. "In Progress")
#   - Review gate:   group "started"  (e.g. "Need Review")
#   - Confirmation:  group "started"  (e.g. "Need Confirmation") — agent parked
#                    the issue for a human decision; the loop pauses until a
#                    human moves it back to a queue state or Done.
#   - Done:          group "completed"
#
# Env:
#   ATUR_API_URL        MCP endpoint       (default https://diatur.com/mcp)
#   ATUR_API_KEY        X-API-Key header   (required)
#   ATUR_WORKSPACE      workspace slug     (required)
#   ATUR_PROJECTS       comma-separated project names or identifiers to watch
#                       (default: ALL projects in the workspace — use sparingly)
#   ATUR_AGENT          cmd | claude | opencode  (default "cmd")
#   ATUR_LABEL          opt-in label name  (default "agent-ready")
#   ATUR_BREAKDOWN_LABEL  label marking a feature issue to be broken down into
#                       child issues before work (default "agent-breakdown")
#                       Children are tagged with both the breakdown and work
#                       labels; each child gets its own agent session.
#   ATUR_MAX_CONCURRENCY                    (default 2)
#   ATUR_MAX_ATTEMPTS                       (default 3)
#   ATUR_REVIEWERS      parallel review agents per review gate (default 2);
#                       ALL must approve for the issue to be marked Done.
#   ATUR_REPO_DIR       repo for agent sessions (defaults to this repo root)
#   ATUR_AGENT_EMAIL    assignee email for the agent user (default "agent@diatur.com")
#   ATUR_DRY_RUN        1 = log only, never spawn (default 0)
#
# Git integration (default: off):
#   ATUR_GIT_BRANCH     create a per-issue branch atur/<seq> (default 0)
#   ATUR_GIT_COMMIT     agent commits work on the issue branch (default 0)
#   ATUR_GIT_PUSH       push the issue branch (default 0)
#   ATUR_GIT_MERGE      merge the issue branch to the default branch + push
#                       after ALL reviewers approve (default 0)
#   ATUR_GIT_MAIN       default branch to merge into (default "master")
#
# Commit/push happen only after the coding session finishes (commit) and after
# the review gate approves (merge+push), so a rejected attempt never pollutes
# main.
#
# The polling loop, claim, watch, review, retry, and cleanup are all in
# `main`. Run under a process manager (systemd/tmux/launchd); it never exits
# on transient errors — it backs off and keeps polling.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

API_URL="${ATUR_API_URL:-https://diatur.com/mcp}"
API_KEY="${ATUR_API_KEY:-}"
WORKSPACE="${ATUR_WORKSPACE:-}"
PROJECTS="${ATUR_PROJECTS:-}"
AGENT="${ATUR_AGENT:-cmd}"
LABEL="${ATUR_LABEL:-agent-ready}"
BREAKDOWN_LABEL="${ATUR_BREAKDOWN_LABEL:-agent-breakdown}"
MAX_CONCURRENCY="${ATUR_MAX_CONCURRENCY:-2}"
MAX_ATTEMPTS="${ATUR_MAX_ATTEMPTS:-3}"
REVIEWERS="${ATUR_REVIEWERS:-2}"
REPO_DIR="${ATUR_REPO_DIR:-$REPO_ROOT}"
AGENT_EMAIL="${ATUR_AGENT_EMAIL:-agent@diatur.com}"
DRY_RUN="${ATUR_DRY_RUN:-0}"
GIT_BRANCH="${ATUR_GIT_BRANCH:-0}"
GIT_COMMIT="${ATUR_GIT_COMMIT:-0}"
GIT_PUSH="${ATUR_GIT_PUSH:-0}"
GIT_MERGE="${ATUR_GIT_MERGE:-0}"
GIT_MAIN="${ATUR_GIT_MAIN:-master}"

# --- logging ---------------------------------------------------------------
log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*"; }
warn() { log "WARN  $*" >&2; }
fail() { log "FATAL $*" >&2; exit 1; }

# --- git helpers ------------------------------------------------------------
# Per-issue branch name (also the tmux session name, so they line up).
issue_branch() { echo "atur/$1"; }

git_ensure_branch() { # <seq> → create + checkout atur/<seq> from the default branch if missing
  local branch
  branch=$(issue_branch "$1")
  if ! git -C "$REPO_DIR" rev-parse --verify "$branch" >/dev/null 2>&1; then
    log "git   $1: creating branch $branch from $GIT_MAIN"
    git -C "$REPO_DIR" checkout "$GIT_MAIN" >/dev/null 2>&1 || warn "git   $1: could not checkout $GIT_MAIN (continuing on current branch)"
    git -C "$REPO_DIR" checkout -b "$branch" >/dev/null 2>&1 \
      || { warn "git   $1: could not create branch $branch"; return 1; }
  else
    git -C "$REPO_DIR" checkout "$branch" >/dev/null 2>&1 \
      || { warn "git   $1: could not checkout $branch"; return 1; }
  fi
  return 0
}

git_commit_work() { # <seq> <name> → stage + commit all changes on the current branch
  local branch
  branch=$(issue_branch "$1")
  git -C "$REPO_DIR" add -A >/dev/null 2>&1
  if ! git -C "$REPO_DIR" diff --cached --quiet 2>/dev/null; then
    log "git   $1: committing work on $branch"
    git -C "$REPO_DIR" commit -m "feat(atur): resolve issue $1 — $2" >/dev/null 2>&1 \
      || { warn "git   $1: commit failed (user.name/email configured?)"; return 1; }
  else
    log "git   $1: nothing to commit on $branch"
  fi
  return 0
}

git_push_branch() { # <seq> → push the issue branch to origin
  local branch
  branch=$(issue_branch "$1")
  git -C "$REPO_DIR" push -u origin "$branch" >/dev/null 2>&1 \
    || { warn "git   $1: push of $branch failed (auth/origin?)"; return 1; }
  log "git   $1: pushed $branch"
  return 0
}

git_merge_to_main() { # <seq> → merge the issue branch into the default branch + push
  local branch
  branch=$(issue_branch "$1")
  git -C "$REPO_DIR" checkout "$GIT_MAIN" >/dev/null 2>&1 \
    || { warn "git   $1: could not checkout $GIT_MAIN for merge"; return 1; }
  git -C "$REPO_DIR" merge --no-ff "$branch" -m "Merge $branch — resolves atur issue $1" >/dev/null 2>&1 \
    || { warn "git   $1: merge of $branch into $GIT_MAIN failed (conflicts?)"; return 1; }
  git -C "$REPO_DIR" push origin "$GIT_MAIN" >/dev/null 2>&1 \
    || { warn "git   $1: push of $GIT_MAIN failed"; return 1; }
  log "git   $1: merged $branch → $GIT_MAIN and pushed"
  return 0
}

# --- coding-agent adapter ---------------------------------------------------
# Each agent has a headless command, a "do work" extra, and a review extra.
# Review commands MUST end with an APPROVED/CHANGES_NEEDED verdict line.
agent_headless() { # <prompt> <review|work> → runs the agent, echoes final text
  local prompt="$1" mode="$2"
  case "$AGENT" in
    cmd)
      if [[ "$mode" == "review" ]]; then
        cmd -p "$prompt" --output-format json --yolo --max-turns 50 2>&1 || true
      else
        cmd -p "$prompt" --yolo --max-turns 100 2>&1 || true
      fi
      ;;
    claude)
      if [[ "$mode" == "review" ]]; then
        claude --dangerously-skip-permissions --output-format json -p "$prompt" 2>&1 || true
      else
        claude --dangerously-skip-permissions -p "$prompt" 2>&1 || true
      fi
      ;;
    opencode)
      if [[ "$mode" == "review" ]]; then
        opencode run "$prompt" --auto --format json 2>&1 || true
      else
        opencode run "$prompt" --auto 2>&1 || true
      fi
      ;;
    *)
      fail "ATUR_AGENT '$AGENT' not supported (cmd|claude|opencode)"
      ;;
  esac
}

agent_verdict() { # <agent output> → echo APPROVED|CHANGES_NEEDED|""
  local out="$1"
  case "$AGENT" in
    cmd)
      # NDJSON: read the final result frame's finalText.
      echo "$out" | jq -r 'select(.type=="result") | .finalText' 2>/dev/null | grep -oE 'APPROVED|CHANGES_NEEDED' | head -1 || true
      ;;
    claude)
      # JSON: single object with .result holding the final answer.
      echo "$out" | jq -r '.result // empty' 2>/dev/null | grep -oE 'APPROVED|CHANGES_NEEDED' | head -1 || true
      ;;
    opencode)
      # JSON events: assistant text parts have type "text" with part.text.
      echo "$out" | jq -r 'select(.type=="text" and .part.type=="text") | .part.text' 2>/dev/null | grep -oE 'APPROVED|CHANGES_NEEDED' | tail -1 || true
      ;;
    *) echo "" ;;
  esac
}

# --- MCP JSON-RPC client ---------------------------------------------------
mcp() { # mcp <tool> <json-args>  → stdout: raw JSON-RPC result ("" on failure)
  # Retries transient failures; never exits non-zero so `set -e` can't kill the
  # supervisor on a blip. Callers that need the result guard with `|| echo ""`.
  local tool="$1" args="$2"
  local payload
  payload=$(printf '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"%s","arguments":%s}}' "$tool" "$args")
  local try out
  for try in 1 2; do
    if out=$(curl -fsS --max-time 30 \
      -H "Content-Type: application/json" \
      -H "Accept: application/json, text/event-stream" \
      -H "X-API-Key: $API_KEY" \
      -d "$payload" \
      "$API_URL" 2>/dev/null); then
      printf '%s' "$out"
      return 0
    fi
    sleep 2
  done
  warn "mcp $tool failed after 2 tries (tool=$tool)"
  return 0
}

# Extract a top-level string from the JSON-RPC `result.content[0].text` blob.
# Accepts the JSON as $2 or (in a pipe) on stdin.
jtext() { # <jq-program> [json]
  if [[ -n "${2:-}" ]]; then
    jq -r "$1" <<<"$2" 2>/dev/null || echo ""
  else
    jq -r "$1" 2>/dev/null || echo ""
  fi
}

# --- pure jq helpers (pipe JSON array/object in, or pass as $2) ------------
# Both accept the JSON via stdin OR as the second argument (matching jtext),
# so call sites can use either style. `// empty` turns a non-match into "" so
# callers can test with [[ -n ]].
state_id_for()  { if [[ -n "${2:-}" ]]; then jq -r --arg n "$1" 'map(select(.name == $n) | .id) | first // empty' <<<"$2" 2>/dev/null; else jq -r --arg n "$1" 'map(select(.name == $n) | .id) | first // empty' 2>/dev/null; fi; }
member_id_for() { if [[ -n "${2:-}" ]]; then jq -r --arg e "$1" 'map(select(.email == $e) | .id) | first // empty' <<<"$2" 2>/dev/null; else jq -r --arg e "$1" 'map(select(.email == $e) | .id) | first // empty' 2>/dev/null; fi; }
# label_id_for <name> → resolves from the GLOBAL LABELS_JSON (set at boot).
label_id_for()  { jq -r --arg n "$1" 'map(select(.name == $n) | .id) | first // empty' <<<"$LABELS_JSON" 2>/dev/null; }

tmux_running() { tmux has-session -t "atur/$1" 2>/dev/null; }

# --- queue discovery (REST + MCP) -----------------------------------------
# The REST list route supports ?labels= (server-side filter) and returns
# enriched issues with .labels and .state {id,name,group}. The MCP list_issues
# cannot filter by label, so the queue comes from REST. The REST list route is
# auth'd (X-API-Key) — same key as the MCP server.
rest_list_issues() { # <project_id> [label_name] → JSON array of enriched issues
  local base="${API_URL%/mcp}"
  local label="${2:-$LABEL}"
  # The REST list route requires auth (returns 401 without a valid token).
  curl -fsS --max-time 30 \
    -H "X-API-Key: $API_KEY" \
    "$base/api/workspaces/$WORKSPACE/projects/$1/issues?labels=$label" 2>/dev/null \
    || echo "[]"
}

# --- issue lifecycle helpers ----------------------------------------------
# State IDs are per-project. Stored as parallel flat arrays (STATE_KEY /
# STATE_VAL) because macOS bash 3.2 has no associative arrays and dot-keys in
# indexed arrays are evaluated arithmetically. set_state/get_state abstract
# that; keys look like "<project_id>.<role>".
STATE_KEYS=()
STATE_VALS=()

set_state() { # <project_id> <role> <state_id>
  local i
  for i in "${!STATE_KEYS[@]}"; do
    if [[ "${STATE_KEYS[$i]}" == "$1.$2" ]]; then STATE_VALS[$i]="$3"; return 0; fi
  done
  STATE_KEYS+=("$1.$2")
  STATE_VALS+=("$3")
}

state_id() { # <project_id> <role> → echo the state id ("" if unset)
  local k="$1.$2" i
  for i in "${!STATE_KEYS[@]}"; do
    [[ "${STATE_KEYS[$i]}" == "$k" ]] && { printf '%s' "${STATE_VALS[$i]}"; return 0; }
  done
  return 1
}

claim_issue() { # <project_id> <issue_id> <agent_member_id>
  mcp update_issue "{\"project_id\":\"$1\",\"workspace\":\"$WORKSPACE\",\"issue_id\":\"$2\",\"state_id\":\"$(state_id "$1" inprogress)\"}" >/dev/null
  mcp set_assignee "{\"project_id\":\"$1\",\"workspace\":\"$WORKSPACE\",\"issue_id\":\"$2\",\"assignee_id\":\"$3\"}" >/dev/null
}

is_completed() { # <project_id> <issue_id>
  local raw
  raw=$(mcp get_issue "{\"project_id\":\"$1\",\"workspace\":\"$WORKSPACE\",\"issue_id\":\"$2\"}")
  [[ "$(jtext '.result.content[0].text | fromjson | .stateId' "$raw")" == "$(state_id "$1" done)" ]]
}

# --- state machine transitions ---------------------------------------------
mark_in_progress()        { mcp update_issue "{\"project_id\":\"$1\",\"workspace\":\"$WORKSPACE\",\"issue_id\":\"$2\",\"state_id\":\"$(state_id "$1" inprogress)\"}" >/dev/null; }
mark_need_review()        { mcp update_issue "{\"project_id\":\"$1\",\"workspace\":\"$WORKSPACE\",\"issue_id\":\"$2\",\"state_id\":\"$(state_id "$1" needreview)\"}" >/dev/null; }
mark_need_confirmation()  { mcp update_issue "{\"project_id\":\"$1\",\"workspace\":\"$WORKSPACE\",\"issue_id\":\"$2\",\"state_id\":\"$(state_id "$1" needconfirm)\"}" >/dev/null; }
mark_done()               { mcp update_issue "{\"project_id\":\"$1\",\"workspace\":\"$WORKSPACE\",\"issue_id\":\"$2\",\"state_id\":\"$(state_id "$1" done)\"}" >/dev/null; }
comment()                 { mcp add_comment "{\"project_id\":\"$1\",\"workspace\":\"$WORKSPACE\",\"issue_id\":\"$2\",\"comment_html\":\"$3\"}" >/dev/null; }

# Current state role of an issue ("" if it doesn't match a known role).
issue_role() { # <project_id> <issue_id> → echoes inprogress|needreview|needconfirm|done|queue|""
  local raw role
  raw=$(mcp get_issue "{\"project_id\":\"$1\",\"workspace\":\"$WORKSPACE\",\"issue_id\":\"$2\"}")
  local sid
  sid=$(jtext '.result.content[0].text | fromjson | .stateId' "$raw")
  local k
  for k in inprogress needreview needconfirm done; do
    if [[ -n "$sid" && "$sid" == "$(state_id "$1" "$k")" ]]; then echo "$k"; return 0; fi
  done
  # Queue states (Backlog/Todo by name, or Rust-style unstarted group).
  local g n
  g=$(jtext '.result.content[0].text | fromjson | .state.group' "$raw")
  n=$(jtext '.result.content[0].text | fromjson | .state.name' "$raw")
  [[ "$n" == "Backlog" || "$n" == "Todo" || "$g" == "unstarted" ]] && { echo "queue"; return 0; }
  echo ""
}

# --- code-review gate -------------------------------------------------------
# Mirrors the "write & review" loop: the coding agent writes, then REVIEWERS
# (default 2) independent review agents review in PARALLEL (Promise.all-style).
# ALL must APPROVE; if any says CHANGES_NEEDED, their feedback is posted and
# the attempt fails (run_attempt retries with feedback in the issue comments).
run_review() { # <project_id> <issue_id> <seq> <name> → 0 if ALL reviewers approved
  log "review  $3: starting code review (${REVIEWERS} parallel reviewer(s))"
  if [[ -z "$(state_id "$1" needreview)" ]]; then
    warn "review  $3: project has no 'Need Review' state — skipping review gate, marking Done"
    return 0
  fi
  mark_need_review "$1" "$2"
  comment "$1" "$2" "<p><strong>Development complete.</strong> Requesting code review (${REVIEWERS} reviewers). (agent-loop)</p>"

  local i
  local -a review_pids=()
  local -a review_files=()
  for (( i = 1; i <= REVIEWERS; i++ )); do
    local out_file
    out_file="$(mktemp -t "atur-review-$seq-$i-XXXXXX")"
    review_files+=("$out_file")
    if [[ "$DRY_RUN" == "1" ]]; then
      # Dry run: write a real-agent-shaped verdict so agent_verdict parses it.
      case "$AGENT" in
        cmd)   echo '{"type":"result","finalText":"APPROVED (dry run)"}' >"$out_file" ;;
        claude) echo '{"type":"result","result":"APPROVED (dry run)"}' >"$out_file" ;;
        opencode) echo '{"type":"text","part":{"type":"text","text":"APPROVED (dry run)"}}' >"$out_file" ;;
      esac
      continue
    fi
    (
      agent_headless "
You are reviewer #$i for atur issue $3 ($4).

Review the implementation that the coding agent just completed.
Read the issue at: $API_URL (workspace '$WORKSPACE', project '$1', issue '$2'),
and inspect the changed code in the repo at $REPO_DIR.

Check for: correctness, bugs, security issues, missing tests, regressions,
adherence to the repository conventions in CLAUDE.md, and Definition-of-Done
coverage. Be rigorous — this is the gate before Done.

Reply with EXACTLY one line, starting with APPROVED or CHANGES_NEEDED, then a
short justification on the same line." review
    ) >"$out_file" 2>&1 &
    review_pids+=("$!")
  done

  # Wait for all reviewers (Promise.all).
  local rc=0
  for pid in "${review_pids[@]}"; do
    wait "$pid" || rc=1
  done

  # Collect verdicts + feedback.
  local all_approved=1
  local feedback=""
  for out_file in "${review_files[@]}"; do
    local out verdict
    out=$(cat "$out_file")
    verdict=$(agent_verdict "$out")
    log "review  $3: reviewer verdict: ${verdict:-none}"
    if [[ "$verdict" != "APPROVED" ]]; then
      all_approved=0
      feedback+="• ${out}"$'\n'
    fi
    rm -f "$out_file"
  done

  if (( all_approved == 1 )); then
    log "review  $3: all ${REVIEWERS} reviewer(s) approved"
    comment "$1" "$2" "<p><strong>Code review passed.</strong> All ${REVIEWERS} reviewers approved. (agent-loop)</p>"
    return 0
  fi

  feedback="${feedback:-No reviewer output captured}"
  log "review  $3: changes needed (${REVIEWERS} reviewer(s), at least one rejected)"
  comment "$1" "$2" "<p><strong>Code review found issues.</strong></p><pre>${feedback//&/&amp;}</pre>"
  return 1
}

# --- feature breakdown ------------------------------------------------------
# A feature issue tagged with ATUR_BREAKDOWN_LABEL is broken down into child
# issues linked via parent_id (the Hono backend now supports sub-issues). Each
# child is tagged with the work label and gets its own agent session. The
# feature itself is moved to Done after children are created.
break_down_issue() { # <project_id> <issue_id> <seq> <name> → 0 ok, 1 no children created
  local project_id="$1" issue_id="$2" seq="$3" name="$4"

  # Idempotency: check the sub-issues endpoint — if the feature already has
  # children, skip re-breakdown.
  local base="${API_URL%/mcp}"
  local sub
  sub=$(curl -fsS --max-time 30 \
    "$base/api/workspaces/$WORKSPACE/projects/$project_id/issues/$issue_id/sub-issues" 2>/dev/null || echo '{"results":[]}')
  local child_count
  child_count=$(echo "$sub" | jq -r '[.results[]?] | length' 2>/dev/null || echo "0")
  if (( child_count > 0 )); then
    log "breakdown $seq: feature already has $child_count child issue(s) — skipping re-breakdown"
    return 0
  fi

  log "breakdown $seq: breaking down feature '$name'"
  comment "$project_id" "$issue_id" "<p><strong>Feature breakdown started.</strong> (agent-loop)</p>"

  local work_label_id
  work_label_id=$(label_id_for "$LABEL")
  if [[ -z "$work_label_id" ]]; then
    warn "breakdown $seq: missing work label '$LABEL' — skipping"
    return 1
  fi

  local proposal
  proposal=$(agent_headless "
You are breaking down an atur feature into small, independently implementable
child issues. The feature: $seq — $name (workspace '$WORKSPACE', project '$1').

Read the feature with get_issue and produce a breakdown. Each child must:
- be small enough for ONE coding-agent session to implement
- be independently testable (acceptance criteria included)
- name the files/crates likely touched

Reply with EXACTLY ONE JSON object on the last line:
{\"children\":[{\"name\":\"...\",\"description_html\":\"<p>...</p>\",\"priority\":\"medium\"}]}
No markdown fences, no prose after the JSON." breakdown)

  # Extract the JSON object (the agent is told to reply with exactly one JSON
  # object on the last line; fall back to the last non-empty line if the model
  # wrapped it in prose).
  local children_json
  children_json=$(echo "$proposal" | grep -oE '\{[^{}]*"children"[^{}]*\}' | tail -1)
  if [[ -z "$children_json" ]]; then
    children_json=$(echo "$proposal" | grep '"children"' | tail -1)
  fi
  if ! jq -e '.children' <<<"$children_json" >/dev/null 2>&1; then
    children_json=$(echo "$proposal" | awk 'NF{last=$0} END{print last}')
  fi
  local count
  count=$(echo "$children_json" | jq -r '.children | length' 2>/dev/null || echo "0")

  if (( count == 0 )); then
    warn "breakdown $seq: agent returned no children"
    comment "$project_id" "$issue_id" "<p><strong>Breakdown failed:</strong> agent returned no child issues.</p>"
    return 1
  fi

  log "breakdown $seq: creating $count child issue(s)"
  local i child_name child_desc child_prio child_id
  for (( i = 0; i < count; i++ )); do
    child_name=$(echo "$children_json" | jq -r --argjson i "$i" '.children[$i].name')
    child_desc=$(echo "$children_json" | jq -r --argjson i "$i" '.children[$i].description_html // "<p></p>"')
    child_prio=$(echo "$children_json" | jq -r --argjson i "$i" '.children[$i].priority // "medium"')
    # Create via MCP with parent_id + work label → real sub-issue.
    child_id=$(mcp create_issue "{\"project_id\":\"$project_id\",\"workspace\":\"$WORKSPACE\",\"name\":\"$child_name\",\"description_html\":\"$child_desc\",\"priority\":\"$child_prio\",\"parent_id\":\"$issue_id\",\"label_ids\":[\"$work_label_id\"]}" \
      | jtext '.result.content[0].text | fromjson | .id')
    log "breakdown $seq: created sub-issue $child_id — $child_name (parent $issue_id)"
  done

  # Feature is fully decomposed; mark it Done (it's not worked directly).
  mark_done "$project_id" "$issue_id"
  comment "$project_id" "$issue_id" "<p><strong>Breakdown complete.</strong> Created $count child issue(s), each now worked by its own agent session.</p>"
  return 0
}

run_attempt() { # <attempt> <project_id> <issue_id> <seq> <name>
  local attempt="$1" project_id="$2" issue_id="$3" seq="$4" name="$5"
  local session="atur/$seq"

  log "start  $seq: attempt $attempt/$MAX_ATTEMPTS — $name (agent=$AGENT)"
  mark_in_progress "$project_id" "$issue_id"

  if [[ "$DRY_RUN" == "1" ]]; then
    log "start  $seq: DRY_RUN — skipping agent spawn"
    return 0
  fi

  # Per-issue branch: work happens on atur/<seq> so main stays clean until
  # the review gate approves.
  if [[ "$GIT_BRANCH" == "1" ]]; then
    git_ensure_branch "$seq" || warn "start  $seq: branch setup failed"
  fi

  if tmux_running "$seq"; then
    warn "start  $seq: session $session already exists — reattaching watch"
  else
    local prompt
    prompt="You are working on atur issue $seq: $name.

Working directory (repo): $REPO_DIR
Project: ${PROJECT_NAME:-unknown} (workspace '$WORKSPACE')
Issue: $seq ($issue_id) — read it with get_issue for the full description,
acceptance criteria, and any child/feature context from comments."

    # On retries, the previous review's feedback is in the issue comments;
    # tell the agent to read and address it (the "apply feedback" step).
    if (( attempt > 1 )); then
      prompt+="

This is retry #$((attempt-1)). The previous review found issues — read the
latest 'Code review found issues' comment on this issue via list_comments and
ADDRESS every point it raises before anything else. Post a comment listing what
you fixed."
    fi

    prompt+="

Use the atur MCP tools (prefixed mcp__atur__) to work this issue end to end:
- get_issue / list_comments to read the issue and its history
- update_issue, add_comment to record progress as you go
- run tests and checks in the repo at $REPO_DIR
- when done, the supervisor will run the review gate — do not mark done yourself

If you hit something you must NOT decide alone (ambiguous requirements, a plan
that needs human sign-off, credentials/secrets, destructive actions), do this:
1. Post a comment explaining exactly what you need and why
2. Move the issue to the state named 'Need Confirmation'
3. Stop working — the supervisor will pause the issue for a human

Definition of Done (all must hold):
1. Implementation exists in the repo and compiles (build/typecheck passes)
2. Tests pass (npm test / cargo test for the touched area)
3. You posted a comment with: what you changed, files touched, and any follow-ups
4. Do NOT move the issue to Done — the review gate does that after it approves

Work autonomously. Post your findings as comments on the issue."

    local cmdline
    # cmd resumes its most recent headless session in the cwd, so retries keep
    # the previous attempt's context. Other agents get a fresh session.
    if [[ "$AGENT" == "cmd" && "$attempt" -gt 1 ]]; then
      cmdline="cmd -p --continue \"$prompt\" --yolo --max-turns 100; tmux wait-for -S atur:$seq"
    else
      cmdline="agent_headless \"$prompt\" work; tmux wait-for -S atur:$seq"
    fi
    tmux new-session -d -s "$session" -c "$REPO_DIR" "$cmdline" 2>/dev/null || \
    tmux new-session -d -s "$session" -c "$REPO_DIR" "agent_headless '$prompt' work; tmux wait-for -S atur:$seq"
    log "start  $seq: spawned tmux session $session (attempt $attempt)"
  fi

  # Wait for the session to exit (claude finished) or timeout (kill -0 won't
  # cover a live-but-hung session; the per-attempt timeout is the backstop).
  local waited=0 timeout="${ATUR_ATTEMPT_TIMEOUT_MIN:-90}"
  while (( waited < timeout )); do
    if ! tmux_running "$seq"; then break; fi
    sleep 15; (( waited += 1 ))
  done
  if tmux_running "$seq"; then
    warn "timeout $seq: attempt $attempt exceeded ${timeout}min — killing session"
    tmux kill-session -t "$session" 2>/dev/null || true
  fi

  # Commit the agent's work so reviewers inspect committed code, not the
  # working tree. (The agent already wrote files in $REPO_DIR.)
  if [[ "$GIT_COMMIT" == "1" ]]; then
    git_commit_work "$seq" "$name" || warn "git   $seq: commit failed"
  fi

  # If the agent parked the issue in Need Confirmation, pause: no review, no
  # retry, no attempt burn — a human must move it back to a queue state (or
  # Done) before the loop touches it again.
  local role
  role=$(issue_role "$project_id" "$issue_id")
  if [[ "$role" == "needconfirm" ]]; then
    log "pause $seq: agent requested human confirmation — parked (no retry)"
    comment "$project_id" "$issue_id" "<p><strong>Agent paused for human confirmation.</strong> Move this issue back to Todo/In Progress to resume, or to Done/Cancelled to close it.</p>"
    return 99
  fi

  # If the agent moved the issue itself, treat as done.
  if is_completed "$project_id" "$issue_id"; then
    log "done  $seq: issue already moved to a completed state"
    return 0
  fi

  if run_review "$project_id" "$issue_id" "$seq" "$name"; then
    # All reviewers approved → merge to the default branch + push.
    if [[ "$GIT_MERGE" == "1" ]]; then
      git_merge_to_main "$seq" || warn "git   $seq: merge/push failed"
    elif [[ "$GIT_PUSH" == "1" ]]; then
      git_push_branch "$seq" || warn "git   $seq: push failed"
    fi
    mark_done "$project_id" "$issue_id"
    log "done  $seq: approved and marked Done"
    return 0
  fi
  return 1
}

# --- supervisor loop ---------------------------------------------------------
main() {
  [[ -n "$API_KEY" ]] || fail "ATUR_API_KEY is required (mint via UI: POST /api/users/me/api-keys)"
  [[ -n "$WORKSPACE" ]] || fail "ATUR_WORKSPACE is required (workspace slug)"
  command -v tmux >/dev/null || fail "tmux is required"
  command -v "$AGENT" >/dev/null || fail "agent '$AGENT' is not on PATH"
  command -v jq >/dev/null || fail "jq is required"
  command -v curl >/dev/null || fail "curl is required"

  log "boot  workspace=$WORKSPACE agent=$AGENT projects=${PROJECTS:-ALL} label=$LABEL concurrency=$MAX_CONCURRENCY attempts=$MAX_ATTEMPTS dry_run=$DRY_RUN"
  log "boot  MCP endpoint: $API_URL"

  # Resolve workspace → projects (MCP needs project UUIDs).
  local workspaces projects
  workspaces=$(mcp list_workspaces "{}")
  jq -e --arg slug "$WORKSPACE" '.result.content[0].text | fromjson | map(select(.slug == $slug)) | length > 0' <<<"$workspaces" >/dev/null \
    || fail "workspace '$WORKSPACE' not found in list_workspaces"

  projects=$(mcp list_projects "{\"workspace\":\"$WORKSPACE\"}")

  # Project pinning: ATUR_PROJECTS is a comma-separated list of project names
  # or identifiers. Empty = every project (use sparingly). Warn if a requested
  # project can't be found instead of failing the whole loop.
  local project_ids=()
  if [[ -n "$PROJECTS" ]]; then
    local wanted
    while IFS= read -r wanted; do
      [[ -n "$wanted" ]] || continue
      local pid
      pid=$(jq -r --arg w "$wanted" '
        .result.content[0].text | fromjson |
        map(select(.name == $w or .identifier == $w) | .id) | first' <<<"$projects")
      if [[ -n "$pid" && "$pid" != "null" ]]; then
        project_ids+=("$pid")
      else
        warn "boot  project '$wanted' not found in workspace '$WORKSPACE' — skipping"
      fi
    done < <(printf '%s\n' "$PROJECTS" | tr ',' '\n')
    ((${#project_ids[@]} > 0)) || fail "none of ATUR_PROJECTS resolved to a project in workspace '$WORKSPACE'"
  else
    while IFS= read -r pid; do project_ids+=("$pid"); done < <(
      jq -r '.result.content[0].text | fromjson | .[].id' <<<"$projects"
    )
  fi
  log "boot  watching ${#project_ids[@]} project(s)"

  local agents_json
  agents_json=$(mcp list_workspace_members "{\"workspace\":\"$WORKSPACE\"}")
  AGENT_JSON="$agents_json" # used by member_id_for callers below

  # Resolve workspace labels once (they're workspace-scoped).
  local labels_json
  labels_json=$(mcp list_labels "{\"workspace\":\"$WORKSPACE\"}")
  LABELS_JSON=$(jtext '.result.content[0].text' "$labels_json")
  log "boot  labels resolved: $(echo "$LABELS_JSON" | jq -r 'length' 2>/dev/null || echo 0)"

  local queue=()
  while true; do
    # Refresh the queue: issues tagged agent-ready in a queue state.
    queue=()
    for pid in "${project_ids[@]}"; do
      local states_json
      states_json=$(mcp list_states "{\"project_id\":\"$pid\",\"workspace\":\"$WORKSPACE\"}" 2>/dev/null || echo '{"result":{"content":[{"type":"text","text":"[]"}]}}')
      local states_text
      states_text=$(jtext '.result.content[0].text' "$states_json")
      # Resolve the state IDs once per project per poll.
      set_state "$pid" inprogress "$(state_id_for 'In Progress' "$states_text")"
      set_state "$pid" needreview "$(state_id_for 'Need Review' "$states_text")"
      set_state "$pid" needconfirm "$(state_id_for 'Need Confirmation' "$states_text")"
      set_state "$pid" done "$(state_id_for 'Done' "$states_text")"
      if [[ -z "$(state_id "$pid" inprogress)" || -z "$(state_id "$pid" done)" ]]; then
        warn "poll  project $pid: missing states (need 'In Progress'/'Done'); skipping"
        continue
      fi

      # Feature breakdown: any issue tagged with the breakdown label that is
      # still in a queue state gets decomposed into child issues (which are
      # then worked individually). Idempotent — see break_down_issue.
      local bd_list
      bd_list=$(rest_list_issues "$pid" "$BREAKDOWN_LABEL" 2>/dev/null || echo "[]")
      while IFS=$'\t' read -r bd_group bd_name bd_id bd_seq; do
        [[ -n "$bd_id" ]] || continue
        if [[ "$bd_name" == "Backlog" || "$bd_name" == "Todo" || "$bd_group" == "unstarted" ]]; then
          log "poll  $pid: breaking down feature '$bd_name' ($bd_id)"
          break_down_issue "$pid" "$bd_id" "$bd_seq" "$bd_name" || warn "poll  $pid: breakdown of $bd_id failed"
        fi
      done < <(echo "$bd_list" | jq -r '
        .results[]? |
        select(.state.name == "Backlog" or .state.name == "Todo" or .state.group == "unstarted") |
        [.state.group, .state.name, .id, .sequence_id] | @tsv' 2>/dev/null)

      # The REST list already filters by the opt-in label and enriches each
      # issue with .labels and .state{id,name,group} — no per-issue lookups.
      # Queue = Backlog or Todo (by state name; Todo is group "started" in the
      # Hono backend, group "unstarted" in the Rust backend).
      while IFS=$'\t' read -r group state_name issue_id issue_name seq; do
        [[ -n "$issue_id" ]] || continue
        if [[ "$state_name" == "Backlog" || "$state_name" == "Todo" || "$group" == "unstarted" ]]; then
          log "queue  $issue_id: $issue_name (state=$state_name group=$group)"
          queue+=("$pid|$issue_id|$issue_name|$seq")
        fi
      done < <(rest_list_issues "$pid" | jq -r '
        .results[]? |
        select(.state.name == "Backlog" or .state.name == "Todo" or .state.group == "unstarted") |
        [.state.group, .state.name, .id, .name, .sequence_id] | @tsv' 2>/dev/null)
    done

    # Drain: work the queue up to the concurrency limit.
    local running=0
    for item in ${queue[@]+"${queue[@]}"}; do
      if (( running >= MAX_CONCURRENCY )); then break; fi
      IFS='|' read -r pid issue_id issue_name seq <<<"$item"
      # Per-session context: project name for the prompt.
      PROJECT_NAME=$(jq -r --arg id "$pid" '.result.content[0].text | fromjson | map(select(.id == $id) | .name) | first' <<<"$projects" 2>/dev/null) || PROJECT_NAME="unknown"
      local agent_member
      agent_member=$(member_id_for "$AGENT_EMAIL" "$(jtext '.result.content[0].text' "$AGENT_JSON")") || agent_member=""

      if [[ -n "$agent_member" ]]; then
        # Claim (assign to the agent user) so two sessions never grab the same issue.
        claim_issue "$pid" "$issue_id" "$agent_member"
      else
        warn "drain  $seq: agent member '$AGENT_EMAIL' not found — claiming without assignee"
        mcp update_issue "{\"project_id\":\"$pid\",\"workspace\":\"$WORKSPACE\",\"issue_id\":\"$issue_id\",\"state_id\":\"$(state_id "$pid" inprogress)\"}" >/dev/null
      fi

      local attempt=1 rc=1
      while (( attempt <= MAX_ATTEMPTS )); do
        local ar
        ar=0
        run_attempt "$attempt" "$pid" "$issue_id" "$seq" "$issue_name" && ar=0 || ar=$?
        if (( ar == 0 )); then
          rc=0; break
        fi
        if (( ar == 99 )); then
          rc=99; break   # pause: stop retrying, don't burn attempts
        fi
        (( attempt++ ))
      done
      if (( rc != 0 )); then
        if (( rc == 99 )); then
          log "pause $seq: paused for human confirmation — issue left as-is"
          # Leave the tmux session running so a human can resume it later.
          # Don't count it against concurrency for the rest of this poll.
        else
          log "fail  $seq: exceeded $MAX_ATTEMPTS attempts — parked for human"
          comment "$pid" "$issue_id" "<p><strong>Agent loop exhausted ${MAX_ATTEMPTS} attempts.</strong> Needs human review.</p>"
        fi
      fi
      # Cleanup the tmux session (skip if paused — a human may reattach).
      if (( rc != 99 )); then
        tmux kill-session -t "atur/$seq" 2>/dev/null || true
        (( running++ ))
      fi
    done

    sleep "${ATUR_POLL_INTERVAL:-60}"
  done
}

main "$@"
