import { pairRouteFor } from "@/lib/direct/pair-link";

// The Google OAuth return (atur://auth/callback?code=...) is consumed by
// WebBrowser.openAuthSessionAsync in lib/google-auth.ts; without this the
// router would also try to open it and land on +not-found.
// A pairing link (atur://pair?...), tapped on the phone, opens the pairing screen with the link
// as a parameter (app/pair.tsx); the core checks it there.
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  if (path.includes("auth/callback")) return "/";
  return pairRouteFor(path) ?? path;
}
