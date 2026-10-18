import { useEffect } from "react";
import { NavLink, Outlet, useLocation, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { LogOut } from "@/lib/icons";
import { portalApi } from "@/lib/portalApi";
import { usePortalAuthStore } from "@/stores/portalAuth";
import { cn } from "@/lib/utils";

const TABS = [
  { to: "ideas", label: "Ideas" },
  { to: "tickets", label: "Support" },
  { to: "changelog", label: "Changelog" },
] as const;

// Unified portal shell: Ideas / Support / Changelog tabs under one sign-in.
// Ideas and Changelog are public; Support (and anything under it) is guarded by
// PortalRouteGuard.
export default function PortalLayout() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const customer = usePortalAuthStore((s) => s.customer);
  const storeSlug = usePortalAuthStore((s) => s.slug);
  const loading = usePortalAuthStore((s) => s.loading);
  const fetchCustomer = usePortalAuthStore((s) => s.fetchCustomer);
  const signOut = usePortalAuthStore((s) => s.signOut);

  useEffect(() => {
    if (slug && slug !== storeSlug && !loading) fetchCustomer(slug);
  }, [slug, storeSlug, loading, fetchCustomer]);

  const overviewQ = useQuery({
    queryKey: ["portal-overview", slug],
    queryFn: () => portalApi.getOverview(slug!),
    enabled: !!slug,
    retry: false,
  });
  const workspaceName = overviewQ.data?.workspace.name ?? slug;

  const handleSignOut = async () => {
    if (slug) await signOut(slug);
    navigate(`/portal/${slug}/ideas`, { replace: true });
  };

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
          <button
            onClick={() => navigate(`/portal/${slug}/ideas`)}
            className="flex items-center gap-2 text-sm font-semibold"
          >
            <img src="/logo-128.png" alt="" className="h-6 w-6 rounded border border-border" />
            <span>{workspaceName}</span>
          </button>

          <div className="flex items-center gap-3">
            {customer ? (
              <>
                <span className="hidden text-xs text-muted-foreground sm:inline">
                  {customer.display_name || customer.email}
                </span>
                <Button variant="ghost" size="sm" onClick={handleSignOut}>
                  <LogOut className="mr-1 h-4 w-4" />
                  Sign out
                </Button>
              </>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  navigate(`/portal/${slug}/login`, {
                    state: { from: location.pathname + location.search },
                  })
                }
              >
                Sign in
              </Button>
            )}
          </div>
        </div>
        <nav aria-label="Portal sections" className="mx-auto flex max-w-3xl gap-1 px-4">
          {TABS.map((t) => (
            <NavLink
              key={t.to}
              to={`/portal/${slug}/${t.to}`}
              className={({ isActive }) =>
                cn(
                  "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )
              }
            >
              {t.label}
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
