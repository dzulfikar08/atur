# Native: terminal panes and desktop Screen

Panes tab (`app/(tabs)/panes.tsx`) lists `GET /api/panes` (only panes bound to a workspace the user belongs to). Agent panes come first, ordered by attention (**Needs you** > **Done** > **Working** > **Idle**); plain shells sit in a collapsed "Shells (n)" group (the toggle is remembered). Tap → `app/pane/[paneId].tsx`: the pane in one of three views (**Native**, **Classic**, **Transcript**). The Screen button on the Panes header only renders when `/api/users/me` says `is_superuser`; `app/screen.tsx` is the full-screen (landscape-capable) noVNC view. The server enforces both rules (per-pane workspace membership; `requireSuperuser`).

## Managing panes

The owner can open workspaces, split panes and close panes from the phone, not only watch them.

- **Workspace chips.** A strip under the Panes header: **All** plus one chip per herdr workspace (built from the pane rows; workspaces with the same label on different machines get the machine name appended). Tapping one filters the list, and the choice is remembered (`atur.panes.workspace`, `lib/terminal-prefs.ts`); a workspace that no longer has panes falls back to All without forgetting the choice (`lib/pane-workspaces.ts`).
- **+ button** (Panes header, and on the empty state). With a workspace selected the sheet offers **New pane in `<workspace>`**: it splits that workspace's most recent pane (highest `revision`) to the right and opens the new pane. **New workspace** opens a form: where (the dev box, or one of your machines, when there is more than one), the folder, and an optional name. Folders are the repo paths bound to Atur workspaces you own or administer (`roots` of `GET /api/panes/workspaces`), or for a machine the folders its workspaces already sit in, plus **Custom path** (an absolute path typed by hand). Creating selects the new workspace's chip and opens its pane.
- **Pane screen.** The **⋯** button next to the view tabs, and a **long-press on a list row**, open the same sheet: **Split right**, **Split down** (the new pane starts in the same folder and opens right away) and **Close pane**. Close asks "Close this pane? Anything running in it stops." inside the sheet (an Alert raised while a Modal is dismissing is dropped on iOS), then the app goes back and the pane list refreshes.

Worker routes (`apps/app/src/worker/routes/panes.ts`). The pane id decides where a call goes, as for attach and paste: `<machineId>~<paneId>` goes through the caller's own BridgeRelay Durable Object to that machine; anything else goes to the env-configured bridge.

