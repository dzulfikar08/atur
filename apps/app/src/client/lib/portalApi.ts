import { ApiError } from "@/lib/api";
export { ApiError };

const PREFIX = "/portal";

export interface PortalCustomer {
  id: string;
  workspace_id: string;
  user_id: string;
  email: string;
  display_name: string | null;
}

export interface TicketSummary {
  id: string;
  issue_id: string;
  sequence_id: number;
  project_id: string;
  name: string;
  priority: string | null;
  state_id: string | null;
  state_name: string | null;
  state_color: string | null;
  state_group: string | null;
  created_at: string | null;
  updated_at: string | null;
  completed_at: string | null;
}

export interface PortalComment {
  id: string;
  comment_html: string | null;
  created_at: string | null;
  actor_id: string;
  actor_name: string | null;
  actor_email: string | null;
  is_customer: number;
}

export interface PortalAssignee {
  id: string;
  email: string;
  username: string;
  display_name: string | null;
  avatar: string | null;
}
export interface PortalActivity {
  id: string;
  verb: string | null;
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  issue_comment_id: string | null;
  actor_id: string | null;
  actor_name: string | null;
  actor_email: string | null;
  is_customer: number | null;
  created_at: string | null;
}

export interface TicketDetail {
  ticket: TicketSummary;
  issue: {
    id: string;
    name: string;
    sequence_id: number;
    description_html: string | null;
    priority: string | null;
  };
  assignees: PortalAssignee[];
  comments: PortalComment[];
  activities: PortalActivity[];
}

async function portalFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${PREFIX}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new ApiError(res.status, text || `Portal error: ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

// Sequence ids are per project; tickets filed through the widget live in the
// feedback board's project, so detail calls carry it.
function projectQuery(projectId?: string | null): string {
  return projectId ? `?project=${encodeURIComponent(projectId)}` : "";
}

export interface PortalBoard {
  token: string;
  title: string;
  description: string | null;
  brand_color: string;
  allow_submit: boolean;
  project_id: string;
}

export interface PortalOverview {
  workspace: { name: string; slug: string };
  boards: PortalBoard[];
  support_enabled: boolean;
}

export interface ChangelogEntry {
  id: string;
  sequence_id: number;
  name: string;
  description: string | null;
  completed_at: string | null;
  votes: number;
  board_title: string | null;
  board_token: string | null;
}

export interface MyIdea {
  id: string;
  sequence_id: number;
  name: string;
  created_at: string | null;
  state_name: string | null;
  state_color: string | null;
  board_token: string | null;
  board_title: string | null;
}

export interface PortalMine {
  ideas: MyIdea[];
  tickets: TicketSummary[];
}

export interface RequestOtpResult {
  ok: true;
  dev_code?: string;
}

export const portalApi = {
  requestOtp: (slug: string, email: string, name?: string) =>
    portalFetch<RequestOtpResult>(`/${slug}/auth/request-otp`, {
      method: "POST",
      body: JSON.stringify({ email, name }),
    }),

  verifyOtp: (slug: string, email: string, code: string) =>
    portalFetch<{ customer: PortalCustomer }>(`/${slug}/auth/verify-otp`, {
      method: "POST",
      body: JSON.stringify({ email, code }),
    }),

  signOut: (slug: string) =>
    portalFetch<{ ok: true }>(`/${slug}/auth/sign-out`, { method: "POST" }),

  getMe: (slug: string) => portalFetch<{ customer: PortalCustomer }>(`/${slug}/auth/me`),

  listTickets: async (slug: string) => {
    const data = await portalFetch<{ results: TicketSummary[] }>(`/${slug}/tickets?limit=100`);
    return data.results;
  },

  getTicket: (slug: string, seqId: number, projectId?: string | null) =>
    portalFetch<TicketDetail>(`/${slug}/tickets/${seqId}${projectQuery(projectId)}`),

  updateTicket: (
    slug: string,
    seqId: number,
    data: { name?: string; description_html?: string; priority?: string },
    projectId?: string | null,
  ) =>
    portalFetch<TicketDetail>(`/${slug}/tickets/${seqId}${projectQuery(projectId)}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  createTicket: (
    slug: string,
    data: { name: string; description_html?: string; priority?: string },
  ) =>
    portalFetch<TicketDetail["issue"]>(`/${slug}/tickets`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  addComment: (slug: string, seqId: number, comment_html: string, projectId?: string | null) =>
    portalFetch<PortalComment>(`/${slug}/tickets/${seqId}/comments${projectQuery(projectId)}`, {
      method: "POST",
      body: JSON.stringify({ comment_html }),
    }),

  getOverview: (slug: string) => portalFetch<PortalOverview>(`/${slug}/overview`),

  getChangelog: (slug: string) =>
    portalFetch<{ results: ChangelogEntry[] }>(`/${slug}/changelog`).then((r) => r.results),

  getMine: (slug: string) => portalFetch<PortalMine>(`/${slug}/mine`),
};
