import { useEffect, useRef } from "react";
import { Outlet, useLocation, useNavigate, useParams } from "react-router-dom";
import Sidebar from "./Sidebar";
import TopBar from "./TopBar";
import WorkspaceRail from "./WorkspaceRail";
import BottomNav from "@/components/mobile/BottomNav";
import CommandPalette from "./CommandPalette";
import { useSidebarStore } from "@/stores/sidebar";
import { useUiPrefsStore } from "@/stores/ui";
import { useWorkspaces } from "@/hooks/useWorkspaces";
import { useNavProjects } from "@/hooks/useMyWork";

/** True while the user is typing, or a dialog/menu owns the keyboard. */
function keyboardBusy(target: EventTarget | null): boolean {
  if (target instanceof HTMLElement) {
    const tag = target.tagName;
    if (
      tag === "INPUT" ||
      tag === "TEXTAREA" ||
      tag === "SELECT" ||
      target.isContentEditable
    ) {
      return true;
    }
  }
  return !!document.querySelector(
    '[role="dialog"], [role="menu"], [role="listbox"]',
  );
}

// Cmd/Ctrl+B toggles the sidebar. Plain keys (no modifiers, not while typing):
// c = new issue, g t = Today, g p = project, / = focus the issue filter.
function ShellShortcuts() {
  const toggle = useSidebarStore((s) => s.toggle);
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { primary } = useNavProjects(slug);
  const goPrefix = useRef(0);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "b" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        toggle();
        return;
      }
      if (
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        e.repeat ||
        keyboardBusy(e.target)
      )
        return;
      if (!slug) return;

      const awaitingGo = Date.now() - goPrefix.current < 1200;
      goPrefix.current = 0;
      const projectPath = primary
        ? `/${slug}/projects/${primary.id}`
        : `/${slug}/projects`;

      if (e.key === "g") {
        goPrefix.current = Date.now();
      } else if (awaitingGo && e.key === "t") {
        navigate(`/${slug}`);
      } else if (awaitingGo && e.key === "p") {
        navigate(projectPath);
      } else if (e.key === "c" && primary) {
        e.preventDefault();
        navigate(`${projectPath}?new=1`);
      } else if (e.key === "/") {
        const input = document.querySelector<HTMLInputElement>(
          "input[data-issue-search]",
        );
        if (input) {
          e.preventDefault();
          input.focus();
          input.select();
        }
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, [toggle, slug, primary, navigate]);
  return null;
}

// Sub-paths that have a meaningful cross-workspace aggregate view under /all.
// Anything else (Settings, Timesheet, single Page/Contact/Pipeline detail) gets
// redirected into the user's first workspace so the page gets a real slug.
const ALL_ALLOWED_SUBPATHS = new Set([
  "",
  "/issues",
  "/projects",
  "/pages",
  "/crm",
  "/crm/contacts",
  "/crm/companies",
  "/crm/pipelines",
]);

function useAllModeGuard() {
  const { slug } = useParams<{ slug: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { data: workspaces = [] } = useWorkspaces();

  useEffect(() => {
    if (slug !== "all") return;
    const rest = location.pathname.replace(/^\/all/, "");
    if (ALL_ALLOWED_SUBPATHS.has(rest)) return;
    const first = workspaces[0]?.slug;
    if (!first) return;
    navigate(`/${first}${rest}`, { replace: true });
  }, [slug, location.pathname, workspaces, navigate]);
}

export default function AppShell() {
  useAllModeGuard();
  const workspaceRail = useUiPrefsStore((s) => s.workspaceRail);

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-background">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-background focus:px-3 focus:py-1.5 focus:text-sm focus:shadow"
      >
        Skip to content
      </a>

      {/* Experimental workspace rail — far left, replaces the switcher dropdown */}
      {workspaceRail && <WorkspaceRail />}

      {/* Sidebar rail (md+; mobile uses BottomNav) */}
      <Sidebar />

      {/* Main area */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopBar />

        {/* Page content - with bottom padding on mobile for bottom nav */}
        <main id="main" className="flex-1 overflow-y-auto">
          <div className="p-4 pb-20 md:p-6 md:pb-6 lg:p-8 lg:pb-8">
            <Outlet />
          </div>
        </main>
      </div>

      {/* Mobile bottom navigation */}
      <BottomNav />

      {/* Command palette (Cmd+K) */}
      <CommandPalette />

      <ShellShortcuts />
    </div>
  );
}