| Route                        | Body                         | Answer                                                                                                                                                 |
| ---------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/panes/workspaces`  | none                         | `{workspaces, machines, roots}`: the visible workspaces (`id`, `label`, `cwd`, `pane_count`, `machine?`), the caller's machines and the bindable roots |
| `POST /api/panes/workspaces` | `{cwd, label?, machine_id?}` | `201 {workspace, pane}`; no `machine_id` means the env-configured bridge                                                                               |
| `POST /api/panes/split`      | `{pane, direction}`          | `201 {pane}` (`right` or `down`)                                                                                                                       |
| `POST /api/panes/close`      | `{pane}`                     | `204`                                                                                                                                                  |

Relay replies carry the same namespaced ids as the list: `pane.pane_id` is `<machineId>~<paneId>` and rows carry `machine`. Errors pass through from the bridge (`404` unknown pane, `400` bad folder), a down machine is `502`, and a bridge that predates the routes is `501`.

**Authorisation.**

| Call                                  | Allowed when                                                                                                                                                                                                                                                                                                              |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Split, close (env-configured bridge)  | The pane is bound to an Atur workspace the caller belongs to: exactly attach's check. No extra role; a member who can attach can already type `exit` or open a shell.                                                                                                                                                     |
| Split, close (machine)                | The caller owns the machine (live, not revoked).                                                                                                                                                                                                                                                                          |
| New workspace (env-configured bridge) | The cwd (normalised: `..` and `.` resolved) lies inside a `workspace_links.local_path` whose workspace the caller owns or administers (role 20 or more, active). The platform superuser flag is **not** enough: a workspace outside every binding would be hidden from `GET /api/panes` for everyone, the owner included. |
| New workspace (machine)               | The caller owns the machine; any absolute path (the bridge checks that it exists).                                                                                                                                                                                                                                        |

Every allowed call writes a `pane_audit` row before it is forwarded (`paneId` = `pane.split:<pane>`, `pane.close:<pane>` or `workspace.create:<machine or bridge>:<cwd>`, attached and detached at the same instant); refused calls write nothing. The routes sit under `/api`, so the native plan gate applies.

## Agent attention and alerts

herdr reports each agent pane's state (`idle`, `working`, `blocked`, `done`, `unknown`; the omp integration drives it from omp's lifecycle hooks). The app maps it in `lib/pane-meta.ts`: `blocked` → **Needs you** (an `ask` question, a tool approval, or a retryable provider failure), `done` → **Done** (finished, not yet seen in a herdr client), `working` → **Working**.

- **Fewer taps.** The Panes tab badge and the "Agents" section at the top of Today count Needs you + Done panes the user has not opened yet. Opening a pane acknowledges its current state (`lib/pane-seen.ts`, persisted); the next change counts again.
- **Push alerts.** Opt in from the Panes card ("Turn on alerts") or Profile → Agent alerts. The device's Expo push token goes to `PUT /api/me/push-tokens` (removed on sign-out or when switched off). Tapping a notification opens that pane; while that same pane is on screen its alerts are not shown.
- **Who detects.** The bridge (`apps/bridge/src/agent-events.ts`) polls herdr `pane.list` every 2 s (`AGENT_POLL_MS`). It sends **blocked** when a pane enters `blocked`, and **done** when a pane goes from `working`/`blocked` to `idle`/`done`. An event fires only if the state still holds 3 s later: a flicker back to `working`, or `done` → `idle` because the pane was looked at on the desktop, cancels it. A bridge restart sends nothing for states that were already there. For omp panes it reads the tail of the omp session file to add the `ask` question or the first 180 characters of the last reply.
- **Delivery.** The bridge sends `POST /api/bridge/agent-events` with `x-bridge-token` = `BRIDGE_TOKEN` (the Worker checks it against `HERDR_BRIDGE_TOKEN`; it is disabled when the token is unset; `ATUR_URL` defaults to `https://app.diatur.com`). The Worker resolves the pane's workspace the same way attach does, then pushes through Expo (`lib/expoPush.ts`, optional `EXPO_ACCESS_TOKEN`) to every opted-in device of that workspace's members. Tokens Expo reports as `DeviceNotRegistered` are deleted.
- **Content.** The title and body show the pane title, the question or the start of the reply, and the workspace slug. They pass through Expo's push service and APNs/FCM and appear on the lock screen.
- **Setup.** `expo-notifications` is a native module, so this needs a new store build plus FCM and APNs credentials (see `native-release.md`, "Push notifications"). Apply drizzle migration `0027_push_tokens` before deploying the Worker, then restart `atur-bridge.service`.

## Pane views

The header is one line: a status dot (green live, amber connecting, red gone) and the pane title, then three icon tabs on the right (terminal = Native, code = Classic, list = Transcript). The choice is remembered (`atur.pane.view`, `lib/terminal-prefs.ts`). **Native is the default.** The app takes the keyboard on every connect and reconnect; if another viewer takes it, the composer reads "Tap to take the keyboard" and a tap claims it back.

| View       | What it is                                                                                                                                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native     | The visible screen drawn as React Native text (`components/terminal/*`). Fast, selectable per row, scrolls, pinch-zooms, has its own key row and (agent panes) a prompt composer.                                   |
| Classic    | The original xterm.js WebView (`components/terminal/classic-terminal.tsx`, `webview/terminal.ts`). Mounts mid-stream, so it first replays the current screen (`TerminalScreen.replay()`), then follows live frames. |
| Transcript | Structured blocks from `/api/panes/observe` (`components/terminal/transcript.tsx`), unchanged.                                                                                                                      |

