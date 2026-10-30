import { useEffect, useSyncExternalStore } from "react";

import { getItem, removeItem, setItem } from "@/lib/storage";

// Persisted opt-in for agent alerts plus the Expo push token registered for it.
// Storage only (no API) so session.ts can clear it on sign-out without a cycle.
const FLAG_KEY = "atur.push.agents";
const TOKEN_KEY = "atur.push.token";
// Set by the Direct area's "Sign in for alerts" row; the first signed-in start turns alerts on.
const WANTED_KEY = "atur.push.wanted";

let enabled = false;
// False until the stored flag was read or a save/clear made it authoritative.
let loaded = false;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function set(next: boolean) {
  enabled = next;
  loaded = true;
  for (const listener of listeners) listener();
}

/** Reads the persisted flag once; later calls reuse the first load. */
export function loadAgentAlertsFlag(): Promise<void> {
  loading ??= getItem(FLAG_KEY).then((raw) => {
    if (!loaded) set(raw === "1");
  });
  return loading;
}

export async function getAgentAlertsEnabled(): Promise<boolean> {
  await loadAgentAlertsFlag();
  return enabled;
}

export function getStoredPushToken(): Promise<string | null> {
  return getItem(TOKEN_KEY);
}

export async function saveAgentAlerts(token: string): Promise<void> {
  set(true);
  await Promise.all([setItem(FLAG_KEY, "1"), setItem(TOKEN_KEY, token)]);
}

/** The user asked for alerts while signed out: register this device as soon as an account exists. */
export function markAgentAlertsWanted(): Promise<void> {
  return setItem(WANTED_KEY, "1");
}

/** True once per `markAgentAlertsWanted`: the flag is consumed. */
export async function takeAgentAlertsWanted(): Promise<boolean> {
  if ((await getItem(WANTED_KEY)) !== "1") return false;
  await removeItem(WANTED_KEY);
  return true;
}

/** Local state only; server-side unregistration is `disableAgentAlerts` in push.ts. */
export async function clearAgentAlertsLocal(): Promise<void> {
  set(false);
  await Promise.all([removeItem(FLAG_KEY), removeItem(TOKEN_KEY), removeItem(WANTED_KEY)]);
}

/** The persisted opt-in; null until the stored value has been read. */
export function useAgentAlertsEnabled(): boolean | null {
  useEffect(() => {
    void loadAgentAlertsFlag();
  }, []);
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => (loaded ? enabled : null),
  );
}
