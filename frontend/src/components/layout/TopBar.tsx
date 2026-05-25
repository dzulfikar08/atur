import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { Search, Sun, Moon, Monitor, Bell, FileText, Clock, PenTool } from 'lucide-react';
import { useThemeStore } from '@/stores/theme';
import { useAuthStore } from '@/stores/auth';
import { usePagesStore } from '@/stores/pages';
import { useQuery } from '@tanstack/react-query';
import { apiFetch, type Page } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

const routeLabels: Record<string, string> = {
  '': 'Dashboard',
  projects: 'Projects',
  issues: 'My Issues',
  pages: 'Pages',
  settings: 'Settings',
  search: 'Search',
};

// Helper to list pages for search results
function listPages(slug: string) {
  return apiFetch<{ results: Page[] }>(`/workspaces/${slug}/pages/`).then((r) => r.results);
}

export default function TopBar() {
  const navigate = useNavigate();
  const { slug } = useParams<{ slug: string }>();
  const location = useLocation();
  const { theme, setTheme } = useThemeStore();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const { recent } = usePagesStore();

  // Fetch pages for the current workspace so we can show recent page names
  const { data: pages = [] } = useQuery({
    queryKey: ['pages', slug],
    queryFn: () => listPages(slug!),
    enabled: !!slug && searchOpen,
  });

  const pagesById = useCallback(() => {
    const map = new Map<string, Page>();
    for (const p of pages) {
      map.set(p.id, p);
    }
    return map;
  }, [pages]);

  // Cmd+K shortcut
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
      if (e.key === 'Escape') {
        setSearchOpen(false);
      }
    },
    []
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const handleSearch = () => {
    if (searchQuery.trim() && slug) {
      navigate(`/${slug}/search?q=${encodeURIComponent(searchQuery.trim())}`);
      setSearchQuery('');
      setSearchOpen(false);
    }
  };

  // Resolve recent page IDs to page data
  const recentPages = recent
    .slice(0, 5)
    .map((id) => pagesById().get(id))
    .filter((p): p is Page => !!p);

  // Build breadcrumb from current route
  const pathSegments = location.pathname
    .replace(`/${slug}`, '')
    .split('/')
    .filter(Boolean);

  const breadcrumbs = [
    { label: slug ?? 'Workspace', path: `/${slug}` },
    ...pathSegments.map((segment, i) => ({
      label: routeLabels[segment] ?? segment,
      path: `/${slug}/${pathSegments.slice(0, i + 1).join('/')}`,
    })),
  ];

  const initials = user?.display_name
    ?.split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) ?? 'U';

  const ThemeIcon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor;

  return (
    <header className="flex h-14 items-center gap-3 border-b border-border bg-background px-4">
      {/* Search */}
      <div className="relative flex-1 max-w-md">
        {searchOpen ? (
          <div className="space-y-2">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSearch();
              }}
              className="flex items-center gap-2"
            >
              <Input
                autoFocus
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search issues, projects..."
                className="h-8 text-sm"
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setSearchOpen(false);
                }}
              />
              <Button type="submit" size="sm" className="h-8 hidden sm:inline-flex">
                Search
              </Button>
            </form>
            {/* Recent Pages section in search dropdown */}
            {!searchQuery && recentPages.length > 0 && slug && (
              <div className="absolute left-0 right-0 top-full mt-1 z-50 rounded-md border bg-popover p-2 shadow-md">
                <div className="flex items-center gap-1.5 px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  Recent Pages
                </div>
                {recentPages.map((page) => (
                  <button
                    key={page.id}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent transition-colors cursor-pointer text-left"
                    onClick={() => {
                      navigate(`/${slug}/pages/${page.id}`);
                      setSearchOpen(false);
                      setSearchQuery('');
                    }}
                  >
                    {page.is_drawing ? (
                      <PenTool className="h-3.5 w-3.5 shrink-0 text-orange-500" />
                    ) : (
                      <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    )}
                    <span className="flex-1 truncate">{page.name || 'Untitled'}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <button
            onClick={() => setSearchOpen(true)}
            className="flex h-8 w-full items-center gap-2 rounded-md border border-input bg-muted/50 px-3 text-sm text-muted-foreground transition-colors hover:bg-muted"
          >
            <Search className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden sm:inline">Search...</span>
            <kbd className="ml-auto rounded bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground border border-border hidden sm:inline-block">
              ⌘K
            </kbd>
          </button>
        )}
      </div>

      {/* Breadcrumb */}
      <nav className="hidden items-center gap-1 text-sm md:flex">
        {breadcrumbs.map((crumb, i) => (
          <span key={crumb.path} className="flex items-center gap-1">
            {i > 0 && <span className="text-muted-foreground">/</span>}
            <button
              onClick={() => navigate(crumb.path)}
              className={cn(
                'rounded px-1.5 py-0.5 transition-colors hover:bg-muted',
                i === breadcrumbs.length - 1
                  ? 'font-medium text-foreground'
                  : 'text-muted-foreground'
              )}
            >
              {crumb.label}
            </button>
          </span>
        ))}
      </nav>

      <div className="ml-auto flex items-center gap-1">
        {/* Theme toggle */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="hidden sm:flex h-8 w-8 text-muted-foreground">
              <ThemeIcon className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setTheme('light')}>
              <Sun className="mr-2 h-4 w-4" /> Light
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setTheme('dark')}>
              <Moon className="mr-2 h-4 w-4" /> Dark
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setTheme('system')}>
              <Monitor className="mr-2 h-4 w-4" /> System
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Notifications */}
        <Button
          variant="ghost"
          size="icon"
          className="hidden sm:flex relative h-8 w-8 text-muted-foreground"
          onClick={() => slug && navigate(`/${slug}/notifications`)}
        >
          <Bell className="h-4 w-4" />
        </Button>

        {/* User menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="ml-1 h-8 w-8 rounded-full p-0">
              <Avatar className="h-8 w-8">
                <AvatarFallback className="text-xs">{initials}</AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <div className="px-2 py-1.5">
              <p className="text-sm font-medium">{user?.display_name ?? 'User'}</p>
              <p className="text-xs text-muted-foreground">{user?.email ?? ''}</p>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => slug && navigate(`/${slug}/settings`)}>
              Profile & Settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <div className="px-2 py-1.5 sm:hidden">
              <p className="text-xs text-muted-foreground mb-1">Theme</p>
              <div className="flex gap-1">
                <Button variant="ghost" size="sm" className="h-7 text-xs flex-1" onClick={() => setTheme('light')}>
                  <Sun className="h-3 w-3 mr-1" /> Light
                </Button>
                <Button variant="ghost" size="sm" className="h-7 text-xs flex-1" onClick={() => setTheme('dark')}>
                  <Moon className="h-3 w-3 mr-1" /> Dark
                </Button>
              </div>
            </div>
            <DropdownMenuSeparator className="sm:hidden" />
            <DropdownMenuItem onClick={logout} className="text-destructive focus:text-destructive">
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