One `usePaneAttach` socket feeds a `TerminalScreen` (`lib/terminal-screen.ts`); whichever renderer is mounted subscribes to it, so switching views never reconnects.

### Frames and the screen model

Bridge → app: `hello` (cols, rows, keyboard), `snapshot` (the whole visible grid as ANSI, rows joined by `\r\n`), `diff` (`[row, content]` pairs), `history` (`rows`: the pane's last rows including host scrollback, oldest first, sent only on request; `visible`: how many trailing rows are the visible grid), `keyboard`, `pong`, `error`, `exit`. The live stream carries the visible grid only, so the pane's cols × rows are authoritative. The bridge diffs each viewer against the grid it last sent _that_ viewer, so a viewer skipped for backpressure, or one that joined between polls, catches up exactly on the next tick. `TerminalScreen` keeps `lines: string[]` (snapshot replaces all, diff replaces rows by index, absurd indices are ignored) plus `history: string[]` and publishes a new immutable state per change (`useSyncExternalStore`).

**Scrollback.** `history` is the reply minus exactly its `visible` trailing rows (herdr trims trailing blank rows, so the grid height would cut real lines; older bridges omit `visible` and the live row count stands in). It is append-only: a connect reads the full window (3000), scrolling back and output while scrolled up read a 400-row top-up (one per 1.5 s, trailing call included) and only rows after the loaded tail are appended (`rowsAfter`, 24-row overlap). A top-up that no longer overlaps triggers a full read; a new width (reflow) replaces. Each row keeps `historyBase + index` as its list key, so appends below never move the rows being read.

App → bridge: `input {data}` (what xterm.js `onData` would send; the bridge turns it into herdr key presses, `translateInput` in `apps/bridge/src/hub.ts`), `paste {text, submit}` (one literal text paste; newlines stay newlines; `submit` presses Enter after), `claim`, `history {lines}` (read-only, any viewer; herdr `pane.read` source `recent`, at most 3000 asked, herdr returns up to 1000), `resize {cols, rows}` (keyboard owner only, see below), `ping`.

**Phone-sized panes.** herdr lays panes out for the most recently _active_ attached client: attaching from Termius makes omp redraw at phone width. The app streams over the socket API instead, so the Native view sends `resize` with the grid that fits its area at the current font (`gridForViewport` in `lib/terminal-metrics.ts`), on every connect, rotation and pinch. The height is the tallest the area has been at the current width: the soft keyboard only shortens the view, and resizing for it made the agent redraw under the finger, so with the keyboard up the list shows the pane's bottom rows. The bridge (`apps/bridge/src/sizer.ts`) keeps one invisible herdr client attached in a PTY at that size (plus one row for herdr's own bar) and re-attaches on each request, since attaching counts as activity. 15 s after the last phone viewer leaves it detaches; the size then follows whichever client is active next (typing on the desktop snaps it back), exactly as after a Termius session. While the phone is in use, the desktop shows the pane at phone size.

> **Bridge restart needed.** `paste` and Ctrl+A…Z (anything beyond the old Ctrl+C/D/Z/\) are new in the bridge. Against an older bridge, multi-line composer sends/pastes and most Ctrl combos are silently ignored; restart the bridge from this commit. Single-line prompts and everything else work on the old bridge.

### Native renderer

