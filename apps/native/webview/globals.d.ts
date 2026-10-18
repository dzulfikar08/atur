// Browser-side typings for the code that runs inside the terminal/screen
// WebViews (bundled by scripts/build-webviews.ts, never by Metro).
interface Window {
  ReactNativeWebView?: { postMessage(message: string): void };
  /** Inbound channel: the app calls `window.__atur.recv(message)` via injectJavaScript. */
  __atur: { recv(message: unknown): void };
}

// @novnc/novnc ships no types; only the surface the screen view touches.
declare module "@novnc/novnc" {
  export default class RFB extends EventTarget {
    constructor(
      target: HTMLElement,
      urlOrChannel: string | WebSocket,
      options?: { shared?: boolean },
    );
    viewOnly: boolean;
    scaleViewport: boolean;
    clipViewport: boolean;
    dragViewport: boolean;
    resizeSession: boolean;
    showDotCursor: boolean;
    focusOnClick: boolean;
    qualityLevel: number;
    compressionLevel: number;
    disconnect(): void;
    sendKey(keysym: number, code: string | null, down?: boolean): void;
    sendCtrlAltDel(): void;
    clipboardPasteFrom(text: string): void;
  }
}
