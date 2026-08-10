import { useState } from 'react';
import { NavLink, useNavigate, useParams } from 'react-router-dom';
import {
  LayoutDashboard,
  FolderKanban,
  CircleDot,
  Search,
  Menu,
  FileText,
  Puzzle,
  Shield,
  Settings,
  LogOut,
  Building2,
  Users,
  Layers,
} from '@/lib/icons';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth';
import { useWorkspaceStore } from '@/stores/workspace';
import { useWorkspaces } from '@/hooks/useWorkspaces';
import BottomSheet from '@/components/mobile/BottomSheet';

const mainTabs = [
  { to: '', icon: LayoutDashboard, label: 'Home' },
  { to: 'projects', icon: FolderKanban, label: 'Projects' },
  { to: 'issues', icon: CircleDot, label: 'Issues' },
  { to: 'search', icon: Search, label: 'Search' },
];

const moreItems = [
  { to: 'pages', icon: FileText, label: 'Pages' },
  { to: 'crm', icon: Users, label: 'CRM' },
  { to: 'integrations/github', icon: Puzzle, label: 'Integrations' },
  { to: 'admin', icon: Shield, label: 'Admin' },
  { to: 'settings', icon: Settings, label: 'Settings' },
];

export default function BottomNav() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [moreOpen, setMoreOpen] = useState(false);
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const { data: workspaces = [] } = useWorkspaces();
  const { currentSlug, setCurrentSlug } = useWorkspaceStore();

  const activeSlug = currentSlug ?? slug;

  return (
    <>
      <nav className="fixed bottom-0 left-0 right-0 z-40 md:hidden border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 safe-area-bottom">
        <div className="flex items-center justify-around h-14">
          {mainTabs.map((tab) => {
            const Icon = tab.icon;
            const targetPath = `/${slug}/${tab.to}`.replace(/\/$/, '');
            return (
              <NavLink
                key={tab.to || 'home'}
                to={targetPath}
                end={tab.to === ''}
                className={({ isActive }) =>
                  cn(
                    'flex flex-col items-center justify-center gap-0.5 flex-1 h-full transition-colors',
                    isActive ? 'text-primary' : 'text-muted-foreground'
                  )
                }
              >
                <Icon className="h-5 w-5" />
                <span className="text-[10px] font-medium">{tab.label}</span>
              </NavLink>
            );
          })}

          {/* More button */}
          <button
            onClick={() => setMoreOpen(true)}
            className={cn(
              'flex flex-col items-center justify-center gap-0.5 flex-1 h-full transition-colors',
              moreOpen ? 'text-primary' : 'text-muted-foreground'
            )}
          >
            <Menu className="h-5 w-5" />
            <span className="text-[10px] font-medium">More</span>
          </button>
        </div>
      </nav>

      {/* More drawer */}
      <BottomSheet open={moreOpen} onClose={() => setMoreOpen(false)} title="Menu">
        {/* Workspace switcher */}
        {workspaces.length > 0 && (
          <div className="mb-4">
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground mb-2">
              <Building2 className="h-3.5 w-3.5" />
              Workspace
            </div>
            <div className="space-y-1">
              <button
                onClick={() => {
                  setCurrentSlug('all');
                  navigate('/all');
                  setMoreOpen(false);
                }}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left text-sm transition-colors',
                  activeSlug === 'all'
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'hover:bg-muted/50'
                )}
              >
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  <Layers className="h-3.5 w-3.5" />
                </div>
                <span className="flex-1">All Workspaces</span>
                {activeSlug === 'all' && (
                  <div className="h-2 w-2 rounded-full bg-primary" />
                )}
              </button>
              {workspaces.map((ws) => {
                const isActive = ws.slug === activeSlug;
                return (
                  <button
                    key={ws.id}
                    onClick={() => {
                      setCurrentSlug(ws.slug);
                      navigate(`/${ws.slug}`);
                      setMoreOpen(false);
                    }}
                    className={cn(
                      'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left text-sm transition-colors',
                      isActive
                        ? 'bg-primary/10 text-primary font-medium'
                        : 'hover:bg-muted/50'
                    )}
                  >
                    <div className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-lg bg-primary text-primary-foreground text-xs font-semibold">
                      {ws.logo ? (
                        <img src={ws.logo} alt="" className="h-full w-full object-cover" />
                      ) : (
                        ws.name[0].toUpperCase()
                      )}
                    </div>
                    <span className="flex-1">{ws.name}</span>
                    {isActive && (
                      <div className="h-2 w-2 rounded-full bg-primary" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Nav items */}
        <div className="space-y-0.5">
          {moreItems.map((item) => {
            const Icon = item.icon;
            const targetPath = `/${slug}/${item.to}`;
            return (
              <NavLink
                key={item.to}
                to={targetPath}
                onClick={() => setMoreOpen(false)}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-colors',
                    isActive
                      ? 'bg-primary/10 text-primary font-medium'
                      : 'hover:bg-muted/50'
                  )
                }
              >
                <Icon className="h-4.5 w-4.5" />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </div>

        {/* User section */}
        <div className="mt-6 pt-4 border-t">
          <div className="flex items-center gap-3 px-3 py-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-semibold">
              {user?.display_name?.[0]?.toUpperCase() ?? 'U'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">
                {user?.display_name ?? 'User'}
              </p>
              <p className="text-xs text-muted-foreground truncate">
                {user?.email ?? ''}
              </p>
            </div>
          </div>
          <button
            onClick={async () => {
              setMoreOpen(false);
              await logout();
            }}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-destructive hover:bg-destructive/10 transition-colors mt-1"
          >
            <LogOut className="h-4 w-4" />
            <span>Log out</span>
          </button>
        </div>
      </BottomSheet>
    </>
  );
}