- **Rows.** `lib/ansi.ts` parses one row of ANSI into styled spans: reset, bold, dim, italic, underline, inverse, 16 + bright, 256 and truecolor foreground/background (semicolon and colon forms); every other CSI/OSC/charset escape is consumed and dropped. Each row is a memoised `TerminalRow` keyed on its raw string, so a diff re-renders only the rows that changed. Rows are `FlatList` items with fixed height (`getItemLayout`), inside a horizontal `ScrollView` when the grid is wider than the phone.
- **Colours.** `components/terminal/palette.ts` mirrors the Classic view: `#0a0a0a` background, `#e5e5e5` foreground and xterm.js's default 16 colours; bold promotes colours 0-7 to bright, as xterm.js does. Dark in both app themes.
- **Font.** JetBrains Mono (500, and 700 for bold), cell width 0.6 em, line height 1.35 em. Default 11 pt. **Pinch** to resize (6–24 pt in half-point steps); the size is saved (`atur.pane.fontSize`) and reapplied. "Fit width" appears when the current size differs from the size that fits the pane's columns exactly.
- **Wide characters.** Width is approximated (`charWidth` in `lib/ansi.ts`: CJK, Hangul, fullwidth and common emoji = 2 cells, combining marks = 0). Rows that contain a double-width glyph render each chunk in a box of exactly its cell width, so columns stay aligned even though the fallback font's glyph is not exactly two cells.
- **Follow and scrollback.** The view sticks to the bottom (the prompt) until you scroll up. Leaving the bottom asks the bridge for 2000 rows of scrollback, which appear above the live grid without moving what you are reading (`maintainVisibleContentPosition`). Back at the bottom the scrollback is dropped and following resumes; the next scroll-up fetches a fresh copy. Needs a bridge from this commit; an older one ignores the request (no scrollback, as before).
- **Copy and links.** Long-press a row copies its text (toast, haptic). Tap a URL (`https?://…`, trailing punctuation trimmed) to open it in the in-app browser; a tap elsewhere opens the keyboard.

### Input

