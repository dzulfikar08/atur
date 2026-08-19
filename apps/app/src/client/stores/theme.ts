import { create } from "zustand";

type Theme = "light" | "dark" | "system";

interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  // jsdom has no matchMedia — treat "unknown preference" as light.
  const prefersDark =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;
  const isDark = theme === "dark" || (theme === "system" && prefersDark);
  root.classList.toggle("dark", isDark);
  root.setAttribute("data-mode", isDark ? "dark" : "light");
}

const stored = localStorage.getItem("theme") as Theme | null;
// Always apply on boot — skipping this when no theme is stored leaves `.dark`
// and `data-mode` unset, so fresh visitors render light even on dark-preferred
// systems (and Kumo's light-dark() tokens never flip).
applyTheme(stored || "system");

export const useThemeStore = create<ThemeState>((set) => ({
  theme: stored || "system",
  setTheme: (theme) => {
    localStorage.setItem("theme", theme);
    applyTheme(theme);
    set({ theme });
  },
}));
