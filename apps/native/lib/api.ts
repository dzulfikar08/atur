import { SERVER_URL } from "@/lib/config";
import { recordFailedRequest } from "@/lib/diagnostics";
import { endSession, getToken, queryClient } from "@/lib/session";

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
  /** Platform owner flag: gates desktop Screen sharing (the server enforces it too). */
  is_superuser?: boolean;
  /** Atur Cloud plan state; `entitled: false` means the app is locked for this account. */
  billing?: Billing;
  workspaces: Workspace[];
}

export interface Billing {
  plan: "solo" | "team" | null;
  status: string | null;
  entitled: boolean;
  /** False on self-hosted servers: no plan is ever required. */
  managed: boolean;
}

/** One row of GET /api/panes (herdr bridge wire format, proxied verbatim). */
export interface PaneListItem {
  pane_id: string;
  workspace_id: string;
  workspace_label: string;
  tab_id: string;
  cwd: string | null;
  agent: string | null;
  agent_status: string | null;
  title: string | null;
  revision: number;
  /** Set on panes of a customer machine (relay); absent on the dev box's own bridge. */
  machine?: PaneMachine;
  /** The Atur workspace this pane's folder is bound to (dev-box bridge panes). */
  workspace_slug?: string;
}

export interface PaneMachine {
  id: string;
  name: string;
}

export type SplitDirection = "right" | "down";

/** A herdr workspace / tmux session as `POST /api/panes/workspaces` answers it. */
export interface PaneWorkspace {
  id: string;
  label: string;
  cwd: string | null;
  pane_count: number;
  machine?: PaneMachine;
}

/** GET /api/panes/workspaces: where panes and workspaces can be created. */
export interface PaneTargets {
  workspaces: PaneWorkspace[];
  machines: PaneMachine[];
  /** Repo folders on the dev box where the caller may open a workspace. */
  roots: { path: string; label: string }[];
}

export interface CreatedPaneWorkspace {
  workspace: PaneWorkspace;
  /** The workspace's first pane; open it to land in the new workspace. */
  pane: PaneListItem;
}

