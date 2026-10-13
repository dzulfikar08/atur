import { getItem, setItem } from "@/lib/storage";

const KEY = "atur.theme";

export type ThemePref = "light" | "dark" | "system";

export async function loadThemePref(): Promise<ThemePref | undefined> {
  const value = await getItem(KEY);
  return value === "light" || value === "dark" || value === "system" ? value : undefined;
}

export async function saveThemePref(pref: ThemePref): Promise<void> {
  await setItem(KEY, pref);
}
