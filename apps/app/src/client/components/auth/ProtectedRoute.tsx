import { useEffect, type ReactNode } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { AppLoader } from "@/components/AppLoader";

import { useAuthStore } from "@/stores/auth";

interface ProtectedRouteProps {
  children: ReactNode;
}

export default function ProtectedRoute({ children }: ProtectedRouteProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuthStore((s) => s.user);
  const initialized = useAuthStore((s) => s.initialized);
  const fetchUser = useAuthStore((s) => s.fetchUser);

  useEffect(() => {
    if (!initialized) {
      fetchUser();
    }
  }, [initialized, fetchUser]);

  useEffect(() => {
    if (initialized && !user) {
      sessionStorage.setItem("redirect_after_login", location.pathname + location.search);
      navigate("/auth/login", { replace: true });
    }
  }, [initialized, user, navigate, location]);

  if (!initialized) {
    return <AppLoader label="Checking your session" />;
  }

  if (!user) {
    return null;
  }

  return <>{children}</>;
}
