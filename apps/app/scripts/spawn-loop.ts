#!/usr/bin/env bun
// Herdr-native spawn loop (DEV-30): watch Atur for Todo issues in bound
// workspaces and dispatch headless `omp -p` agents. Terminal-agnostic —
// foot/wezterm only render; observing = attaching the herdr pane.
//
// Env:
//   ATUR_API_KEY   required — X-API-Key for app.diatur.com
//   ATUR_BASE      default https://app.diatur.com
//   WATCH          "slug:IDENT,slug:IDENT" (also --watch overrides)
//   MAX_ACTIVE     default 2
// Flags:
//   --watch ...  --once  --dry-run  --interval <sec>  --max <n>
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
const INTERVAL = Number(val("--interval", String(process.env.INTERVAL_SEC ?? 300))) * 1000;
const MAX_ACTIVE = Number(val("--max", String(process.env.MAX_ACTIVE ?? 2)));
const WATCH = (val("--watch", process.env.WATCH ?? "") ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .map((s) => {
    const [slug, ident] = s.split(":");
    return { slug, ident };
  });

type Json = Record<string, unknown>;

async function api<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: { "X-API-Key": KEY } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} on ${path}: ${await res.text()}`);
  return (await res.json()) as T;
}

function rowsOf(body: unknown): Json[] {
  if (Array.isArray(body)) return body as Json[];
  const b = body as Json;
  const rows = (b?.rows ?? b?.results ?? []) as Json[];
  return rows;
}

function loadClaims(): Record<string, { ts: number; ws: string; seq: number }> {
  try {
    return JSON.parse(readFileSync(CLAIMS_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveClaims(c: Record<string, { ts: number; ws: string; seq: number }>) {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(CLAIMS_FILE, JSON.stringify(c, null, 2));
}

function freshClaims(): Record<string, { ts: number; ws: string; seq: number }> {
  const now = Date.now();
  const claims = loadClaims();
  for (const [id, c] of Object.entries(claims)) {
    if (now - c.ts > CLAIM_TTL_MS) delete claims[id];
  }
  return claims;
}

async function hasClaimComment(slug: string, projectId: string, issueId: string) {
  const body = await api<unknown>(
    `/api/workspaces/${slug}/projects/${projectId}/issues/${issueId}/comments`,
  );
  const comments = rowsOf(body);
  return comments.some((c) => JSON.stringify(c).includes("Picked up by"));
}

async function spawnAgent(
  slug: string,
  issue: { id: string; sequenceId: number; name: string },
  binding: { local_path: string | null; repo_urls: string[] | null },
  ompPath: string,
): Promise<boolean> {
  const cwd = binding.local_path;
  if (!cwd || !existsSync(cwd)) {
    console.log(`    skip: no local checkout (${cwd ?? "unbound"})`);
    return false;
  }
  mkdirSync(PROMPT_DIR, { recursive: true });
  const promptPath = join(PROMPT_DIR, `${slug}-${issue.sequenceId}.md`);
  const repos = binding.repo_urls?.join(", ") ?? "see workspace binding";
  writeFileSync(
    promptPath,
    [
      `Work Atur issue ${slug}-${issue.sequenceId}: ${issue.name}`,
      ``,
      `Issue URL: ${BASE}/${slug}/issues/${issue.id}`,
      `Workspace: ${slug} · Repos: ${repos} · Checkout: ${cwd}`,
      ``,
      `Follow AGENTS.md § Control Plane — Agent Claim/Evidence Convention:`,
      `claim via MCP (comment "Picked up by <agent> (pane <id>)" + state In Progress),`,
      `work in a git worktree, post ONE evidence comment (screenshot for UI, command`,
      `output for CLI), set state to Need Review. Never set Done. Never push the`,
      `default branch. The Atur MCP server is ${BASE}/mcp (X-API-Key in env).`,
      ``,
    ].join("\n"),
  );
  const logPath = join(STATE_DIR, `${slug}-${issue.sequenceId}.log`);
  mkdirSync(STATE_DIR, { recursive: true });
  if (DRY) {
    console.log(`    DRY-RUN would spawn: cd ${cwd} && ${ompPath} -p @${promptPath} (log ${logPath})`);
    return false;
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
  return true;
}

async function tick(ompPath: string) {
  const claims = freshClaims();
  let active = Object.keys(claims).length;
  for (const { slug, ident } of WATCH) {
    if (active >= MAX_ACTIVE) break;
    try {
      const projects = rowsOf(await api(`/api/workspaces/${slug}/projects?limit=100`));
      const project = projects.find((p) => p.identifier === ident) as Json | undefined;
      if (!project) {
        console.log(`  ${slug}:${ident} — project not found`);
        continue;
      }
      const states = rowsOf(
        await api(`/api/workspaces/${slug}/projects/${project.id}/states`),
      );
      // Explicit Todo first; ClickUp-migrated projects often have custom
      // state names — fall back to the project's default entry state.
      let todo = states.find(
        (s) => s.slug === "todo" || String(s.name).toLowerCase() === "todo",
      );
      let stateLabel = "Todo";
      if (!todo) {
        todo = states.find((s) => s.is_default === 1 || s.isDefault === 1);
        stateLabel = todo ? `default state "${todo.name}"` : "";
      }
      if (!todo) {
        // ClickUp-migrated projects often have no default state at all —
        // their entry point is the backlog group.
        todo = states.find(
          (s) => s.group === "backlog" || s.groupName === "backlog",
        );
        stateLabel = todo ? `backlog state "${todo.name}"` : "";
      }
      if (!todo) {
        console.log(`  ${slug}:${ident} — no watchable state`);
        continue;
      }
      const link = (await api(`/api/workspaces/${slug}/links`)) as Json | null;
      const issues = rowsOf(
        await api(
          `/api/workspaces/${slug}/projects/${project.id}/issues?state=${todo.id}&limit=50`,
        ),
      );
      console.log(
        `  ${slug}:${ident} — ${issues.length} in ${stateLabel} · binding ${link ? "ok" : "missing"}`,
      );
      for (const issue of issues) {
        if (active >= MAX_ACTIVE) break;
        if (claims[issue.id as string]) continue;
        if (await hasClaimComment(slug, project.id as string, issue.id as string)) continue;
        const seq = (issue.sequence_id ?? issue.sequenceId) as number;
        console.log(
          `  → candidate ${slug}-${seq}: ${issue.name}`,
        );
        const ok = await spawnAgent(
          slug,
          { id: issue.id as string, sequenceId: seq, name: issue.name as string },
          (link ?? {}) as { local_path: string | null; repo_urls: string[] | null },
          ompPath,
        );
        if (ok) {
          claims[issue.id as string] = { ts: Date.now(), ws: slug, seq };
          active++;
          saveClaims(claims);
        }
      }
    } catch (err) {
      console.error(`  ${slug}:${ident} — ${err instanceof Error ? err.message : err}`);
    }
  }
}

async function main() {
  if (!KEY) throw new Error("ATUR_API_KEY required");
  if (!WATCH.length) throw new Error("WATCH (or --watch slug:IDENT,...) required");
  const ompPath = await new Response(
    Bun.spawn(["which", "omp"]).stdout,
  ).text();
  const omp = ompPath.trim();
  if (!omp) throw new Error("omp binary not found on PATH");
  console.log(`spawn-loop: base=${BASE} watch=${WATCH.map((w) => `${w.slug}:${w.ident}`).join(",")} max=${MAX_ACTIVE} ${DRY ? "[DRY-RUN]" : ""} ${ONCE ? "[once]" : `[every ${INTERVAL / 1000}s]`}`);
  for (;;) {
    console.log(new Date().toISOString());
    await tick(omp);
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
