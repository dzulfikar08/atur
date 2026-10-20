import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useWorkspaceStore } from "@/stores/workspace";
import { useWorkspaces } from "@/hooks/useWorkspaces";
import { useHiddenWorkspaces } from "@/hooks/useHiddenWorkspaces";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * One row per workspace with a switch controlling whether it shows in the
 * workspace switchers. Saves immediately (optimistic); used by the manage
 * dialog and the Profile & Settings page.
 */
export function WorkspaceVisibilityList({ className }: { className?: string }) {
  const { t } = useTranslation();
  const { slug } = useParams<{ slug: string }>();
  const { currentSlug } = useWorkspaceStore();
  const { data: workspaces = [] } = useWorkspaces();
  const { hiddenIds, setHidden } = useHiddenWorkspaces();
  const activeSlug = currentSlug ?? slug;
  const hiddenSet = new Set(hiddenIds);

  if (workspaces.length === 0) {
    return <p className="py-2 text-sm text-muted-foreground">{t("workspaceSwitcher.empty")}</p>;
  }

  return (
    <ul className={cn("divide-y", className)}>
      {workspaces.map((ws) => {
        const shown = !hiddenSet.has(ws.id);
        return (
          <li key={ws.id} className="flex items-center gap-3 py-2">
            {ws.logo ? (
              <img src={ws.logo} alt="" className="size-6 shrink-0 rounded object-cover" />
            ) : (
              <span className="flex size-6 shrink-0 items-center justify-center rounded bg-primary text-[11px] font-semibold text-primary-foreground">
                {(ws.name[0] ?? "").toUpperCase()}
              </span>
            )}
            <span
              className={cn("min-w-0 flex-1 truncate text-sm", !shown && "text-muted-foreground")}
            >
              {ws.name}
              {ws.slug === activeSlug && (
                <span className="ml-2 text-xs text-muted-foreground">
                  {t("workspaceSwitcher.currentWorkspace")}
                </span>
              )}
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={shown}
              aria-label={t("workspaceSwitcher.toggleLabel", { name: ws.name })}
              onClick={() => setHidden(ws.id, shown)}
              className={cn(
                "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
                shown ? "bg-primary" : "bg-muted",
              )}
            >
              <span
                className={cn(
                  "inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform",
                  shown ? "translate-x-[18px]" : "translate-x-0.5",
                )}
              />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Controlled dialog opened from the switcher footer ("Kelola workspace"). */
export default function ManageWorkspacesDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("workspaceSwitcher.manage")}</DialogTitle>
          <DialogDescription>{t("workspaceSwitcher.manageDescription")}</DialogDescription>
        </DialogHeader>
        <WorkspaceVisibilityList className="max-h-[60vh] overflow-y-auto pr-1" />
      </DialogContent>
    </Dialog>
  );
}