/** GET /api/screen/status: desktop sharing side of the bridge. */
export interface ScreenStatus {
  available: boolean;
  running: boolean;
  viewers: number;
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
  /** Canonical workflow key (needs_you, need_review, in_progress, …). */
  key?: string | null;
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
  estimate_points?: number | null;
  is_decision?: boolean | number;
  module_ids?: string[];
  state?: {
    id: string;
    name: string;
    color?: string | null;
    group: StateGroup;
    key?: string | null;
  } | null;
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
  actor_detail: {
    id: string;
    display_name: string | null;
    email: string | null;
    avatar: string | null;
  } | null;
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

export type TodayBucketKey =
  | "overdue"
  | "due_today"
  | "needs_you"
  | "need_review"
  | "in_progress"
  | "due_this_week";

/** GET /api/me/today: each open issue lands in exactly one bucket. */
export type TodayResponse = Record<TodayBucketKey, Issue[]> & {
  counts: Record<TodayBucketKey | "total", number>;
};

export interface AnalyticsOverview {
  total_issues: number;
  open_issues: number;
  closed_issues: number;
  overdue_issues: number;
}

export interface IssueActivity {
  id: string;
  verb: string | null;
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  actor_id: string | null;
  actor_name: string | null;
  actor_email: string | null;
  created_at: string | null;
}

export interface IssueRelation {
  id: string;
  issue_id: string;
  related_issue_id: string;
  relation_type: string;
}

export interface IssueSubscriber {
  id: string;
  subscriber_id: string;
  user: UserRef | null;
}

export interface ProjectModule {
  id: string;
  name: string;
  status?: string | null;
}

/** A saved view the web stored in workspace_members.view_props (per user + project). */
export interface SavedViewRow {
  id: string;
  name: string;
  /** The web's IssueQuery, verbatim; normalize before use. */
  query: unknown;
}

/** One file on an issue (GET .../issues/:id/attachments/). */
export interface IssueAttachment {
  id: string;
  issue_id: string;
  asset: string | null;
  /** Path like /api/assets/<uuid>, or an absolute URL; load the file from it. */
  url: string | null;
  attributes: { name?: string; size?: number; type?: string } | null;
  created_at: string;
}

/**
 * GET .../issues/:id/?include=… — the issue plus its project (breadcrumb) and,
 * when requested, every sub-resource the detail screen shows, in one request.
 */
export interface IssueDetail extends Issue {
  project_detail: { id: string; name: string; identifier: string };
  included?: {
    comments: Paginated<Comment>;
    activities: { results: IssueActivity[] };
    relations: { results: IssueRelation[] };
    sub_issues: { results: Issue[] };
    subscribers: { results: IssueSubscriber[] };
    modules: { results: ProjectModule[] };
    custom_values: unknown[];
    /** Names for the parent issue and every related issue, in one lookup. */
    related_issues: { id: string; name: string; sequence_id: number }[];
    counts: { attachments: number; time_seconds: number };
  };
}

export interface IssuePatch {
  name?: string;
  description_html?: string;
  priority?: Priority;
  state_id?: string;
  assignee_ids?: string[];
  label_ids?: string[];
  start_date?: string | null;
  target_date?: string | null;
  estimate_points?: number | null;
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

export async function request<T>(
  path: string,
  init: {
    method?: string;
    body?: unknown;
    raw?: { data: ArrayBuffer; type: string };
    /** Multipart body; fetch sets the boundary Content-Type itself. */
    form?: FormData;
  } = {},
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    Accept: "application/json",
    "X-Atur-Client": "native",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (init.raw) headers["Content-Type"] = init.raw.type;
  else if (init.body !== undefined && !init.form) headers["Content-Type"] = "application/json";

  let res: Response;
  try {
    res = await fetch(`${SERVER_URL}${path}`, {
      method: init.method ?? "GET",
      headers,
      body: init.form
        ? init.form
        : init.raw
          ? init.raw.data
          : init.body === undefined
            ? undefined
            : JSON.stringify(init.body),
    });
  } catch {
    recordFailedRequest(init.method ?? "GET", path, 0);
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
    recordFailedRequest(init.method ?? "GET", path, res.status);
    // A dead token on an authed call means the session is over everywhere.
    if (res.status === 401 && token && path.startsWith("/api/")) void endSession();
    // The plan lapsed (or never existed): re-read `me` so the root layout shows the gate.
    const code = (data as { error?: unknown } | null)?.error;
    if (res.status === 402 && code === "plan_required") {
      void queryClient.invalidateQueries({ queryKey: ["me"] });
    }
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

/**
 * Request source (`{ uri, headers }`) for an Atur URL, for images, video, PDFs
 * and downloads alike. Uploads live at /api/assets/<id> and are auth-checked,
 * so same-origin URLs carry the bearer token; relative paths (how the web
 * editor stores them) resolve against the server.
 */
export function assetSource(url: string): { uri: string; headers?: Record<string, string> } {
  const uri = url.startsWith("/") ? `${SERVER_URL}${url}` : url;
  const token = getToken();
  // `${SERVER_URL}/`: a bare prefix would also match https://app.diatur.com.evil.test.
  return token && uri.startsWith(`${SERVER_URL}/`)
    ? { uri, headers: { Authorization: `Bearer ${token}` } }
    : { uri };
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

// The server caps a project issue page at 500 and /api/me/issues at 100.
const ISSUE_PAGE = 500;
const ME_PAGE = 100;

// Everything the issue detail screen shows, bundled into one GET (see
// worker/services/issueDetail.ts).
const ISSUE_INCLUDES = "comments,activities,relations,sub_issues,subscribers,modules,custom_values";

/** First page, then every remaining page in parallel (no waterfall). */
async function allPages<T>(path: (offset: number) => string): Promise<T[]> {
  const first = await request<Paginated<T>>(path(0));
  if (first.next_offset === null) return first.results;
  const offsets: number[] = [];
  for (let o = first.next_offset; o < first.total; o += first.limit) offsets.push(o);
  const rest = await Promise.all(offsets.map((o) => request<Paginated<T>>(path(o))));
  return first.results.concat(...rest.map((p) => p.results));
}

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
  panes: () => request<{ panes: PaneListItem[] }>("/api/panes").then((r) => r.panes),
  /** What the caller can target when managing panes (see PaneTargets). */
  paneTargets: () => request<PaneTargets>("/api/panes/workspaces"),
  /** Split a pane; the new pane starts in the source pane's cwd. */
  splitPane: (paneId: string, direction: SplitDirection) =>
    request<{ pane: PaneListItem }>("/api/panes/split", {
      method: "POST",
      body: { pane: paneId, direction },
    }).then((r) => r.pane),
  /** Close a pane; whatever runs in it stops. */
  closePane: (paneId: string) =>
    request<null>("/api/panes/close", { method: "POST", body: { pane: paneId } }),
  /** Open a workspace at `cwd` on the dev box (no machine_id) or on one of the caller's machines. */
  createPaneWorkspace: (body: { cwd: string; label?: string; machine_id?: string }) =>
    request<CreatedPaneWorkspace>("/api/panes/workspaces", {
      method: "POST",
      body,
    }),
  screenStatus: () => request<ScreenStatus>("/api/screen/status"),
  /** Save an image on the pane's machine; returns the path to put in the prompt. */
  panePasteImage: (paneId: string, image: ArrayBuffer, type: string) =>
    request<{ path: string; bytes: number }>(
      `/api/panes/paste?pane=${encodeURIComponent(paneId)}`,
      {
        method: "POST",
        raw: { data: image, type },
      },
    ),
  /** Put a PNG on the desktop's clipboard (the Screen view then presses Ctrl+V). */
  screenClipboardImage: (png: ArrayBuffer) =>
    request<{ ok: true }>("/api/screen/clipboard", {
      method: "POST",
      raw: { data: png, type: "image/png" },
    }),
  /** One-time ticket (≤60s, single use) for the screen WebView's WebSocket. */
  screenTicket: () =>
    request<{ ticket: string; expires_at: number }>("/api/ws-tickets", {
      method: "POST",
      body: { scope: "screen" },
    }),
  /**
   * Direct (tailnet) path to the bridge: a wss:// URL plus a one-time ticket
   * minted by the Worker. 404 when the bridge has no direct listener.
   */
  screenDirect: () =>
    request<{ url: string; ticket: string; expires_at: number }>("/api/screen/direct", {
      method: "POST",
    }),
  projects: () => request<{ results: Project[] }>("/api/me/projects").then((r) => r.results),
  /** Every issue visible to me (cross-workspace), walked page by page like the web's listAllIssues. */
  allMyIssues: (workspace?: string) =>
    allPages<Issue>((offset) => `/api/me/issues${qs({ workspace, offset, limit: ME_PAGE })}`),
  /** Issue search, same call as the web Cmd+K palette (GET /api/me/issues?q=). */
  searchIssues: (q: string, workspace?: string, limit = 25) =>
    request<Paginated<Issue>>(
      `/api/me/issues${qs({ q, limit, sort: "updated_at:desc", workspace })}`,
    ).then((r) => r.results),
  /** The Today buckets; `today` is the device's local date (the server buckets by it). */
  today: (today: string, workspace?: string) =>
    request<TodayResponse>(`/api/me/today${qs({ today, workspace })}`),
  analyticsOverview: (slug: string | undefined) =>
    request<AnalyticsOverview>(
      slug ? `/api/workspaces/${slug}/analytics/overview` : "/api/me/analytics/overview",
    ),
  decisions: () => request<{ results: DecisionItem[] }>("/api/me/decisions").then((r) => r.results),

  /** The project's whole issue set (lean rows, 500 per page, remaining pages in parallel). */
  projectIssues: (slug: string, projectId: string) =>
    allPages<Issue>(
      (offset) => `${issueBase(slug, projectId)}/${qs({ offset, limit: ISSUE_PAGE })}`,
    ),
  /** One-request detail: the issue plus every sub-resource the screen shows. */
  issue: (slug: string, projectId: string, issueId: string) =>
    request<IssueDetail>(
      `${issueBase(slug, projectId)}/${issueId}/${qs({ include: ISSUE_INCLUDES })}`,
    ),
  attachments: (slug: string, projectId: string, issueId: string) =>
    request<{ results: IssueAttachment[] }>(
      `${issueBase(slug, projectId)}/${issueId}/attachments/`,
    ).then((r) => r.results),
  modules: (slug: string, projectId: string) =>
    request<Paginated<ProjectModule>>(
      `/api/workspaces/${slug}/projects/${projectId}/modules/?limit=100`,
    ).then((r) => r.results),
  addIssueModule: (slug: string, projectId: string, issueId: string, moduleId: string) =>
    request<{ ok: true }>(`${issueBase(slug, projectId)}/${issueId}/modules`, {
      method: "POST",
      body: { module_id: moduleId },
    }),
  removeIssueModule: (slug: string, projectId: string, issueId: string, moduleId: string) =>
    request<null>(`${issueBase(slug, projectId)}/${issueId}/modules/${moduleId}`, {
      method: "DELETE",
    }),
  followIssue: (slug: string, projectId: string, issueId: string) =>
    request<unknown>(`${issueBase(slug, projectId)}/${issueId}/subscribers/`, { method: "POST" }),
  unfollowIssue: (slug: string, projectId: string, issueId: string) =>
    request<unknown>(`${issueBase(slug, projectId)}/${issueId}/subscribers/`, {
      method: "DELETE",
    }),
  views: (slug: string, projectId: string) =>
    request<{ results: SavedViewRow[] }>(
      `/api/workspaces/${slug}/projects/${projectId}/views/`,
    ).then((r) => r.results),
  saveView: (slug: string, projectId: string, name: string, query: unknown) =>
    request<SavedViewRow>(`/api/workspaces/${slug}/projects/${projectId}/views/`, {
      method: "POST",
      body: { name, query },
    }),
  deleteView: (slug: string, projectId: string, viewId: string) =>
    request<null>(`/api/workspaces/${slug}/projects/${projectId}/views/${viewId}`, {
      method: "DELETE",
    }),
  createIssue: (slug: string, projectId: string, body: IssueCreate) =>
    request<Issue>(`${issueBase(slug, projectId)}/`, { method: "POST", body }),
  updateIssue: (slug: string, projectId: string, issueId: string, body: IssuePatch) =>
    request<Issue>(`${issueBase(slug, projectId)}/${issueId}`, { method: "PATCH", body }),
  /**
   * Upload a local file (file:// URI) as an Atur asset. Returns the
   * auth-checked `/api/assets/<id>` path the web editor embeds as <img src>.
   */
  uploadAsset: (file: { uri: string; name: string; type: string }) => {
    const form = new FormData();
    // React Native's FormData streams a { uri, name, type } part from disk.
    form.append("file", file as unknown as Blob);
    return request<{ id: string; url: string; size: number }>("/api/assets/upload/", {
      method: "POST",
      form,
    });
  },
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

  /** Register this device for agent alerts (upsert by token; reassigns it to the caller). */
  registerPushToken: (token: string, platform: "ios" | "android") =>
    request<{ ok: true }>("/api/me/push-tokens", { method: "PUT", body: { token, platform } }),
  /** Idempotent: removes only the caller's row for this token. */
  unregisterPushToken: (token: string) =>
    request<{ ok: true }>("/api/me/push-tokens", { method: "DELETE", body: { token } }),
};
