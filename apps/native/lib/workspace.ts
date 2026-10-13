import { useQuery } from "@tanstack/react-query";
import { useEffect, useSyncExternalStore } from "react";

import { api, type Workspace } from "@/lib/api";
import { getItem, setItem } from "@/lib/storage";

// The workspace the app is scoped to, like the web sidebar switcher.
// ALL = every workspace (the web's "All Workspaces" view).
export const ALL = "all";
const KEY = "atur.workspace";

let current: string | null = null;
let loaded = false;
const listeners = new Set<() => void>();

function publish(slug: string) {
  current = slug;
  for (const listener of listeners) listener();
}

export function setCurrentWorkspace(slug: string): void {
  publish(slug);
  void setItem(KEY, slug);
}

/**
 * Current workspace slug (or ALL) plus the resolved workspace. Falls back to
 * the first workspace when nothing is stored or the stored one is gone.
 */
export function useCurrentWorkspace(): {
  slug: string;
  workspace: Workspace | null;
  workspaces: Workspace[];
} {
  const stored = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
  );
  useEffect(() => {
    if (loaded) return;
    loaded = true;
    void getItem(KEY).then((slug) => {
      if (slug && current === null) publish(slug);
    });
  }, []);

  const me = useQuery({ queryKey: ["me"], queryFn: api.me });
  const workspaces = me.data?.workspaces ?? [];
  const match = workspaces.find((w) => w.slug === stored) ?? null;
  if (stored === ALL) return { slug: ALL, workspace: null, workspaces };
  const workspace = match ?? workspaces[0] ?? null;
  return { slug: workspace?.slug ?? ALL, workspace, workspaces };
}
