import { sql, type SQL } from "drizzle-orm";
import type { DbClient } from "../db/index";

// Cross-tenant, read-only queries behind the superuser console (/api/admin).
// Nothing here is scoped to a workspace: callers MUST gate on is_superuser.
// Raw SQL because every query is a multi-table rollup the query builder would
// only make harder to read. Timestamps are ISO-8601 strings, so string
// comparison and MAX() order them correctly.

// Agent token total for an aliased time_entries row set `t`.
const TOKENS = sql.raw("COALESCE(t.input_tokens, 0) + COALESCE(t.output_tokens, 0)");
// An issue is open unless its state is in a done group. Issues with no state
// (legacy imports) count as open.
const OPEN_STATE = sql.raw("COALESCE(s.group_name, '') NOT IN ('completed', 'cancelled')");

function like(q: string): string {
  return `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

export function sinceISO(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

export type PlatformTotals = {
  users: number;
  customers: number;
  workspaces: number;
  projects: number;
  issues: number;
  open_issues: number;
  comments: number;
  pages: number;
  contacts: number;
  tickets: number;
  api_keys: number;
  human_seconds: number;
  agent_seconds: number;
  agent_tokens: number;
};

export async function totals(db: DbClient): Promise<PlatformTotals> {
  const [row] = await db.all<PlatformTotals>(sql`
    SELECT
      (SELECT COUNT(*) FROM users WHERE deleted_at IS NULL AND is_customer = 0) AS users,
      (SELECT COUNT(*) FROM users WHERE deleted_at IS NULL AND is_customer = 1) AS customers,
      (SELECT COUNT(*) FROM workspaces WHERE deleted_at IS NULL) AS workspaces,
      (SELECT COUNT(*) FROM projects WHERE deleted_at IS NULL) AS projects,
      (SELECT COUNT(*) FROM issues WHERE deleted_at IS NULL) AS issues,
      (SELECT COUNT(*) FROM issues i LEFT JOIN states s ON s.id = i.state_id
        WHERE i.deleted_at IS NULL AND ${OPEN_STATE}) AS open_issues,
      (SELECT COUNT(*) FROM issue_comments WHERE deleted_at IS NULL) AS comments,
      (SELECT COUNT(*) FROM pages WHERE deleted_at IS NULL) AS pages,
      (SELECT COUNT(*) FROM customers) AS contacts,
      (SELECT COUNT(*) FROM support_tickets) AS tickets,
      (SELECT COUNT(*) FROM api_keys WHERE deleted_at IS NULL AND is_active = 1) AS api_keys,
      (SELECT COALESCE(SUM(duration_seconds), 0) FROM time_entries
        WHERE deleted_at IS NULL AND source = 'human') AS human_seconds,
      (SELECT COALESCE(SUM(duration_seconds), 0) FROM time_entries
        WHERE deleted_at IS NULL AND source = 'agent') AS agent_seconds,
      (SELECT COALESCE(SUM(${TOKENS}), 0) FROM time_entries t
        WHERE t.deleted_at IS NULL AND t.source = 'agent') AS agent_tokens
  `);
  return row;
}

export type DailyRow = {
  day: string;
  signups: number;
  issues: number;
  comments: number;
  agent_tokens: number;
};

// One row per calendar day (UTC) from `since` to today, zero-filled.
export async function daily(db: DbClient, days: number): Promise<DailyRow[]> {
  const since = sinceISO(days - 1).slice(0, 10);
  const rows = await db.all<{ kind: string; day: string; n: number }>(sql`
    SELECT 'signups' AS kind, substr(created_at, 1, 10) AS day, COUNT(*) AS n
      FROM users WHERE created_at >= ${since} AND is_customer = 0 GROUP BY day
    UNION ALL
    SELECT 'issues', substr(created_at, 1, 10), COUNT(*)
      FROM issues WHERE created_at >= ${since} AND deleted_at IS NULL GROUP BY 2
    UNION ALL
    SELECT 'comments', substr(created_at, 1, 10), COUNT(*)
      FROM issue_comments WHERE created_at >= ${since} AND deleted_at IS NULL GROUP BY 2
    UNION ALL
    SELECT 'agent_tokens', substr(t.started_at, 1, 10), COALESCE(SUM(${TOKENS}), 0)
      FROM time_entries t
      WHERE t.started_at >= ${since} AND t.deleted_at IS NULL AND t.source = 'agent' GROUP BY 2
  `);
  const byDay = new Map<string, DailyRow>();
  for (let i = days - 1; i >= 0; i--) {
    const day = sinceISO(i).slice(0, 10);
    byDay.set(day, { day, signups: 0, issues: 0, comments: 0, agent_tokens: 0 });
  }
  for (const r of rows) {
    const bucket = byDay.get(r.day);
    if (bucket) bucket[r.kind as Exclude<keyof DailyRow, "day">] = Number(r.n);
  }
  return [...byDay.values()];
}

export type PlatformUser = {
  id: string;
  email: string;
  username: string;
  display_name: string | null;
  avatar: string | null;
  is_superuser: number;
  is_active: number;
  is_bot: number;
  is_customer: number;
  is_email_verified: number;
  created_at: string | null;
  workspaces: number;
  issues_created: number;
  comments: number;
  agent_tokens: number;
  // Latest of: session refresh (expiry minus the 24h TTL), API key use, issue
  // activity. A lower bound — sessions only re-stamp near expiry.
  last_seen_at: string | null;
};

export type UserFilter = { q?: string; type?: "team" | "customers" | "all" };

export async function listUsers(db: DbClient, filter: UserFilter): Promise<PlatformUser[]> {
  const where: SQL[] = [sql`u.deleted_at IS NULL`];
  if (filter.type !== "all")
    where.push(sql`u.is_customer = ${filter.type === "customers" ? 1 : 0}`);
  if (filter.q) {
    const pat = like(filter.q);
    where.push(
      sql`(u.email LIKE ${pat} ESCAPE '\\' OR u.display_name LIKE ${pat} ESCAPE '\\' OR u.username LIKE ${pat} ESCAPE '\\')`,
    );
  }
  const rows = await db.all<PlatformUser>(sql`
    SELECT * FROM (
      SELECT u.id, u.email, u.username, u.display_name, u.avatar, u.is_superuser, u.is_active,
        u.is_bot, u.is_customer, u.is_email_verified, u.created_at,
        (SELECT COUNT(*) FROM workspace_members m
          JOIN workspaces w ON w.id = m.workspace_id AND w.deleted_at IS NULL
          WHERE m.member_id = u.id AND m.is_active = 1 AND m.deleted_at IS NULL) AS workspaces,
        (SELECT COUNT(*) FROM issues i WHERE i.created_by_id = u.id AND i.deleted_at IS NULL) AS issues_created,
        (SELECT COUNT(*) FROM issue_comments c WHERE c.actor_id = u.id AND c.deleted_at IS NULL) AS comments,
        (SELECT COALESCE(SUM(${TOKENS}), 0) FROM time_entries t
          WHERE t.user_id = u.id AND t.deleted_at IS NULL AND t.source = 'agent') AS agent_tokens,
        MAX(
          COALESCE(strftime('%Y-%m-%dT%H:%M:%fZ', u.session_expires_at, '-1 day'), ''),
          COALESCE((SELECT MAX(k.last_used_at) FROM api_keys k WHERE k.user_id = u.id), ''),
          COALESCE((SELECT MAX(a.created_at) FROM issue_activities a WHERE a.actor_id = u.id), '')
        ) AS last_seen_at
      FROM users u
      WHERE ${sql.join(where, sql` AND `)}
    )
    ORDER BY last_seen_at DESC, created_at DESC
    LIMIT 500
  `);
  return rows.map((r) => ({ ...r, last_seen_at: r.last_seen_at || null }));
}

export async function getUser(db: DbClient, id: string) {
  const [user] = await db.all<{
    id: string;
    email: string;
    username: string;
    display_name: string | null;
    avatar: string | null;
    is_superuser: number;
    is_active: number;
    is_bot: number;
    is_customer: number;
    is_email_verified: number;
    user_timezone: string | null;
    created_at: string | null;
    session_expires_at: string | null;
  }>(sql`
    SELECT id, email, username, display_name, avatar, is_superuser, is_active, is_bot, is_customer,
      is_email_verified, user_timezone, created_at, session_expires_at
    FROM users WHERE id = ${id} AND deleted_at IS NULL
  `);
  if (!user) return null;

  const [memberships, apiKeys, agents] = await Promise.all([
    db.all<{
      workspace_id: string;
      slug: string;
      name: string;
      role: number;
      is_active: number;
      is_owner: number;
      joined_at: string | null;
    }>(sql`
      SELECT w.id AS workspace_id, w.slug, w.name, m.role, m.is_active,
        (w.owner_id = m.member_id) AS is_owner, m.created_at AS joined_at
      FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id
      WHERE m.member_id = ${id} AND m.deleted_at IS NULL AND w.deleted_at IS NULL
      ORDER BY w.name
    `),
    // Never the hash: label + usage metadata only.
    db.all<{
      id: string;
      label: string | null;
      workspace_slug: string | null;
      is_active: number;
      expires_at: string | null;
      last_used_at: string | null;
      created_at: string | null;
    }>(sql`
      SELECT k.id, k.label, w.slug AS workspace_slug, k.is_active, k.expires_at, k.last_used_at,
        k.created_at
      FROM api_keys k LEFT JOIN workspaces w ON w.id = k.workspace_id
      WHERE k.user_id = ${id} AND k.deleted_at IS NULL
      ORDER BY COALESCE(k.last_used_at, k.created_at) DESC
    `),
    agentUsage(db, { userId: id }),
  ]);
  return { user, memberships, api_keys: apiKeys, agents };
}

export type PlatformWorkspace = {
  id: string;
  slug: string;
  name: string;
  logo: string | null;
  created_at: string | null;
  strategy_verdict: string | null;
  owner_id: string;
  owner_email: string | null;
  owner_name: string | null;
  members: number;
  projects: number;
  issues: number;
  open_issues: number;
  agent_tokens: number;
  last_activity_at: string | null;
};

const WORKSPACE_COLUMNS = sql`
  w.id, w.slug, w.name, w.logo, w.created_at, w.strategy_verdict, w.owner_id,
  o.email AS owner_email, o.display_name AS owner_name,
  (SELECT COUNT(*) FROM workspace_members m
    WHERE m.workspace_id = w.id AND m.is_active = 1 AND m.deleted_at IS NULL) AS members,
  (SELECT COUNT(*) FROM projects p WHERE p.workspace_id = w.id AND p.deleted_at IS NULL) AS projects,
  (SELECT COUNT(*) FROM issues i WHERE i.workspace_id = w.id AND i.deleted_at IS NULL) AS issues,
  (SELECT COUNT(*) FROM issues i LEFT JOIN states s ON s.id = i.state_id
    WHERE i.workspace_id = w.id AND i.deleted_at IS NULL AND ${OPEN_STATE}) AS open_issues,
  (SELECT COALESCE(SUM(${TOKENS}), 0) FROM time_entries t
    WHERE t.workspace_id = w.id AND t.deleted_at IS NULL AND t.source = 'agent') AS agent_tokens,
  (SELECT MAX(i.updated_at) FROM issues i WHERE i.workspace_id = w.id) AS last_activity_at
`;

export async function listWorkspaces(
  db: DbClient,
  filter: { q?: string },
): Promise<PlatformWorkspace[]> {
  const pat = filter.q ? like(filter.q) : null;
  return db.all<PlatformWorkspace>(sql`
    SELECT ${WORKSPACE_COLUMNS}
    FROM workspaces w LEFT JOIN users o ON o.id = w.owner_id
    WHERE w.deleted_at IS NULL
      ${pat ? sql`AND (w.name LIKE ${pat} ESCAPE '\\' OR w.slug LIKE ${pat} ESCAPE '\\')` : sql``}
    ORDER BY last_activity_at DESC NULLS LAST, w.created_at DESC
    LIMIT 500
  `);
}

export async function getWorkspace(db: DbClient, slug: string) {
  const [workspace] = await db.all<PlatformWorkspace>(sql`
    SELECT ${WORKSPACE_COLUMNS}
    FROM workspaces w LEFT JOIN users o ON o.id = w.owner_id
    WHERE w.slug = ${slug} AND w.deleted_at IS NULL
  `);
  if (!workspace) return null;
  const wid = workspace.id;

  const [members, projects, issues, agents] = await Promise.all([
    db.all<{
      id: string;
      email: string;
      display_name: string | null;
      avatar: string | null;
      role: number;
      is_active: number;
      joined_at: string | null;
    }>(sql`
      SELECT u.id, u.email, u.display_name, u.avatar, m.role, m.is_active, m.created_at AS joined_at
      FROM workspace_members m JOIN users u ON u.id = m.member_id
      WHERE m.workspace_id = ${wid} AND m.deleted_at IS NULL
      ORDER BY m.role DESC, u.email
    `),
    db.all<{
      id: string;
      name: string;
      identifier: string;
      is_pipeline: number;
      archived_at: string | null;
      issues: number;
      open_issues: number;
      last_activity_at: string | null;
    }>(sql`
      SELECT p.id, p.name, p.identifier, p.is_pipeline, p.archived_at,
        COUNT(i.id) AS issues,
        COALESCE(SUM(CASE WHEN i.id IS NOT NULL AND ${OPEN_STATE} THEN 1 ELSE 0 END), 0) AS open_issues,
        MAX(i.updated_at) AS last_activity_at
      FROM projects p
      LEFT JOIN issues i ON i.project_id = p.id AND i.deleted_at IS NULL
      LEFT JOIN states s ON s.id = i.state_id
      WHERE p.workspace_id = ${wid} AND p.deleted_at IS NULL
      GROUP BY p.id
      ORDER BY last_activity_at DESC NULLS LAST
    `),
    db.all<{
      id: string;
      name: string;
      sequence_id: number;
      priority: string | null;
      project_id: string;
      project_identifier: string;
      state_name: string | null;
      state_group: string | null;
      updated_at: string | null;
    }>(sql`
      SELECT i.id, i.name, i.sequence_id, i.priority, p.id AS project_id,
        p.identifier AS project_identifier, s.name AS state_name, s.group_name AS state_group,
        i.updated_at
      FROM issues i
      JOIN projects p ON p.id = i.project_id
      LEFT JOIN states s ON s.id = i.state_id
      WHERE i.workspace_id = ${wid} AND i.deleted_at IS NULL
      ORDER BY i.updated_at DESC
      LIMIT 25
    `),
    agentUsage(db, { workspaceId: wid }),
  ]);
  return { workspace, members, projects, recent_issues: issues, agents };
}

export type FeedItem = {
  kind: "issue" | "comment" | "activity" | "time";
  id: string;
  at: string;
  actor_id: string | null;
  actor_email: string | null;
  actor_name: string | null;
  issue_id: string;
  issue_name: string;
  sequence_id: number;
  project_id: string;
  project_identifier: string;
  workspace_slug: string;
  workspace_name: string;
  // issue: priority / comment: text snippet (raw HTML when the comment has no
  // stripped text; render as text only) / activity: field / time: agent name.
  detail: string | null;
  // comment: access / activity: new value / time: model.
  extra: string | null;
  // time: duration seconds; tokens for agent entries.
  seconds: number | null;
  tokens: number | null;
};

export type FeedFilter = { before?: string; workspace?: string; actorId?: string; limit: number };

// Cross-workspace feed: issues created, comments, field changes, and time
// entries (agent runs) merged newest first. Cursor = `at` of the last item.
export async function feed(db: DbClient, f: FeedFilter): Promise<FeedItem[]> {
  const cond = (at: SQL, actor: SQL) => {
    const parts: SQL[] = [];
    if (f.before) parts.push(sql`${at} < ${f.before}`);
    if (f.actorId) parts.push(sql`${actor} = ${f.actorId}`);
    if (f.workspace) parts.push(sql`w.slug = ${f.workspace}`);
    return parts.length ? sql` AND ${sql.join(parts, sql` AND `)}` : sql``;
  };
  const joins = sql`
    JOIN projects p ON p.id = i.project_id
    JOIN workspaces w ON w.id = i.workspace_id AND w.deleted_at IS NULL
  `;
  return db.all<FeedItem>(sql`
    SELECT f.*, u.email AS actor_email, u.display_name AS actor_name FROM (
      SELECT 'issue' AS kind, i.id, i.created_at AS at, i.created_by_id AS actor_id,
        i.id AS issue_id, i.name AS issue_name, i.sequence_id, p.id AS project_id,
        p.identifier AS project_identifier, w.slug AS workspace_slug, w.name AS workspace_name,
        i.priority AS detail, NULL AS extra, NULL AS seconds, NULL AS tokens
      FROM issues i ${joins}
      WHERE i.deleted_at IS NULL AND i.created_at IS NOT NULL
        ${cond(sql.raw("i.created_at"), sql.raw("i.created_by_id"))}
      UNION ALL
      SELECT 'comment', c.id, c.created_at, c.actor_id, i.id, i.name, i.sequence_id, p.id,
        p.identifier, w.slug, w.name, substr(COALESCE(c.comment_stripped, c.comment_html), 1, 400),
        c.access, NULL, NULL
      FROM issue_comments c JOIN issues i ON i.id = c.issue_id ${joins}
      WHERE c.deleted_at IS NULL AND c.created_at IS NOT NULL
        ${cond(sql.raw("c.created_at"), sql.raw("c.actor_id"))}
      UNION ALL
      SELECT 'activity', a.id, a.created_at, a.actor_id, i.id, i.name, i.sequence_id, p.id,
        p.identifier, w.slug, w.name, COALESCE(a.field, a.verb), substr(a.new_value, 1, 120),
        NULL, NULL
      FROM issue_activities a JOIN issues i ON i.id = a.issue_id ${joins}
      WHERE a.deleted_at IS NULL AND a.created_at IS NOT NULL AND COALESCE(a.verb, '') <> 'created'
        ${cond(sql.raw("a.created_at"), sql.raw("a.actor_id"))}
      UNION ALL
      SELECT 'time', t.id, t.created_at, t.user_id, i.id, i.name, i.sequence_id, p.id,
        p.identifier, w.slug, w.name,
        CASE WHEN t.source = 'agent' THEN COALESCE(t.agent_name, 'agent') ELSE 'human' END,
        t.model, t.duration_seconds,
        CASE WHEN t.source = 'agent' THEN ${TOKENS} END
      FROM time_entries t JOIN issues i ON i.id = t.issue_id ${joins}
      WHERE t.deleted_at IS NULL AND t.created_at IS NOT NULL
        ${cond(sql.raw("t.created_at"), sql.raw("t.user_id"))}
    ) f
    LEFT JOIN users u ON u.id = f.actor_id
    ORDER BY f.at DESC
    LIMIT ${f.limit}
  `);
}

export type AgentUsageRow = {
  agent_name: string;
  model: string;
  workspace_slug: string;
  entries: number;
  seconds: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  total_tokens: number;
  // NULL when the model has no model_prices row — unpriced, not free.
  cost_usd: number | null;
  last_at: string | null;
};

export async function agentUsage(
  db: DbClient,
  f: { since?: string; workspaceId?: string; userId?: string },
): Promise<AgentUsageRow[]> {
  const rows = await db.all<AgentUsageRow>(sql`
    SELECT COALESCE(t.agent_name, 'unknown') AS agent_name, COALESCE(t.model, 'unknown') AS model,
      w.slug AS workspace_slug, COUNT(*) AS entries,
      COALESCE(SUM(t.duration_seconds), 0) AS seconds,
      COALESCE(SUM(t.input_tokens), 0) AS input_tokens,
      COALESCE(SUM(t.output_tokens), 0) AS output_tokens,
      COALESCE(SUM(t.cache_read_tokens), 0) AS cache_read_tokens,
      COALESCE(SUM(t.cache_write_tokens), 0) AS cache_write_tokens,
      COALESCE(SUM(${TOKENS}), 0) AS total_tokens,
      (COALESCE(SUM(t.input_tokens), 0) / 1000000.0) * mp.input_per_mtok
        + ((COALESCE(SUM(t.output_tokens), 0) + COALESCE(SUM(t.reasoning_tokens), 0)) / 1000000.0) * mp.output_per_mtok
        + (COALESCE(SUM(t.cache_read_tokens), 0) / 1000000.0) * mp.cache_read_per_mtok
        + (COALESCE(SUM(t.cache_write_tokens), 0) / 1000000.0) * mp.cache_write_per_mtok AS cost_usd,
      MAX(t.started_at) AS last_at
    FROM time_entries t
    JOIN workspaces w ON w.id = t.workspace_id
    LEFT JOIN model_prices mp ON mp.model = t.model
    WHERE t.deleted_at IS NULL AND t.source = 'agent'
      ${f.since ? sql`AND t.started_at >= ${f.since}` : sql``}
      ${f.workspaceId ? sql`AND t.workspace_id = ${f.workspaceId}` : sql``}
      ${f.userId ? sql`AND t.user_id = ${f.userId}` : sql``}
    GROUP BY 1, 2, 3
    ORDER BY total_tokens DESC
  `);
  return rows.map((r) => ({ ...r, cost_usd: r.cost_usd == null ? null : Number(r.cost_usd) }));
}