- A hidden `TextInput` owns the soft keyboard. It always holds a sentinel so Backspace has something to delete; each change is diffed against the sentinel (`diffInput`) and sent as `input` frames. Return sends `\r`.
- **Key row.** Shell panes: two rows, Ctrl, Alt (sticky for one key), Esc, Tab, ← ↓ ↑ →; ⌨ (toggle keyboard), Home, End, PgUp, PgDn, Paste, `| / - ~`. Agent panes: one slim row (Esc, Tab, ← ↓ ↑ →, Ctrl, ⋯) so the chat gets the room; ⋯ adds a second row with Alt and the rest. Ctrl turns a letter into its control byte, Alt prefixes ESC (`lib/terminal-keys.ts`). A **horizontal swipe across the key rows repeats ←/→** (one press per 16 px); taps still press keys. Every key gives a light haptic.
- **Paste** sends clipboard text; multi-line text asks first and goes as one `paste` frame, never as typed Enters.
- **Prompt composer** (agent panes only, i.e. when the pane list reports an `agent`): a multiline draft with a mic button and Send. Send types the text and presses Enter: a single line is `input` with a trailing `\r`; multi-line text is a `paste` frame with `submit`. The draft is kept if the socket was not open.
- **Keyboard.** `KeyboardFrame` pads its bottom by exactly the part of it the soft keyboard covers, measured in window coordinates (`measureInWindow` against the keyboard's `screenY`). Android stopped resizing the window under edge-to-edge, and `KeyboardAvoidingView` measures relative to its parent, so below the header it lifted too little.
- **Images in prompts** (Termius-style). The composer's image button takes an image from the phone clipboard and uploads it to `POST /api/panes/paste?pane=<id>` (same per-pane workspace check as attach, at most 20 MiB). The bridge (`apps/bridge/src/pastes.ts`) checks the magic bytes (PNG, JPEG, GIF, WebP), saves it as `~/.cache/atur/pastes/paste-<time>-<random>.<ext>` (directory 0700, file 0600, name chosen by the bridge, files older than 7 days swept on each save; `ATUR_PASTE_DIR` overrides) and returns the path, which goes into the draft at the caret. The agent reads the image from that path.

## Web pane view

`apps/app/src/client/pages/panes/PaneViewPage.tsx` keeps xterm.js (a full terminal emulator; with a hardware keyboard it is the better fit) and Transcript, and shares the app's prompt features:

- **Prompt composer** (agent panes): Enter sends as one `paste` frame with `submit`, Shift+Enter adds a line, the draft stays if the socket is down. Paste or drop an image into it, or use the image button: it is uploaded as above and its path inserted. The mic uses the browser's Web Speech API (Chrome sends audio to Google's speech service, unlike the app's on-device recognition; Firefox has none, so no mic is shown).
- **Touch devices** (`pointer: coarse`, e.g. app.diatur.com on a phone browser): a key row (sticky Ctrl/Alt for the next key, Esc, Tab, arrows, Home/End/PgUp/PgDn, `| / - ~`) and **Fit width**, which sizes the font so the pane's columns fill the screen (remembered in `atur.pane.fit`). Key data and modifiers mirror `apps/native/lib/terminal-keys.ts` (`apps/app/src/client/lib/terminalKeys.ts`).

## Auth — the session token never enters a URL

| Feature    | Transport                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Panes list | `request()` with `Authorization: Bearer`.                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Terminal   | Native app opens `/api/panes/attach` itself with `Authorization: Bearer` on the WebSocket handshake (React Native's `WebSocket` accepts headers). The Classic view's xterm.js runs in a WebView that has **no network** (CSP `connect-src 'none'`); frames are passed in/out with `postMessage`. The Native view needs no WebView.                                                                                                                                     |
| Transcript | Rendered natively from `/api/panes/observe` (same frames as the web).                                                                                                                                                                                                                                                                                                                                                                                                  |
| Screen     | A WebView cannot set WS headers and a native bridge for binary RFB is overkill, so the app mints a **one-time ticket**: `POST /api/ws-tickets {scope:"screen"}` (bearer, superuser only) → `?ticket=` on `/api/screen/ws`. The ticket is 256-bit random, stored as SHA-256, single use (atomic `UPDATE … WHERE used_at IS NULL`), TTL 60 s, scope-bound; `requireSuperuser` still runs after redemption. Only `/api/screen/ws` upgrades accept it (`lib/wsTicket.ts`). |

WebViews load bundled HTML from memory (`lib/webview/*.generated.ts`, built by `bun run webviews` from `webview/*.ts` + `@xterm/xterm` + `@novnc/novnc`), may only navigate to the API origin, and keep no cookies/storage/file access (`components/html-view.tsx`). The screen page's CSP `connect-src` is the API origin only.

## Dictation (speech to text)

`components/mic-button.tsx` + `lib/dictation.ts` (`expo-speech-recognition` 57.1.1) in four places: the pane prompt composer, the issue comment composer, the new-issue description and the Send feedback sheet.

- **On device.** `requiresOnDeviceRecognition` is set when `supportsOnDeviceRecognition()` is true **and** the chosen language's offline pack is installed (`getSupportedLocales().installedLocales`). Otherwise the OS's own recognition service is used (Apple's, or Android's default, usually Google's): forcing on-device without the pack makes Android offer a download and then fail with "language not supported". Atur never records, stores or uploads audio; only the text enters the field.
- **Language.** `id-ID` when the device language is Indonesian, `en-US` otherwise; the ID/EN chip next to the mic switches it, and the choice is saved (`atur.dictation.locale`).
- **Behaviour.** Tap the mic to start (permission prompt on first use), tap again to stop. Interim results appear in the field live, re-derived from the text that was there when listening began; listening stops after ~2.5 s of silence (and the Android recognizer is asked for the same silence length).
- **States.** Permission denied → alert with an **Open Settings** button. Language pack missing or recognizer error → alert with the reason ("Didn't catch that" for no speech). Web (Expo web build) → the mic is disabled and explains that dictation needs the iOS or Android app; audio is never sent to a browser speech service.
- **Native config.** The `expo-speech-recognition` plugin in `app.json` sets `NSMicrophoneUsageDescription`, `NSSpeechRecognitionUsageDescription` and Android `RECORD_AUDIO`, plus a `<queries>` entry for the Google app so the recognizer is discoverable. Store disclosures: `docs/app-store.md` section 5, `docs/play-store.md` sections 6-8.

## Screen (remote desktop)

`app/screen.tsx` hosts `webview/screen.ts` (noVNC). The behaviour follows Microsoft's Windows App (Remote Desktop) for iOS/Android. Pure logic lives in `lib/` and is unit-tested: `screen-gestures.ts` (gesture recognizer), `screen-view.ts` (zoom/pan geometry, pointer acceleration), `screen-session.ts` (reconnect policy).

### Mouse modes

Switched from the connection bar (arrow / hand icon), remembered in `atur.screen.prefs`. **Mouse pointer** is the default.

| Gesture                     | Mouse pointer                            | Direct touch                   |
| --------------------------- | ---------------------------------------- | ------------------------------ |
| One-finger drag             | Move the pointer (trackpad, accelerated) | Pan the zoomed view            |
| Tap                         | Click at the pointer                     | Click where you touch          |
| Double-tap                  | Double click                             | Double click                   |
| Double-tap, hold, then drag | Left drag (select text, move windows)    | Left drag from the finger      |
| Hold (500 ms), release      | Right click (haptic at the hold)         | Right click where you touch    |
| Two-finger tap              | Right click                              | Right click under the fingers  |
| Three-finger tap            | Middle click                             | Middle click under the fingers |
| Two-finger drag             | Wheel (natural direction)                | Wheel under the fingers        |
| Pinch                       | Zoom 1-6x about the fingers (local only) | Same                           |

- A single tap's click waits 280 ms for a possible second tap, so "double-tap, hold, drag" reaches the desktop as one drag, never as a click followed by a press (which GTK reads as a double click and opens files).
- **Pointer.** Drawn locally at a fixed 26 px whatever the zoom: wayvnc (`-r`) paints the real cursor into a 1920 px frame, which shrinks to a few pixels on a phone. When zoomed, the view follows the pointer once it comes within 48 px of an edge.
- **View only** (More menu) sends no input; one finger then pans as in Direct touch. Opening the keyboard switches to control.
- **Input path.** Actions become synthetic mouse/wheel events on noVNC's canvas, so noVNC's own coordinate mapping applies at every zoom. noVNC's `setCapture` polyfill is replaced by no-ops: its full-screen capture div is only removed by a mouseup reaching `window`, which synthetic events never do, and it would swallow every touch after the first click.

### Connection bar and keys

A floating bar at the top (drag it sideways; the chevron tucks it into a status pill): status dot + round-trip time, mouse mode, keyboard, fit, More. **More**: view only, picture quality (Sharp / Balanced / Low data → noVNC quality 8/6/2, compression 2/2/9), copy the desktop clipboard (dot on More when the desktop copied something), paste the phone clipboard (Ctrl+V after), reconnect, the gesture table for the current mode, disconnect. The key row above the soft keyboard: hide, sticky Ctrl/Alt/Shift/Super (one-shot), Esc, Tab, arrows, Home, End, PgUp, PgDn, Del, Ins, PrtSc, F1-F12, Paste. With the keyboard up, the desktop area shrinks above it instead of hiding under it.

**Paste** (More menu or key row) sends whatever the phone clipboard holds. Text goes over RFB's clipboard. RFB carries text only, so an image takes another path: the app reads it as PNG (`Clipboard.getImageAsync`), posts the bytes to `POST /api/screen/clipboard` (superuser, at most 20 MiB), the Worker forwards them to the bridge's `POST /screen/clipboard` (bridge token, PNG magic checked), the bridge pipes them into `wl-copy --type image/png` on the desktop's Wayland session, and the app then presses Ctrl+V. The image pastes into whatever has focus. It replaces the desktop clipboard, as any copy would.

### Robustness

- **Ping.** Beside the binary RFB stream the page sends text frames `{"t":"ping","id","ts"}` every 5 s; the bridge answers `{"t":"pong",…}` (`ScreenHub.control`). Round-trip time and receive rate show in the bar and the More menu. Text frames never reach wayvnc. Older bridges ignore them, and the page then never applies the watchdog.
- **Dead socket.** Once pongs have been seen, 15 s with no bytes at all kills the session locally (close 4000) instead of waiting for TCP. On return to the foreground (`AppState` active) a live session is pinged and killed if nothing comes back within 4 s. A connection that hasn't finished the RFB handshake after 15 s is abandoned.
- **Auto-reconnect.** Any drop reconnects with a fresh ticket: immediately, then after 1, 2, 3, then 5 s, up to 20 attempts (the budget resets after 10 s connected). The last frame stays on screen meanwhile ("Reconnecting…, attempt n of 20", Stop reconnecting). It does not reconnect after close **4001** (another viewer took over) or 1013 (an older bridge's viewer cap). Coming back to the foreground retries a pending attempt at once.
- **Server side.** At the viewer cap (`SCREEN_MAX_VIEWERS`, 4) the bridge replaces the oldest viewer (close 4001) instead of refusing the newcomer, and a viewer that has pinged but then goes silent for `SCREEN_VIEWER_TIMEOUT_MS` (30 s) is dropped (close 4002). This clears the ghost sessions a phone leaves behind when its network changes. The Worker relay forwards close codes and reasons in both directions (reserved codes become 1011).
- Events from a replaced session (Reconnect pressed mid-session) are ignored by a per-connect generation counter, so a late "disconnected" can no longer end the new session.

## Tests

`bun test apps/native/lib` (also `bun run test` from the root): `ansi.test.ts` (SGR parsing, colour resolution, wide chars), `terminal-screen.test.ts` (snapshot/diff model, replay, link detection), `terminal-keys.test.ts` (modifiers, swipe steps, font sizing), `dictation-text.test.ts` (locale choice, transcript merging), `screen-gestures.test.ts` (both mouse modes: deferred tap, double click, double-tap-drag, hold, multi-finger taps, scroll vs pinch, mode switch releasing a held button), `screen-view.test.ts` (fit, pan clamping, zoom anchoring, pointer follow, acceleration), `screen-session.test.ts` (backoff, which closes retry). Bridge: `apps/bridge/src/hub.test.ts` (Ctrl letters, `paste`), `apps/bridge/src/screen.test.ts` (ping/pong off the RFB stream, liveness timeout, replace-oldest).

Pane management: `apps/native/lib/pane-workspaces.test.ts` (chip grouping, selection fallback, newest pane, new-workspace targets, custom path), `apps/app/src/worker/routes/__tests__/panes.test.ts` and `panes_relay.test.ts` (authz, routing by pane-id prefix, audit rows, old bridge), `apps/app/src/worker/lib/__tests__/panePaths.test.ts`, `apps/bridge/src/manage.test.ts`.

## Release note

New native modules (`react-native-webview`, `expo-clipboard`, `expo-screen-orientation`, `expo-speech-recognition`) and `orientation: default` change the native fingerprint: this needs a **new store build**; OTA alone will not deliver it. Dictation additionally adds the microphone and speech-recognition permissions, so the store privacy answers in `docs/app-store.md` / `docs/play-store.md` must match before submitting. The Screen rework (mouse modes, pointer, reconnect) is JS and bundled HTML only and ships over EAS Update to builds that already have the WebView.

Pane management (workspace chips, new workspace/pane, split, close) is JS only and ships over EAS Update. It needs the Worker deployed and, for the new routes and the workspace-label fix, the bridge restarted: `systemctl --user restart atur-bridge.service` for the dev box, an updated `atur-bridge` on customer machines (older ones answer "too old to manage panes"). Chips from an old bridge still work but show the first workspace's label on every pane.
