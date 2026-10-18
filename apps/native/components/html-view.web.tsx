import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import type { StyleProp, ViewStyle } from "react-native";

// Dev-only stand-in for the native WebView so `expo start --web` can render the
// terminal and screen pages: an iframe with a postMessage shim. Not shipped
// (the store apps use html-view.tsx).

export interface HtmlViewHandle {
  send(message: object): void;
}

interface HtmlViewProps {
  ref?: Ref<HtmlViewHandle>;
  html: string;
  onMessage: (message: Record<string, unknown>) => void;
  style?: StyleProp<ViewStyle>;
}

type PageWindow = Window & { __atur?: { recv(message: unknown): void } };

const SHIM =
  '<script>window.ReactNativeWebView={postMessage:function(m){parent.postMessage({__atur:m},"*")}}</script>';

export function HtmlView({ ref, html, onMessage }: HtmlViewProps) {
  const frame = useRef<HTMLIFrameElement>(null);

  useImperativeHandle(
    ref,
    () => ({
      send: (message) =>
        (frame.current?.contentWindow as PageWindow | null | undefined)?.__atur?.recv(message),
    }),
    [],
  );

  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      const data = (event.data as { __atur?: string } | null)?.__atur;
      if (typeof data !== "string") return;
      try {
        onMessage(JSON.parse(data) as Record<string, unknown>);
      } catch {
        // Not ours: ignore.
      }
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, [onMessage]);

  // The wrapper owns the flex slot; the frame fills it absolutely (an iframe's
  // percentage height does not resolve inside a flex item).
  return (
    <div style={{ position: "relative", flex: 1, minHeight: 0, display: "flex" }}>
      <iframe
        ref={frame}
        srcDoc={html.replace("<style>", `${SHIM}<style>`)}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }}
        title="embedded view"
      />
    </div>
  );
}
