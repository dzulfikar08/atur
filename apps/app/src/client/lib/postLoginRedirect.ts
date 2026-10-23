import type { NavigateFunction } from "react-router-dom";

const KEY = "redirect_after_login";
// The auth pages can consume the stored target twice in one sign-in (the
// "already authenticated" effect and the submit handler race), so a just-taken
// target stays available briefly instead of silently degrading to "/".
const REUSE_WINDOW_MS = 10_000;
let lastTaken: { target: string; at: number } | null = null;

export function takePostLoginRedirect(): string {
  const stored = sessionStorage.getItem(KEY);
  sessionStorage.removeItem(KEY);
  if (stored) {
    lastTaken = { target: stored, at: Date.now() };
    return stored;
  }
  if (lastTaken && Date.now() - lastTaken.at < REUSE_WINDOW_MS) return lastTaken.target;
  return "/";
}

// /oauth/* (MCP authorization consent) is served by the worker, not the SPA
// router, so it needs a real navigation.
export function goAfterLogin(navigate: NavigateFunction, target: string): void {
  if (target.startsWith("/oauth/")) {
    window.location.assign(target);
    return;
  }
  navigate(target, { replace: true });
}
