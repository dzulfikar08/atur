import { create } from "zustand";

interface UiPrefsState {
  /** Experimental "most-left" workspace rail instead of the dropdown switcher. */
  workspaceRail: boolean;
  setWorkspaceRail: (enabled: boolean) => void;
}

const STORAGE_KEY = "ui-workspace-rail";

// Default ON; only an explicit "0" (user opted out) disables it.
const stored = localStorage.getItem(STORAGE_KEY);
const initial = stored !== "0";

export const useUiPrefsStore = create<UiPrefsState>((set) => ({
  workspaceRail: initial,
  setWorkspaceRail: (enabled) => {
    localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
    set({ workspaceRail: enabled });
  },
}));
