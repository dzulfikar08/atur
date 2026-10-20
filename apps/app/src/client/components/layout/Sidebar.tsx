import { useEffect, useState } from "react";
import { useNavigate, useLocation, useParams } from "react-router-dom";
import {
  FolderKanban,
  Circle,
  StickyNote,
  Timer,
  FileText,
  Users,
  Building2,
  Puzzle,
  Shield,
  Settings,
  ChevronDown,
  ChevronRight,
  Columns3,
  CalendarDays,
  Layers,
  Star,
  Gauge,
  Monitor,
} from "@/lib/icons";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth";
import { useSidebarStore } from "@/stores/sidebar";
import { useUiPrefsStore } from "@/stores/ui";
import { useWorkspaceStore } from "@/stores/workspace";
import { useWorkspaces } from "@/hooks/useWorkspaces";
import { useNavProjects, useToday } from "@/hooks/useMyWork";
import { useProjectNavStore } from "@/stores/projectNav";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import UserMenu from "@/components/layout/UserMenu";
import CreateWorkspaceDialog from "@/components/layout/CreateWorkspaceDialog";
import ManageWorkspacesDialog from "@/components/layout/ManageWorkspaces";
import { WorkspaceMenuItems } from "@/components/layout/WorkspaceSwitcher";

interface NavItem {
  to: string;
  icon: React.ElementType;
  label: string;
  end?: boolean;
  /** Absolute route (not slug-scoped), e.g. /panes. */
  absolute?: boolean;
}

const topItems: NavItem[] = [
  { to: "", icon: CalendarDays, label: "Today", end: true },
  { to: "issues", icon: Circle, label: "My Issues" },
];

const workItems: NavItem[] = [
  { to: "notes", icon: StickyNote, label: "Notes" },
  { to: "timesheet", icon: Timer, label: "Timesheet" },
  { to: "pages", icon: FileText, label: "Pages" },
  { to: "/panes", icon: Columns3, label: "Panes", absolute: true },
];

// Desktop sharing: platform owner only (the Worker enforces it too).
const screenItem: NavItem = { to: "/screen", icon: Monitor, label: "Screen", absolute: true };

// Rarely used day to day: folded away until opened (or until one is active).
const manageItems: NavItem[] = [
  { to: "crm", icon: Users, label: "CRM" },
  { to: "crm/companies", icon: Building2, label: "Companies" },
  { to: "integrations", icon: Puzzle, label: "Integrations" },
  { to: "strategy", icon: Gauge, label: "Strategy" },
  { to: "admin", icon: Shield, label: "Admin" },
  { to: "settings", icon: Settings, label: "Settings" },
];

const MAX_PROJECT_ROWS = 6;

function SectionLabel({
  collapsed,
  first,
  children,
}: {
  collapsed: boolean;
  first: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "px-2.5 text-[length:var(--text-meta)] font-medium uppercase tracking-wide text-muted-foreground",
        collapsed ? "hidden" : cn(first ? "mt-3" : "mt-4", "mb-1"),
      )}
    >
      {children}
    </div>
  );
}

function NavRow({
  item,
  active,
  collapsed,
  onGo,
  badge,
}: {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
  onGo: (to: string, absolute?: boolean) => void;
  badge?: number;
}) {
  const Icon = item.icon;
  const row = (
    <button
      onClick={() => onGo(item.to, item.absolute)}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex h-7 w-full min-w-0 items-center gap-2.5 rounded-md px-2.5 text-[13px] outline-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
        collapsed && "justify-center px-0",
        active
          ? "bg-accent font-medium text-foreground"
          : "text-foreground/80 hover:bg-accent hover:text-foreground",
      )}
    >
      <Icon
        className={cn("size-4 shrink-0", active ? "text-foreground" : "text-muted-foreground")}
      />
      <span className={cn("min-w-0 flex-1 truncate text-left", collapsed && "hidden")}>
        {item.label}
      </span>
      {badge ? (
        <span
          className={cn(
            "shrink-0 rounded-full bg-[var(--priority-urgent)] px-1.5 text-[length:var(--text-meta)] font-semibold tabular-nums leading-[18px] text-white",
            collapsed && "absolute right-0.5 top-0.5 size-2 p-0 text-[0px]",
          )}
          aria-label={`${badge} overdue`}
        >
          {badge}
        </span>
      ) : null}
    </button>
  );
  // Collapsed: the label is gone, so surface it as a tooltip.
  return collapsed ? (
    <Tooltip>
      <TooltipTrigger asChild>{row}</TooltipTrigger>
      <TooltipContent side="right">
        {item.label}
        {badge ? ` (${badge} overdue)` : ""}
      </TooltipContent>
    </Tooltip>
  ) : (
    row
  );
}

