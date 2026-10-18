// Runs inside the terminal WebView (bundled into lib/webview/terminal-html.generated.ts).
// The page has no network access (CSP connect-src 'none'): the app owns the
// WebSocket and its Authorization header, and pushes bridge frames in through
// `window.__atur.recv`. Keystrokes go back out through postMessage.
import { Terminal } from "@xterm/xterm";

type Inbound =
  | { t: "hello"; cols: number; rows: number }
  | { t: "snapshot"; ansi: string }
  | { t: "diff"; rows: [number, string][] }
  | { t: "focus" }
  | { t: "blur" };

const post = (message: object) => window.ReactNativeWebView?.postMessage(JSON.stringify(message));

const wrap = document.getElementById("wrap") as HTMLElement;
const holder = document.getElementById("term") as HTMLElement;

const term = new Terminal({
  cursorBlink: false,
  // Frames replace the visible screen wholesale; there is no history to scroll.
  scrollback: 0,
  fontFamily: "ui-monospace, Menlo, 'DejaVu Sans Mono', 'Roboto Mono', monospace",
  fontSize: 12,
  theme: { background: "#0a0a0a", foreground: "#e5e5e5", cursor: "#e5e5e5" },
});
term.open(holder);
term.onData((data) => post({ t: "data", data }));

// The pane grid is authoritative (hello carries cols x rows), so the terminal
// keeps that geometry and the whole grid is scaled to the viewport width. The
// native WebView pinch zoom then reads small text without reflowing anything.
function fit() {
  const screen = holder.querySelector<HTMLElement>(".xterm-screen");
  if (!screen || screen.offsetWidth === 0) return;
  const scale = Math.min(1.5, window.innerWidth / screen.offsetWidth);
  holder.style.transform = `scale(${scale})`;
  wrap.style.width = `${screen.offsetWidth * scale}px`;
  wrap.style.height = `${screen.offsetHeight * scale}px`;
}

window.addEventListener("resize", fit);

window.__atur = {
  recv(raw) {
    const msg = raw as Inbound;
    switch (msg.t) {
      case "hello":
        term.resize(msg.cols, msg.rows);
        requestAnimationFrame(fit);
        break;
      // Home + clear + replay in ONE write: one parse pass, one repaint.
      case "snapshot":
        term.write("\x1b[H\x1b[2J\x1b[?25l" + msg.ansi + "\x1b[?25l", fit);
        break;
      // Repaint only changed rows, cursor-addressed. The cursor stays hidden:
      // herdr's dump carries no cursor position.
      case "diff": {
        let data = "";
        for (const [row, line] of msg.rows) data += `\x1b[${row + 1};1H\x1b[2K` + line;
        term.write(data + "\x1b[?25l");
        break;
      }
      case "focus":
        term.focus();
        break;
      case "blur":
        term.blur();
        break;
    }
  },
};

post({ t: "ready" });
