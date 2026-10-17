import { apiFetch } from "./api";

// Superuser console client (/api/admin). Every endpoint 403s for non-superusers.
// Shapes mirror worker/repositories/platform.ts.

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

export type DailyRow = {
  day: string;
  signups: number;
  issues: number;
  comments: number;
  agent_tokens: number;
};

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
  last_seen_at: string | null;
};

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
  cost_usd: number | null;
  last_at: string | null;
};

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
  detail: string | null;
  extra: string | null;
  seconds: number | null;
  tokens: number | null;
};

export type PlatformUserDetail = {
  user: {
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
  };
  memberships: {
    workspace_id: string;
    slug: string;
    name: string;
    role: number;
    is_active: number;
    is_owner: number;
    joined_at: string | null;
  }[];
  api_keys: {
    id: string;
    label: string | null;
    workspace_slug: string | null;
    is_active: number;
    expires_at: string | null;
    last_used_at: string | null;
    created_at: string | null;
  }[];
  agents: AgentUsageRow[];
};

export type PlatformWorkspaceDetail = {
  workspace: PlatformWorkspace;
  members: {
    id: string;
    email: string;
    display_name: string | null;
    avatar: string | null;
    role: number;
    is_active: number;
    joined_at: string | null;
  }[];
  projects: {
    id: string;
    name: string;
    identifier: string;
    is_pipeline: number;
    archived_at: string | null;
    issues: number;
    open_issues: number;
    last_activity_at: string | null;
  }[];
  recent_issues: {
    id: string;
    name: string;
    sequence_id: number;
    priority: string | null;
    project_id: string;
    project_identifier: string;
    state_name: string | null;
    state_group: string | null;
    updated_at: string | null;
  }[];
  agents: AgentUsageRow[];
};

export type FeedPage = { results: FeedItem[]; next_before: string | null };

function query(params: Record<string, string | undefined>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
  const s = qs.toString();
  return s ? `?${s}` : "";
}

export const platformApi = {
  me: () => apiFetch<{ id: string; email: string; display_name: string | null }>("/admin/me"),
  overview: (days: string) =>
    apiFetch<{ totals: PlatformTotals; daily: DailyRow[] }>(`/admin/overview${query({ days })}`),
  users: (q: string, type: string) =>
    apiFetch<{ results: PlatformUser[] }>(`/admin/users${query({ q, type })}`).then(
      (d) => d.results,
    ),
  user: (id: string) => apiFetch<PlatformUserDetail>(`/admin/users/${encodeURIComponent(id)}`),
  workspaces: (q: string) =>
    apiFetch<{ results: PlatformWorkspace[] }>(`/admin/workspaces${query({ q })}`).then(
      (d) => d.results,
    ),
  workspace: (slug: string) =>
    apiFetch<PlatformWorkspaceDetail>(`/admin/workspaces/${encodeURIComponent(slug)}`),
  feed: (f: { before?: string; workspace?: string; actor?: string }) =>
    apiFetch<FeedPage>(`/admin/feed${query(f)}`),
  agents: (days: string) =>
    apiFetch<{ results: AgentUsageRow[] }>(`/admin/agents${query({ days })}`).then(
      (d) => d.results,
    ),
};
