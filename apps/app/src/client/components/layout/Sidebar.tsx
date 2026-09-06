import { useState } from "react";
import { useNavigate, useLocation, useParams } from "react-router-dom";
import {
  FolderKanban,
  Circle,
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
  LayoutDashboard,
  Layers,
  Gauge,
} from "@/lib/icons";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth";
import { useSidebarStore } from "@/stores/sidebar";
import { useUiPrefsStore } from "@/stores/ui";
import { useWorkspaceStore } from "@/stores/workspace";
import { useWorkspaces } from "@/hooks/useWorkspaces";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import UserMenu from "@/components/layout/UserMenu";
import CreateWorkspaceDialog from "@/components/layout/CreateWorkspaceDialog";
import { WorkspaceMenuItems } from "@/components/layout/WorkspaceSwitcher";

interface NavItem {
  to: string;
  icon: React.ElementType;
  label: string;
  end?: boolean;
  /** Absolute route (not slug-scoped), e.g. /panes. */
  absolute?: boolean;
}

const navGroups: { label: string; items: NavItem[] }[] = [
  {
    label: "Workspace",
    items: [
      { to: "", icon: LayoutDashboard, label: "Dashboard", end: true },
      { to: "projects", icon: FolderKanban, label: "Projects" },
      { to: "/panes", icon: Columns3, label: "Panes", absolute: true },
    ],
  },
  {
    label: "Your Work",
    items: [
      { to: "issues", icon: Circle, label: "My Issues" },
      { to: "timesheet", icon: Timer, label: "Timesheet" },
      { to: "pages", icon: FileText, label: "Pages" },
    ],
  },
  {
    label: "Manage",
    items: [
      { to: "crm", icon: Users, label: "CRM" },
      { to: "crm/companies", icon: Building2, label: "Companies" },
      { to: "integrations", icon: Puzzle, label: "Integrations" },
      { to: "strategy", icon: Gauge, label: "Strategy" },
      { to: "admin", icon: Shield, label: "Admin" },
      { to: "settings", icon: Settings, label: "Settings" },
    ],
  },
];

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

  const activeSlug = currentSlug ?? slug;
  const isAll = activeSlug === "all";
  const basePath = `/${slug ?? ""}`;

  const isActive = (item: NavItem) => {
    if (item.end) return location.pathname === basePath;
    // Absolute items (Panes) live outside the workspace slug scope.
    if (item.absolute)
      return location.pathname === item.to || location.pathname.startsWith(`${item.to}/`);
    return location.pathname.startsWith(`${basePath}/${item.to}`);
  };

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
                <WorkspaceMenuItems onCreateWorkspace={() => setCreateOpen(true)} />
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {navGroups.map((group, gi) => (
            <div key={group.label}>
              <div
                className={cn(
                  "px-2.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground",
                  collapsed ? "hidden" : cn(gi === 0 ? "mt-3" : "mt-4", "mb-1"),
                )}
              >
                {group.label}
              </div>
              {group.items.map((item) => {
                const active = isActive(item);
                const Icon = item.icon;
                const row = (
                  <button
                    onClick={() => go(item.to, item.absolute)}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex h-7 w-full min-w-0 items-center gap-2.5 rounded-md px-2.5 text-[13px] outline-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
                      collapsed && "justify-center px-0",
                      active
                        ? "bg-accent font-medium text-foreground"
                        : "text-foreground/80 hover:bg-accent hover:text-foreground",
                    )}
                  >
                    <Icon
                      className={cn(
                        "size-4 shrink-0",
                        active ? "text-foreground" : "text-muted-foreground",
                      )}
                    />
                    <span className={cn("min-w-0 truncate", collapsed && "hidden")}>
                      {item.label}
                    </span>
                  </button>
                );
                // Collapsed: the label is gone, so surface it as a tooltip.
                return collapsed ? (
                  <Tooltip key={item.to}>
                    <TooltipTrigger asChild>{row}</TooltipTrigger>
                    <TooltipContent side="right">{item.label}</TooltipContent>
                  </Tooltip>
                ) : (
                  <span key={item.to} className="contents">
                    {row}
                  </span>
                );
              })}
            </div>
          ))}
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
    </TooltipProvider>
  );
}
