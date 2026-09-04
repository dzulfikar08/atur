#!/usr/bin/env bun
// Herdr-native spawn loop + supervision (DEV-30, firstmate port): watch Atur
// for eligible issues in bound workspaces, dispatch headless `omp -p` agents,
// and supervise them — dead agents are commented and requeued, finished ones
// release their claim. Terminal-agnostic: foot/wezterm only render; observing
// = attaching the herdr pane.
//
// Env:
//   ATUR_API_KEY   required — X-API-Key for app.diatur.com
//   ATUR_BASE      default https://app.diatur.com
//   WATCH          "slug:IDENT,slug:IDENT" (also --watch overrides)
//   MAX_ACTIVE     default 2
//   SCOUT_MODEL    optional — --model passed to scout spawns
//   SHIP_MODEL     optional — --model passed to ship spawns
// Flags:
//   --watch ...        --once  --dry-run  --interval <sec>  --max <n>
//   --status  --scout-model <m>  --ship-model <m>
//
// Task shapes: issue titles prefixed [SCOUT] dispatch investigation-only
// agents (findings = evidence comment, no code changes, main checkout).
// Everything else is a ship task: the loop prepares a FRESH GIT WORKTREE per
// issue (branch crew/<slug>-<seq> off the binding's default branch / origin
// HEAD) under ~/.local/state/spawn-loop/worktrees/ — parallel ships never
// collide, and the main checkout stays clean.
// Autonomy comes from the workspace binding: mode 'direct-PR' lets the agent
// push + open a PR; auto_merge 'yolo' additionally lets it merge after green
// gates. Default (NULL) = branch left for human merge.
//
// Run: bun run scripts/spawn-loop.ts --watch diatur:DEV --once --dry-run

import { join } from "node:path";
import { homedir } from "node:os";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync, openSync } from "node:fs";

const BASE = (process.env.ATUR_BASE ?? "https://app.diatur.com").replace(/\/$/, "");
const KEY =
  process.env.ATUR_API_KEY ??
  (process.env.ATUR_API_KEY_FILE ? readFileSync(process.env.ATUR_API_KEY_FILE, "utf8").trim() : "");
