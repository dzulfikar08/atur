// The Google OAuth return (atur://auth/callback?code=...) is consumed by
// WebBrowser.openAuthSessionAsync in lib/google-auth.ts; without this the
// router would also try to open it and land on +not-found.
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  if (path.includes("auth/callback")) return "/";
  return path;
}
