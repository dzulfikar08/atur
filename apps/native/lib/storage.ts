import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

// SecureStore (Keychain / Keystore) on device; expo-secure-store has no web
// implementation, so the web build falls back to localStorage.
const web = Platform.OS === "web";

export async function getItem(key: string): Promise<string | null> {
  try {
    if (web) return globalThis.localStorage?.getItem(key) ?? null;
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

export async function setItem(key: string, value: string): Promise<void> {
  try {
    if (web) globalThis.localStorage?.setItem(key, value);
    else await SecureStore.setItemAsync(key, value);
  } catch {
    // Best effort: the in-memory value still applies for this run.
  }
}

export async function removeItem(key: string): Promise<void> {
  try {
    if (web) globalThis.localStorage?.removeItem(key);
    else await SecureStore.deleteItemAsync(key);
  } catch {
    // Nothing stored or storage unavailable.
  }
}
