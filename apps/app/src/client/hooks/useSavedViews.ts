import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api";
import { normalizeIssueQuery, type IssueQuery } from "@/lib/issueQuery";

export interface SavedView {
  id: string;
  name: string;
  query: IssueQuery;
}

interface ApiView {
  id: string;
  name: string;
  query?: unknown;
}

/** The caller's private saved views for one project (stored server-side per user). */
export function useSavedViews(slug: string | undefined, projectId: string | undefined) {
  const qc = useQueryClient();
  const key = ["views", slug, projectId];
  const base = `/workspaces/${slug}/projects/${projectId}/views/`;

  const { data } = useQuery({
    queryKey: key,
    queryFn: () => apiFetch<{ results: ApiView[] }>(base).then((r) => r.results),
    enabled: !!slug && !!projectId,
  });

  const views = useMemo<SavedView[]>(
    () =>
      (data ?? []).map((v) => ({
        id: v.id,
        name: v.name,
        query: normalizeIssueQuery(v.query),
      })),
    [data],
  );

  const refresh = () => qc.invalidateQueries({ queryKey: key });

  const save = useMutation({
    mutationFn: (v: { name: string; query: IssueQuery }) =>
      apiFetch<ApiView>(base, { method: "POST", body: JSON.stringify(v) }),
    onSuccess: () => {
      refresh();
      toast.success("View saved");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to save view"),
  });

  const update = useMutation({
    mutationFn: ({ id, ...patch }: { id: string; name?: string; query?: IssueQuery }) =>
      apiFetch<ApiView>(`${base}${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
    onSuccess: () => {
      refresh();
      toast.success("View updated");
    },
    onError: () => toast.error("Failed to update view"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiFetch(`${base}${id}`, { method: "DELETE" }),
    onSuccess: () => {
      refresh();
      toast.success("View deleted");
    },
    onError: () => toast.error("Failed to delete view"),
  });

  return { views, save, update, remove };
}
