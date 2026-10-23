import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { useEffect, useState } from "react";
import { Platform } from "react-native";

import { api } from "@/lib/api";
import {
  clearAgentAlertsLocal,
  getAgentAlertsEnabled,
  getStoredPushToken,
  saveAgentAlerts,
  useAgentAlertsEnabled,
} from "@/lib/push-state";

/** Android notification channel the Worker targets (`channelId: "agents"`). */
export const AGENT_CHANNEL_ID = "agents";

/** How long sign-out waits for the server to drop this device's token. */
const UNREGISTER_TIMEOUT_MS = 4000;

export type AlertsResult =
  | { status: "granted" }
  | { status: "denied" }
  | { status: "unavailable"; reason: string };

const platform = Platform.OS === "ios" || Platform.OS === "android" ? Platform.OS : null;

/** False on the web build: there is no Expo push there. */
export const AGENT_ALERTS_SUPPORTED = platform !== null;

function unavailable(reason: string): AlertsResult {
  return { status: "unavailable", reason };
}

function failure(error: unknown): AlertsResult {
  return unavailable(error instanceof Error ? error.message : "Couldn't set up notifications.");
}

async function ensureChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync(AGENT_CHANNEL_ID, {
    name: "Agent alerts",
    importance: Notifications.AndroidImportance.HIGH,
  });
}

async function fetchPushToken(): Promise<string> {
  const projectId: unknown =
    Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (typeof projectId !== "string" || !projectId) {
    throw new Error("This build has no EAS project id, so it can't receive push notifications.");
  }
  const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
  return data;
}

/** Registers the current token with the Worker and persists the opt-in. */
async function registerCurrentToken(): Promise<void> {
  if (!platform) return;
  const token = await fetchPushToken();
  const previous = await getStoredPushToken();
  await api.registerPushToken(token, platform);
  await saveAgentAlerts(token);
  // Tokens rotate; don't leave the old one receiving alerts for this user.
  if (previous && previous !== token) void api.unregisterPushToken(previous).catch(() => {});
}

/**
 * Asks for notification permission (once; afterwards the OS only shows its
 * settings), then registers this device for agent alerts.
 */
export async function enableAgentAlerts(): Promise<AlertsResult> {
  if (!platform) return unavailable("Agent alerts need the iOS or Android app.");
  try {
    await ensureChannel();
    let permission = await Notifications.getPermissionsAsync();
    if (!permission.granted && permission.canAskAgain) {
      permission = await Notifications.requestPermissionsAsync();
    }
    if (!permission.granted) return { status: "denied" };
    await registerCurrentToken();
    return { status: "granted" };
  } catch (error) {
    return failure(error);
  }
}

/**
 * Unregisters this device (best effort, bounded wait so sign-out never hangs
 * offline) and clears the opt-in. Call before the session token is cleared.
 */
export async function disableAgentAlerts(): Promise<void> {
  if (!platform) return;
  const token = await getStoredPushToken();
  if (token) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, UNREGISTER_TIMEOUT_MS);
    });
    await Promise.race([
      api.unregisterPushToken(token).then(
        () => {},
        () => {},
      ),
      timeout,
    ]);
    clearTimeout(timer);
  }
  await clearAgentAlertsLocal();
}

/**
 * On authed app start: re-register when alerts are on (tokens rotate), or
 * switch them off when the OS permission was revoked meanwhile. Network
 * failures leave the opt-in alone so the next launch retries.
 */
export async function syncAgentAlerts(): Promise<void> {
  if (!platform || !(await getAgentAlertsEnabled())) return;
  try {
    const permission = await Notifications.getPermissionsAsync();
    if (!permission.granted) {
      await disableAgentAlerts();
      return;
    }
    await ensureChannel();
    await registerCurrentToken();
  } catch {
    // Offline or the push service is unreachable: try again next launch.
  }
}

/**
 * True when the "Turn on alerts" prompt is worth showing: native build, alerts
 * off, and the OS hasn't permanently refused (then only Settings can help, and
 * the Profile row covers that).
 */
export function useAgentAlertsPrompt(): boolean {
  const enabled = useAgentAlertsEnabled();
  const [refused, setRefused] = useState(true);
  useEffect(() => {
    if (!platform) return;
    let live = true;
    Notifications.getPermissionsAsync().then(
      (p) => live && setRefused(!p.granted && !p.canAskAgain),
      () => live && setRefused(true),
    );
    return () => {
      live = false;
    };
  }, []);
  return AGENT_ALERTS_SUPPORTED && enabled === false && !refused;
}
