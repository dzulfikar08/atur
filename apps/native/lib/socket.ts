import { SERVER_URL } from "@/lib/config";
import { getToken } from "@/lib/session";

/** `wss://host` (or `ws://` for a local dev server) of the Atur API. */
export const WS_ORIGIN = SERVER_URL.replace(/^http/, "ws");

// React Native's WebSocket takes a non-standard third argument carrying
// handshake headers, so the session goes in `Authorization: Bearer` exactly as
// on `request()` and never touches the URL. (Browsers cannot do this and ignore
// the extra argument; the react-native-web dev build authenticates by cookie.)
type RnWebSocket = new (
  url: string,
  protocols: string[] | undefined,
  options: { headers: Record<string, string> },
) => WebSocket;

/** Open an authenticated WebSocket to an Atur API path, e.g. `/api/panes/attach?pane=1`. */
export function openAuthedSocket(path: string): WebSocket {
  const token = getToken();
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  return new (WebSocket as unknown as RnWebSocket)(`${WS_ORIGIN}${path}`, undefined, { headers });
}
