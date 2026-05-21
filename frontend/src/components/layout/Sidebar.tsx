import { NavLink, useParams } from 'react-router-dom';
import {
  LayoutDashboard,
  FolderKanban,
  CircleDot,
  FileText,
  Settings,
  ChevronsLeft,
  ChevronsRight,
  LogOut,
  ChevronDown,
  Puzzle,
  Shield,
} from 'lucide-react';
import { useAuthStore } from '@/stores/auth';
import { useWorkspaceStore } from '@/stores/workspace';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

const navItems = [
  { to: '', icon: LayoutDashboard, label: 'Dashboard', end: true },
  { to: 'projects', icon: FolderKanban, label: 'Projects' },
  { to: 'issues', icon: CircleDot, label: 'My Issues' },
  { to: 'pages', icon: FileText, label: 'Pages' },
  { to: 'integrations/github', icon: Puzzle, label: 'Integrations' },
  { to: 'admin', icon: Shield, label: 'Admin' },
  { to: 'settings', icon: Settings, label: 'Settings' },
];

export default function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const { slug } = useParams<{ slug: string }>();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const { workspaces, currentSlug, setCurrentSlug } = useWorkspaceStore();

  const basePath = `/${slug ?? ''}`;

  const initials = user?.display_name
    ?.split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) ?? 'U';

  return (
    <aside
      className={cn(
        'flex h-screen flex-col border-r border-border bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-in-out',
        collapsed ? 'w-[68px]' : 'w-[250px]'
      )}
    >
      {/* Workspace switcher */}
      <div className="flex h-14 items-center gap-2 border-b border-border px-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className={cn(
                'flex h-9 w-full items-center gap-2 px-2 hover:bg-sidebar-accent',
                collapsed && 'justify-center px-0'
              )}
            >
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground text-xs font-semibold">
                {(currentSlug ?? slug)?.[0]?.toUpperCase() ?? 'W'}
              </div>
              {!collapsed && (
                <>
                  <span className="flex-1 truncate text-sm font-medium text-left">
                    {workspaces.find((w) => w.slug === (currentSlug ?? slug))?.name ??
                      currentSlug ??
                      slug ??
                      'Workspace'}
                  </span>
                  <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                </>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            {workspaces.map((ws) => (
              <DropdownMenuItem
                key={ws.id}
                onClick={() => setCurrentSlug(ws.slug)}
                className={cn(
                  'cursor-pointer',
                  ws.slug === currentSlug && 'bg-accent'
                )}
              >
                <div className="mr-2 flex h-6 w-6 items-center justify-center rounded bg-primary text-primary-foreground text-xs font-semibold">
                  {ws.name[0].toUpperCase()}
                </div>
                <span className="flex-1">{ws.name}</span>
              </DropdownMenuItem>
            ))}
            {workspaces.length === 0 && (
              <div className="px-2 py-4 text-center text-sm text-muted-foreground">
                No workspaces
              </div>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Navigation */}
      <ScrollArea className="flex-1 px-2 py-2">
        <nav className="flex flex-col gap-0.5">
          {navItems.map((item) => {
            const Icon = item.icon;
            const targetPath = `${basePath}/${item.to}`.replace(/\/$/, '');
            return (
              <NavLink
                key={item.to}
                to={targetPath}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 rounded-md px-2.5 py-2 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                      : 'text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground',
                    collapsed && 'justify-center px-2'
                  )
                }
                title={collapsed ? item.label : undefined}
              >
                <Icon className="h-4.5 w-4.5 shrink-0" />
                {!collapsed && <span>{item.label}</span>}
              </NavLink>
            );
          })}
        </nav>
      </ScrollArea>

      {/* Collapse toggle */}
      <div className="px-2 py-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={onToggle}
          className={cn(
            'w-full justify-center text-muted-foreground hover:text-sidebar-foreground',
            !collapsed && 'justify-start'
          )}
        >
          {collapsed ? (
            <ChevronsRight className="h-4 w-4" />
          ) : (
            <>
              <ChevronsLeft className="h-4 w-4" />
              <span className="ml-2 text-xs">Collapse</span>
            </>
          )}
        </Button>
      </div>

      <Separator />

      {/* User section */}
      <div className="flex items-center gap-2 px-3 py-3">
        <Avatar className="h-8 w-8 shrink-0">
          <AvatarFallback className="text-xs">{initials}</AvatarFallback>
        </Avatar>
        {!collapsed && (
          <div className="flex flex-1 items-center justify-between min-w-0">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{user?.display_name ?? 'User'}</p>
              <p className="truncate text-xs text-muted-foreground">{user?.email ?? ''}</p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
              onClick={logout}
              title="Log out"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        )}
        {collapsed && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
            onClick={logout}
            title="Log out"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        )}
      </div>
    </aside>
  );
}
