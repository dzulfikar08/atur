import { getItem, setItem } from "@/lib/storage";
import { clampFontSize } from "@/lib/terminal-metrics";

export type PaneView = "native" | "classic" | "transcript";

const VIEW_KEY = "atur.pane.view";
const FONT_KEY = "atur.pane.fontSize";

export async function loadPaneView(): Promise<PaneView | undefined> {
  const value = await getItem(VIEW_KEY);
  return value === "native" || value === "classic" || value === "transcript" ? value : undefined;
}

export async function savePaneView(view: PaneView): Promise<void> {
  await setItem(VIEW_KEY, view);
}

export async function loadFontSize(): Promise<number | undefined> {
  const value = Number(await getItem(FONT_KEY));
  return Number.isFinite(value) && value > 0 ? clampFontSize(value) : undefined;
}

export async function saveFontSize(size: number): Promise<void> {
  await setItem(FONT_KEY, String(clampFontSize(size)));
}

const SHELLS_OPEN_KEY = "atur.panes.shellsOpen";

/** Whether the Panes tab's "Shells" group was left expanded; collapsed by default. */
export async function loadShellsOpen(): Promise<boolean> {
  return (await getItem(SHELLS_OPEN_KEY)) === "1";
}

export async function saveShellsOpen(open: boolean): Promise<void> {
  await setItem(SHELLS_OPEN_KEY, open ? "1" : "0");
}
