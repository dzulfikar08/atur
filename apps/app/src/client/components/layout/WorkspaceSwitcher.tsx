import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ChevronDown, Layers, Plus } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { useWorkspaceStore } from "@/stores/workspace";
import { useWorkspaces } from "@/hooks/useWorkspaces";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import CreateWorkspaceDialog from "@/components/layout/CreateWorkspaceDialog";

/**
 * Shared dropdown items for the workspace switchers (sidebar + top bar):
 * "All Workspaces", the user's workspaces, then "Create workspace".
 * `onCreateWorkspace` opens the host's CreateWorkspaceDialog — the dialog
 * state lives with the host so it survives the menu closing.
 */
export function WorkspaceMenuItems({ onCreateWorkspace }: { onCreateWorkspace: () => void }) {
  const navigate = useNavigate();
  const { data: workspaces = [] } = useWorkspaces();
  const { currentSlug, switchWorkspace } = useWorkspaceStore();

  return (
    <>
      <DropdownMenuItem onClick={() => navigate(switchWorkspace("all"))}>
        <span className="text-muted-foreground">
          <Layers size={16} />
        </span>
        <span className={cn(currentSlug === "all" && "font-medium")}>All Workspaces</span>
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      {workspaces.map((ws) => (
        <DropdownMenuItem key={ws.id} onClick={() => navigate(switchWorkspace(ws.slug))}>
          {ws.logo ? (
            <img src={ws.logo} alt="" className="size-4 rounded object-cover" />
          ) : (
            <span className="flex size-4 items-center justify-center rounded bg-primary text-[10px] font-semibold text-primary-foreground">
              {(ws.name[0] ?? "").toUpperCase()}
            </span>
          )}
          <span className={cn(ws.slug === currentSlug && "font-medium")}>{ws.name}</span>
        </DropdownMenuItem>
      ))}
      {workspaces.length === 0 && <DropdownMenuItem disabled>No workspaces</DropdownMenuItem>}
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={onCreateWorkspace}>
        <span className="text-muted-foreground">
          <Plus size={16} />
        </span>
        Create workspace
      </DropdownMenuItem>
    </>
  );
}

/**
 * WorkspaceSwitcher — compact trigger + dropdown for the TopBar. The sidebar
 * switcher is md+ and the experimental rail lg+, so TopBar mounts this only on
 * the breakpoints where neither is visible (see TopBar) — that keeps exactly
 * one switcher on screen at any size.
 */
export default function WorkspaceSwitcher() {
  const { slug } = useParams<{ slug: string }>();
  const { data: workspaces = [] } = useWorkspaces();
  const { currentSlug } = useWorkspaceStore();
  const [createOpen, setCreateOpen] = useState(false);

  const activeSlug = currentSlug ?? slug;
  const isAll = activeSlug === "all";
  const current = workspaces.find((w) => w.slug === activeSlug);
  const currentName = isAll
    ? "All Workspaces"
    : (current?.name ?? currentSlug ?? slug ?? "Workspace");

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`Workspace: ${currentName}`}
          className="flex h-8 min-w-0 max-w-[10rem] items-center gap-2 rounded-lg border border-input bg-muted/60 px-2 text-foreground shadow-soft outline-none transition-colors hover:bg-muted hover:border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          {isAll || !current?.logo ? (
            <span className="flex size-5 shrink-0 items-center justify-center rounded bg-primary text-[10px] font-semibold text-primary-foreground">
              {isAll ? <Layers size={11} /> : currentName.charAt(0).toUpperCase()}
            </span>
          ) : (
            <img src={current.logo} alt="" className="size-5 shrink-0 rounded object-cover" />
          )}
          <span className="hidden min-w-0 truncate text-[13px] font-medium sm:inline">
            {currentName}
          </span>
          <ChevronDown size={14} className="shrink-0 text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <WorkspaceMenuItems onCreateWorkspace={() => setCreateOpen(true)} />
        </DropdownMenuContent>
      </DropdownMenu>

      <CreateWorkspaceDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}
