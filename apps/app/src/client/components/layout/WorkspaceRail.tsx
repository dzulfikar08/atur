import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Plus, Layers } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { useWorkspaceStore } from "@/stores/workspace";
import { useWorkspaces } from "@/hooks/useWorkspaces";
import CreateWorkspaceDialog from "@/components/layout/CreateWorkspaceDialog";

/**
 * WorkspaceRail — "most-left" icon rail of the user's workspaces (Linear-style):
 * logo/letter tiles stacked vertically, active workspace ringed, "+" to create.
 * Replaces the dropdown switcher in the main sidebar. Opt-out via
 * Profile & Settings → Experimental (useUiPrefsStore.workspaceRail).
 * lg+ only; mobile keeps the bottom-sheet switcher.
 */
export default function WorkspaceRail() {
  const navigate = useNavigate();
  const { slug } = useParams<{ slug: string }>();
  const { data: workspaces = [] } = useWorkspaces();
  const { currentSlug, switchWorkspace } = useWorkspaceStore();
  const [createOpen, setCreateOpen] = useState(false);

  const activeSlug = currentSlug ?? slug;
  const isAll = activeSlug === "all";

  const tile = (ws: { logo?: string | null; name: string }, className?: string) =>
    ws.logo ? (
      <img src={ws.logo} alt="" className={cn("rounded-md object-cover", className)} />
    ) : (
      <span
        className={cn(
          "flex items-center justify-center rounded-md bg-primary font-semibold text-primary-foreground",
          className,
        )}
      >
        {(ws.name[0] ?? "").toUpperCase()}
      </span>
    );

  return (
    <>
      <aside className="hidden h-full w-[52px] shrink-0 flex-col items-center overflow-hidden border-r border-border bg-card py-2 lg:flex">
        <button
          onClick={() => navigate(switchWorkspace("all"))}
          aria-current={isAll ? "page" : undefined}
          title="All workspaces"
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-lg outline-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
            isAll
              ? "bg-accent text-foreground ring-2 ring-foreground/80"
              : "text-foreground/80 hover:bg-accent hover:text-foreground",
          )}
        >
          <Layers size={17} />
        </button>

        <div className="my-1 h-px w-5 shrink-0 bg-border" />

        <nav className="flex min-h-0 flex-1 flex-col items-center gap-2.5 overflow-y-auto py-1.5">
          {workspaces.map((ws) => {
            const active = ws.slug === activeSlug;
            return (
              <button
                key={ws.id}
                onClick={() => navigate(switchWorkspace(ws.slug))}
                aria-current={active ? "page" : undefined}
                title={ws.name}
                className={cn(
                  "flex size-9 shrink-0 items-center justify-center rounded-lg outline-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
                  active ? "bg-accent ring-2 ring-foreground/80" : "hover:bg-accent",
                )}
              >
                {tile(ws, "size-9 text-[13px]")}
              </button>
            );
          })}
        </nav>

        <button
          onClick={() => setCreateOpen(true)}
          title="Create workspace"
          className="flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          <Plus size={17} />
        </button>
      </aside>

      <CreateWorkspaceDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}
