import { useCallback, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { api, type Workspace } from "@/lib/api";
import { useWorkspaces } from "@/hooks/useWorkspaces";

const KEY = ["hidden-workspaces"] as const;

/**
 * Per-user (server-side, syncs across devices) set of workspaces hidden from
 * the workspace switchers. Presentation only: the full list still comes from
 * useWorkspaces(), and membership/API listings are unaffected.
 */
export function useHiddenWorkspaces() {
  const qc = useQueryClient();
  const { t } = useTranslation();
  const { data: hiddenIds = [] } = useQuery({ queryKey: KEY, queryFn: api.hiddenWorkspaces });

  const mutation = useMutation({
    mutationFn: ({ workspaceId, hidden }: { workspaceId: string; hidden: boolean }) =>
      api.setWorkspaceHidden(workspaceId, hidden),
    onMutate: async ({ workspaceId, hidden }) => {
      await qc.cancelQueries({ queryKey: KEY });
      const previous = qc.getQueryData<string[]>(KEY) ?? [];
      const rest = previous.filter((id) => id !== workspaceId);
      qc.setQueryData<string[]>(KEY, hidden ? [...rest, workspaceId] : rest);
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx) qc.setQueryData(KEY, ctx.previous);
      toast.error(t("workspaceSwitcher.saveFailed"));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  });

  const setHidden = useCallback(
    (workspaceId: string, hidden: boolean) => mutation.mutate({ workspaceId, hidden }),
    [mutation.mutate],
  );

  return { hiddenIds, setHidden };
}

/**
 * Workspaces split for a switcher: `visible` (not hidden, plus the active one,
 * which always shows) and `hidden` (reachable through "show all").
 */
export function useSwitcherWorkspaces(activeSlug: string | null | undefined) {
  const { data: workspaces = [] } = useWorkspaces();
  const { hiddenIds } = useHiddenWorkspaces();

  return useMemo(() => {
    const hiddenSet = new Set(hiddenIds);
    const visible: Workspace[] = [];
    const hidden: Workspace[] = [];
    for (const ws of workspaces) {
      (hiddenSet.has(ws.id) && ws.slug !== activeSlug ? hidden : visible).push(ws);
    }
    return { visible, hidden };
  }, [workspaces, hiddenIds, activeSlug]);
}
