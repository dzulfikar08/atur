// Public feedback board client. Hits the token-keyed /public/feedback/* API
// (no session/credentials). Distinct from the authed lib/api.ts.

const API_BASE = '/public/feedback';

export class FeedbackApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'FeedbackApiError';
    this.status = status;
  }
}

async function fbFetch<T>(token: string, path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}/${token}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new FeedbackApiError(res.status, text || `Request failed: ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

function emailQuery(email?: string): string {
  return email ? `?email=${encodeURIComponent(email)}` : '';
}

export interface FeedbackBoard {
  title: string;
  description: string | null;
  allow_submit: boolean;
  allow_voting: boolean;
  require_email: boolean;
  allow_comments: boolean;
  brand_color: string;
}

export interface FeedbackItemState {
  id: string;
  name: string;
  color: string | null;
  group: string | null;
}

export interface FeedbackItem {
  id: string;
  sequence_id: number;
  name: string;
  description: string | null;
  state: FeedbackItemState | null;
  votes: number;
  voted: boolean;
  comment_count: number;
  author_name: string | null;
  created_at: string | null;
}

export interface FeedbackComment {
  id: string;
  body: string | null;
  created_at: string | null;
}

export interface FeedbackItemDetail extends FeedbackItem {
  author_email: string | null;
  comments: FeedbackComment[];
}

export const feedbackApi = {
  getBoard: (token: string, email?: string) =>
    fbFetch<{ board: FeedbackBoard; items: FeedbackItem[] }>(token, `/${emailQuery(email)}`),

  getItem: (token: string, issueId: string, email?: string) =>
    fbFetch<FeedbackItemDetail>(token, `/items/${issueId}${emailQuery(email)}`),

  createItem: (token: string, data: { title: string; description?: string; email?: string; name?: string; source?: 'portal' | 'widget' }) =>
    fbFetch<{ id: string; sequence_id: number }>(token, '/items', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  vote: (token: string, issueId: string, email?: string) =>
    fbFetch<{ voted: boolean; count: number }>(token, `/items/${issueId}/votes`, {
      method: 'POST',
      body: JSON.stringify(email ? { email } : {}),
    }),

  listComments: (token: string, issueId: string) =>
    fbFetch<{ results: FeedbackComment[] }>(token, `/items/${issueId}/comments`).then(r => r.results),

  addComment: (token: string, issueId: string, body: string, email?: string) =>
    fbFetch<{ id: string }>(token, `/items/${issueId}/comments`, {
      method: 'POST',
      body: JSON.stringify(email ? { body, email } : { body }),
    }),
};
