import { Outlet, useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Inbox, LogOut } from '@/lib/icons';
import { usePortalAuthStore } from '@/stores/portalAuth';

export default function PortalLayout() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const customer = usePortalAuthStore((s) => s.customer);
  const signOut = usePortalAuthStore((s) => s.signOut);

  const handleSignOut = async () => {
    if (slug) await signOut(slug);
    navigate(`/portal/${slug}/login`, { replace: true });
  };

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
          <button
            onClick={() => navigate(`/portal/${slug}`)}
            className="flex items-center gap-2 text-sm font-semibold"
          >
            <img src="/logo-128.png" alt="" className="h-6 w-6 rounded border border-border" />
            <Inbox className="h-4 w-4" />
            <span className="hidden sm:inline">Support Portal</span>
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground">{slug}</span>
          </button>

          <div className="flex items-center gap-3">
            {customer && (
              <span className="hidden text-xs text-muted-foreground sm:inline">
                {customer.display_name || customer.email}
              </span>
            )}
            <Button variant="ghost" size="sm" onClick={handleSignOut}>
              <LogOut className="mr-1 h-4 w-4" />
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
