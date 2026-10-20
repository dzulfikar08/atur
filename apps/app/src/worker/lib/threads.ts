import { HTTPException } from "hono/http-exception";

// Threads Graph API client (https://developers.facebook.com/docs/threads).
// Only the calls the CRM inbox needs: OAuth, token refresh, reading replies
// and mentions, publishing a reply, hiding a reply. There is no DM API.

const GRAPH = "https://graph.threads.net";
const API = `${GRAPH}/v1.0`;

// threads_content_publish publishes our replies; read/manage_replies covers the
// replies on our posts; manage_mentions covers posts that tag us.
export const THREADS_SCOPES = [
  "threads_basic",
  "threads_content_publish",
  "threads_read_replies",
  "threads_manage_replies",
  "threads_manage_mentions",
];

// A Graph failure (expired token, permission still in App Review) is a bad
// gateway for our caller, with Meta's reason in the message.
export class ThreadsApiError extends HTTPException {
  constructor(
    readonly graphMessage: string,
    readonly code: number | null,
  ) {
    super(502, { message: `Threads: ${graphMessage}` });
    this.name = "ThreadsApiError";
  }
}

export interface ThreadsToken {
  accessToken: string;
  expiresIn: number;
}

// A post as returned by the mentions and conversation edges.
export interface ThreadsPost {
  id: string;
  text?: string;
  username?: string;
  permalink?: string;
  timestamp: string;
  replied_to?: { id: string };
  root_post?: { id: string };
  is_reply_owned_by_me?: boolean;
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = (await res.json().catch(() => null)) as {
    error?: { message?: string; code?: number };
  } | null;
  if (!res.ok || body?.error) {
    throw new ThreadsApiError(
      body?.error?.message ?? `HTTP ${res.status}`,
      body?.error?.code ?? null,
    );
  }
  return body as T;
}

function query(params: Record<string, string>): string {
  return new URLSearchParams(params).toString();
}

export function authorizeUrl(appId: string, redirectUri: string, state: string): string {
  return `https://threads.net/oauth/authorize?${query({
    client_id: appId,
    redirect_uri: redirectUri,
    scope: THREADS_SCOPES.join(","),
    response_type: "code",
    state,
  })}`;
}

// Authorization code → short-lived token (1 hour) → long-lived token (60 days).
export async function exchangeCode(
  appId: string,
  appSecret: string,
  redirectUri: string,
  code: string,
): Promise<ThreadsToken> {
  const short = await call<{ access_token: string }>(`${GRAPH}/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: query({
      client_id: appId,
      client_secret: appSecret,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      code,
    }),
  });
  const long = await call<{ access_token: string; expires_in: number }>(
    `${GRAPH}/access_token?${query({
      grant_type: "th_exchange_token",
      client_secret: appSecret,
      access_token: short.access_token,
    })}`,
  );
  return { accessToken: long.access_token, expiresIn: long.expires_in };
}

// A long-lived token older than 24 hours can be refreshed for another 60 days.
export async function refreshToken(accessToken: string): Promise<ThreadsToken> {
  const res = await call<{ access_token: string; expires_in: number }>(
    `${GRAPH}/refresh_access_token?${query({
      grant_type: "th_refresh_token",
      access_token: accessToken,
    })}`,
  );
  return { accessToken: res.access_token, expiresIn: res.expires_in };
}

export function getMe(accessToken: string): Promise<{ id: string; username: string }> {
  return call(`${API}/me?${query({ fields: "id,username", access_token: accessToken })}`);
}

const POST_FIELDS = "id,text,username,permalink,timestamp,replied_to,root_post";

export async function listMentions(accessToken: string, userId: string): Promise<ThreadsPost[]> {
  const res = await call<{ data: ThreadsPost[] }>(
    `${API}/${userId}/mentions?${query({ fields: POST_FIELDS, limit: "50", access_token: accessToken })}`,
  );
  return res.data;
}

export async function listOwnPosts(
  accessToken: string,
  limit: number,
): Promise<{ id: string; timestamp: string }[]> {
  const res = await call<{ data: { id: string; timestamp: string }[] }>(
    `${API}/me/threads?${query({ fields: "id,timestamp", limit: String(limit), access_token: accessToken })}`,
  );
  return res.data;
}

// Every reply under a post, at any depth (the /replies edge is top level only).
export async function listConversation(
  accessToken: string,
  mediaId: string,
): Promise<ThreadsPost[]> {
  const res = await call<{ data: ThreadsPost[] }>(
    `${API}/${mediaId}/conversation?${query({
      fields: `${POST_FIELDS},is_reply_owned_by_me`,
      reverse: "false",
      limit: "100",
      access_token: accessToken,
    })}`,
  );
  return res.data;
}

// Publishing is two steps: create a media container, then publish it.
export async function publishReply(
  accessToken: string,
  userId: string,
  replyToId: string,
  text: string,
): Promise<string> {
  const container = await call<{ id: string }>(`${API}/${userId}/threads`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: query({ media_type: "TEXT", text, reply_to_id: replyToId, access_token: accessToken }),
  });
  const published = await call<{ id: string }>(`${API}/${userId}/threads_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: query({ creation_id: container.id, access_token: accessToken }),
  });
  return published.id;
}

// Only replies under our own posts can be hidden.
export async function hideReply(accessToken: string, replyId: string): Promise<void> {
  await call(`${API}/${replyId}/manage_reply`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: query({ hide: "true", access_token: accessToken }),
  });
}
