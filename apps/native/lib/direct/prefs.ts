import type { KeyValueStorage } from "@/lib/direct/credentials";
import type { EchoMode, TransportPreference } from "@/modules/atur-direct/src/types";

const PREFER_DIRECT_KEY = "atur.direct.preferDirect";
const ECHO_MODE_KEY = "atur.direct.echoMode";
const TRANSPORT_KEY = "atur.direct.transport";

export const DEFAULT_ECHO_MODE: EchoMode = "auto";
export const DEFAULT_TRANSPORT: TransportPreference = "auto";

export interface DirectPrefs {
  /** Undefined until the user chose; the manager treats that as on. */
  loadPreferDirect(): Promise<boolean | undefined>;
  savePreferDirect(prefer: boolean): Promise<void>;
  /** The local echo mode the phone applies after every connect; "auto" until the user chose. */
  loadEchoMode(): Promise<EchoMode>;
  saveEchoMode(mode: EchoMode): Promise<void>;
  /** Which transport to ask for; "auto" until the user chose. */
  loadTransport(): Promise<TransportPreference>;
  saveTransport(transport: TransportPreference): Promise<void>;
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

    async loadEchoMode() {
      const value = await storage.getItem(ECHO_MODE_KEY);
      return value === "always" || value === "never" || value === "auto"
        ? value
        : DEFAULT_ECHO_MODE;
    },

    async saveEchoMode(mode) {
      await storage.setItem(ECHO_MODE_KEY, mode);
    },

    async loadTransport() {
      const value = await storage.getItem(TRANSPORT_KEY);
      return value === "tls" || value === "auto" ? value : DEFAULT_TRANSPORT;
    },

    async saveTransport(transport) {
      await storage.setItem(TRANSPORT_KEY, transport);
    },
  };
}
