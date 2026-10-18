import type { TerminalPalette } from "@/lib/ansi";

/**
 * Same colours as the Classic (xterm.js) view: webview/terminal.ts sets
 * background/foreground and leaves the 16 ANSI colours at xterm.js's defaults.
 * The terminal is dark in both app themes, like the WebView.
 */
export const TERMINAL_PALETTE: TerminalPalette = {
  background: "#0a0a0a",
  foreground: "#e5e5e5",
  ansi: [
    "#2e3436",
    "#cc0000",
    "#4e9a06",
    "#c4a000",
    "#3465a4",
    "#75507b",
    "#06989a",
    "#d3d7cf",
    "#555753",
    "#ef2929",
    "#8ae234",
    "#fce94f",
    "#729fcf",
    "#ad7fa8",
    "#34e2e2",
    "#eeeeec",
  ],
};
