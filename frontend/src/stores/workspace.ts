import { create } from 'zustand';

interface Workspace {
  id: string;
  name: string;
  slug: string;
}

interface WorkspaceState {
  workspaces: Workspace[];
  currentSlug: string | null;
  setWorkspaces: (ws: Workspace[]) => void;
  setCurrentSlug: (slug: string | null) => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  workspaces: [],
  currentSlug: null,
  setWorkspaces: (workspaces) => set({ workspaces }),
  setCurrentSlug: (currentSlug) => set({ currentSlug }),
}));
