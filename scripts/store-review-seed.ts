#!/usr/bin/env bun
// Store-review account + demo data on PROD (https://app.diatur.com).
//
//   bun scripts/store-review-seed.ts            # create / top up everything
//   ATUR_URL=http://localhost:5173 bun scripts/store-review-seed.ts
//
// Idempotent: every object is looked up by name first, so re-running only fills
// what is missing. Dates are relative to "today", so run it again before
// capturing screenshots or when a reviewer reports an empty Today screen.
//
// Credentials live in ~/.config/atur/review-login.txt (mode 600):
//   email= / password=                      the account given to Apple / Google
//   teammate_email= / teammate_password=    a second demo user whose comments
//                                           populate the reviewer's inbox
// Missing file or fields are generated; existing ones are never overwritten.
//
// If a reviewer deletes the review account (App Store / Play test the delete
// flow), run this script again: the teammate inherits the workspace on
// deletion, the review user registers afresh and is added back as an admin.
// Only the seed users' own session tokens are used; no other account is touched.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const BASE = (process.env.ATUR_URL ?? "https://app.diatur.com").replace(/\/+$/, "");
const CREDS = join(homedir(), ".config", "atur", "review-login.txt");

const WORKSPACE_NAME = "Acme Mobile";
const WORKSPACE_SLUG = "acme-mobile";

// ── credentials file ────────────────────────────────────────────────────────

