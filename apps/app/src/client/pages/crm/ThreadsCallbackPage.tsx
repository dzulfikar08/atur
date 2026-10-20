import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, ApiError } from "@/lib/api";

// Threads redirects here after consent (one fixed redirect URI for every
// workspace). The workspace travels in the signed state as "slug.exp.sig";
// the code goes to the authed connect endpoint, which checks the signature.
export default function ThreadsCallbackPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  const code = params.get("code");
  const state = params.get("state") ?? "";
  const slug = state.split(".").slice(0, -2).join(".");
  const denied = params.get("error_description") ?? params.get("error");

  useEffect(() => {
    // Strict mode runs effects twice; an authorization code is single use.
    if (started.current) return;
    started.current = true;
    if (denied) return setError(denied);
    if (!code || !slug) return setError("Threads did not return an authorization code.");
    api
      .connectThreads(slug, code, state)
      .then(() => navigate(`/${slug}/crm/threads`, { replace: true }))
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : "Connection failed."));
  }, [code, slug, state, denied, navigate]);

  return (
    <div className="mx-auto max-w-md space-y-3 p-6">
      <h1 className="text-xl font-bold">Connecting Threads</h1>
      {error ? (
        <>
          <p className="text-sm text-destructive break-words">{error}</p>
          {slug && (
            <Link to={`/${slug}/crm/threads`} className="text-sm text-blue-600 hover:underline">
              Back to the Threads inbox
            </Link>
          )}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">Finishing the connection…</p>
      )}
    </div>
  );
}
