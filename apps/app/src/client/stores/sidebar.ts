import { create } from "zustand";

/**
 * Sidebar collapse state, shared between the Sidebar rail and the
 * AppShell's Cmd/Ctrl+B shortcut. Replaces the collapse state that used to
 * live inside Kumo's Sidebar.Provider.
 */
interface SidebarState {
  collapsed: boolean;
  toggle: () => void;
}

export const useSidebarStore = create<SidebarState>((set) => ({
  collapsed: false,
  toggle: () => set((s) => ({ collapsed: !s.collapsed })),
}));
