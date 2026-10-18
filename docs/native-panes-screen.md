# Native: terminal panes and desktop Screen

Panes tab (`app/(tabs)/panes.tsx`) lists `GET /api/panes` (only panes bound to a workspace the user belongs to). Tap → `app/pane/[paneId].tsx`: the pane in one of three views (**Native**, **Classic**, **Transcript**). The Screen button on the Panes header only renders when `/api/users/me` says `is_superuser`; `app/screen.tsx` is the full-screen (landscape-capable) noVNC view. The server enforces both rules (per-pane workspace membership; `requireSuperuser`).

## Pane views

The chip row picks the view; the choice is remembered (`atur.pane.view`, `lib/terminal-prefs.ts`). **Native is the default.**

| View       | What it is                                                                                                                                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native     | The visible screen drawn as React Native text (`components/terminal/*`). Fast, selectable per row, scrolls, pinch-zooms, has its own key row and (agent panes) a prompt composer.                                   |
| Classic    | The original xterm.js WebView (`components/terminal/classic-terminal.tsx`, `webview/terminal.ts`). Mounts mid-stream, so it first replays the current screen (`TerminalScreen.replay()`), then follows live frames. |
| Transcript | Structured blocks from `/api/panes/observe` (`components/terminal/transcript.tsx`), unchanged.                                                                                                                      |

One `usePaneAttach` socket feeds a `TerminalScreen` (`lib/terminal-screen.ts`); whichever renderer is mounted subscribes to it, so switching views never reconnects.

### Frames and the screen model

Bridge → app: `hello` (cols, rows, keyboard), `snapshot` (the whole visible grid as ANSI, rows joined by `\r\n`), `diff` (`[row, content]` pairs), `keyboard`, `pong`, `error`, `exit`. The bridge keeps **no scrollback**: the app sees only the visible grid, so "scroll back" is not possible and the pane's cols × rows are authoritative. `TerminalScreen` keeps `lines: string[]` (snapshot replaces all, diff replaces rows by index, absurd indices are ignored) and publishes a new immutable state per change (`useSyncExternalStore`).

App → bridge: `input {data}` (what xterm.js `onData` would send; the bridge turns it into herdr key presses, `translateInput` in `apps/bridge/src/hub.ts`), `paste {text, submit}` (one literal text paste; newlines stay newlines; `submit` presses Enter after), `claim`, `ping`.

> **Bridge restart needed.** `paste` and Ctrl+A…Z (anything beyond the old Ctrl+C/D/Z/\) are new in the bridge. Against an older bridge, multi-line composer sends/pastes and most Ctrl combos are silently ignored; restart the bridge from this commit. Single-line prompts and everything else work on the old bridge.

### Native renderer

- **Rows.** `lib/ansi.ts` parses one row of ANSI into styled spans: reset, bold, dim, italic, underline, inverse, 16 + bright, 256 and truecolor foreground/background (semicolon and colon forms); every other CSI/OSC/charset escape is consumed and dropped. Each row is a memoised `TerminalRow` keyed on its raw string, so a diff re-renders only the rows that changed. Rows are `FlatList` items with fixed height (`getItemLayout`), inside a horizontal `ScrollView` when the grid is wider than the phone.
- **Colours.** `components/terminal/palette.ts` mirrors the Classic view: `#0a0a0a` background, `#e5e5e5` foreground and xterm.js's default 16 colours; bold promotes colours 0-7 to bright, as xterm.js does. Dark in both app themes.
- **Font.** JetBrains Mono (500, and 700 for bold), cell width 0.6 em, line height 1.35 em. Default 11 pt. **Pinch** to resize (6–24 pt in half-point steps); the size is saved (`atur.pane.fontSize`) and reapplied. "Fit width" appears when the current size differs from the size that fits the pane's columns exactly.
- **Wide characters.** Width is approximated (`charWidth` in `lib/ansi.ts`: CJK, Hangul, fullwidth and common emoji = 2 cells, combining marks = 0). Rows that contain a double-width glyph render each chunk in a box of exactly its cell width, so columns stay aligned even though the fallback font's glyph is not exactly two cells.
- **Follow.** The view sticks to the bottom (the prompt) until you scroll up, and resumes when you scroll back near the bottom.
- **Copy and links.** Long-press a row copies its text (toast, haptic). Tap a URL (`https?://…`, trailing punctuation trimmed) to open it in the in-app browser; a tap elsewhere opens the keyboard.

