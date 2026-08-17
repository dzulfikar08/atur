import { useEffect } from "react";
import { Outlet, useNavigate, useParams } from "react-router-dom";
import { usePortalAuthStore } from "@/stores/portalAuth";
import { Loader2 } from "@/lib/icons";

// Portal equivalent of ProtectedRoute: ensures a portal session exists for the
// workspace slug in the URL, redirecting to the portal login otherwise.
export default function PortalRouteGuard() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const customer = usePortalAuthStore((s) => s.customer);
  const initialized = usePortalAuthStore((s) => s.initialized);
  const storeSlug = usePortalAuthStore((s) => s.slug);
  const fetchCustomer = usePortalAuthStore((s) => s.fetchCustomer);

  useEffect(() => {
    if (slug && slug !== storeSlug) {
      fetchCustomer(slug);
    }
  }, [slug, storeSlug, fetchCustomer]);

  useEffect(() => {
    if (initialized && !customer && slug) {
      navigate(`/portal/${slug}/login`, { replace: true });
    }
  }, [initialized, customer, slug, navigate]);

  if (!initialized || !customer) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return <Outlet />;
}
