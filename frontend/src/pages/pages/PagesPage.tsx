import { useState, useMemo, useCallback, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch, type Page } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Plus,
  Search,
  FileText,
  PenTool,
  ChevronRight,
  ChevronDown,
  MoreHorizontal,
  Trash2,
  FilePlus,
  Pencil,
  Star,
  Pin,
  Clock,
  Network,
} from 'lucide-react';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { usePagesStore } from '@/stores/pages';

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

function listPages(slug: string) {
  return apiFetch<{ results: Page[] }>(`/workspaces/${slug}/pages/`).then((r) => r.results);
}

function createPage(slug: string, data: { name: string; parent?: string; description_html?: string }) {
  return apiFetch<Page>(`/workspaces/${slug}/pages/`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

function deletePage(slug: string, id: string) {
  return apiFetch<void>(`/workspaces/${slug}/pages/${id}/`, { method: 'DELETE' });
}

function getPage(slug: string, id: string) {
  return apiFetch<Page>(`/workspaces/${slug}/pages/${id}/`);
}

function updatePage(slug: string, id: string, data: Partial<Pick<Page, 'name' | 'parent'>>) {
  return apiFetch<Page>(`/workspaces/${slug}/pages/${id}/`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

// ---------------------------------------------------------------------------
// Tree helpers
// ---------------------------------------------------------------------------

interface PageNode {
  page: Page;
  children: PageNode[];
}

function buildTree(pages: Page[]): PageNode[] {
  const map = new Map<string, PageNode>();
  const roots: PageNode[] = [];

  // Create nodes for all pages
  for (const page of pages) {
    map.set(page.id, { page, children: [] });
  }

  // Build parent-child relationships
  for (const page of pages) {
    const node = map.get(page.id)!;
    if (page.parent && map.has(page.parent)) {
      map.get(page.parent)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

function flattenTree(nodes: PageNode[]): Page[] {
  const result: Page[] = [];
  for (const node of nodes) {
    result.push(node.page);
    result.push(...flattenTree(node.children));
  }
  return result;
}

// ---------------------------------------------------------------------------
// PageTreeItem
// ---------------------------------------------------------------------------

function PageTreeItem({
  node,
  slug,
  activePageId,
  expandedIds,
  onToggle,
  depth,
  searchQuery,
}: {
  node: PageNode;
  slug: string;
  activePageId: string | undefined;
  expandedIds: Set<string>;
  onToggle: (id: string) => void;
  depth: number;
  searchQuery: string;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const hasChildren = node.children.length > 0;
  const isExpanded = expandedIds.has(node.page.id);
  const isActive = activePageId === node.page.id;
  const isDrawing = node.page.is_drawing ?? false;
  const { favorites, pinned, toggleFavorite, togglePin } = usePagesStore();
  const isFav = favorites.includes(node.page.id);
  const isPinned = pinned.includes(node.page.id);

  const deleteMutation = useMutation({
    mutationFn: () => deletePage(slug, node.page.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pages', slug] });
      toast.success('Page deleted');
      // If we're viewing the deleted page, navigate back
      if (isActive) {
        navigate(`/${slug}/pages`);
      }
    },
    onError: () => toast.error('Failed to delete page'),
  });

  const nameMatch = searchQuery
    ? node.page.name.toLowerCase().includes(searchQuery.toLowerCase())
    : true;

  if (searchQuery && !nameMatch && flattenTree(node.children).length === 0) {
    return null;
  }

  return (
    <div>
      <div
        className={cn(
          'group flex items-center gap-1 rounded-md px-2 py-1.5 text-sm cursor-pointer transition-colors',
          isActive
            ? 'bg-accent text-accent-foreground'
            : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
        )}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => navigate(`/${slug}/pages/${node.page.id}`)}
      >
        {/* Expand/collapse toggle */}
        {hasChildren ? (
          <button
            className="shrink-0 h-4 w-4 flex items-center justify-center rounded hover:bg-muted"
            onClick={(e) => {
              e.stopPropagation();
              onToggle(node.page.id);
            }}
          >
            {isExpanded ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}

        {/* Page icon */}
        {isDrawing ? (
          <PenTool className="h-3.5 w-3.5 shrink-0 text-orange-500" />
        ) : (
          <FileText className="h-3.5 w-3.5 shrink-0" />
        )}

        {/* Pin indicator for pinned pages */}
        {isPinned && (
          <Pin className="h-2.5 w-2.5 shrink-0 text-muted-foreground" />
        )}

        {/* Page name */}
        <span className="flex-1 truncate ml-1">{node.page.name || 'Untitled'}</span>

        {/* Last updated */}
        <span className="hidden text-[10px] text-muted-foreground group-hover:hidden lg:inline">
          {formatDistanceToNow(parseISO(node.page.updated_at), { addSuffix: false })}
        </span>

        {/* Quick action buttons on hover */}
        <button
          className={cn(
            'shrink-0 h-5 w-5 items-center justify-center rounded hover:bg-muted transition-colors',
            isFav ? 'inline-flex opacity-100 text-amber-500' : 'hidden group-hover:inline-flex opacity-0 group-hover:opacity-100'
          )}
          onClick={(e) => {
            e.stopPropagation();
            toggleFavorite(node.page.id);
          }}
          title={isFav ? 'Remove from favorites' : 'Add to favorites'}
        >
          <Star className={cn('h-3 w-3', isFav && 'fill-current')} />
        </button>

        {/* Actions dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="shrink-0 h-5 w-5 items-center justify-center rounded hover:bg-muted opacity-0 group-hover:opacity-100 hidden group-hover:flex"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontal className="h-3 w-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/${slug}/pages/${node.page.id}`);
              }}
            >
              <Pencil className="h-3.5 w-3.5 mr-2" />
              Open
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                togglePin(node.page.id);
              }}
            >
              <Pin className="h-3.5 w-3.5 mr-2" />
              {isPinned ? 'Unpin' : 'Pin to top'}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                toggleFavorite(node.page.id);
              }}
            >
              <Star className={cn('h-3.5 w-3.5 mr-2', isFav && 'fill-current')} />
              {isFav ? 'Remove from favorites' : 'Add to favorites'}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={(e) => {
                e.stopPropagation();
                deleteMutation.mutate();
              }}
            >
              <Trash2 className="h-3.5 w-3.5 mr-2" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Children */}
      {hasChildren && isExpanded &&
        node.children.map((child) => (
          <PageTreeItem
            key={child.page.id}
            node={child}
            slug={slug}
            activePageId={activePageId}
            expandedIds={expandedIds}
            onToggle={onToggle}
            depth={depth + 1}
            searchQuery={searchQuery}
          />
        ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SidebarSection — collapsible section for Pinned/Favorites/Recent
// ---------------------------------------------------------------------------

function SidebarSection({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className="mb-1">
      <button
        className="flex items-center gap-1.5 w-full px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => setCollapsed(!collapsed)}
      >
        {collapsed ? (
          <ChevronRight className="h-3 w-3 shrink-0" />
        ) : (
          <ChevronDown className="h-3 w-3 shrink-0" />
        )}
        <Icon className="h-3 w-3 shrink-0" />
        <span>{title}</span>
      </button>
      {!collapsed && <div>{children}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// WelcomeState — shown when no page is selected
// ---------------------------------------------------------------------------

function WelcomeState({ onCreatePage }: { onCreatePage: (isDrawing: boolean) => void }) {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="max-w-sm text-center space-y-6">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-muted">
          <FileText className="h-8 w-8 text-muted-foreground" />
        </div>
        <div className="space-y-2">
          <h2 className="text-xl font-semibold">Pages</h2>
          <p className="text-sm text-muted-foreground">
            Create documents and drawings to organize your workspace knowledge.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Button onClick={() => onCreatePage(false)}>
            <FilePlus className="h-4 w-4 mr-2" />
            New Page
          </Button>
          <Button variant="outline" onClick={() => onCreatePage(true)}>
            <PenTool className="h-4 w-4 mr-2" />
            New Drawing
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PageSidebar
// ---------------------------------------------------------------------------

function PageSidebar({
  slug,
  activePageId,
  searchQuery,
  onSearchChange,
  onCreatePage,
}: {
  slug: string;
  activePageId: string | undefined;
  searchQuery: string;
  onSearchChange: (v: string) => void;
  onCreatePage: (isDrawing: boolean) => void;
}) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const { favorites, pinned, recent, removeFavorite, removePin } = usePagesStore();

  const { data: pages = [], isLoading } = useQuery({
    queryKey: ['pages', slug],
    queryFn: () => listPages(slug),
    enabled: !!slug,
  });

  // Build a lookup map for resolving page names for recent/pinned/favorites
  const pagesById = useMemo(() => {
    const map = new Map<string, Page>();
    for (const p of pages) {
      map.set(p.id, p);
    }
    return map;
  }, [pages]);

  // Filter pages by search query
  const filteredPages = useMemo(() => {
    if (!searchQuery) return pages;
    const q = searchQuery.toLowerCase();
    return pages.filter((p) => p.name.toLowerCase().includes(q));
  }, [pages, searchQuery]);

  const tree = useMemo(() => buildTree(filteredPages), [filteredPages]);

  const toggleExpanded = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  // Auto-expand when there's a search query so all results are visible
  const effectiveExpanded = useMemo(() => {
    if (searchQuery) {
      const allIds = new Set(pages.map((p) => p.id));
      return allIds;
    }
    return expandedIds;
  }, [searchQuery, expandedIds, pages]);

  // Resolve pinned/favorite/recent page IDs to actual page data
  const pinnedPages = useMemo(
    () => pinned.map((id) => pagesById.get(id)).filter((p): p is Page => !!p),
    [pinned, pagesById]
  );
  const favoritePages = useMemo(
    () => favorites.map((id) => pagesById.get(id)).filter((p): p is Page => !!p),
    [favorites, pagesById]
  );
  const recentPages = useMemo(
    () => recent.slice(0, 5).map((id) => pagesById.get(id)).filter((p): p is Page => !!p),
    [recent, pagesById]
  );

  const navigate = useNavigate();

  const hasQuickAccessSections = pinnedPages.length > 0 || favoritePages.length > 0 || recentPages.length > 0;

  return (
    <div className="flex h-full flex-col border-r border-border bg-background">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-3 py-3">
        <h2 className="text-sm font-semibold">Pages</h2>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7">
              <Plus className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onClick={() => onCreatePage(false)}>
              <FilePlus className="h-4 w-4 mr-2" />
              New Page
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onCreatePage(true)}>
              <PenTool className="h-4 w-4 mr-2" />
              New Drawing
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Search */}
      <div className="px-3 py-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search pages..."
            className="h-8 pl-8 text-sm"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>
      </div>

      {/* Graph View button */}
      <div className="px-3 pb-2">
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start gap-2 text-xs h-7"
          onClick={() => navigate(`/${slug}/pages/graph`)}
        >
          <Network className="h-3.5 w-3.5" />
          Graph View
        </Button>
      </div>

      {/* Quick access sections (only when not searching) */}
      {!searchQuery && hasQuickAccessSections && (
        <div className="border-b px-1 py-1">
          {/* Pinned */}
          {pinnedPages.length > 0 && (
            <SidebarSection title="Pinned" icon={Pin}>
              {pinnedPages.map((page) => (
                <div
                  key={page.id}
                  className={cn(
                    'group flex items-center gap-1.5 rounded-md px-2 py-1 text-sm cursor-pointer transition-colors',
                    activePageId === page.id
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                  )}
                  onClick={() => navigate(`/${slug}/pages/${page.id}`)}
                >
                  <Pin className="h-3 w-3 shrink-0 text-primary" />
                  {page.is_drawing ? (
                    <PenTool className="h-3.5 w-3.5 shrink-0 text-orange-500" />
                  ) : (
                    <FileText className="h-3.5 w-3.5 shrink-0" />
                  )}
                  <span className="flex-1 truncate">{page.name || 'Untitled'}</span>
                  <button
                    className="shrink-0 h-4 w-4 items-center justify-center rounded hover:bg-muted opacity-0 group-hover:opacity-100 hidden group-hover:flex"
                    onClick={(e) => {
                      e.stopPropagation();
                      removePin(page.id);
                    }}
                    title="Unpin"
                  >
                    <Pin className="h-2.5 w-2.5" />
                  </button>
                </div>
              ))}
            </SidebarSection>
          )}

          {/* Favorites */}
          {favoritePages.length > 0 && (
            <SidebarSection title="Favorites" icon={Star}>
              {favoritePages.map((page) => (
                <div
                  key={page.id}
                  className={cn(
                    'group flex items-center gap-1.5 rounded-md px-2 py-1 text-sm cursor-pointer transition-colors',
                    activePageId === page.id
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                  )}
                  onClick={() => navigate(`/${slug}/pages/${page.id}`)}
                >
                  <Star className="h-3 w-3 shrink-0 fill-amber-500 text-amber-500" />
                  {page.is_drawing ? (
                    <PenTool className="h-3.5 w-3.5 shrink-0 text-orange-500" />
                  ) : (
                    <FileText className="h-3.5 w-3.5 shrink-0" />
                  )}
                  <span className="flex-1 truncate">{page.name || 'Untitled'}</span>
                  <button
                    className="shrink-0 h-4 w-4 items-center justify-center rounded hover:bg-muted opacity-0 group-hover:opacity-100 hidden group-hover:flex"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeFavorite(page.id);
                    }}
                    title="Remove from favorites"
                  >
                    <Star className="h-2.5 w-2.5 fill-current" />
                  </button>
                </div>
              ))}
            </SidebarSection>
          )}

          {/* Recent */}
          {recentPages.length > 0 && (
            <SidebarSection title="Recent" icon={Clock}>
              {recentPages.map((page) => (
                <div
                  key={page.id}
                  className={cn(
                    'group flex items-center gap-1.5 rounded-md px-2 py-1 text-xs cursor-pointer transition-colors',
                    activePageId === page.id
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                  )}
                  onClick={() => navigate(`/${slug}/pages/${page.id}`)}
                >
                  <Clock className="h-3 w-3 shrink-0" />
                  {page.is_drawing ? (
                    <PenTool className="h-3 w-3 shrink-0 text-orange-500" />
                  ) : (
                    <FileText className="h-3 w-3 shrink-0" />
                  )}
                  <span className="flex-1 truncate">{page.name || 'Untitled'}</span>
                  <span className="text-[10px] text-muted-foreground shrink-0">
                    {formatDistanceToNow(parseISO(page.updated_at), { addSuffix: false })}
                  </span>
                </div>
              ))}
            </SidebarSection>
          )}
        </div>
      )}

      {/* Page tree */}
      <ScrollArea className="flex-1">
        <div className="px-2 py-1">
          {isLoading ? (
            <div className="space-y-2 px-2 py-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-6 rounded bg-muted animate-pulse" />
              ))}
            </div>
          ) : tree.length === 0 ? (
            <div className="px-2 py-8 text-center">
              <p className="text-xs text-muted-foreground">
                {searchQuery ? 'No pages match your search' : 'No pages yet'}
              </p>
              {!searchQuery && (
                <Button
                  variant="link"
                  className="mt-1 h-auto p-0 text-xs"
                  onClick={() => onCreatePage(false)}
                >
                  Create your first page
                </Button>
              )}
            </div>
          ) : (
            tree.map((node) => (
              <PageTreeItem
                key={node.page.id}
                node={node}
                slug={slug}
                activePageId={activePageId}
                expandedIds={effectiveExpanded}
                onToggle={toggleExpanded}
                depth={0}
                searchQuery={searchQuery}
              />
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PageEditor — loads page detail and renders the appropriate editor
// ---------------------------------------------------------------------------

function PageEditor({ slug, pageId }: { slug: string; pageId: string }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState('');
  const { favorites, pinned, toggleFavorite, togglePin, addRecent } = usePagesStore();
  const isFav = favorites.includes(pageId);
  const isPinned = pinned.includes(pageId);

  // Track this page as recently viewed
  useEffect(() => {
    addRecent(pageId);
  }, [pageId, addRecent]);

  const { data: page, isLoading } = useQuery({
    queryKey: ['page', slug, pageId],
    queryFn: () => getPage(slug, pageId),
    enabled: !!slug && !!pageId,
  });

  const updateMutation = useMutation({
    mutationFn: (data: { name?: string }) => updatePage(slug, pageId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pages', slug] });
      qc.invalidateQueries({ queryKey: ['page', slug, pageId] });
    },
    onError: () => toast.error('Failed to update page'),
  });

  const handleNameSubmit = useCallback(() => {
    if (nameValue.trim() && nameValue !== page?.name) {
      updateMutation.mutate({ name: nameValue.trim() });
    }
    setEditingName(false);
  }, [nameValue, page, updateMutation]);

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!page) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="text-center space-y-3">
          <p className="text-muted-foreground">Page not found</p>
          <Button variant="outline" onClick={() => navigate(`/${slug}/pages`)}>
            Back to Pages
          </Button>
        </div>
      </div>
    );
  }

  const isDrawing = page.is_drawing ?? false;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Page header */}
      {!isDrawing && (
        <div className="border-b px-6 py-3 flex items-center gap-2">
          {editingName ? (
            <Input
              autoFocus
              value={nameValue}
              onChange={(e) => setNameValue(e.target.value)}
              onBlur={handleNameSubmit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleNameSubmit();
                if (e.key === 'Escape') setEditingName(false);
              }}
              className="text-lg font-semibold h-8 border-none px-0 focus-visible:ring-0"
            />
          ) : (
            <h1
              className="text-lg font-semibold cursor-pointer hover:text-primary transition-colors"
              onClick={() => {
                setNameValue(page.name);
                setEditingName(true);
              }}
              title="Click to rename"
            >
              {page.name || 'Untitled'}
            </h1>
          )}

          {/* Favorite & Pin buttons */}
          <div className="flex items-center gap-0.5 ml-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => toggleFavorite(pageId)}
              title={isFav ? 'Remove from favorites' : 'Add to favorites'}
            >
              <Star className={cn('h-4 w-4', isFav && 'fill-amber-500 text-amber-500')} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => togglePin(pageId)}
              title={isPinned ? 'Unpin' : 'Pin to top'}
            >
              <Pin className={cn('h-4 w-4', isPinned && 'fill-primary text-primary')} />
            </Button>
          </div>
        </div>
      )}

      {/* Editor area */}
      <div className="flex-1 overflow-hidden">
        {isDrawing ? (
          <DrawingBoardLazy pageId={pageId} />
        ) : (
          <DocEditorLazy pageId={pageId} />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lazy-loaded editors (avoid bundling tldraw/tiptap for every page load)
// ---------------------------------------------------------------------------

import DocEditor from '@/components/DocEditor';
import DrawingBoard from '@/components/DrawingBoard';

function DocEditorLazy({ pageId }: { pageId: string }) {
  return (
    <div className="h-full flex flex-col">
      <DocEditor pageId={pageId} />
    </div>
  );
}

function DrawingBoardLazy({ pageId }: { pageId: string }) {
  return <DrawingBoard pageId={pageId} />;
}

// ---------------------------------------------------------------------------
// Mobile back button
// ---------------------------------------------------------------------------

function MobileBackButton({ slug }: { slug: string }) {
  const navigate = useNavigate();
  return (
    <Button
      variant="ghost"
      size="sm"
      className="md:hidden mb-2"
      onClick={() => navigate(`/${slug}/pages`)}
    >
      Back to Pages
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Main PagesPage
// ---------------------------------------------------------------------------

export default function PagesPage() {
  const { slug, pageId } = useParams<{ slug: string; pageId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');

  const createMutation = useMutation({
    mutationFn: (data: { name: string; is_drawing?: boolean }) =>
      createPage(slug!, {
        name: data.name,
        ...(data.is_drawing ? { description_html: '' } : {}),
      }),
    onSuccess: (newPage) => {
      qc.invalidateQueries({ queryKey: ['pages', slug] });
      navigate(`/${slug}/pages/${newPage.id}`);
    },
    onError: () => toast.error('Failed to create page'),
  });

  const handleCreatePage = useCallback(
    (isDrawing: boolean) => {
      createMutation.mutate({
        name: isDrawing ? 'Untitled Drawing' : 'Untitled Page',
        is_drawing: isDrawing,
      });
    },
    [createMutation]
  );

  // Mobile: if pageId is set, show editor; otherwise show list
  const showMobileEditor = !!pageId;

  return (
    <div className="flex h-[calc(100vh-7.5rem)] -m-4 md:-m-6 lg:-m-8">
      {/* Left sidebar — hidden on mobile when viewing a page */}
      <div
        className={cn(
          'shrink-0 w-[280px]',
          showMobileEditor ? 'hidden md:block' : 'block'
        )}
      >
        <PageSidebar
          slug={slug!}
          activePageId={pageId}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onCreatePage={handleCreatePage}
        />
      </div>

      {/* Main area */}
      <div
        className={cn(
          'flex flex-1 flex-col min-w-0',
          !showMobileEditor ? 'hidden md:flex' : 'flex'
        )}
      >
        {pageId && slug ? (
          <>
            <MobileBackButton slug={slug!} />
            <PageEditor slug={slug} pageId={pageId} />
          </>
        ) : (
          <WelcomeState onCreatePage={handleCreatePage} />
        )}
      </div>
    </div>
  );
}
