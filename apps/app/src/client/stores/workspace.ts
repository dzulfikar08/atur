import { create } from "zustand";
import { getWorkspaceSwitchPath } from "@/lib/navigation";

const STORAGE_KEY = "current-workspace-slug";

function loadInitialSlug(): string | null {
  try {
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

interface WorkspaceState {
  currentSlug: string | null;
  setCurrentSlug: (slug: string | null) => void;
  /** Switch workspace, mirroring the current section. Returns the path to navigate to. */
  switchWorkspace: (targetSlug: string) => string;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  currentSlug: loadInitialSlug(),
  setCurrentSlug: (currentSlug) => {
    try {
      if (currentSlug) sessionStorage.setItem(STORAGE_KEY, currentSlug);
      else sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore storage errors
    }
    set({ currentSlug });
  },
  switchWorkspace: (targetSlug) => {
    const path = getWorkspaceSwitchPath(window.location.pathname, targetSlug);
    get().setCurrentSlug(targetSlug);
    return path;
  },
}));
