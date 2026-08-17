import { useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import BottomNav from '@/components/mobile/BottomNav';
import CommandPalette from './CommandPalette';
import { useWorkspaces } from '@/hooks/useWorkspaces';

// Sub-paths that have a meaningful cross-workspace aggregate view under /all.
// Anything else (Settings, Timesheet, single Page/Contact/Pipeline detail) gets
// redirected into the user's first workspace so the page gets a real slug.
const ALL_ALLOWED_SUBPATHS = new Set([
  '',
  '/issues',
  '/projects',
  '/pages',
  '/crm',
  '/crm/contacts',
  '/crm/pipelines',
]);

function useAllModeGuard() {
  const { slug } = useParams<{ slug: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { data: workspaces = [] } = useWorkspaces();

  useEffect(() => {
    if (slug !== 'all') return;
    const rest = location.pathname.replace(/^\/all/, '');
    if (ALL_ALLOWED_SUBPATHS.has(rest)) return;
    const first = workspaces[0]?.slug;
    if (!first) return;
    navigate(`/${first}${rest}`, { replace: true });
  }, [slug, location.pathname, workspaces, navigate]);
}

export default function AppShell() {
  const [collapsed, setCollapsed] = useState(false);

  useAllModeGuard();

  // Toggle sidebar collapse with Cmd/Ctrl+B
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'b' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setCollapsed((c) => !c);
      }
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, []);

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-background focus:px-3 focus:py-1.5 focus:text-sm focus:shadow"
      >
        Skip to content
      </a>
      {/* Desktop sidebar */}
      <div className="hidden md:block shrink-0">
        <Sidebar collapsed={collapsed} onToggle={() => setCollapsed(!collapsed)} />
      </div>

      {/* Main area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar />

        {/* Page content - with bottom padding on mobile for bottom nav */}
        <main id="main" className="flex-1 overflow-y-auto">
          <div className="p-4 md:p-6 lg:p-8 pb-20 md:pb-6 lg:pb-8">
            <Outlet />
          </div>
        </main>
      </div>

      {/* Mobile bottom navigation */}
      <BottomNav />

      {/* Command palette (Cmd+K) */}
      <CommandPalette />
    </div>
  );
}
