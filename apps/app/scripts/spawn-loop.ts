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
// Flags:
//   --watch ...   --once  --dry-run  --interval <sec>  --max <n>  --status
//
// Task shapes: issue titles prefixed [SCOUT] dispatch investigation-only
// agents (findings = evidence comment, no code changes). Everything else is
// a ship task (worktree branch per AGENTS.md § Control Plane).
// Autonomy comes from the workspace binding: mode 'direct-PR' lets the agent
// push + open a PR; auto_merge 'yolo' additionally lets it merge after green
// gates. Default (NULL) = branch left for human merge.
//
// Run: bun run scripts/spawn-loop.ts --watch diatur:DEV --once --dry-run

import { join } from "node:path";
import { homedir } from "node:os";
import { mkdirSync, readFileSync, writeFileSync, existsSync, openSync } from "node:fs";

const BASE = (process.env.ATUR_BASE ?? "https://app.diatur.com").replace(/\/$/, "");
const KEY = process.env.ATUR_API_KEY ?? "";
const CLAIM_TTL_MS = 60 * 60 * 1000;
const STATE_DIR = join(homedir(), ".local/state/spawn-loop");
const CLAIMS_FILE = join(STATE_DIR, "claims.json");
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
// project: which state counts as "back to queue" and which states mean the
// agent finished its lifecycle.
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
    if (now - c.ts > CLAIM_TTL_MS) delete claims[id];
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
  return ["Autonomy: local-only. Commit to a branch; open no PR; human takes it from here."];
}

async function hasClaimComment(slug: string, projectId: string, issueId: string) {
  const body = await api<unknown>(
    "GET",
    `/api/workspaces/${slug}/projects/${projectId}/issues/${issueId}/comments`,
  );
  return rowsOf(body).some((c) => JSON.stringify(c).includes("Picked up by"));
}

async function spawnAgent(
  slug: string,
  issue: { id: string; seq: number; name: string },
  binding: { local_path: string | null; repo_urls: string[] | null; mode: string | null; auto_merge: string | null },
  scout: boolean,
  ompPath: string,
): Promise<number | null> {
  const cwd = binding.local_path;
  if (!cwd || !existsSync(cwd)) {
    console.log(`    skip: no local checkout (${cwd ?? "unbound"})`);
    return null;
  }
  mkdirSync(PROMPT_DIR, { recursive: true });
  const promptPath = join(PROMPT_DIR, `${slug}-${issue.seq}.md`);
  const repos = binding.repo_urls?.join(", ") ?? "see workspace binding";
  const shape = scout
    ? [
        "Task shape: SCOUT — investigation only.",
        "Do NOT modify any files. Research the issue, then post your findings as",
        "the evidence comment (structure: question → findings → recommendation).",
        "Set the state to Need Review. Never Done.",
      ]
    : [
        "Task shape: SHIP — implement a real change.",
        "Work in a git worktree/branch. Post ONE evidence comment (screenshot via",
        "upload_image for UI work, command/test output for CLI work), then set the",
        "state to Need Review. Never Done.",
        ...autonomyLines(binding),
      ];
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
      `(X-API-Key in env).`,
      ``,
      ...shape,
      ``,
    ].join("\n"),
  );
  const logPath = join(STATE_DIR, `${slug}-${issue.seq}.log`);
  mkdirSync(STATE_DIR, { recursive: true });
  if (DRY) {
    console.log(`    DRY-RUN would spawn: cd ${cwd} && ${ompPath} -p @${promptPath} (log ${logPath})`);
    return null;
  }
  const out = openSync(logPath, "a");
  const proc = Bun.spawn(["setsid", ompPath, "-p", `@${promptPath}`], {
    cwd,
    stdin: "ignore",
    stdout: out,
    stderr: out,
  });
  proc.unref();
  console.log(`    spawned pid ${proc.pid} (log ${logPath})`);
  return proc.pid;
}

// Supervision runs before dispatch each tick: dead-pid claims either finished
// (issue reached review/done — release silently) or crashed mid-flight
// (evidence-gap comment + requeue to the watch state). DRY never mutates.
async function supervise(claims: Claims): Promise<number> {
  let active = 0;
  for (const [issueId, claim] of Object.entries(claims)) {
    const age = Math.round((Date.now() - claim.ts) / 60000);
    if (pidAlive(claim.pid)) {
      console.log(`  crew: ${claim.ws}-${claim.seq} pid=${claim.pid} alive · ${age}m`);
      active++;
      continue;
    }
    console.log(`  crew: ${claim.ws}-${claim.seq} pid=${claim.pid ?? "?"} DEAD · ${age}m`);
    try {
      const issue = (await api<Json>(
        "GET",
        `/api/workspaces/${claim.ws}/projects/${claim.projectId}/issues/${issueId}`,
      )) as Json;
      const stateId = str(issue.state_id ?? issue.stateId);
      const finished = issue.completed_at != null || (stateId !== null && (claim.doneStateIds.includes(stateId) || stateId === claim.reviewStateId));
      if (finished) {
        console.log(`    finished — releasing claim`);
      } else if (DRY) {
        console.log(`    DRY-RUN would comment crash + requeue to "${claim.watchStateName}"`);
      } else {
        await api("POST", `/api/workspaces/${claim.ws}/projects/${claim.projectId}/issues/${issueId}/comments`, {
          comment_html: `<p>⚠️ Spawned agent (pid ${claim.pid ?? "?"}) exited after ~${age}m without reaching Need Review. Requeued to <strong>${claim.watchStateName}</strong>; claim released.</p>`,
        });
        await api("PATCH", `/api/workspaces/${claim.ws}/projects/${claim.projectId}/issues/${issueId}`, {
          stateId: claim.watchStateId,
        });
        console.log(`    commented crash + requeued to "${claim.watchStateName}"`);
      }
      delete claims[issueId];
      saveClaims(claims);
    } catch (err) {
      console.error(`    supervise failed: ${err instanceof Error ? err.message : err}`);
      active++; // unresolved — keep counting it until the claim ages out
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
      mode: str(link?.mode),
      auto_merge: str(link?.auto_merge),
    };
    const issues = rowsOf(
      await api("GET", `/api/workspaces/${slug}/projects/${projectId}/issues?state=${watch.id}&limit=50`),
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
      const pid = await spawnAgent(
        slug,
        { id: issue.id as string, seq, name: String(issue.name) },
        binding,
        scout,
        ompPath,
      );
      if (pid !== null) {
        claims[issue.id as string] = {
          ts: Date.now(),
          ws: slug,
          seq,
          pid,
          projectId,
          watchStateId: watch.id as string,
          watchStateName: String(watch.name),
          reviewStateId: review ? (review.id as string) : null,
          doneStateIds,
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
      `  ${c.ws}-${c.seq}  pid=${c.pid ?? "?"} ${alive ? "alive" : "DEAD"}  ${age}m  ${name}`,
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
  console.log(
    `spawn-loop: base=${BASE} watch=${WATCH.map((w) => `${w.slug}:${w.ident}`).join(",")} max=${MAX_ACTIVE} ${DRY ? "[DRY-RUN]" : ""} ${ONCE ? "[once]" : `[every ${INTERVAL / 1000}s]`}`,
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