const CLAIM_TTL_MS = 60 * 60 * 1000; // dead claims older than this are force-released
const HARD_DROP_MS = 24 * 60 * 60 * 1000; // unresolvable claims vanish after a day
const STALL_MS = 30 * 60 * 1000; // live agent with no log writes this long = stuck
const SIGTERM_GRACE_MS = 15_000; // wait for SIGTERM to land before escalating to SIGKILL
const SIGKILL_GRACE_MS = 45_000; // wait for SIGKILL to land before deferring to the next tick
const REQUEUE_GRACE_MS = 20_000; // pause before verifying a requeue stuck (zombie writes land within seconds)
const STATE_DIR = join(homedir(), ".local/state/spawn-loop");
const CLAIMS_FILE = join(STATE_DIR, "claims.json");
const WT_DIR = join(STATE_DIR, "worktrees");
const PROMPT_DIR = "/tmp/spawn-loop";

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(name);
const val = (name: string, fallback: string) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const ONCE = flag("--once");
const DRY = flag("--dry-run");
const STATUS = flag("--status");
const INTERVAL = Number(val("--interval", String(process.env.INTERVAL_SEC ?? 300))) * 1000;
const MAX_ACTIVE = Number(val("--max", String(process.env.MAX_ACTIVE ?? 2)));
const SCOUT_MODEL = val("--scout-model", process.env.SCOUT_MODEL ?? "") || null;
const SHIP_MODEL = val("--ship-model", process.env.SHIP_MODEL ?? "") || null;
const WATCH = val("--watch", process.env.WATCH ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .map((s) => {
    const [slug, ident] = s.split(":");
    return { slug, ident };
  });

type Json = Record<string, unknown>;

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "X-API-Key": KEY, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} on ${path}: ${await res.text()}`);
  return (await res.json()) as T;
}

function rowsOf(body: unknown): Json[] {
  if (Array.isArray(body)) return body as Json[];
  const b = body as Json;
  return (b?.rows ?? b?.results ?? []) as Json[];
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

// A claim records everything supervision needs without re-resolving the
// project: which state counts as "back to queue", which states mean the agent
// finished, where its log lives (stall detection) and its worktree (cleanup).
type Claim = {
  ts: number;
  ws: string;
  seq: number;
  pid?: number;
  projectId: string;
  watchStateId: string;
  watchStateName: string;
  reviewStateId: string | null;
  doneStateIds: string[];
  logPath: string;
  wtPath: string | null;
  branch: string | null;
};
type Claims = Record<string, Claim>;

function loadClaims(): Claims {
  try {
    return JSON.parse(readFileSync(CLAIMS_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveClaims(c: Claims) {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(CLAIMS_FILE, JSON.stringify(c, null, 2));
}

function freshClaims(): Claims {
  const now = Date.now();
  const claims = loadClaims();
  for (const [id, c] of Object.entries(claims)) {
    if (now - c.ts > HARD_DROP_MS) delete claims[id];
  }
  return claims;
}

function pidAlive(pid?: number): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const sleep = (ms: number) => {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
};

function killTree(pid: number, sig: NodeJS.Signals) {
  try {
    process.kill(-pid, sig); // setsid made the spawn a group leader
  } catch {
    try {
      process.kill(pid, sig);
    } catch {
      // already gone
    }
  }
}

function notify(title: string, body: string) {
  if (DRY) return;
  try {
    const p = Bun.spawn(["notify-send", "-a", "spawn-loop", title, body], {
      stdout: "ignore",
      stderr: "ignore",
    });
    p.unref();
  } catch {
    // headless box without notify-send — best-effort only
  }
}

// Best-effort git runner; returns stdout or null on any failure.
async function git(args: string[], cwd: string): Promise<string | null> {
  try {
    const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
    const out = await new Response(proc.stdout).text();
    const code = await proc.exited;
    return code === 0 ? out.trim() : null;
  } catch {
    return null;
  }
}

function autonomyLines(binding: { mode: string | null; auto_merge: string | null }): string[] {
  if (binding.mode === "direct-PR" && binding.auto_merge === "yolo") {
    return [
      "Autonomy: push your branch and open a PR. After green gates (tests, lint,",
      "build) you MAY merge your own PR.",
    ];
  }
  if (binding.mode === "direct-PR") {
    return ["Autonomy: push your branch and open a PR. Do NOT merge — human merges."];
  }
  return ["Autonomy: local-only. Commit to your branch; open no PR; human takes it from here."];
}

async function hasClaimComment(slug: string, projectId: string, issueId: string) {
  const body = await api<unknown>(
    "GET",
    `/api/workspaces/${slug}/projects/${projectId}/issues/${issueId}/comments`,
  );
  return rowsOf(body).some((c) => JSON.stringify(c).includes("Picked up by"));
}

// True if a "Picked up by" claim comment landed after `sinceMs` — someone
// (human or fresh agent) took the issue during a grace window, and
// supervision must not fight them over the state field.
async function reclaimedAfter(slug: string, projectId: string, issueId: string, sinceMs: number) {
  const body = await api<unknown>(
    "GET",
    `/api/workspaces/${slug}/projects/${projectId}/issues/${issueId}/comments`,
  );
  return rowsOf(body).some((c) => {
    const at = Date.parse(str(c.createdAt) ?? "");
    return JSON.stringify(c).includes("Picked up by") && !Number.isNaN(at) && at > sinceMs;
  });
}

// PATCH the issue back to the watch state, then — after a grace pause long
// enough for any in-flight write from the dying agent to land — verify the
// requeue stuck. A verified kill shrinks the zombie-write race to a single
// HTTP request; this closes even that. Re-claims during the window win.
async function requeueVerified(claim: Claim, issueId: string, actionAt: number) {
  await api("PATCH", `/api/workspaces/${claim.ws}/projects/${claim.projectId}/issues/${issueId}`, {
    stateId: claim.watchStateId,
  });
  await sleep(REQUEUE_GRACE_MS);
  try {
    if (await reclaimedAfter(claim.ws, claim.projectId, issueId, actionAt)) return;
    const issue = (await api<Json>(
      "GET",
      `/api/workspaces/${claim.ws}/projects/${claim.projectId}/issues/${issueId}`,
    )) as Json;
    const stateId = str(issue.state_id ?? issue.stateId);
    if (stateId !== null && stateId !== claim.watchStateId) {
      await api(
        "PATCH",
        `/api/workspaces/${claim.ws}/projects/${claim.projectId}/issues/${issueId}`,
        {
          stateId: claim.watchStateId,
        },
      );
      console.log(
        `    zombie state-write had overwritten the requeue — re-asserted "${claim.watchStateName}"`,
      );
    }
  } catch (err) {
    console.error(`    requeue verification failed: ${err instanceof Error ? err.message : err}`);
  }
}

// Fresh worktree per ship task: fetch, resolve base (binding default branch →
// origin HEAD → local HEAD), add crew/<slug>-<seq>. Reuses an existing branch
// after a crashed earlier attempt.
async function prepareWorktree(
  cwd: string,
  slug: string,
  seq: number,
  defaultBranch: string | null,
): Promise<{ wtPath: string; branch: string } | null> {
  await git(["fetch", "origin", "--prune"], cwd); // base freshness; offline OK
  let base: string | null = null;
  if (defaultBranch) {
    base = await git(["rev-parse", "--verify", `origin/${defaultBranch}`], cwd);
  }
  base ??= await git(["rev-parse", "--verify", "origin/HEAD"], cwd);
  base ??= (await git(["rev-parse", "HEAD"], cwd)) ?? "HEAD";
  const branch = `crew/${slug}-${seq}`;
  const wtPath = join(WT_DIR, `${slug}-${seq}`);
  mkdirSync(WT_DIR, { recursive: true });
  if (existsSync(wtPath)) await git(["worktree", "remove", "--force", wtPath], cwd);
  const added =
    (await git(["worktree", "add", "-b", branch, wtPath, base], cwd)) !== null ||
    (await git(["worktree", "add", wtPath, branch], cwd)) !== null;
  if (!added) return null;
  return { wtPath, branch };
}

async function spawnAgent(
  slug: string,
  issue: { id: string; seq: number; name: string },
  binding: {
    local_path: string | null;
    repo_urls: string[] | null;
    default_branch: string | null;
    mode: string | null;
    auto_merge: string | null;
  },
  scout: boolean,
  ompPath: string,
): Promise<{ pid: number; logPath: string; wtPath: string | null; branch: string | null } | null> {
  const cwd = binding.local_path;
  if (!cwd || !existsSync(cwd)) {
    console.log(`    skip: no local checkout (${cwd ?? "unbound"})`);
    return null;
  }
  mkdirSync(PROMPT_DIR, { recursive: true });
  const promptPath = join(PROMPT_DIR, `${slug}-${issue.seq}.md`);
  const repos = binding.repo_urls?.join(", ") ?? "see workspace binding";
  let worktreeLines: string[];
  let wtInfo: { wtPath: string | null; branch: string | null } = { wtPath: null, branch: null };
  if (scout) {
    worktreeLines = [
      "Task shape: SCOUT — investigation only, in this checkout (read-only).",
      "Do NOT modify any files. Research the issue, then post your findings as",
      "the evidence comment (structure: question → findings → recommendation).",
      "Set the state to Need Review. Never Done.",
    ];
  } else {
    const wt = DRY
      ? { wtPath: "/tmp/spawn-loop/dry-worktree", branch: `crew/${slug}-${issue.seq}` }
      : await prepareWorktree(cwd, slug, issue.seq, binding.default_branch);
    if (!wt) {
      console.log("    skip: worktree preparation failed");
      return null;
    }
    wtInfo = { wtPath: wt.wtPath, branch: wt.branch };
    worktreeLines = [
      `Task shape: SHIP — implement a real change.`,
      `You are in a dedicated git worktree on branch ${wt.branch} (fresh off the`,
      `default branch). Commit there; never touch the main checkout.`,
      `Post ONE evidence comment (screenshot via upload_image for UI work,`,
      `command/test output for CLI work), then set the state to Need Review.`,
      `Never Done.`,
      ...autonomyLines(binding),
    ];
  }
  writeFileSync(
    promptPath,
    [
      `Work Atur issue ${slug}-${issue.seq}: ${issue.name}`,
      ``,
      `Issue URL: ${BASE}/${slug}/issues/${issue.id}`,
      `Workspace: ${slug} · Repos: ${repos} · Checkout: ${cwd}`,
      ``,
      `Follow AGENTS.md § Control Plane — Agent Claim/Evidence Convention:`,
      `claim via MCP (comment "Picked up by <agent> (pane <id>)" + state In`,
      `Progress) BEFORE starting work. The Atur MCP server is ${BASE}/mcp`,
      `(X-API-Key in env). In the claim comment include:`,
      ``,
      `Observe: ${BASE}/panes/$HERDR_PANE_ID`,
      ``,
      `(HERDR_PANE_ID comes from your env — humans click that URL to watch`,
      `your live terminal in the browser.)`,
      ``,
      ...worktreeLines,
      ``,
    ].join("\n"),
  );
  const logPath = join(STATE_DIR, `${slug}-${issue.seq}.log`);
  mkdirSync(STATE_DIR, { recursive: true });
  const spawnCwd = scout ? cwd : wtInfo.wtPath!;
  const model = scout ? SCOUT_MODEL : SHIP_MODEL;
  const modelArgs = model ? ["--model", model] : [];
  if (DRY) {
    console.log(
      `    DRY-RUN would spawn: cd ${spawnCwd} && ${ompPath} -p @${promptPath}${model ? ` --model ${model}` : ""} (log ${logPath})`,
    );
    return null;
  }
  const out = openSync(logPath, "a");
  const proc = Bun.spawn(["setsid", ompPath, "-p", `@${promptPath}`, ...modelArgs], {
    cwd: spawnCwd,
    stdin: "ignore",
    stdout: out,
    stderr: out,
  });
  proc.unref();
  console.log(
    `    spawned pid ${proc.pid} (log ${logPath}${wtInfo.branch ? `, branch ${wtInfo.branch}` : ""})`,
  );
  return { pid: proc.pid, logPath, wtPath: wtInfo.wtPath, branch: wtInfo.branch };
}

// Release-side worktree hygiene: finished + clean → remove; dirty → keep for
// inspection and say so.
async function cleanupWorktree(claim: Claim): Promise<string | null> {
  if (!claim.wtPath || !existsSync(claim.wtPath)) return null;
  const dirty = await git(["status", "--porcelain"], claim.wtPath);
  if (dirty) return `worktree kept (uncommitted work): ${claim.wtPath}`;
  await git(["worktree", "remove", claim.wtPath], claim.wtPath); // self-removal works for git ≥2.30
  return null;
}

// Supervision runs before dispatch each tick: dead-pid claims either finished
// (issue reached review/done — release silently) or crashed mid-flight
// (evidence-gap comment + requeue to the watch state). Live claims whose log
// went quiet for STALL_MS are killed with verified escalation — if death
// can't be confirmed, the claim is kept and the kill retried next tick.
// Requeues re-assert the watch state after a grace pause so an in-flight
// write from the dying agent can't win the race. DRY never mutates.
async function supervise(claims: Claims): Promise<number> {
  let active = 0;
  for (const [issueId, claim] of Object.entries(claims)) {
    const age = Math.round((Date.now() - claim.ts) / 60000);
    if (pidAlive(claim.pid)) {
      let stalled = false;
      try {
        stalled = Date.now() - statSync(claim.logPath).mtimeMs > STALL_MS;
      } catch {
        // no log yet — a fresh spawn writes on first output; not stalled
      }
      if (!stalled) {
        console.log(`  crew: ${claim.ws}-${claim.seq} pid=${claim.pid} alive · ${age}m`);
        active++;
        continue;
      }
      console.log(
        `  crew: ${claim.ws}-${claim.seq} pid=${claim.pid} STALLED · no log writes for ${Math.round(STALL_MS / 60000)}m`,
      );
      if (DRY) {
        console.log(
          `    DRY-RUN would kill + comment crash + requeue to "${claim.watchStateName}"`,
        );
        active++;
        continue;
      }
      killTree(claim.pid!, "SIGTERM");
      const termDeadline = Date.now() + SIGTERM_GRACE_MS;
      while (pidAlive(claim.pid) && Date.now() < termDeadline) await sleep(500);
      if (pidAlive(claim.pid)) killTree(claim.pid!, "SIGKILL");
      const killDeadline = Date.now() + SIGKILL_GRACE_MS;
      while (pidAlive(claim.pid) && Date.now() < killDeadline) await sleep(1000);
      if (pidAlive(claim.pid)) {
        // SIGKILL delivery can be deferred (D-state sleep) or the process
        // escaped the group — post nothing false: keep the claim and retry
        // the kill on the next tick instead of requeueing a live agent.
        console.error(`    pid ${claim.pid} survived SIGKILL — claim retained, retrying next tick`);
        active++;
        continue;
      }
      const actionAt = Date.now();
      try {
        await api(
          "POST",
          `/api/workspaces/${claim.ws}/projects/${claim.projectId}/issues/${issueId}/comments`,
          {
            comment_html: `<p>⚠️ Spawned agent (pid ${claim.pid}) stalled — no log output for ~${Math.round(STALL_MS / 60000)}m. Killed (verified dead) and requeued to <strong>${claim.watchStateName}</strong>; claim released.</p>`,
          },
        );
        await requeueVerified(claim, issueId, actionAt);
      } catch (err) {
        console.error(`    stall requeue failed: ${err instanceof Error ? err.message : err}`);
      }
      notify("spawn-loop: crewmate stalled", `${claim.ws}-${claim.seq} killed + requeued`);
      delete claims[issueId];
      saveClaims(claims);
      continue;
    }
    console.log(`  crew: ${claim.ws}-${claim.seq} pid=${claim.pid ?? "?"} DEAD · ${age}m`);
    try {
      const issue = (await api<Json>(
        "GET",
        `/api/workspaces/${claim.ws}/projects/${claim.projectId}/issues/${issueId}`,
      )) as Json;
      const stateId = str(issue.state_id ?? issue.stateId);
      const finished =
        issue.completed_at != null ||
        (stateId !== null &&
          (claim.doneStateIds.includes(stateId) || stateId === claim.reviewStateId));
      if (finished) {
        const wtNote = await cleanupWorktree(claim);
        console.log(`    finished — releasing claim${wtNote ? ` · ${wtNote}` : ""}`);
        notify("spawn-loop: crewmate finished", `${claim.ws}-${claim.seq} → Need Review`);
      } else if (DRY) {
        console.log(`    DRY-RUN would comment crash + requeue to "${claim.watchStateName}"`);
      } else {
        const actionAt = Date.now();
        await api(
          "POST",
          `/api/workspaces/${claim.ws}/projects/${claim.projectId}/issues/${issueId}/comments`,
          {
            comment_html: `<p>⚠️ Spawned agent (pid ${claim.pid ?? "?"}) exited after ~${age}m without reaching Need Review. Requeued to <strong>${claim.watchStateName}</strong>; claim released.</p>`,
          },
        );
        await requeueVerified(claim, issueId, actionAt);
        const wtNote = await cleanupWorktree(claim);
        console.log(
          `    commented crash + requeued to "${claim.watchStateName}"${wtNote ? ` · ${wtNote}` : ""}`,
        );
        notify(
          "spawn-loop: crewmate crashed",
          `${claim.ws}-${claim.seq} requeued to ${claim.watchStateName}`,
        );
      }
      delete claims[issueId];
      saveClaims(claims);
    } catch (err) {
      // Unresolvable (Atur unreachable?): keep counting until TTL, then
      // force-release so a dead agent never wedges the dispatch slot.
      if (Date.now() - claim.ts > CLAIM_TTL_MS) {
        console.error(
          `    supervise failed past TTL — force-releasing: ${err instanceof Error ? err.message : err}`,
        );
        delete claims[issueId];
        saveClaims(claims);
      } else {
        console.error(`    supervise failed: ${err instanceof Error ? err.message : err}`);
        active++;
      }
    }
  }
  return active;
}

async function tick(ompPath: string) {
  const claims = freshClaims();
  let active = await supervise(claims);
  for (const { slug, ident } of WATCH) {
    if (active >= MAX_ACTIVE) break;
    const projects = rowsOf(await api("GET", `/api/workspaces/${slug}/projects?limit=100`));
    const project = projects.find((p) => p.identifier === ident) as Json | undefined;
    if (!project) {
      console.log(`  ${slug}:${ident} — project not found`);
      continue;
    }
    const projectId = project.id as string;
    const states = rowsOf(await api("GET", `/api/workspaces/${slug}/projects/${projectId}/states`));
    // Watch state: explicit Todo → project default → backlog group (covers
    // ClickUp-migrated projects whose entry state is "Backlog").
    let watch = states.find((s) => s.slug === "todo" || String(s.name).toLowerCase() === "todo");
    let watchLabel = "Todo";
    if (!watch) {
      watch = states.find((s) => s.is_default === 1 || s.isDefault === 1);
      watchLabel = watch ? `default "${watch.name}"` : "";
    }
    if (!watch) {
      watch = states.find((s) => s.group === "backlog" || s.groupName === "backlog");
      watchLabel = watch ? `backlog "${watch.name}"` : "";
    }
    if (!watch) {
      console.log(`  ${slug}:${ident} — no watchable state`);
      continue;
    }
    const review = states.find((s) => /review/i.test(String(s.name))) ?? null;
    const doneStateIds = states
      .filter((s) => s.group === "completed" || s.groupName === "completed")
      .map((s) => s.id as string);
    const link = (await api<Json | null>("GET", `/api/workspaces/${slug}/links`)) as Json | null;
    const binding = {
      local_path: str(link?.local_path),
      repo_urls: (link?.repo_urls as string[] | null) ?? null,
      default_branch: str(link?.default_branch),
      mode: str(link?.mode),
      auto_merge: str(link?.auto_merge),
    };
    const issues = rowsOf(
      await api(
        "GET",
        `/api/workspaces/${slug}/projects/${projectId}/issues?state=${watch.id}&limit=50`,
      ),
    );
    console.log(
      `  ${slug}:${ident} — ${issues.length} in ${watchLabel} · mode=${binding.mode ?? "local-only"}${binding.auto_merge ? "+" + binding.auto_merge : ""} · binding ${link ? "ok" : "missing"}`,
    );
    for (const issue of issues) {
      if (active >= MAX_ACTIVE) break;
      if (claims[issue.id as string]) continue;
      if (await hasClaimComment(slug, projectId, issue.id as string)) continue;
      const seq = (issue.sequence_id ?? issue.sequenceId) as number;
      const scout = /^\[?scout\]?/i.test(String(issue.name));
      console.log(`  → candidate ${slug}-${seq}${scout ? " [SCOUT]" : ""}: ${issue.name}`);
      const spawned = await spawnAgent(
        slug,
        { id: issue.id as string, seq, name: String(issue.name) },
        binding,
        scout,
        ompPath,
      );
      if (spawned !== null) {
        claims[issue.id as string] = {
          ts: Date.now(),
          ws: slug,
          seq,
          pid: spawned.pid,
          projectId,
          watchStateId: watch.id as string,
          watchStateName: String(watch.name),
          reviewStateId: review ? (review.id as string) : null,
          doneStateIds,
          logPath: spawned.logPath,
          wtPath: spawned.wtPath,
          branch: spawned.branch,
        };
        saveClaims(claims);
        active++;
      }
    }
  }
}

async function status() {
  const claims = loadClaims();
  console.log(`crew (${Object.keys(claims).length} claims):`);
  for (const [issueId, c] of Object.entries(claims)) {
    const age = Math.round((Date.now() - c.ts) / 60000);
    const alive = pidAlive(c.pid);
    let name = "(unresolvable)";
    try {
      const issue = (await api<Json>(
        "GET",
        `/api/workspaces/${c.ws}/projects/${c.projectId}/issues/${issueId}`,
      )) as Json;
      name = String(issue.name);
    } catch {
      // keep placeholder
    }
    console.log(
      `  ${c.ws}-${c.seq}  pid=${c.pid ?? "?"} ${alive ? "alive" : "DEAD"}  ${age}m${c.branch ? `  ${c.branch}` : ""}  ${name}`,
    );
    console.log(`      ${BASE}/${c.ws}/issues/${issueId}`);
  }
}

async function main() {
  if (!KEY) throw new Error("ATUR_API_KEY required");
  if (STATUS) return status();
  if (!WATCH.length) throw new Error("WATCH (or --watch slug:IDENT,...) required");
  const ompPath = (await new Response(Bun.spawn(["which", "omp"]).stdout).text()).trim();
  if (!ompPath) throw new Error("omp binary not found on PATH");
  mkdirSync(WT_DIR, { recursive: true });
  console.log(
    `spawn-loop: base=${BASE} watch=${WATCH.map((w) => `${w.slug}:${w.ident}`).join(",")} max=${MAX_ACTIVE} ${DRY ? "[DRY-RUN]" : ""} ${ONCE ? "[once]" : `[every ${INTERVAL / 1000}s]`}${SCOUT_MODEL ? ` scout=${SCOUT_MODEL}` : ""}${SHIP_MODEL ? ` ship=${SHIP_MODEL}` : ""}`,
  );
  for (;;) {
    console.log(new Date().toISOString());
    await tick(ompPath);
    if (ONCE) break;
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, INTERVAL);
    await promise;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