function readCreds(): Record<string, string> {
  if (!existsSync(CREDS)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(CREDS, "utf8").split("\n")) {
    const i = line.indexOf("=");
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

function password(): string {
  // 24 url-safe chars + a fixed suffix so every character class is present.
  return `${randomBytes(18).toString("base64url")}-9aZ`;
}

const creds = readCreds();
creds.email ||= "review@diatur.com";
creds.password ||= password();
creds.teammate_email ||= "maya.chen@acme-mobile.example";
creds.teammate_password ||= password();
mkdirSync(dirname(CREDS), { recursive: true });
writeFileSync(CREDS, Object.entries(creds).map(([k, v]) => `${k}=${v}`).join("\n") + "\n", {
  mode: 0o600,
});
chmodSync(CREDS, 0o600);

// ── http ────────────────────────────────────────────────────────────────────

// Only the fields this script reads; the API returns more.
type Json = {
  id: string;
  name: string;
  member_id?: string;
  session_token?: string;
  user?: { id: string };
};

class Api {
  token = "";
  userId = "";
  constructor(readonly label: string) {}

  async req<T = Json>(method: string, path: string, body?: unknown, okStatuses: number[] = []) {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!res.ok && !okStatuses.includes(res.status)) {
      throw new Error(`${this.label} ${method} ${path} -> ${res.status} ${text.slice(0, 300)}`);
    }
    return { status: res.status, data: data as T };
  }

  get = <T = Json>(path: string) => this.req<T>("GET", path).then((r) => r.data);
  post = <T = Json>(path: string, body?: unknown) => this.req<T>("POST", path, body ?? {}).then((r) => r.data);
  patch = <T = Json>(path: string, body: unknown) => this.req<T>("PATCH", path, body).then((r) => r.data);

  async signIn(email: string, pw: string, username: string) {
    const reg = await this.req<Json>("POST", "/auth/register", { email, username, password: pw }, [
      409,
    ]);
    const session =
      reg.status === 409
        ? (await this.req<Json>("POST", "/auth/sign-in", { email, password: pw })).data
        : reg.data;
    if (!session.session_token || !session.user) throw new Error(`${this.label}: no session`);
    this.token = session.session_token;
    this.userId = session.user.id;
  }
}

const list = <T = Json>(d: unknown): T[] => {
  if (Array.isArray(d)) return d as T[];
  const results = (d as { results?: unknown } | null)?.results;
  return Array.isArray(results) ? (results as T[]) : [];
};

// ── dates ───────────────────────────────────────────────────────────────────

function day(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ── seed ────────────────────────────────────────────────────────────────────

const alex = new Api("review");
const maya = new Api("teammate");

await alex.signIn(creds.email, creds.password, "alex-rivera");
await maya.signIn(creds.teammate_email, creds.teammate_password, "maya-chen");
await alex.patch("/api/users/me", { display_name: "Alex Rivera" });
await maya.patch("/api/users/me", { display_name: "Maya Chen" });
console.log(`signed in: review=${alex.userId} teammate=${maya.userId}`);

// Workspace: whoever is already in it (the teammate after a deletion) hosts it.
const slugPath = `/api/workspaces/${WORKSPACE_SLUG}`;
let host: Api | null = null;
for (const who of [alex, maya]) {
  const r = await who.req("GET", slugPath, undefined, [403, 404]);
  if (r.status === 200) {
    host = who;
    break;
  }
}
if (!host) {
  await alex.post("/api/workspaces/", {
    name: WORKSPACE_NAME,
    slug: WORKSPACE_SLUG,
    timezone: "UTC",
  });
  host = alex;
  console.log("created workspace");
}
// Both users end up admins (role 20) of the workspace.
for (const [who, other] of [
  [alex, maya],
  [maya, alex],
] as const) {
  const members = list<Json>(await host.get(`${slugPath}/members/`));
  const present = members.some((m) => m.member_id === who.userId);
  if (!present) {
    // The host is an admin; add the other user.
    await host.req("POST", `${slugPath}/members/`, { member_id: who.userId, role: 20 }, [409]);
    console.log(`added ${who.label} to workspace`);
  }
  void other;
}

const ws = (a: Api) => `/api/workspaces/${WORKSPACE_SLUG}`;

async function ensureProject(name: string, identifier: string, emoji: string) {
  const existing = list<Json>(await alex.get(`${ws(alex)}/projects/`)).find((p) => p.name === name);
  if (existing) return existing;
  return alex.post(`${ws(alex)}/projects/`, { name, identifier, emoji, timezone: "UTC" });
}

const mobile = await ensureProject("Mobile App", "MOB", "1f4f1");
const web = await ensureProject("Website", "WEB", "1f310");

type Ctx = {
  project: Json;
  states: Record<string, string>; // canonical key -> id
  labels: Record<string, string>; // name -> id
  base: string;
};

async function setup(project: Json): Promise<Ctx> {
  const base = `${ws(alex)}/projects/${project.id}`;
  let states = list<Json>(await alex.get(`${base}/states/`));
  for (const [name, color] of [
    ["Needs You", "#BE185D"],
    ["Need Review", "#7C3AED"],
  ] as const) {
    if (!states.some((s) => s.name === name)) {
      await alex.post(`${base}/states/`, { name, color, group: "started" });
      states = list<Json>(await alex.get(`${base}/states/`));
    }
  }
  const byName = Object.fromEntries(states.map((s) => [s.name, s.id]));
  let labels = list<Json>(await alex.get(`${base}/labels/`));
  for (const [name, color] of [
    ["Bug", "#DC2626"],
    ["Feature", "#2563EB"],
    ["Design", "#9333EA"],
    ["iOS", "#0F172A"],
    ["Android", "#16A34A"],
    ["Content", "#D97706"],
  ] as const) {
    if (!labels.some((l) => l.name === name)) {
      await alex.post(`${base}/labels/`, { name, color });
    }
  }
  labels = list<Json>(await alex.get(`${base}/labels/`));
  return {
    project,
    base,
    states: {
      backlog: byName["Backlog"],
      todo: byName["Todo"],
      in_progress: byName["In Progress"],
      needs_you: byName["Needs You"],
      need_review: byName["Need Review"],
      done: byName["Done"],
      cancelled: byName["Cancelled"],
    },
    labels: Object.fromEntries(labels.map((l) => [l.name, l.id])),
  };
}

const mob = await setup(mobile);
const site = await setup(web);

type Seed = {
  ctx: Ctx;
  name: string;
  html: string;
  priority: "urgent" | "high" | "medium" | "low" | "none";
  state: string;
  labels?: string[];
  assignee?: "alex" | "maya" | null;
  start?: number;
  target?: number;
  decision?: boolean;
  comments?: { by: "alex" | "maya"; html: string }[];
};

const p = (s: string) => `<p>${s}</p>`;
const mention = (who: Api, name: string) =>
  `<span data-mention-id="${who.userId}" data-mention-label="${name}">@${name}</span>`;

const seeds: Seed[] = [
  {
    ctx: mob,
    name: "Crash when opening a notification from a cold start",
    html: p("Tapping a push notification while the app is closed lands on a blank screen on iOS 18.") +
      p("Repro: force-quit, send a comment notification, tap it."),
    priority: "urgent",
    state: "in_progress",
    labels: ["Bug", "iOS"],
    assignee: "alex",
    start: -6,
    target: -2,
    comments: [
      { by: "maya", html: p(`${mention(alex, "Alex Rivera")} I can reproduce on an iPhone 15 with 18.1. The router is not ready when the deep link arrives.`) },
      { by: "alex", html: p("Found it: the link is handled before the session is restored. Fix is up for review tomorrow.") },
    ],
  },
  {
    ctx: mob,
    name: "Shorten sign-up to two screens",
    html: p("Drop the intro carousel and ask for email and workspace name only. Target: first issue created within 60 seconds."),
    priority: "high",
    state: "in_progress",
    labels: ["Feature", "Design"],
    assignee: "alex",
    start: -4,
    target: 0,
  },
  {
    ctx: mob,
    name: "Decision: ship offline mode in 1.1 or 1.2?",
    html: p("Offline reads are done. Offline writes need a conflict policy and about three more weeks.") +
      p("Option A: ship read-only offline in 1.1. Option B: hold for full offline in 1.2."),
    priority: "high",
    state: "needs_you",
    labels: ["Feature"],
    assignee: "alex",
    target: 2,
    decision: true,
    comments: [
      { by: "maya", html: p(`${mention(alex, "Alex Rivera")} I lean towards A. Read-only offline is the most requested part and it is already stable. Your call.`) },
    ],
  },
  {
    ctx: mob,
    name: "Ask for notification permission after the first assigned issue",
    html: p("Today the prompt appears at launch and 70% decline. Move it to the moment it is useful."),
    priority: "medium",
    state: "need_review",
    labels: ["Feature", "iOS"],
    assignee: "alex",
    start: -3,
    target: 1,
    comments: [
      { by: "maya", html: p("Implemented and behind a flag. Please try it with a fresh install and tell me if the wording works.") },
    ],
  },
  {
    ctx: mob,
    name: "Android back button should close the filter sheet first",
    html: p("Back currently leaves the project screen even while the filter sheet is open."),
    priority: "high",
    state: "need_review",
    labels: ["Bug", "Android"],
    assignee: "alex",
    target: 3,
  },
  {
    ctx: mob,
    name: "Improve contrast of metadata text in dark mode",
    html: p("State and date chips fall below 4.5:1 on the dark theme."),
    priority: "medium",
    state: "todo",
    labels: ["Design"],
    assignee: "alex",
    target: 5,
  },
  {
    ctx: mob,
    name: "Attachment previews on the issue screen",
    html: p("Show image thumbnails inline and open files in the system viewer."),
    priority: "medium",
    state: "todo",
    labels: ["Feature"],
    assignee: "maya",
    start: -1,
    target: 6,
  },
  {
    ctx: mob,
    name: "Pull to refresh on Today",
    html: p("Swipe down to reload the Today list."),
    priority: "low",
    state: "done",
    labels: ["Feature"],
    assignee: "alex",
    start: -10,
    target: -7,
  },
  {
    ctx: mob,
    name: "Localise date formats",
    html: p("Use the device locale for relative and absolute dates."),
    priority: "low",
    state: "backlog",
    labels: ["Feature"],
    assignee: "maya",
  },
  {
    ctx: site,
    name: "Review pricing page copy before the launch email",
    html: p("The launch email links to /pricing on Thursday. Check headlines, plan names and the FAQ wording."),
    priority: "high",
    state: "needs_you",
    labels: ["Content"],
    assignee: "alex",
    target: 0,
    comments: [
      { by: "maya", html: p(`${mention(alex, "Alex Rivera")} draft is in the doc. I need your sign-off on the plan names before I publish.`) },
    ],
  },
  {
    ctx: site,
    name: "Compress hero images to fix slow loading on mobile",
    html: p("Largest Contentful Paint is 4.1 s on a mid-range phone. Serve WebP and size images per breakpoint."),
    priority: "high",
    state: "todo",
    labels: ["Bug"],
    assignee: "alex",
    start: -5,
    target: -1,
  },
  {
    ctx: site,
    name: "Add a public changelog page",
    html: p("One page, newest first, with an RSS feed."),
    priority: "medium",
    state: "in_progress",
    labels: ["Feature", "Content"],
    assignee: "alex",
    start: -3,
    target: 3,
  },
  {
    ctx: site,
    name: "Decision: move the docs to a subdomain?",
    html: p("docs.acme-mobile.example would give the docs their own search and analytics, at the cost of a redirect for old links."),
    priority: "medium",
    state: "needs_you",
    labels: ["Content"],
    assignee: "alex",
    target: 5,
    decision: true,
  },
  {
    ctx: site,
    name: "Fix broken anchor link on the privacy page",
    html: p("The table of contents link for account deletion jumped to the top of the page."),
    priority: "low",
    state: "done",
    labels: ["Bug"],
    assignee: "maya",
    start: -8,
    target: -6,
  },
  {
    ctx: site,
    name: "Refresh the social preview image",
    html: p("Use the new brand colours."),
    priority: "low",
    state: "backlog",
    labels: ["Design", "Content"],
    assignee: null,
  },
  {
    ctx: site,
    name: "Write the release notes for 1.0.3",
    html: p("Three user-facing changes and one fix. Keep it under 120 words."),
    priority: "medium",
    state: "todo",
    labels: ["Content"],
    assignee: "alex",
    target: 4,
  },
];

const who = { alex, maya };
const existingByProject = new Map<string, Json[]>();
async function issuesOf(ctx: Ctx) {
  if (!existingByProject.has(ctx.project.id)) {
    existingByProject.set(
      ctx.project.id,
      list<Json>(await alex.get(`${ctx.base}/issues/?limit=200`)),
    );
  }
  return existingByProject.get(ctx.project.id)!;
}

for (const s of seeds) {
  const existing = (await issuesOf(s.ctx)).find((i) => i.name === s.name);
  const assignee = s.assignee ? who[s.assignee].userId : undefined;
  const body = {
    name: s.name,
    description_html: s.html,
    priority: s.priority,
    state_id: s.ctx.states[s.state],
    label_ids: (s.labels ?? []).map((n) => s.ctx.labels[n]).filter(Boolean),
    assignee_ids: assignee ? [assignee] : [],
    start_date: s.start === undefined ? undefined : day(s.start),
    target_date: s.target === undefined ? undefined : day(s.target),
    is_decision: s.decision ?? false,
  };
  if (existing) {
    // Re-run: move the relative dates to today and restore state + assignee.
    await alex.patch(`${s.ctx.base}/issues/${existing.id}`, {
      start_date: body.start_date ?? null,
      target_date: body.target_date ?? null,
      assignee_ids: body.assignee_ids,
      state_id: body.state_id,
    });
  } else {
    const issue = await alex.post(`${s.ctx.base}/issues/`, body);
    console.log(`created ${s.ctx.project.identifier}: ${s.name}`);
    // Comments come from the teammate so the review user's inbox has entries.
    for (const c of s.comments ?? []) {
      await who[c.by].post(`${s.ctx.base}/issues/${issue.id}/comments/`, { comment_html: c.html });
    }
  }
}

// A module and a saved view on Mobile App.
const modules = list<Json>(await alex.get(`${mob.base}/modules/`));
let release = modules.find((m) => m.name === "Release 1.1");
if (!release) {
  release = await alex.post(`${mob.base}/modules/`, {
    name: "Release 1.1",
    description: "Scope for the 1.1 store release.",
    status: "in-progress",
    start_date: day(-14),
    target_date: day(14),
    lead_id: alex.userId,
  });
}
const mobIssues = list<Json>(await alex.get(`${mob.base}/issues/?limit=200`));
for (const name of [
  "Crash when opening a notification from a cold start",
  "Shorten sign-up to two screens",
  "Ask for notification permission after the first assigned issue",
  "Android back button should close the filter sheet first",
]) {
  const issue = mobIssues.find((i) => i.name === name);
  if (issue) {
    await alex.req("POST", `${mob.base}/modules/${release.id}/issues`, { issue_id: issue.id }, [409]);
  }
}

const views = list<Json>(await alex.get(`${mob.base}/views/`));
if (!views.some((v) => v.name === "Mine, by due date")) {
  await alex.post(`${mob.base}/views/`, {
    name: "Mine, by due date",
    query: {
      view: "list",
      group: "state",
      sort: { field: "target_date", dir: "asc" },
      q: "",
      state: [],
      done: "hide",
      priority: [],
      assignee: ["me"],
      label: [],
      product: [],
      module: [],
      due: "any",
      decision: false,
      target_from: "",
      target_to: "",
      start_from: "",
      start_to: "",
    },
  });
}

console.log("done");
