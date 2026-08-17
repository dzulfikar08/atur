import { NavLink, useNavigate, useParams } from 'react-router-dom';
import { useState } from 'react';
import {
  LayoutDashboard,
  FolderKanban,
  CircleDot,
  FileText,
  Settings,
  ChevronsLeft,
  ChevronsRight,
  ChevronDown,
  Puzzle,
  Bot,
  Shield,
  Timer,
  Users,
  Plus,
  Layers,
} from '@/lib/icons';
import { useAuthStore } from '@/stores/auth';
import { useWorkspaceStore } from '@/stores/workspace';
import { useWorkspaces } from '@/hooks/useWorkspaces';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import CreateWorkspaceDialog from '@/components/layout/CreateWorkspaceDialog';
import UserMenu from '@/components/layout/UserMenu';
import { cn } from '@/lib/utils';

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

const navItems = [
  { to: '', icon: LayoutDashboard, label: 'Dashboard', end: true },
  { to: 'projects', icon: FolderKanban, label: 'Projects' },
  { to: 'crm', icon: Users, label: 'CRM' },
  { to: 'issues', icon: CircleDot, label: 'My Issues' },
  { to: 'timesheet', icon: Timer, label: 'Timesheet' },
  { to: 'pages', icon: FileText, label: 'Pages' },
  { to: 'integrations/github', icon: Puzzle, label: 'Integrations' },
  { to: 'integrations/mcp', icon: Bot, label: 'AI / MCP' },
  { to: 'admin', icon: Shield, label: 'Admin' },
  { to: 'settings', icon: Settings, label: 'Settings' },
];

export default function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const { data: workspaces = [] } = useWorkspaces();
  const { currentSlug, switchWorkspace } = useWorkspaceStore();
  const [createOpen, setCreateOpen] = useState(false);

  const activeSlug = currentSlug ?? slug;
  const isAll = activeSlug === 'all';

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
        'relative flex h-screen flex-col border-r border-border bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-in-out',
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
              {(() => {
                if (isAll) {
                  return (
                    <div className="h-7 w-7 shrink-0 rounded-md bg-primary text-primary-foreground flex items-center justify-center">
                      <Layers className="h-4 w-4" />
                    </div>
                  );
                }
                const cws = workspaces.find((w) => w.slug === activeSlug);
                if (cws?.logo) return <img src={cws.logo} alt="" className="h-7 w-7 shrink-0 rounded-md object-cover" />;
                return (
                  <div className="h-7 w-7 shrink-0 rounded-md bg-primary text-primary-foreground flex items-center justify-center text-xs font-semibold">
                    {(cws?.name || 'W').charAt(0).toUpperCase()}
                  </div>
                );
              })()}
              {!collapsed && (
                <>
                  <span className="flex-1 truncate text-sm font-medium text-left">
                    {isAll
                      ? 'All Workspaces'
                      : (workspaces.find((w) => w.slug === activeSlug)?.name ??
                        currentSlug ??
                        slug ??
                        'Workspace')}
                  </span>
                  <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                </>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuItem
              className={cn('cursor-pointer', isAll && 'bg-accent')}
              onClick={() => {
                navigate(switchWorkspace('all'));
              }}
            >
              <div className="mr-2 flex h-6 w-6 items-center justify-center rounded bg-primary text-primary-foreground">
                <Layers className="h-3.5 w-3.5" />
              </div>
              <span className="flex-1">All Workspaces</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {workspaces.map((ws) => (
              <DropdownMenuItem
                key={ws.id}
                onClick={() => {
                  navigate(switchWorkspace(ws.slug));
                }}
                className={cn(
                  'cursor-pointer',
                  ws.slug === currentSlug && 'bg-accent'
                )}
              >
                <div className="mr-2 flex h-6 w-6 items-center justify-center overflow-hidden rounded bg-primary text-primary-foreground">
                  {ws.logo ? (
                    <img src={ws.logo} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-xs font-semibold">{(ws.name[0] ?? '').toUpperCase()}</span>
                  )}
                </div>
                <span className="flex-1">{ws.name}</span>
              </DropdownMenuItem>
            ))}
            {workspaces.length === 0 && (
              <div className="px-2 py-4 text-center text-sm text-muted-foreground">
                No workspaces
              </div>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="cursor-pointer text-muted-foreground"
              onClick={() => setCreateOpen(true)}
            >
              <Plus className="mr-2 h-4 w-4" />
              <span>Create workspace</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Navigation */}
      <ScrollArea className="flex-1 min-h-0 px-2 py-2">
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
                    'flex items-center gap-3 rounded-md px-2.5 py-2.5 text-sm font-medium transition-colors',
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

      {/* Collapse toggle — floats on right border */}
      <Button
        variant="outline"
        size="icon"
        onClick={onToggle}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        aria-expanded={!collapsed}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        className="absolute top-1/2 right-0 z-40 h-6 w-6 -translate-y-1/2 translate-x-1/2 rounded-full border border-border bg-background p-0 text-muted-foreground shadow-sm transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
      >
        {collapsed ? (
          <ChevronsRight className="h-3.5 w-3.5" />
        ) : (
          <ChevronsLeft className="h-3.5 w-3.5" />
        )}
      </Button>

      <Separator />

      {/* User section */}
      <div className={cn('flex items-center py-3', collapsed ? 'justify-center px-0' : 'px-3')}>
        {collapsed ? (
          <UserMenu
            side="right"
            align="start"
            trigger={
              <Button variant="ghost" aria-label="Account menu" className="h-8 w-8 rounded-full p-0">
                <Avatar className="h-8 w-8">
                  {user?.avatar ? <AvatarImage src={user.avatar} alt={user.display_name ?? 'User'} /> : null}
                  <AvatarFallback className="text-xs">{initials}</AvatarFallback>
                </Avatar>
              </Button>
            }
          />
        ) : (
          <UserMenu
            side="top"
            align="start"
            trigger={
              <button
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-sidebar-accent/50 cursor-pointer"
                aria-label="Account menu"
              >
                <Avatar className="h-8 w-8 shrink-0">
                  {user?.avatar ? <AvatarImage src={user.avatar} alt={user.display_name ?? 'User'} /> : null}
                  <AvatarFallback className="text-xs">{initials}</AvatarFallback>
                </Avatar>
                <div className="flex flex-1 items-center justify-between min-w-0">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{user?.display_name ?? 'User'}</p>
                    <p className="truncate text-xs text-muted-foreground">{user?.email ?? ''}</p>
                  </div>
                  <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                </div>
              </button>
            }
          />
        )}
      </div>

      <CreateWorkspaceDialog open={createOpen} onOpenChange={setCreateOpen} />
    </aside>
  );
}
