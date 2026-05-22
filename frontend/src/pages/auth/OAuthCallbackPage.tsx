import { useEffect, useRef } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { useAuthStore } from "@/stores/auth";

export default function OAuthCallbackPage() {
  const { provider } = useParams<{ provider: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const fetchUser = useAuthStore((s) => s.fetchUser);
  const hasRun = useRef(false);

  useEffect(() => {
    if (hasRun.current) return;
    hasRun.current = true;

    async function handleCallback() {
      const code = searchParams.get("code");
      const errorParam = searchParams.get("error");

      if (errorParam) {
        toast.error(
          searchParams.get("error_description") ??
            "OAuth authentication was cancelled or failed"
        );
        navigate("/auth/login", { replace: true });
        return;
      }

      if (!code) {
        toast.error("Missing authorization code from provider");
        navigate("/auth/login", { replace: true });
        return;
      }

      try {
        // The OAuth callback is handled server-side via GET /auth/{provider}/callback
        // which sets the session cookie and redirects back here.
        // We just need to fetch the user now.
        await fetchUser();

        const redirect =
          sessionStorage.getItem("redirect_after_login") ?? "/";
        sessionStorage.removeItem("redirect_after_login");
        navigate(redirect, { replace: true });
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "OAuth authentication failed"
        );
        navigate("/auth/login", { replace: true });
      }
    }

    handleCallback();
  }, [provider, searchParams, navigate, fetchUser]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background gap-4">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
      <p className="text-sm text-muted-foreground">
        Completing {provider ? provider.charAt(0).toUpperCase() + provider.slice(1) : "OAuth"} sign-in...
      </p>
    </div>
  );
}
