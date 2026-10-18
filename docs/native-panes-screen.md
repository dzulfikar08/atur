# Native: terminal panes and desktop Screen

Panes tab (`app/(tabs)/panes.tsx`) lists `GET /api/panes` (only panes bound to a workspace the user belongs to). Tap → `app/pane/[paneId].tsx`: live terminal, transcript toggle, key row (Ctrl, Esc, Tab, arrows, `| / - ~`, Paste). The Screen button on the Panes header only renders when `/api/users/me` says `is_superuser`; `app/screen.tsx` is the full-screen (landscape-capable) noVNC view. The server enforces both rules (per-pane workspace membership; `requireSuperuser`).

## Auth — the session token never enters a URL

| Feature    | Transport                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Panes list | `request()` with `Authorization: Bearer`.                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Terminal   | Native app opens `/api/panes/attach` itself with `Authorization: Bearer` on the WebSocket handshake (React Native's `WebSocket` accepts headers). xterm.js runs in a WebView that has **no network** (CSP `connect-src 'none'`); frames are passed in/out with `postMessage`.                                                                                                                                                                                          |
| Transcript | Rendered natively from `/api/panes/observe` (same frames as the web).                                                                                                                                                                                                                                                                                                                                                                                                  |
| Screen     | A WebView cannot set WS headers and a native bridge for binary RFB is overkill, so the app mints a **one-time ticket**: `POST /api/ws-tickets {scope:"screen"}` (bearer, superuser only) → `?ticket=` on `/api/screen/ws`. The ticket is 256-bit random, stored as SHA-256, single use (atomic `UPDATE … WHERE used_at IS NULL`), TTL 60 s, scope-bound; `requireSuperuser` still runs after redemption. Only `/api/screen/ws` upgrades accept it (`lib/wsTicket.ts`). |

WebViews load bundled HTML from memory (`lib/webview/*.generated.ts`, built by `bun run webviews` from `webview/*.ts` + `@xterm/xterm` + `@novnc/novnc`), may only navigate to the API origin, and keep no cookies/storage/file access (`components/html-view.tsx`). The screen page's CSP `connect-src` is the API origin only.

## Screen gestures

tap = left click · two-finger tap = right click · long-press + drag = mouse drag · one-finger drag = pan · pinch = zoom (1–6×) · two-finger drag = wheel. View-only is on by default; opening the keyboard switches to control mode.

## Release note

New native modules (`react-native-webview`, `expo-clipboard`, `expo-screen-orientation`) and `orientation: default` change the native fingerprint: this needs a **new store build**; OTA alone will not deliver it.
