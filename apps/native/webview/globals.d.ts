// Browser-side typings for the code that runs inside the terminal/screen
// WebViews (bundled by scripts/build-webviews.ts, never by Metro).
interface Window {
  ReactNativeWebView?: { postMessage(message: string): void };
  /** Inbound channel: the app calls `window.__atur.recv(message)` via injectJavaScript. */
  __atur: { recv(message: unknown): void };
}

// @novnc/novnc ships no types; only the surface the screen view touches.
declare module "@novnc/novnc" {
  /** What noVNC's Websock.attach needs from a socket-like object. */
  export interface RawChannel {
    binaryType: BinaryType;
    readonly protocol: string;
    readonly readyState: number;
    send(data: ArrayBuffer | Uint8Array): void;
    close(): void;
    onopen: ((e: Event) => void) | null;
    onmessage: ((e: MessageEvent) => void) | null;
    onclose: ((e: { code: number; reason: string; wasClean: boolean }) => void) | null;
    onerror: ((e: Event) => void) | null;
  }

  export default class RFB extends EventTarget {
    constructor(
      target: HTMLElement,
      urlOrChannel: string | WebSocket | RawChannel,
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
    /** CSS background behind the desktop canvas. */
    background: string;
    disconnect(): void;
    sendKey(keysym: number, code: string | null, down?: boolean): void;
    clipboardPasteFrom(text: string): void;
  }
}
