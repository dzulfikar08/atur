import { create } from 'zustand';


interface WorkspaceState {
  currentSlug: string | null;
  setCurrentSlug: (slug: string | null) => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  currentSlug: null,
  setCurrentSlug: (currentSlug) => set({ currentSlug }),
}));
