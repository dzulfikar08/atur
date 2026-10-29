import { AppState } from "react-native";

import { createCredentialStore } from "@/lib/direct/credentials";
import { DirectManager } from "@/lib/direct/manager";
import { createDirectPrefs } from "@/lib/direct/prefs";
import { getItem, removeItem, setItem } from "@/lib/storage";
import { AturDirect } from "@/modules/atur-direct";

export * from "@/lib/direct/manager";
export * from "@/lib/direct/transport-choice";
export { openDirectPane, type DirectPaneHandle } from "@/lib/direct/pane-direct";

const storage = { getItem, setItem, removeItem };

/** The app's one direct connection to the paired computer. Started by `useDirect` / `usePaneAttach`. */
export const directManager = new DirectManager({
  native: AturDirect,
  credentials: createCredentialStore(storage),
  prefs: createDirectPrefs(storage),
  appState: {
    isActive: () => AppState.currentState === "active",
    subscribe: (listener) => {
      const subscription = AppState.addEventListener("change", (next) =>
        listener(next === "active"),
      );
      return () => subscription.remove();
    },
  },
});
