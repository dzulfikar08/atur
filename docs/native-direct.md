# Direct terminals in the phone app

The phone app can reach a computer's terminals without Atur Cloud in the middle: it pairs once with an
Atur Terminal server (scan a QR code), keeps a credential in the Keychain or Android Keystore, and talks to
the server over its own pinned TLS connection, usually through Tailscale. The bridge and Cloudflare path
stays as it is and takes over when the direct one does not work.

```
                    ┌────────────────────────────────────────────────────────────┐
 phone              │  React Native (lib/direct, components/terminal)            │
                    │      │ JSON strings          ▲ ANSI rows, events           │
                    │  Expo module  AturDirect (Kotlin / Swift, ~100 lines each)  │
                    │      │ UniFFI                ▲                              │
                    │  atur-mobile (Rust): TLS 1.3 + protocol, screen, local echo │
                    └──────┼───────────────────────┼─────────────────────────────┘
                           │ TCP 7419, pinned certificate (Tailscale / LAN)
 computer           atur-term-server  ── sessions, agents, git, files
                           ▲
                    atur-bridge ── Worker ── phone     (existing path, the fallback)
```

Phase 1 (this branch) is the connection foundation: pairing, connecting, listing sessions, a live terminal
with typing and local echo, reconnecting, and the fallback. Shortcut panels, the agent chat view, diff and
files, Live Activities and voice come later (see [Next phases](#next-phases)).

## Where the code is

| What                                         | Where                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rust core, facade, local echo                | `crates/atur-mobile` in [atur-terminal](https://github.com/dzulfikar08/atur-terminal), branch `feat/mobile-rn` (`src/direct.rs`, `src/ansi.rs`, `src/input.rs`)                                                                                                                                                                                                               |
| Native module                                | `apps/native/modules/atur-direct` (`android/`, `ios/`, `src/`)                                                                                                                                                                                                                                                                                                                |
| Build of the core into the module            | `apps/native/modules/atur-direct/scripts/build-core.sh`, pinned by `core.ref`                                                                                                                                                                                                                                                                                                 |
| Connection manager, pane transport, fallback | `apps/native/lib/direct/*`, `usePaneAttach` in `lib/pane-streams.ts`                                                                                                                                                                                                                                                                                                          |
| Screens                                      | `components/direct/direct-settings.tsx` (pairing and settings; `app/direct.tsx` signed in, `app/direct-home.tsx` for everyone), `app/pair.tsx` (a tapped link), `app/direct-pane/[sessionId].tsx`, Direct section in the panes tab, badge in the pane header                                                                                                                  |
| Proof run on a device                        | `app/direct-e2e.tsx`, `lib/direct/e2e.ts`, `scripts/e2e-direct-android.sh` (phase 1: the scripted scenario, on TLS; phase 2: clean install, signed out, tapped link, typed command, read through `scripts/ui-assert.py`; phase 3: the lossy link, TLS against UDP, shaped with `tc netem` on the host), `scripts/start-test-server.sh`, `.github/workflows/native-direct.yml` |

## Calling the Rust core from both platforms

The core is the Rust client library that Atur Terminal's own mobile SDK is built on (`muxy-client` and
`muxy-protocol`, MIT). It already speaks the server's protocol, pins the server certificate, keeps each
attached screen up to date and acknowledges frames, so the app never reimplements any of that.

The app reaches it through a small Expo module, one Kotlin and one Swift file, on top of the Kotlin and
Swift bindings that UniFFI generates (`crates/atur-mobile` is the renamed `muxy-mobile`; its library, Kotlin
package and Swift module are called `atur_mobile`, so nothing in a phone's lib directory or crash report
carries the upstream name).

Two decisions keep the glue small and the platforms identical:

1. **One JSON facade instead of the whole UniFFI surface.** `src/direct.rs` exposes four functions and one
   object (`Direct`): `connect`, `call(method, argsJson)`, `fire(method, argsJson)`, `disconnect`, plus an
   event listener. Everything crossing the boundary is a string: answers are `{"ok": ...}` or
   `{"error": {"code", "reason"}}`, events are one JSON object each. Kotlin and Swift forward strings and
   never parse them; `modules/atur-direct/src/connection.ts` does that once, in TypeScript. Adding a method
   (a git action in phase 3) is a Rust `match` arm and a TypeScript method, no native code.
2. **The core speaks the app's rendering vocabulary.** The app already draws terminals from ANSI rows
   (`TerminalScreen`: `hello`, `snapshot`, `diff`). The core renders its screen to the same rows and sends
   only rows that changed, so `NativeTerminal` and `ClassicTerminal` work unchanged on the direct path, and
   scrollback uses the same `history` request. Typing goes the other way as the xterm byte strings the app
   already produces; the core parses them into typed text and key presses (`src/input.rs`) so the server
   encodes arrows, function keys and paste with the program's own modes. This is the translation the bridge
   does in `translateInput`, done in Rust.

`fire` exists because typing must never wait: input, paste and resize are queued inside the core and run in
order on one thread, and the module calls it synchronously from JS (a JSI call, no promise, no thread hop).
Everything that can block (connect, pair, session list, history) goes through `call`, off the main thread,
one at a time per module.

Alternatives considered:

- **uniffi-bindgen-react-native** (JSI bindings generated from the same UniFFI definitions). One generated
  layer instead of two glue files, but it pins specific UniFFI versions and RN internals while the Atur
  Terminal core pins `uniffi =0.32.2` and the app is on RN 0.86 with the new architecture. The JSON facade
  needs no matching toolchain and the glue is a few dozen lines. Licence note: that tool is MPL-2.0 (file
  level copyleft, acceptable) but we do not use it, so no MPL files are in the app. The core is MIT, JNA
  (Android's loader for the generated Kotlin) is Apache-2.0 / LGPL-2.1 dual.
- **Native SSH from the app** (what the core's `BridgeChannel` is for). Needs an SSH library in both
  platforms, host key UX, and a login; pairing is one scan.

## Pairing

On the computer: `atur-term mobile enable` once, then `atur-term mobile pair` prints a QR code and a link
(`...://pair?v=1&h=<host>&h=<host>&p=7419&f=<certificate hash>&s=<one-time secret>`). The link lists the
computer's addresses, including its Tailscale address, and works once for five minutes.

In the app: Profile, Direct connection, Scan pairing code (camera) or paste the link (simulators, or a link
sent to yourself). The app shows `host:port` and asks for confirmation, with the device name that the
computer will list under paired devices. The core pairs over TLS trusting only the certificate named in the
link, and returns a credential: server id and name, addresses, port, certificate fingerprint, device id and a
32 byte token.

The credential is stored through `expo-secure-store`: iOS Keychain with
`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` (no iCloud sync, no restore to another phone), Android
Keystore-backed encrypted preferences. It is read back after writing, and a write the keystore dropped is an
error, not a silent success. Links and credentials are never logged. Revoking the device on the computer
(`atur-term mobile revoke`) closes its connection at once; the app then shows "pair again".

A scanned or pasted link is parsed by the core, never in JavaScript.

**Tapping the link.** `atur-term mobile pair` prints `atur://pair?...`, and the app registers the `atur`
scheme, so opening that link on the phone (a message to yourself, a note) opens the app on the pairing
screen: `app/+native-intent.tsx` turns `atur://pair?...` (or the router's `/pair?...`) into
`/pair?link=<the whole link, encoded>` (`pairRouteFor` in `lib/direct/pair-link.ts`), and `app/pair.tsx` hands
the link to the core. It shows `host:port` and the name this phone will have, and pairs only after Confirm; a
link the core rejects says "This is not an Atur pairing code." and pairs nothing. The screen works signed out
and signed in. The legacy pairing link (an older server prints its own scheme) is accepted when pasted or
scanned, where the core reads it; the app registers no extra scheme for it. A pasted `.../pair?link=...`
wrapper is unwrapped before the core sees it.

## Which transport the phone uses

The phone connects **TLS 1.3 over TCP to the server's mobile port** first, through Tailscale or the LAN, and
then, when the server offers it, moves to a **UDP stream** over the same paired identity (see
[UDP, bootstrapped over TLS](#udp-bootstrapped-over-tls) below). TLS stays as the fallback. The phone already runs
Tailscale, so the pairing link's Tailscale address is reachable from anywhere, and Tailscale (WireGuard over
UDP) is the part that survives Wi-Fi to cellular changes: the tunnel keeps its identity while the path under
it moves, and the TCP connection inside sees at most a pause.

Why phase 1 did not use the UDP transport (`muxy-protocol` `transport/udp`, designed for bad links) yet:

- Its bootstrap is SSH: the client runs `atur-term stdio --udp`, reads the port and key from the SSH
  session, then drops SSH. A phone has no `ssh` binary, and an SSH library inside the app is exactly the
  work the pairing flow avoids.
- Over Tailscale the lossy hop is usually the phone's own radio, which WireGuard does not fix but which a
  TCP connection inside it tolerates for the short stalls a terminal sees. The UDP stream pays off when the
  path is bad enough that TCP's backed-off retransmit timer shows (its own notes: 8 to 12 s to recover from a
  10 s outage over SSH against 0.3 to 2 s over UDP). That is a measurable gain, and the next phase.

What the phone does about the things a transport has to survive:

| Situation                               | Behaviour                                                                                                                                                                                                                              |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App goes to the background              | iOS suspends sockets; Android may keep them for a while. The manager keeps the connection 30 s, then closes it, so nothing wakes the radio for a terminal nobody is looking at. Sessions live in the server, nothing is lost.          |
| App comes back                          | The manager connects at once, open terminals attach again (`openDirectPane` re-attaches on the new connection without remounting the screen), and the server sends a full snapshot.                                                    |
| Network drops or changes                | The core reports `disconnected` (reset, or the server stopped answering). The manager retries after 1, 2, 5 s and then every 10 s while the app is in front. The core never reconnects by itself, so there is one policy in one place. |
| Server restarts                         | `restarting` event: retry after 2 s.                                                                                                                                                                                                   |
| Revoked, identity changed, incompatible | No retry; the screen says what the user has to do.                                                                                                                                                                                     |
| Battery                                 | No traffic in the background; in front, one ping every few seconds keeps the round trip fresh for the local echo and the latency readout.                                                                                              |

## UDP, bootstrapped over TLS

Phase 2 adds the UDP leg. The first connection is the same authenticated, pinned TLS one, so pairing,
revocation and the addresses work unchanged. Then the core asks the server, over that connection, for a
UDP listener: the server binds a port from `ATUR_TERM_UDP_PORTS` (`LOW-HIGH`, default 60001-61000, the
variable the stdio bridge uses) and answers `{port, key}` with a fresh 256-bit secret. The core opens the
UDP stream (`muxy-protocol` `transport/udp`, the state machine built for lossy links) to the same host,
claims it with the key, and runs the usual Hello and device-credential authentication on it: the secret is
an extra layer, the device token is still checked. When the UDP stream is up, it replaces the TLS connection
(TLS is closed) before `connect` returns; on any failure the TLS connection stays.

- **One listener per offer**, closed after 30 s unclaimed or when the TLS connection that asked ends. The
  per-device and connection-limit admission of TLS applies, and revoking a device closes its UDP connection
  too.
- **The server must be updated.** A server without the offer answers the request as unknown: the phone stays
  on TLS and shows "older server" next to the transport in the settings. `ATUR_TERM_UDP=0` on the server turns
  the offer off ("turned off"). A server whose UDP ports the phone cannot reach shows "no answer in 3 s".
  Open the range in the firewall, or over Tailscale it just works.
- **Predictive local echo stays on** and uses the UDP round trip like any other.
- **Settings** (Profile, Direct connection): `Transport` is `Auto` (default) or `TLS only` (persisted;
  changing it reconnects at once), the transport in use is shown (`UDP`, or `TLS` with the reason UDP was not
  used), and the pane header badge reads `Direct UDP · 38 ms`. The app passes the preference to the core by
  merging `{"transport": "auto" | "tls"}` into the credential JSON it hands `connect`; the answer carries
  `transport` and `udpNote`, and `echoStats` carries `transport` too.

LOSSY_RESULTS_PLACEHOLDER: the numbers of the lossy-link run (phase 3 of `native-direct`: TLS against UDP at
about 800 ms round trip and 10% round-trip loss, key to echo p50 / p90 / max, local echo on and off, and the
time to carry a key again after a 10 s outage) are filled in here after CI.

## Choosing the route

A computer is reachable several ways at once (its address on the local network, its Tailscale address, a
`.local` name) and they differ a lot. When the phone itself hosts the hotspot the computer is on, Tailscale
cannot connect the two directly and relays through DERP (123 ms measured) although the phone and the
computer are 2.6 ms apart on the local link. Addresses saved at pairing were tried in order, one after
another with a 4 s timeout each, so the slow or dead first one decided everything. Now the core races them
and the app keeps the race going (`muxy-client/src/race.rs`, `lib/direct/manager.ts`).

- **The race.** On every connect (`native.connect`, so also every retry and the return from the
  background) the core ranks the credential's addresses: local first (RFC 1918, link-local, loopback,
  `.local` names), then Tailscale (100.64.0.0/10, `*.ts.net`), then the rest, each group in the stored order.
  The first starts at once, the next one 150 ms later if nothing has signed in yet, or immediately when the
  one before failed. The first connection that completes the TLS handshake, Hello and sign-in is kept and
  the others are closed. With a single address nothing is raced.
- **What stays pinned.** Every attempt is the same TLS handshake trusting only the certificate fingerprint
  stored at pairing, then the same device token sign-in. A host that presents another certificate is never
  used (and reported as "not the computer you paired with" only when no address worked). The race never adds
  trust: it only decides which of the addresses of the one paired computer carries the connection. Pairing
  itself races the link's addresses to the first TLS connection only, because its secret works once.
- **What the connect answer says.** `route: {host, kind: "local" | "tailscale" | "other", ms}` (`ms` is the
  winning address's own connect, TLS and sign-in time), `addresses: [...]` (below), and `echoStats` carries
  `route` too. The connection card in Direct connection shows `Local · 3 ms` or `Tailscale · 120 ms`; once
  the manager's ping has a sample, that live round trip replaces `ms`.
- **Learning addresses.** A server that lists the feature `SERVER_ADDRESSES` answers the new
  `ReadAddresses` request (paired connections only) with `{hosts, port}`: the addresses a pairing link would
  list right now. The core merges them: what the server reported first, then the winning address if the
  server did not list it, then the stored ones not in the list, each once, at most eight. The app writes the
  list back into the credential as `hosts` (`credentials.updateHosts`, which changes nothing else) so
  the new hotspot or Wi-Fi address is tried first the next time, without pairing again. Hosts are never
  logged; the card lists them under "Addresses" (hosts only, never the token or the fingerprint). An older
  server is never asked and the stored addresses stay as they are.
- **Racing again.** `manager.reroute()` opens a second connection through `native.connect(credential)`, which
  races again, measures three pings on it and on the live one (median of each), and swaps when the new one is
  at least 30% and 20 ms faster: `snapshot.connection` becomes the new link in one step, the old one is
  disconnected, and `openDirectPane` re-attaches every open terminal on the new link without remounting
  because it follows the snapshot. One reroute runs at a time; a request during one shares it. It runs
  (1) 1.5 s after a network change (`expo-network`'s `addNetworkStateListener`, injected as `network` like
  `appState`, so tests use a fake), (2) when the app returns to the front, (3) every 60 s while the route
  is not local or the ping is above 80 ms, and it stops looking once the route is local and fast, and
  (4) from the "Re-check route" button. The first three skip a route that is already local and fast.
  `expo-network` needs a new build of the app: where its native module is missing the app still starts and
  relies on (2) and (3).

## Local echo

Yes, on the phone, and it is the same code the desktop clients use. `Predictor` (`muxy-client/src/predict.rs`,
after mosh) lives in the core: the core feeds it every key it sends and every frame the server answers
with, and draws its guesses into the rows it hands to JavaScript. Guesses are hidden until one of them has
been confirmed (so password prompts and full-screen programs never show invented text), underlined after
250 ms unconfirmed, and dropped when wrong. A ping sent right behind typed input settles them. Modes:
`auto` (on above ~30 ms round trip), `always`, `never`. The phone defaults to `auto`, keeps the choice (Direct
connection screen, "Local echo") and applies it to every connection right after it is made. The same screen
shows live numbers from the core: the mode, the round trip, and how many keys were typed, how many guesses
were shown and confirmed, and how many were shown and wrong.

Nothing was ported: the predictor owns no clock, socket or screen. The only new code is the overlay on the
rows and a timer thread that sleeps until the predictor's next deadline (it does not poll). What is not
predicted: the cursor position (the app draws no cursor), and anything the predictor itself refuses
(paste, escape sequences, the alternate screen until the program proved it echoes).

## Choosing between direct and the bridge

`usePaneAttach(paneId)` keeps its shape and picks the road itself (`lib/direct/transport-choice.ts` holds
the rules and has unit tests):

- `direct:<sessionId>` panes (the Direct section of the panes tab) are direct only: no bridge to fall back
  on, so a failure is shown as such.
- Any other pane goes direct when the user prefers it (default on once paired) and the paired computer lists
  the pane's id as a session. On Atur Terminal the bridge's pane id is the session id; tmux and herdr ids
  (`%3`, `w1:p2`) never match, so those panes stay on the bridge.
- Fallback to the bridge when direct is not attached within 4 s, the computer refuses the attach, or the
  direct connection drops and does not come back within 6 s. While on the bridge the manager keeps trying;
  the pane returns to direct the moment the computer is connected again. The bridge socket is closed before
  the direct attach, and frames still queued from it are dropped, so the two roads never interleave.
- A pane header badge says which road is in use (Direct UDP or TLS with the round trip, or Cloud).
- Session rows (and a direct pane's header) show the terminal's own title as the primary text, as the
  desktop app's session list does, with the project name and the folder as secondary text; a session whose
  terminal set no title shows the project name. Agent providers are shown by their short name (`Oh My Pi`
  as `omp`, `lib/direct/session-meta.ts`).

## Without an Atur account

Direct needs no sign-in. The root layout (`app/_layout.tsx`) keeps the account's screens (issues, inbox, cloud
panes, profile) behind `Stack.Protected`, and puts the Direct area outside it: `direct-home` (connection,
pairing, the computer's sessions, a row to sign in), `direct-pane/[sessionId]` (a terminal; `components/terminal/pane-screen.tsx`
asks the account API for nothing on a `direct:` pane) and `pair`. The login screen has "Use Direct without
signing in". When the app starts signed out and a computer is already paired, it opens `direct-home`
instead of the login screen (`startRoute` in `lib/direct/start-route.ts`; a tapped pairing link wins). The
Atur Cloud plan gate holds back only the account's screens: a signed-in account without a plan sees the plan
screen, which has a button into Direct.

## Images in prompts

`pasteImage` of the facade writes the image into the computer's Home project at `.cache/atur/pastes/<name>`
(the bridge's default paste directory, 5 MiB at most) and answers with the absolute path. On a direct pane
the prompt composer's image button sends the clipboard image that way (`paste-<epoch ms>.png`,
`lib/direct/paste-image.ts`) and inserts the returned path, exactly as the bridge path does.

## Scrolling back

The pane's scrollback is not part of the live stream: the frames carry the visible grid only, and the rows
above it are read on request (`history` of the facade, answered by the core from the server's history pages,
500 rows at most per page, newest first, `visible` telling how many trailing rows are the live grid).
`TerminalScreen` (`lib/terminal-screen.ts`) keeps them next to the grid; `TerminalView` shows both in one
inverted list.

What was wrong on a direct pane running an agent that prints all the time (found by reading the code; the
phase 4 run below is what proves the fix on a device):

- **One slow queue for every call.** The Android and iOS modules ran every `call` (attach, detach, session
  list, ping, history) on a single thread. A first read of 3000 rows is many page round trips, each served
  by the session's owner thread that is also busy parsing the agent's output, so the read held up everything
  behind it, outlasted the screen's 8 s "reply lost" timeout, and the screen asked again while the first was
  still running. A failed read was swallowed, so nothing was retried until the next scroll event. Scrollback
  reads now have their own thread (queue on iOS) and their own order; a failed read frees the slot
  (`onHistoryFailed`), and the timeout grows with the size of the read.
- **A short read taken for the whole scrollback.** A page cursor goes stale when the server clears or rewrites
  its scrollback between two pages, which a full-screen redraw of an agent does. The core stopped paging at
  that point and answered with the rows it had, so the pane showed a few hundred rows. The core now starts
  the read over (three tries) before it settles for a short one.
- **No way past the first window.** The phone asked once for 3000 rows and nothing else. A read is now small
  on purpose (1000 rows, so the first screenful does not wait for thousands) and the reader pages back: when
  the reader gets within 80 rows of the oldest loaded row `TerminalView` calls `onNearTop`,
  `TerminalScreen.loadOlder()` asks for a longer window (loaded rows plus a step of 3000 that doubles), up to
  the core's cap of 20 000 rows, and the rows before the loaded ones are put above them. Every loaded row
  keeps its key (`historyBase` moves by what was put before it), so nothing on screen moves. The pane's first
  row is known when a read comes back shorter than asked, and then nothing more is requested.
- **A re-render storm at the agent's pace.** Each frame (ten a second) rebuilt the item object of every row of
  the list, handed it a new `renderItem`, `getItemLayout` and pinch gesture, and re-rendered the whole
  `NativeTerminal` (the keyboard input, the composer, the key row), because it subscribed to the whole screen
  state for one number. Every rendered cell of the list therefore re-rendered ten times a second and the pinch
  `GestureDetector` was reconfigured as often, on the thread that has to deliver the scroll events. Scrollback
  items are now built only when scrollback changes, a live item is reused while its row is unchanged,
  `renderItem` and the gesture keep their identity, `NativeTerminal` reads `cols` only, and the horizontal
  scroller around the list is switched off when the pane fits the phone (it competed for the vertical swipes
  of the list inside it).
- **No way back.** The reader is "at the bottom" within 48 px; only there does the view follow output. A round
  button (`Jump to bottom`) shows whenever the reader is above it. Rows that output pushes into scrollback are
  topped up only while the reader is within three screens of the live grid; further up nothing below them
  changes while they read, and a top-up fetches what was missed when they come back.

Checked and found fine: the facade exposes no mouse tracking and no scroll forwarding, and nothing in
`TerminalView`, `NativeTerminal` or `lib/screen-gestures.ts` (the Screen tab's) takes a vertical pan; the
history rows come from the server's pages and never carry the local-echo guesses (only the visible grid is
drawn with them); `visible` is the length of the server's screen in the same read, so the cut between
scrollback and grid is exact; the pane resizes when its width, its tallest height or the font size changes,
not while scrolling (the soft keyboard only shortens the view, the height used is the tallest seen), and the
server's history pages are the same after the full reset frame a resize brings.

Proof: phase 4 of `native-direct` (`scripts/e2e-direct-android.sh`, `scenario=scroll` in
`lib/direct/e2e.ts`). A shell prints `row-1` to `row-2500` and then one `live-N` row per 100 ms. The scenario
reads the scrollback through the same `TerminalScreen` wiring as the pane screen and needs every `row-N` in
order with no gap, then `live-N` rows appended by top-ups without a gap, then opens the real pane screen. The
host swipes back 12 times by 70% of the screen with `adb shell input swipe`, reads the rows with uiautomator
(`scripts/ui-assert.py scroll-up`) and needs rows at least 400 places back (`scroll_rows_reached`) and the
same rows on screen for 5 s of live output (`scroll_held_ms`); then more swipes until the first row is in
reach, and a tap on the jump button must bring `live-N` rows newer than before the swipes, remove the button
and keep following the output.

## Building it

```bash
# Rust core into the module (Android: cargo-ndk + NDK; iOS: macOS + Xcode). Uses the commit in core.ref,
# or a checkout of atur-terminal in ATUR_TERMINAL_DIR.
apps/native/modules/atur-direct/scripts/build-core.sh android      # and/or ios
cd apps/native && bunx expo prebuild -p android && cd android && ./gradlew :app:assembleRelease
```

Every build and test runs on GitHub-hosted runners: `.github/workflows/mobile.yml` in atur-terminal (core
checks and tests, Android libraries, iOS XCFramework) and `.github/workflows/native-direct.yml` here (repo
gates, a `server` job that builds `atur-term` and `atur-term-server` from the atur-terminal commit in
`core.ref` so the isolated test server has the UDP offer, Android emulator proof, bridge latency, iOS
Simulator build).

## What was proven

All of it on GitHub-hosted runners (nothing was compiled on the laptop), against isolated servers, never the
live one.

|                                                                                                                                                                                                                                                                                                             | Evidence                                                                                                                                      |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Core compiles, lints (`clippy -D warnings`) and passes its tests, including the facade tests (pair, attach, type, rows, history, ping, paste, errors, disconnect) against a real in-process TLS server                                                                                                      | atur-terminal `mobile` workflow, job `core`, branch `feat/mobile-rn`                                                                          |
| Android libraries (arm64-v8a, armeabi-v7a, x86_64) and Kotlin bindings; iOS XCFramework (device, simulator arm64 and x86_64) and Swift bindings                                                                                                                                                             | same workflow, jobs `android` and `ios`                                                                                                       |
| Android: the release APK (R8 on, so the keep rules are exercised) installed on an API 34 x86_64 emulator, paired by link, connected, listed, attached through `usePaneAttach`'s direct pane code, typed into, survived the app going to the background for 40 s and a connection reset, and read scrollback | `native-direct` workflow, job `android-e2e` (log lines and screenshots in the `android-e2e` artifact)                                         |
| iOS: module and app build for the simulator with Xcode 26                                                                                                                                                                                                                                                   | `native-direct` workflow, job `ios-simulator` (compile only: there is no simulator run, no XCTest; JS tests cover the logic above the module) |
| JS: formatting, lint, typecheck and the new unit tests (manager backoff, background grace, forget, pane event translation and reattach, transport choice, credentials)                                                                                                                                      | `gates` job; the job is red only because of `TmuxBackend ... creates a workspace` in `apps/bridge`, which fails the same way on master's CI   |

Android emulator run (isolated server on the runner, reached at 10.0.2.2, release build):

| Step                                                                            | Result                                                                                                                                                  |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pair and connect (TLS handshake, pinning, sign-in)                              | 0.49 to 0.59 s                                                                                                                                          |
| Ping to the server                                                              | p50 1.9 ms (emulator to host)                                                                                                                           |
| Attach to first snapshot                                                        | 2 to 9 ms                                                                                                                                               |
| `echo e2e-$((40+2))` typed, output on screen                                    | 0.17 to 0.30 s (includes shell start)                                                                                                                   |
| After 40 s in the background                                                    | connection survived on this emulator, next command echoed in 35 ms                                                                                      |
| Connection reset by the server host (`iptables REJECT --reject-with tcp-reset`) | state went offline, reconnected and reattached in 7.6 s (1 s + 2 s + 5 s backoff steps while the port was still blocked for 8 s), next command in 19 ms |
| Scrollback request                                                              | 24 rows                                                                                                                                                 |

Direct versus bridge, both on loopback with the same measurement (30 keys, typed 100 ms apart into `cat`):

|                                                                 | Attach to first screen | Key to echo on screen, p50 / p90                                                                                               |
| --------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Rust core, facade, loopback TLS (`cargo test ... bench_facade`) | 1.9 ms                 | 1.07 / 3.7 ms with local echo off; **0.34 / 0.38 ms with local echo on** (39 of 40 guesses confirmed, 0 wrong)                 |
| Android emulator, JS to native to core and back                 | 2 to 9 ms              | 17 ms either way; this is the 16 ms JS timer tick of the measuring loop, not the path (local echo cannot show below that here) |
| Bridge on loopback, no Cloudflare                               | 2.9 to 4.5 ms          | 100 ms (the bridge mirrors a pane in about 100 ms steps)                                                                       |

The Cloudflare hop adds its own 70 to 230 ms round trip to the bridge numbers (measured earlier, see
`docs/bridge.md`), so the real gap on a phone is larger than the table. These are loopback numbers: they show
the cost of each software path, not of a network. A real phone over Tailscale pays the network round trip
once on the direct path.

Not proven: a real device, Tailscale, a long background on a real phone (the emulator kept the connection),
iOS at runtime, UDP connection migration between networks, and the bridge fallback end to end (its decision rules are unit tested; the proof run
cannot reach the Worker).

## Trying it on your phone

1. On the computer that runs Atur Terminal (any 2.2 server works over TLS; a build with the UDP offer, the
   one `core.ref` points to or newer, is needed for UDP, and older servers just stay on TLS): `atur-term mobile enable`, then `atur-term mobile pair`. Do not
   run this against a server you are using for something else if you do not want a new paired device: it
   adds one entry that `atur-term mobile revoke <id>` removes.
2. Install a build of the app that contains the module: `expo run:android` / `expo run:ios` from
   `apps/native` after `build-core.sh`, or a CI build. An OTA update cannot add native code; the app shows
   "not available in this build" on older binaries.
3. Profile, Direct connection, Scan pairing code. Make sure Tailscale is connected on the phone. Open the
   Direct section of the Panes tab and tap a session.

## Next phases

2. **UDP transport**: done (see [UDP, bootstrapped over TLS](#udp-bootstrapped-over-tls)). Still open:
   connection migration test on a real phone (Wi-Fi to cellular), and the bridge-free `Pane list`
   independent of an Atur account.
3. **Shortcut panels and gestures**: the accessory key bar from `Key`/`Modifiers`, mouse and scroll
   forwarding (the core already has `click`/`scroll`; the facade exposes neither yet), selection.
4. **Agent chat view** from the activity events and the agent's transcript, **diff and files** (the facade has
   `filesList` and `gitSummary`; the rest of `GitRepository` and `ProjectFiles` is a `match` arm each),
   **Live Activity / ongoing notification** driven by `activity` events (needs a push path while the app is
   suspended, which direct connections cannot provide on iOS), and **voice** input into the same `input`
   call.

Also open: several paired computers in the UI (the storage already keeps one credential per server id).
