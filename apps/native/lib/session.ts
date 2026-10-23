import { QueryCache, QueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";

import { clearPaneSeen } from "@/lib/pane-seen";
import { clearAgentAlertsLocal } from "@/lib/push-state";
import { getItem, removeItem, setItem } from "@/lib/storage";

// The opaque Atur session token (users.token) — sent as `Authorization:
// Bearer`, which the worker's extractToken accepts ahead of the cookie.
const TOKEN_KEY = "atur.session_token";

export type SessionStatus = "loading" | "anon" | "authed";

type Session = { status: SessionStatus; token: string | null };

let session: Session = { status: "loading", token: null };
const listeners = new Set<() => void>();

function publish(next: Session) {
  session = next;
  for (const listener of listeners) listener();
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error) => console.log(error),
  }),
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000,
      gcTime: 30 * 60 * 1000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

export function getToken(): string | null {
  return session.token;
}

export async function restoreSession(): Promise<void> {
  const token = await getItem(TOKEN_KEY);
  publish(token ? { status: "authed", token } : { status: "anon", token: null });
}

export async function startSession(token: string): Promise<void> {
  await setItem(TOKEN_KEY, token);
  queryClient.clear();
  publish({ status: "authed", token });
}

/**
 * Drops the local session (server already revoked it, or it expired). The
 * device-level alert opt-in and pane acknowledgements belong to the account,
 * so they go too; server-side token removal is `disableAgentAlerts`, run
 * before this while the session is still valid.
 */
export async function endSession(): Promise<void> {
  await Promise.all([removeItem(TOKEN_KEY), clearAgentAlertsLocal(), clearPaneSeen()]);
  queryClient.clear();
  publish({ status: "anon", token: null });
}

export function useSession(): Session {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => session,
  );
}
