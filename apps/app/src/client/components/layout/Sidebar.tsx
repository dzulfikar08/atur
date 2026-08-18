import { useState } from "react";
import { useNavigate, useLocation, useParams } from "react-router-dom";
import { Sidebar as KumoSidebar, DropdownMenu } from "@cloudflare/kumo";
import {
  FolderSimple,
  Circle,
  Timer,
  FileText,
  Users,
  PuzzlePiece,
  ShieldCheck,
  GearSix,
  CaretDown,
  Plus,
  SquaresFour,
  Stack,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth";
import { useWorkspaceStore } from "@/stores/workspace";
import { useWorkspaces } from "@/hooks/useWorkspaces";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import UserMenu from "@/components/layout/UserMenu";
import CreateWorkspaceDialog from "@/components/layout/CreateWorkspaceDialog";

interface NavItem {
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  end?: boolean;
}

const navGroups: { label: string; items: NavItem[] }[] = [
  {
    label: "Workspace",
    items: [
      { to: "", icon: SquaresFour, label: "Dashboard", end: true },
      { to: "projects", icon: FolderSimple, label: "Projects" },
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
      { to: "integrations", icon: PuzzlePiece, label: "Integrations" },
      { to: "admin", icon: ShieldCheck, label: "Admin" },
      { to: "settings", icon: GearSix, label: "Settings" },
    ],
  },
];

const itemRow =
  "min-h-7! flex w-full min-w-0 cursor-pointer items-center gap-2.5 rounded-lg px-3 py-0 outline-none transition-colors group-data-[state=collapsed]/sidebar:justify-center group-data-[state=collapsed]/sidebar:px-0";

/**
 * Sidebar (Kumo) — the app's navigation rail, built on @cloudflare/kumo.
 * Linear-style: workspace switcher sits flush with the nav rows (no header
 * bar), items are 28px, active row gets a left accent bar (see
 * .kumo-active-accent in index.css).
 */
export default function Sidebar() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuthStore((s) => s.user);
  const { data: workspaces = [] } = useWorkspaces();
  const { currentSlug, switchWorkspace } = useWorkspaceStore();
  const [createOpen, setCreateOpen] = useState(false);

  const activeSlug = currentSlug ?? slug;
  const isAll = activeSlug === "all";
  const basePath = `/${slug ?? ""}`;

  const isActive = (item: NavItem) => {
    if (item.end) return location.pathname === basePath;
    return location.pathname.startsWith(`${basePath}/${item.to}`);
  };

  const go = (to: string) => navigate(`${basePath}/${to}`.replace(/\/$/, ""));

  const initials =
    user?.display_name
      ?.split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2) ?? "U";

  const currentName = isAll
    ? "All Workspaces"
    : (workspaces.find((w) => w.slug === activeSlug)?.name ??
      currentSlug ??
      slug ??
      "Workspace");

  return (
    <KumoSidebar>
      <KumoSidebar.Content>
        {/* Workspace switcher — Linear-style row, flush with nav items */}
        <DropdownMenu>
          <DropdownMenu.Trigger
            className={cn(
              itemRow,
              "gap-2.5 text-kumo-strong hover:bg-(--color-kumo-interact)",
            )}
          >
            {isAll ? (
              <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Stack size={16} weight="bold" />
              </div>
            ) : (() => {
              const cws = workspaces.find((w) => w.slug === activeSlug);
              if (cws?.logo) {
                return (
                  <img src={cws.logo} alt="" className="size-7 shrink-0 rounded-lg object-cover" />
                );
              }
              return (
                <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary text-xs font-semibold text-primary-foreground">
                  {currentName.charAt(0).toUpperCase()}
                </div>
              );
            })()}
            <span className="min-w-0 flex-1 truncate text-sm font-medium group-data-[state=collapsed]/sidebar:hidden">
              {currentName}
            </span>
            <CaretDown
              size={14}
              className="shrink-0 text-kumo-subtle group-data-[state=collapsed]/sidebar:hidden"
            />
          </DropdownMenu.Trigger>
          <DropdownMenu.Content align="start" className="w-56">
            <DropdownMenu.Item selected={isAll} onClick={() => navigate(switchWorkspace("all"))}>
              <Stack size={16} />
              All Workspaces
            </DropdownMenu.Item>
            <DropdownMenu.Separator />
            {workspaces.map((ws) => (
              <DropdownMenu.Item
                key={ws.id}
                selected={ws.slug === currentSlug}
                onClick={() => navigate(switchWorkspace(ws.slug))}
              >
                {ws.logo ? (
                  <img src={ws.logo} alt="" className="size-4 rounded object-cover" />
                ) : (
                  <span className="flex size-4 items-center justify-center rounded bg-primary text-[10px] font-semibold text-primary-foreground">
                    {(ws.name[0] ?? "").toUpperCase()}
                  </span>
                )}
                {ws.name}
              </DropdownMenu.Item>
            ))}
            {workspaces.length === 0 && (
              <DropdownMenu.Item disabled>No workspaces</DropdownMenu.Item>
            )}
            <DropdownMenu.Separator />
            <DropdownMenu.Item onClick={() => setCreateOpen(true)}>
              <Plus size={16} />
              Create workspace
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu>

        {navGroups.map((group) => (
          <KumoSidebar.Group key={group.label}>
            <KumoSidebar.GroupLabel>{group.label}</KumoSidebar.GroupLabel>
            <KumoSidebar.Menu>
              {group.items.map((item) => (
                <KumoSidebar.MenuButton
                  key={item.to}
                  icon={item.icon}
                  active={isActive(item)}
                  tooltip={item.label}
                  onClick={() => go(item.to)}
                  className={cn(
                    itemRow,
                    isActive(item) && "kumo-active-accent text-kumo-strong",
                  )}
                >
                  {item.label}
                </KumoSidebar.MenuButton>
              ))}
            </KumoSidebar.Menu>
          </KumoSidebar.Group>
        ))}
      </KumoSidebar.Content>

      <KumoSidebar.Footer>
        <div className="flex items-center gap-1 px-2 py-2 group-data-[state=collapsed]/sidebar:justify-center">
          <UserMenu
            side="top"
            align="start"
            trigger={
              <button
                className="flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-(--color-kumo-interact) group-data-[state=collapsed]/sidebar:px-0"
                aria-label="Account menu"
              >
                <Avatar className="size-7 shrink-0">
                  {user?.avatar ? (
                    <AvatarImage src={user.avatar} alt={user.display_name ?? "User"} />
                  ) : null}
                  <AvatarFallback className="text-[10px]">{initials}</AvatarFallback>
                </Avatar>
                <span className="min-w-0 flex-1 text-left group-data-[state=collapsed]/sidebar:hidden">
                  <span className="block truncate text-[13px] font-medium leading-tight text-kumo-strong">
                    {user?.display_name ?? "User"}
                  </span>
                  <span className="block truncate text-[11px] leading-tight text-kumo-subtle">
                    {user?.email ?? ""}
                  </span>
                </span>
              </button>
            }
          />
          <KumoSidebar.Trigger className="group-data-[state=collapsed]/sidebar:hidden" />
        </div>
      </KumoSidebar.Footer>

      <CreateWorkspaceDialog open={createOpen} onOpenChange={setCreateOpen} />
    </KumoSidebar>
  );
}