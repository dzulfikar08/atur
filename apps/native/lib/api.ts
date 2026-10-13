import { SERVER_URL } from "@/lib/config";
import { endSession, getToken } from "@/lib/session";

// Wire shapes mirror apps/app/src/client/lib/api.ts. The worker snake_cases
// every response key (middleware/snakecase.ts).

export type Priority = "urgent" | "high" | "medium" | "low" | "none";
export type StateGroup = "triage" | "backlog" | "unstarted" | "started" | "completed" | "cancelled";

export interface UserRef {
  id: string;
  email?: string | null;
  username?: string | null;
  display_name?: string | null;
  avatar?: string | null;
}

export interface Me {
  id: string;
  email: string;
  username: string;
  display_name: string | null;
  avatar: string | null;
  workspaces: Workspace[];
}

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  logo?: string | null;
}

export interface Project {
  id: string;
  name: string;
  slug: string;
  identifier?: string | null;
  emoji?: string | null;
  is_pipeline?: number;
  workspace_id: string;
  workspace_slug: string;
  workspace_name: string;
}

export interface State {
  id: string;
  name: string;
  group: StateGroup;
  sequence: number;
  color?: string | null;
}

export interface Label {
  id: string;
  name: string;
  color?: string | null;
}

export interface Issue {
  id: string;
  name: string;
  sequence_id: number;
  state_id: string | null;
  priority: Priority | null;
  description_html: string | null;
  created_at: string;
  updated_at: string;
  project_id: string;
  workspace_id: string;
  parent_id: string | null;
  start_date: string | null;
  target_date: string | null;
  completed_at: string | null;
  is_decision?: boolean | number;
  state?: { id: string; name: string; color?: string | null; group: StateGroup } | null;
  labels?: Label[];
  assignees?: UserRef[];
  // Present on cross-workspace /api/me/issues rows.
  project_name?: string;
  project_identifier?: string | null;
  workspace_slug?: string;
  workspace_name?: string;
}

export interface DecisionItem {
  id: string;
  name: string;
  sequence_id: number;
  priority: Priority | null;
  target_date: string | null;
  updated_at: string | null;
  project_id: string;
  project_name: string;
  project_identifier: string;
  workspace_slug: string;
  workspace_name: string;
  state_name: string | null;
  state_color: string | null;
}

export interface Comment {
  id: string;
  comment_html: string | null;
  comment_stripped: string | null;
  created_at: string;
  actor_detail: { id: string; display_name: string | null; email: string | null } | null;
}

export interface WorkspaceMember {
  id: string;
  role: number;
  member_id: string;
  member: UserRef | null;
}

export interface Notification {
  id: string;
  title: string | null;
  entity_identifier: string | null;
  entity_name: string | null;
  message: string | null;
  read_at: string | null;
  archived_at: string | null;
  workspace_id: string;
  project_id: string | null;
  created_at: string | null;
}

export interface Paginated<T> {
  results: T[];
  total: number;
  offset: number;
  limit: number;
  next_offset: number | null;
}

export interface IssuePatch {
  name?: string;
  description_html?: string;
  priority?: Priority;
  state_id?: string;
  assignee_ids?: string[];
  label_ids?: string[];
  target_date?: string | null;
}

export interface IssueCreate extends IssuePatch {
  name: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (init.body !== undefined) headers["Content-Type"] = "application/json";

  let res: Response;
  try {
    res = await fetch(`${SERVER_URL}${path}`, {
      method: init.method ?? "GET",
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new ApiError(0, "Can't reach Atur. Check your connection.");
  }

  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!res.ok) {
    // A dead token on an authed call means the session is over everywhere.
    if (res.status === 401 && token && path.startsWith("/api/")) void endSession();
    const body = data as { error?: unknown; message?: unknown } | null;
    const message =
      typeof body?.message === "string"
        ? body.message
        : typeof body?.error === "string"
          ? body.error
          : text && text.length < 200
            ? text
            : `Request failed (${res.status})`;
    throw new ApiError(res.status, message);
  }
  return data as T;
}

const qs = (params: Record<string, string | number | undefined>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const s = search.toString();
  return s ? `?${s}` : "";
};

const issueBase = (slug: string, projectId: string) =>
  `/api/workspaces/${slug}/projects/${projectId}/issues`;

type AuthResult = { session_token: string; user: Me };

export const api = {
  signIn: (email: string, password: string) =>
    request<AuthResult>("/auth/sign-in", { method: "POST", body: { email, password } }),
  requestOtp: (email: string) =>
    request<{ dev_code?: string }>("/auth/otp/request", { method: "POST", body: { email } }),
  verifyOtp: (email: string, code: string) =>
    request<AuthResult>("/auth/otp/verify", { method: "POST", body: { email, code } }),
  exchangeNativeCode: (code: string, verifier: string) =>
    request<AuthResult>("/auth/native/exchange", { method: "POST", body: { code, verifier } }),
  signOut: () => request<{ message: string }>("/auth/sign-out", { method: "POST" }),

  me: () => request<Me>("/api/users/me"),
  projects: () => request<{ results: Project[] }>("/api/me/projects").then((r) => r.results),
  myIssues: (params: { state_key?: string; search?: string; offset?: number; limit?: number }) =>
    request<Paginated<Issue>>(`/api/me/issues${qs(params)}`),
  decisions: () => request<{ results: DecisionItem[] }>("/api/me/decisions").then((r) => r.results),

  projectIssues: (
    slug: string,
    projectId: string,
    params: { state?: string; search?: string; offset?: number; limit?: number },
  ) => request<Paginated<Issue>>(`${issueBase(slug, projectId)}/${qs(params)}`),
  issue: (slug: string, projectId: string, issueId: string) =>
    request<Issue>(`${issueBase(slug, projectId)}/${issueId}`),
  createIssue: (slug: string, projectId: string, body: IssueCreate) =>
    request<Issue>(`${issueBase(slug, projectId)}/`, { method: "POST", body }),
  updateIssue: (slug: string, projectId: string, issueId: string, body: IssuePatch) =>
    request<Issue>(`${issueBase(slug, projectId)}/${issueId}`, { method: "PATCH", body }),
  comments: (slug: string, projectId: string, issueId: string) =>
    request<Paginated<Comment>>(`${issueBase(slug, projectId)}/${issueId}/comments/?limit=100`),
  addComment: (slug: string, projectId: string, issueId: string, commentHtml: string) =>
    request<Comment>(`${issueBase(slug, projectId)}/${issueId}/comments/`, {
      method: "POST",
      body: { comment_html: commentHtml },
    }),

  states: (slug: string, projectId: string) =>
    request<{ results: State[] } | State[]>(
      `/api/workspaces/${slug}/projects/${projectId}/states/`,
    ).then((r) => (Array.isArray(r) ? r : r.results)),
  labels: (slug: string, projectId: string) =>
    request<{ results: Label[] } | Label[]>(
      `/api/workspaces/${slug}/projects/${projectId}/labels/`,
    ).then((r) => (Array.isArray(r) ? r : r.results)),
  members: (slug: string) =>
    request<{ results: WorkspaceMember[] }>(`/api/workspaces/${slug}/members/`).then(
      (r) => r.results,
    ),

  notifications: () => request<Paginated<Notification>>("/api/notifications/?limit=50"),
  unreadCount: () => request<{ count: number }>("/api/notifications/unread-count"),
  markNotificationRead: (id: string) =>
    request<{ ok: true }>(`/api/notifications/${id}`, { method: "PATCH", body: { read: true } }),
  markAllNotificationsRead: () =>
    request<{ ok: true }>("/api/notifications/mark-all-read", { method: "POST" }),
};
