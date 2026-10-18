import * as Updates from "expo-updates";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";

/** True in a release build that embeds expo-updates; false in dev clients, Expo Go and web. */
export const OTA_ENABLED = Platform.OS !== "web" && Updates.isEnabled;

/** Minimum gap between foreground re-checks. */
export const CHECK_THROTTLE_MS = 6 * 60 * 60 * 1000;

export type OtaPhase = "disabled" | "checking" | "downloading" | "ready" | "error" | "idle";

/**
 * Asks the update server for a newer bundle and downloads it. The launch-time check is done by
 * expo-updates itself (`checkAutomatically: ON_LOAD`); this serves the manual button and the foreground
 * re-check. A downloaded update waits for the next cold start or `restartOta()`.
 */
export async function checkAndFetchOta(): Promise<void> {
  const check = await Updates.checkForUpdateAsync();
  if (check.isAvailable || check.isRollBackToEmbedded) await Updates.fetchUpdateAsync();
}

/** Reloads into the downloaded update (or the embedded bundle after a rollback). */
export async function restartOta(): Promise<void> {
  try {
    await Updates.reloadAsync();
  } catch {
    // No pending update or updates disabled: keep running.
  }
}

/** OTA state shared (via expo-updates' global state) by the banner and the Profile section. */
export function useOtaUpdate() {
  const state = Updates.useUpdates();
  const [failed, setFailed] = useState(false);

  const check = useCallback(async () => {
    if (!OTA_ENABLED) return;
    setFailed(false);
    try {
      await checkAndFetchOta();
    } catch {
      setFailed(true);
    }
  }, []);

  let phase: OtaPhase = "idle";
  if (!OTA_ENABLED) phase = "disabled";
  else if (state.isDownloading) phase = "downloading";
  else if (state.isChecking) phase = "checking";
  else if (state.isUpdatePending) phase = "ready";
  else if (failed || state.checkError || state.downloadError) phase = "error";

  const running = state.currentlyRunning;
  const progress = state.downloadProgress;
  return {
    phase,
    percent: typeof progress === "number" ? Math.round(progress * 100) : null,
    embedded: running.isEmbeddedLaunch,
    updateId: running.updateId ?? null,
    createdAt: running.createdAt ?? null,
    runtimeVersion: running.runtimeVersion ?? null,
    channel: running.channel ?? null,
    check,
    restart: restartOta,
  };
}

/** Re-checks when the app returns to the foreground, at most once per CHECK_THROTTLE_MS. */
export function useOtaForegroundCheck(check: () => Promise<void>) {
  const last = useRef(Date.now());
  useEffect(() => {
    if (!OTA_ENABLED) return;
    const sub = AppState.addEventListener("change", (s) => {
      if (s !== "active" || Date.now() - last.current < CHECK_THROTTLE_MS) return;
      last.current = Date.now();
      void check();
    });
    return () => sub.remove();
  }, [check]);
}
