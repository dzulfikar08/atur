import { useEffect } from "react";
import { Outlet, useLocation, useNavigate, useParams } from "react-router-dom";
import { usePortalAuthStore } from "@/stores/portalAuth";
import { Loader2 } from "@/lib/icons";

// Gates the signed-in portal sections (Support, tickets). Ensures a portal
// session exists for the workspace slug in the URL, redirecting to the portal
// login otherwise and returning here after the OTP succeeds.
export default function PortalRouteGuard() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const customer = usePortalAuthStore((s) => s.customer);
  const initialized = usePortalAuthStore((s) => s.initialized);
  const storeSlug = usePortalAuthStore((s) => s.slug);
  const loading = usePortalAuthStore((s) => s.loading);
  const fetchCustomer = usePortalAuthStore((s) => s.fetchCustomer);

  useEffect(() => {
    if (slug && slug !== storeSlug && !loading) {
      fetchCustomer(slug);
    }
  }, [slug, storeSlug, loading, fetchCustomer]);

  useEffect(() => {
    if (initialized && !customer && slug) {
      navigate(`/portal/${slug}/login`, {
        replace: true,
        state: { from: location.pathname + location.search },
      });
    }
  }, [initialized, customer, slug, navigate, location.pathname, location.search]);

  if (!initialized || !customer) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return <Outlet />;
}
