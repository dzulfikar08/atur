import type { KeyValueStorage } from "@/lib/direct/credentials";

const PREFER_DIRECT_KEY = "atur.direct.preferDirect";

export interface DirectPrefs {
  /** Undefined until the user chose; the manager treats that as on. */
  loadPreferDirect(): Promise<boolean | undefined>;
  savePreferDirect(prefer: boolean): Promise<void>;
}

/** The "prefer direct" switch, persisted like the terminal prefs (plain keystore entry). */
export function createDirectPrefs(
  storage: Pick<KeyValueStorage, "getItem" | "setItem">,
): DirectPrefs {
  return {
    async loadPreferDirect() {
      const value = await storage.getItem(PREFER_DIRECT_KEY);
      return value === "1" ? true : value === "0" ? false : undefined;
    },

    async savePreferDirect(prefer) {
      await storage.setItem(PREFER_DIRECT_KEY, prefer ? "1" : "0");
    },
  };
}
