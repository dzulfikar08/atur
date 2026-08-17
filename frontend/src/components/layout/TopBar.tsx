import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { Search, Bell, Sun, Moon, Monitor, FileText, Clock, PenTool } from '@/lib/icons';
import { useThemeStore } from '@/stores/theme';
import { usePagesStore } from '@/stores/pages';
import { useQuery } from '@tanstack/react-query';
import { apiFetch, type Page } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import UserMenu from './UserMenu';

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
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const { recent } = usePagesStore();

  // Fetch pages for the current workspace so we can show recent page names
  const { data: pages = [] } = useQuery({
    queryKey: ['pages', slug],
    queryFn: () => listPages(slug!),
    enabled: !!slug && searchOpen,
  });

  // Projects for this workspace — used to resolve project UUIDs in the breadcrumb
  // (e.g. /:slug/projects/<uuid>/issues) to a readable identifier/name.
  const { data: projects = [] } = useQuery({
    queryKey: ['projects', slug],
    queryFn: () => apiFetch<{ results: { id: string; name: string; identifier: string }[] }>(`/workspaces/${slug}/projects/`).then((r) => r.results),
    enabled: !!slug,
  });
  const projectById = new Map(projects.map((p) => [p.id, p]));

  const pagesById = useCallback(() => {
    const map = new Map<string, Page>();
    for (const p of pages) {
      map.set(p.id, p);
    }
    return map;
  }, [pages]);

  // Escape closes inline search; Cmd+K is owned by CommandPalette
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      setSearchOpen(false);
    }
  }, []);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const pageMap = pagesById();

  // Resolve recent page IDs to page data
  const recentPages = recent
    .slice(0, 5)
    .map((id) => pageMap.get(id))
    .filter((p): p is Page => !!p);

  const filteredPages = searchQuery.trim()
    ? pages
        .filter((p) =>
          (p.name || 'Untitled').toLowerCase().includes(searchQuery.trim().toLowerCase())
        )
        .slice(0, 8)
    : [];

  const goToPage = (page: Page) => {
    if (!slug) return;
    navigate(`/${slug}/pages/${page.id}`);
    setSearchOpen(false);
    setSearchQuery('');
  };

  const handleSearch = () => {
    if (!searchQuery.trim() || !slug) return;
    if (filteredPages.length > 0) {
      goToPage(filteredPages[0]!);
    } else {
      toast.error('No matching pages');
    }
  };

  const renderPage = (page: Page) => (
    <button
      key={page.id}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent transition-colors cursor-pointer text-left"
      onClick={() => goToPage(page)}
    >
      {page.is_drawing ? (
        <PenTool className="h-3.5 w-3.5 shrink-0 text-orange-500" />
      ) : (
        <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      )}
      <span className="flex-1 truncate">{page.name || 'Untitled'}</span>
    </button>
  );

  // Build breadcrumb from current route
  const pathSegments = location.pathname
    .replace(`/${slug}`, '')
    .split('/')
    .filter(Boolean);

  const breadcrumbs = [
    { label: slug ?? 'Workspace', path: `/${slug}` },
    ...pathSegments.map((segment, i) => {
      // A project UUID segment (the one right after "projects") is unreadable —
      // show the project's identifier (or name) instead.
      let label = routeLabels[segment] ?? segment;
      if (pathSegments[i - 1] === 'projects') {
        const p = projectById.get(segment);
        if (p) label = p.identifier || p.name;
      }
      return {
        label,
        path: `/${slug}/${pathSegments.slice(0, i + 1).join('/')}`,
      };
    }),
  ];

  const ThemeIcon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor;

  return (
    <header className="flex h-14 items-center gap-3 border-b border-border bg-background px-4">
      <button onClick={() => slug && navigate(`/${slug}`)} className="shrink-0 rounded-md" aria-label="Atur home">
        <img src="/logo-128.png" alt="Atur" className="h-7 w-7 rounded-md" />
      </button>
      {/* Breadcrumb - left */}
      <nav className="hidden items-center gap-1 text-sm md:flex min-w-0">
        {breadcrumbs.map((crumb, i) => (
          <span key={crumb.path} className="flex items-center gap-1">
            {i > 0 && <span className="text-muted-foreground">/</span>}
            <button
              onClick={() => navigate(crumb.path)}
              className={cn(
                'rounded px-1.5 py-0.5 transition-colors hover:bg-muted truncate',
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

      {/* Right group: search + actions */}
      <div className="ml-auto flex items-center gap-3">
      {/* Search */}
      <div className="relative w-full max-w-md sm:w-64 lg:w-72">
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
            {/* Recent / matching pages dropdown */}
            {!searchQuery && recentPages.length > 0 && slug && (
              <div className="absolute left-0 right-0 top-full mt-1 z-50 rounded-md border bg-popover p-2 shadow-md">
                <div className="flex items-center gap-1.5 px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  Recent Pages
                </div>
                {recentPages.map(renderPage)}
              </div>
            )}
            {searchQuery && filteredPages.length > 0 && slug && (
              <div className="absolute left-0 right-0 top-full mt-1 z-50 rounded-md border bg-popover p-2 shadow-md">
                <div className="flex items-center gap-1.5 px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <Search className="h-3 w-3" />
                  Matching Pages
                </div>
                {filteredPages.map(renderPage)}
              </div>
            )}
          </div>
        ) : (
          <button
            onClick={() => setSearchOpen(true)}
            aria-label="Search"
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

      <div className="flex items-center gap-1">
        {/* Theme toggle */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Theme" className="hidden sm:flex h-8 w-8 text-muted-foreground">
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
          aria-label="Notifications"
          className="hidden sm:flex relative h-8 w-8 text-muted-foreground"
          onClick={() => slug && navigate(`/${slug}/notifications`)}
        >
          <Bell className="h-4 w-4" />
        </Button>

        {/* User menu */}
        <UserMenu showThemeOptions />
      </div>
      </div>
    </header>
  );
}
