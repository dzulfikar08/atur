import type { DirectCredential } from "@/modules/atur-direct/src/types";

// What a paired computer needs to be reached again. The token is a password: it lives only in the
// platform keystore (see `lib/storage.ts`), is never logged and never leaves this module as text.

/** The slice of `lib/storage.ts` this store needs, so tests can run on a map. */
export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string, options?: { thisDeviceOnly?: boolean }): Promise<void>;
  removeItem(key: string): Promise<void>;
}

const INDEX_KEY = "direct.credential.index";
const credentialKey = (serverId: string) => `direct.credential.${serverId}`;

const HEX64 = /^[0-9a-f]{64}$/i;

function parseCredential(text: string | null): DirectCredential | null {
  if (!text) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const c = value as Record<string, unknown>;
  if (
    typeof c.serverId !== "string" ||
    c.serverId === "" ||
    typeof c.serverName !== "string" ||
    !Array.isArray(c.hosts) ||
    c.hosts.length === 0 ||
    !c.hosts.every((host) => typeof host === "string" && host !== "") ||
    typeof c.port !== "number" ||
    !Number.isInteger(c.port) ||
    typeof c.fingerprint !== "string" ||
    !HEX64.test(c.fingerprint) ||
    typeof c.deviceId !== "string" ||
    typeof c.token !== "string" ||
    !HEX64.test(c.token)
  ) {
    return null;
  }
  return {
    serverId: c.serverId,
    serverName: c.serverName,
    hosts: c.hosts as string[],
    port: c.port,
    fingerprint: c.fingerprint,
    deviceId: c.deviceId,
    token: c.token,
  };
}

function parseIndex(text: string | null): string[] {
  if (!text) return [];
  try {
    const value: unknown = JSON.parse(text);
    return Array.isArray(value)
      ? value.filter((id): id is string => typeof id === "string" && id !== "")
      : [];
  } catch {
    return [];
  }
}

/** One credential per computer (`serverId`), newest first. */
export interface CredentialStore {
  /** Stored ids, most recently saved first. */
  serverIds(): Promise<string[]>;
  load(serverId: string): Promise<DirectCredential | null>;
  /** Every readable credential, most recently saved first; unreadable entries are skipped. */
  loadAll(): Promise<DirectCredential[]>;
  /** Stores (or replaces) the credential; throws when the keystore did not take it. */
  save(credential: DirectCredential): Promise<void>;
  clear(serverId: string): Promise<void>;
}

export function createCredentialStore(storage: KeyValueStorage): CredentialStore {
  const readIndex = async () => parseIndex(await storage.getItem(INDEX_KEY));
  const writeIndex = (ids: string[]) => storage.setItem(INDEX_KEY, JSON.stringify(ids));

  return {
    serverIds: readIndex,

    async load(serverId) {
      return parseCredential(await storage.getItem(credentialKey(serverId)));
    },

    async loadAll() {
      const found: DirectCredential[] = [];
      for (const id of await readIndex()) {
        const credential = parseCredential(await storage.getItem(credentialKey(id)));
        if (credential) found.push(credential);
      }
      return found;
    },

    async save(credential) {
      const text = JSON.stringify(credential);
      const key = credentialKey(credential.serverId);
      await storage.setItem(key, text, { thisDeviceOnly: true });
      // Storage swallows write failures; a pairing that is not kept must not look successful.
      if ((await storage.getItem(key)) !== text) {
        throw new Error("The credential could not be saved on this phone");
      }
      const rest = (await readIndex()).filter((id) => id !== credential.serverId);
      await writeIndex([credential.serverId, ...rest]);
    },

    async clear(serverId) {
      await storage.removeItem(credentialKey(serverId));
      const rest = (await readIndex()).filter((id) => id !== serverId);
      if (rest.length === 0) await storage.removeItem(INDEX_KEY);
      else await writeIndex(rest);
    },
  };
}