### Input

- A hidden `TextInput` owns the soft keyboard. It always holds a sentinel so Backspace has something to delete; each change is diffed against the sentinel (`diffInput`) and sent as `input` frames. Return sends `\r`.
- **Key row** (two rows): Ctrl, Alt (sticky for one key), Esc, Tab, ← ↓ ↑ →; ⌨ (toggle keyboard), Home, End, PgUp, PgDn, Paste, `| / - ~`. Ctrl turns a letter into its control byte, Alt prefixes ESC (`lib/terminal-keys.ts`). A **horizontal swipe across the key rows repeats ←/→** (one press per 16 px); taps still press keys. Every key gives a light haptic.
- **Paste** sends clipboard text; multi-line text asks first and goes as one `paste` frame, never as typed Enters.
- **Prompt composer** (agent panes only, i.e. when the pane list reports an `agent`): a multiline draft with a mic button and Send. Send types the text and presses Enter: a single line is `input` with a trailing `\r`; multi-line text is a `paste` frame with `submit`. The draft is kept if the socket was not open. Typing needs the keyboard (Take keyboard); the composer is disabled while Read-only.

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

- **On device.** `requiresOnDeviceRecognition` is set whenever `supportsOnDeviceRecognition()` is true, so the app never falls back to a server recognizer when the phone can do it locally. Where the OS has no on-device engine, the OS's own recognition service is used (Apple's, or Android's default, usually Google's). Atur never records, stores or uploads audio; only the text enters the field.
- **Language.** `id-ID` when the device language is Indonesian, `en-US` otherwise; the ID/EN chip next to the mic switches it, and the choice is saved (`atur.dictation.locale`).
- **Behaviour.** Tap the mic to start (permission prompt on first use), tap again to stop. Interim results appear in the field live, re-derived from the text that was there when listening began; listening stops after ~2.5 s of silence (and the Android recognizer is asked for the same silence length).
- **States.** Permission denied → alert with an **Open Settings** button. Language pack missing or recognizer error → alert with the reason ("Didn't catch that" for no speech). Web (Expo web build) → the mic is disabled and explains that dictation needs the iOS or Android app; audio is never sent to a browser speech service.
- **Native config.** The `expo-speech-recognition` plugin in `app.json` sets `NSMicrophoneUsageDescription`, `NSSpeechRecognitionUsageDescription` and Android `RECORD_AUDIO`, plus a `<queries>` entry for the Google app so the recognizer is discoverable. Store disclosures: `docs/app-store.md` section 5, `docs/play-store.md` sections 6-8.

## Screen gestures

tap = left click · two-finger tap = right click · long-press + drag = mouse drag · one-finger drag = pan · pinch = zoom (1–6×) · two-finger drag = wheel. View-only is on by default; opening the keyboard switches to control mode.

## Tests

`bun test apps/native/lib` (also `bun run test` from the root): `ansi.test.ts` (SGR parsing, colour resolution, wide chars), `terminal-screen.test.ts` (snapshot/diff model, replay, link detection), `terminal-keys.test.ts` (modifiers, swipe steps, font sizing), `dictation-text.test.ts` (locale choice, transcript merging). Bridge: `apps/bridge/src/hub.test.ts` (Ctrl letters, `paste`).

## Release note

New native modules (`react-native-webview`, `expo-clipboard`, `expo-screen-orientation`, `expo-speech-recognition`) and `orientation: default` change the native fingerprint: this needs a **new store build**; OTA alone will not deliver it. Dictation additionally adds the microphone and speech-recognition permissions, so the store privacy answers in `docs/app-store.md` / `docs/play-store.md` must match before submitting.
