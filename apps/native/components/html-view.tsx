import { useImperativeHandle, useRef, type Ref } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import { WebView } from "react-native-webview";

import { SERVER_URL } from "@/lib/config";

export interface HtmlViewHandle {
  /** Deliver a message to the page's `window.__atur.recv`. */
  send(message: object): void;
}

interface HtmlViewProps {
  ref?: Ref<HtmlViewHandle>;
  /** Self-contained page from lib/webview (never a remote URL). */
  html: string;
  /** Parsed JSON the page posted via `ReactNativeWebView.postMessage`. */
  onMessage: (message: Record<string, unknown>) => void;
  style?: StyleProp<ViewStyle>;
}

/**
 * Locked-down WebView for our bundled terminal/screen pages. The page loads
 * from memory with the API origin as its base, may only ever "navigate" to
 * that origin (or about:blank), opens no windows, keeps no cookies/storage and
 * has no file access. The session token is never injected: the page gets
 * bridge frames through `send` and, for the screen, a one-time ticket.
 */
export function HtmlView({ ref, html, onMessage, style }: HtmlViewProps) {
  const webview = useRef<WebView>(null);

  useImperativeHandle(
    ref,
    () => ({
      send: (message) =>
        webview.current?.injectJavaScript(
          `window.__atur&&window.__atur.recv(${JSON.stringify(message)});true;`,
        ),
    }),
    [],
  );

  return (
    <WebView
      ref={webview}
      style={style}
      source={{ html, baseUrl: SERVER_URL }}
      originWhitelist={[`${SERVER_URL}*`, "about:blank"]}
      onShouldStartLoadWithRequest={(request) =>
        request.url === "about:blank" || request.url.startsWith(SERVER_URL)
      }
      onMessage={(event) => {
        try {
          const parsed: unknown = JSON.parse(event.nativeEvent.data);
          if (typeof parsed === "object" && parsed !== null) {
            onMessage(parsed as Record<string, unknown>);
          }
        } catch {
          // Not ours: ignore.
        }
      }}
      javaScriptEnabled
      javaScriptCanOpenWindowsAutomatically={false}
      setSupportMultipleWindows={false}
      allowFileAccess={false}
      allowFileAccessFromFileURLs={false}
      allowUniversalAccessFromFileURLs={false}
      allowsLinkPreview={false}
      mixedContentMode="never"
      incognito
      cacheEnabled={false}
      domStorageEnabled={false}
      sharedCookiesEnabled={false}
      thirdPartyCookiesEnabled={false}
      geolocationEnabled={false}
      keyboardDisplayRequiresUserAction={false}
      hideKeyboardAccessoryView
      automaticallyAdjustContentInsets={false}
      overScrollMode="never"
      bounces={false}
      allowsInlineMediaPlayback={false}
      textZoom={100}
    />
  );
}