/**
 * Sidebar — the app's navigation rail, Linear-style graphite.
 * Plain flex + Tailwind over the app's design tokens (no component library):
 * workspace switcher flush with the nav rows (no header bar), 28px rows,
 * tiny uppercase group labels, footer with user menu + collapse toggle.
 * Collapse state lives in useSidebarStore (footer button or Cmd/Ctrl+B).
 * Mobile uses BottomNav instead — the rail is md+ only.
 */
export default function Sidebar() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuthStore((s) => s.user);
  const collapsed = useSidebarStore((s) => s.collapsed);
  const toggle = useSidebarStore((s) => s.toggle);
  const { data: workspaces = [] } = useWorkspaces();
  const { currentSlug } = useWorkspaceStore();
  const workspaceRail = useUiPrefsStore((s) => s.workspaceRail);
  const [createOpen, setCreateOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [manageWsOpen, setManageWsOpen] = useState(false);

  const activeSlug = currentSlug ?? slug;
  const isAll = activeSlug === "all";
  // Non-slug routes (/panes, /admin) keep nav pointed at the last workspace.
  const basePath = `/${slug ?? currentSlug ?? ""}`;

  const isActive = (item: NavItem) => {
    if (item.end) return location.pathname === basePath;
    // Absolute items (Panes) live outside the workspace slug scope.
    if (item.absolute)
      return location.pathname === item.to || location.pathname.startsWith(`${item.to}/`);
    return location.pathname.startsWith(`${basePath}/${item.to}`);
  };

  const manageActive = manageItems.some(isActive);
  const showManage = manageOpen || manageActive;

  const today = useToday(activeSlug ?? undefined);
  const overdue = today.data?.counts.overdue ?? 0;

  const { pinned, recent, ordered } = useNavProjects(isAll ? undefined : (activeSlug ?? undefined));
  const trackVisit = useProjectNavStore((st) => st.trackVisit);
  const togglePin = useProjectNavStore((st) => st.togglePin);
  const pinnedIds = new Set(pinned.map((p) => p.id));
  const sidebarProjects = (
    pinned.length + recent.length > 0 ? [...pinned, ...recent] : ordered
  ).slice(0, MAX_PROJECT_ROWS);

  // Remember the project being viewed so it floats into the Projects section.
  const visitedProjectId = new RegExp(`^/${slug}/projects/([^/]+)`).exec(location.pathname)?.[1];
  useEffect(() => {
    if (slug && slug !== "all" && visitedProjectId) trackVisit(slug, visitedProjectId);
  }, [slug, visitedProjectId, trackVisit]);

  const go = (to: string, absolute?: boolean) =>
    navigate(absolute ? to : `${basePath}/${to}`.replace(/\/$/, ""));

  const initials =
    user?.display_name
      ?.split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2) ?? "U";

  const currentName = isAll
    ? "All Workspaces"
    : (workspaces.find((w) => w.slug === activeSlug)?.name ?? currentSlug ?? slug ?? "Workspace");

  return (
    <TooltipProvider delayDuration={300}>
      <aside
        className={cn(
          "hidden h-full shrink-0 flex-col overflow-hidden border-r border-border bg-card text-foreground transition-[width] duration-200 md:flex",
          collapsed ? "w-[52px]" : "w-60",
        )}
      >
        <nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overflow-x-hidden px-1.5 py-2">
          {/* Workspace switcher — Linear-style row, flush with nav items.
              With the experimental workspace rail enabled, show a static
              current-workspace row instead (the rail handles switching). */}
          {workspaceRail ? (
            <div
              className={cn(
                "flex h-7 w-full min-w-0 items-center gap-2.5 rounded-md px-2.5",
                collapsed && "justify-center px-0",
              )}
            >
              {isAll ? (
                <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  <Layers size={16} />
                </div>
              ) : (
                (() => {
                  const cws = workspaces.find((w) => w.slug === activeSlug);
                  if (cws?.logo) {
                    return (
                      <img
                        src={cws.logo}
                        alt=""
                        className="size-7 shrink-0 rounded-lg object-cover"
                      />
                    );
                  }
                  return (
                    <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary text-xs font-semibold text-primary-foreground">
                      {currentName.charAt(0).toUpperCase()}
                    </div>
                  );
                })()
              )}
              <span
                className={cn(
                  "min-w-0 flex-1 truncate text-left text-[13px] font-medium",
                  collapsed && "hidden",
                )}
              >
                {currentName}
              </span>
            </div>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label={currentName}
                className={cn(
                  "flex h-7 w-full min-w-0 items-center gap-2.5 rounded-md px-2.5 outline-none transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
                  collapsed && "justify-center px-0",
                )}
              >
                {isAll ? (
                  <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                    <Layers size={16} />
                  </div>
                ) : (
                  (() => {
                    const cws = workspaces.find((w) => w.slug === activeSlug);
                    if (cws?.logo) {
                      return (
                        <img
                          src={cws.logo}
                          alt=""
                          className="size-7 shrink-0 rounded-lg object-cover"
                        />
                      );
                    }
                    return (
                      <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary text-xs font-semibold text-primary-foreground">
                        {currentName.charAt(0).toUpperCase()}
                      </div>
                    );
                  })()
                )}
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate text-left text-[13px] font-medium",
                    collapsed && "hidden",
                  )}
                >
                  {currentName}
                </span>
                <span className={cn("shrink-0 text-muted-foreground", collapsed && "hidden")}>
                  <ChevronDown size={14} />
                </span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                <WorkspaceMenuItems
                  onCreateWorkspace={() => setCreateOpen(true)}
                  onManageWorkspaces={() => setManageWsOpen(true)}
                />
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          <div className="mt-2 flex flex-col gap-0.5">
            {topItems.map((item) => (
              <NavRow
                key={item.to}
                item={item}
                active={isActive(item)}
                collapsed={collapsed}
                onGo={go}
                badge={item.end && overdue > 0 ? overdue : undefined}
              />
            ))}
          </div>

          {!isAll && (
            <div>
              <SectionLabel collapsed={collapsed} first={false}>
                Projects
              </SectionLabel>
              {sidebarProjects.map((project) => {
                const active = location.pathname.startsWith(`${basePath}/projects/${project.id}`);
                const isPinned = pinnedIds.has(project.id);
                const row = (
                  <div className="group relative flex">
                    <button
                      onClick={() => navigate(`${basePath}/projects/${project.id}`)}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex h-7 w-full min-w-0 items-center gap-2.5 rounded-md px-2.5 text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/60",
                        collapsed && "justify-center px-0",
                        active
                          ? "bg-accent font-medium text-foreground"
                          : "text-foreground/80 hover:bg-accent hover:text-foreground",
                      )}
                    >
                      <FolderKanban
                        className={cn(
                          "size-4 shrink-0",
                          active ? "text-foreground" : "text-muted-foreground",
                        )}
                      />
                      <span className={cn("min-w-0 truncate", collapsed && "hidden")}>
                        {project.name}
                      </span>
                    </button>
                    {!collapsed && (
                      <button
                        onClick={() => togglePin(slug ?? activeSlug ?? "", project.id)}
                        aria-label={isPinned ? `Unpin ${project.name}` : `Pin ${project.name}`}
                        aria-pressed={isPinned}
                        className={cn(
                          "absolute right-1 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground outline-none transition-opacity hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/60",
                          isPinned ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                        )}
                      >
                        <Star
                          className={cn(
                            "size-3.5",
                            isPinned && "fill-current text-[var(--state-amber)]",
                          )}
                        />
                      </button>
                    )}
                  </div>
                );
                return collapsed ? (
                  <Tooltip key={project.id}>
                    <TooltipTrigger asChild>{row}</TooltipTrigger>
                    <TooltipContent side="right">{project.name}</TooltipContent>
                  </Tooltip>
                ) : (
                  <span key={project.id} className="contents">
                    {row}
                  </span>
                );
              })}
              <NavRow
                item={{ to: "projects", icon: Layers, label: "All projects" }}
                active={location.pathname === `${basePath}/projects`}
                collapsed={collapsed}
                onGo={go}
              />
            </div>
          )}

          <div>
            <SectionLabel collapsed={collapsed} first={false}>
              Work
            </SectionLabel>
            {(user?.is_superuser ? [...workItems, screenItem] : workItems).map((item) => (
              <NavRow
                key={item.to}
                item={item}
                active={isActive(item)}
                collapsed={collapsed}
                onGo={go}
              />
            ))}
          </div>

          <div>
            {collapsed ? (
              <div className="mt-2 border-t border-border" />
            ) : (
              <button
                onClick={() => setManageOpen((o) => !o)}
                aria-expanded={showManage}
                className="mb-1 mt-4 flex w-full items-center gap-1 px-2.5 text-left text-[length:var(--text-meta)] font-medium uppercase tracking-wide text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
              >
                Manage
                {showManage ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              </button>
            )}
            {(showManage || collapsed) &&
              manageItems.map((item) => (
                <NavRow
                  key={item.to}
                  item={item}
                  active={isActive(item)}
                  collapsed={collapsed}
                  onGo={go}
                />
              ))}
          </div>
        </nav>

        {/* Footer — user menu + collapse toggle */}
        <div
          className={cn(
            "flex items-center gap-1 border-t border-border px-1.5 py-2",
            collapsed && "flex-col justify-center",
          )}
        >
          <UserMenu
            side="top"
            align="start"
            trigger={
              <button
                className={cn(
                  "flex items-center gap-2 rounded-md outline-none transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
                  collapsed ? "p-1.5" : "px-2 py-1.5",
                )}
                aria-label="Account menu"
              >
                <Avatar className="size-7 shrink-0">
                  {user?.avatar ? (
                    <AvatarImage src={user.avatar} alt={user.display_name ?? "User"} />
                  ) : null}
                  <AvatarFallback className="text-[10px]">{initials}</AvatarFallback>
                </Avatar>
                <span className={cn("min-w-0 flex-1 text-left", collapsed && "hidden")}>
                  <span className="block truncate text-[13px] font-medium leading-tight">
                    {user?.display_name ?? "User"}
                  </span>
                  <span className="block truncate text-[11px] leading-tight text-muted-foreground">
                    {user?.email ?? ""}
                  </span>
                </span>
              </button>
            }
          />
          <button
            onClick={toggle}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            <span className={cn("transition-transform", !collapsed && "rotate-180")}>
              <ChevronRight size={14} />
            </span>
          </button>
        </div>
      </aside>

      <CreateWorkspaceDialog open={createOpen} onOpenChange={setCreateOpen} />
      <ManageWorkspacesDialog open={manageWsOpen} onOpenChange={setManageWsOpen} />
    </TooltipProvider>
  );
}
