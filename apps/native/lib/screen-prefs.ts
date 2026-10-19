import type { MouseMode } from "@/lib/screen-gestures";
import { getItem, setItem } from "@/lib/storage";

export type ScreenQuality = "high" | "balanced" | "low";

export interface ScreenPrefs {
  mode: MouseMode;
  quality: ScreenQuality;
  viewOnly: boolean;
}

export const DEFAULT_SCREEN_PREFS: ScreenPrefs = {
  mode: "pointer",
  quality: "balanced",
  viewOnly: false,
};

const KEY = "atur.screen.prefs";

export async function loadScreenPrefs(): Promise<ScreenPrefs> {
  try {
    const raw: unknown = JSON.parse((await getItem(KEY)) ?? "null");
    if (typeof raw !== "object" || raw === null) return DEFAULT_SCREEN_PREFS;
    const mode =
      "mode" in raw && (raw.mode === "pointer" || raw.mode === "touch") ? raw.mode : undefined;
    const quality =
      "quality" in raw &&
      (raw.quality === "high" || raw.quality === "balanced" || raw.quality === "low")
        ? raw.quality
        : undefined;
    const viewOnly =
      "viewOnly" in raw && typeof raw.viewOnly === "boolean" ? raw.viewOnly : undefined;
    return {
      mode: mode ?? DEFAULT_SCREEN_PREFS.mode,
      quality: quality ?? DEFAULT_SCREEN_PREFS.quality,
      viewOnly: viewOnly ?? DEFAULT_SCREEN_PREFS.viewOnly,
    };
  } catch {
    return DEFAULT_SCREEN_PREFS;
  }
}

export async function saveScreenPrefs(prefs: ScreenPrefs): Promise<void> {
  await setItem(KEY, JSON.stringify(prefs));
}
