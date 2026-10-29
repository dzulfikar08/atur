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

| What                                         | Where                                                                                                                                                           |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rust core, facade, local echo                | `crates/atur-mobile` in [atur-terminal](https://github.com/dzulfikar08/atur-terminal), branch `feat/mobile-rn` (`src/direct.rs`, `src/ansi.rs`, `src/input.rs`) |
| Native module                                | `apps/native/modules/atur-direct` (`android/`, `ios/`, `src/`)                                                                                                  |
| Build of the core into the module            | `apps/native/modules/atur-direct/scripts/build-core.sh`, pinned by `core.ref`                                                                                   |
| Connection manager, pane transport, fallback | `apps/native/lib/direct/*`, `usePaneAttach` in `lib/pane-streams.ts`                                                                                            |
| Screens                                      | `app/direct.tsx` (pairing and settings), Direct section in the panes tab, badge in the pane header                                                              |
| Proof run on a device                        | `app/direct-e2e.tsx`, `lib/direct/e2e.ts`, `scripts/e2e-direct-android.sh`, `.github/workflows/native-direct.yml`                                               |

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

## Which transport the phone uses

**TLS 1.3 over TCP to the server's mobile port, through Tailscale or the LAN.** The phone already runs
Tailscale, so the pairing link's Tailscale address is reachable from anywhere, and Tailscale (WireGuard over
UDP) is the part that survives Wi-Fi to cellular changes: the tunnel keeps its identity while the path under
it moves, and the TCP connection inside sees at most a pause.

Why not the UDP transport (`muxy-protocol` `transport/udp`, designed for bad links) in phase 1:

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

Phase 2 replaces the TCP leg with the UDP stream, bootstrapped over the authenticated TLS connection
instead of SSH: a request on the paired connection asks the server to start a UDP listener and returns its
port and key, exactly what the stdio bridge prints today. It needs a server change (one new request) and
keeps TLS as the fallback. `muxy-protocol` (which contains the UDP state machine) already compiles for
Android and iOS, since the core depends on it.

## Local echo

Yes, on the phone, and it is the same code the desktop clients use. `Predictor` (`muxy-client/src/predict.rs`,
after mosh) lives in the core: the core feeds it every key it sends and every frame the server answers
with, and draws its guesses into the rows it hands to JavaScript. Guesses are hidden until one of them has
been confirmed (so password prompts and full-screen programs never show invented text), underlined after
250 ms unconfirmed, and dropped when wrong. A ping sent right behind typed input settles them. Modes:
`auto` (on above ~30 ms round trip), `always`, `never`, set from the Direct connection screen.

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
- A pane header badge says which road is in use (Direct with the round trip, or Cloud).

Account sign-in and the Atur Cloud plan gate still apply to the app as a whole in phase 1.

## Building it

```bash
# Rust core into the module (Android: cargo-ndk + NDK; iOS: macOS + Xcode). Uses the commit in core.ref,
# or a checkout of atur-terminal in ATUR_TERMINAL_DIR.
apps/native/modules/atur-direct/scripts/build-core.sh android      # and/or ios
cd apps/native && bunx expo prebuild -p android && cd android && ./gradlew :app:assembleRelease
```

Every build and test runs on GitHub-hosted runners: `.github/workflows/mobile.yml` in atur-terminal (core
checks and tests, Android libraries, iOS XCFramework) and `.github/workflows/native-direct.yml` here (repo
gates, Android emulator proof, bridge latency, iOS Simulator build).

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
iOS at runtime, UDP, and the bridge fallback end to end (its decision rules are unit tested; the proof run
cannot reach the Worker).

## Trying it on your phone

1. On the computer that runs Atur Terminal (an Atur Terminal build that contains this branch's protocol is
   not required: any 2.2 server works): `atur-term mobile enable`, then `atur-term mobile pair`. Do not
   run this against a server you are using for something else if you do not want a new paired device: it
   adds one entry that `atur-term mobile revoke <id>` removes.
2. Install a build of the app that contains the module: `expo run:android` / `expo run:ios` from
   `apps/native` after `build-core.sh`, or a CI build. An OTA update cannot add native code; the app shows
   "not available in this build" on older binaries.
3. Profile, Direct connection, Scan pairing code. Make sure Tailscale is connected on the phone. Open the
   Direct section of the Panes tab and tap a session.

## Next phases

2. **UDP transport** bootstrapped over TLS (server request + client), TLS fallback; connection migration
   test on a real phone; the bridge-free `Pane list` independent of an Atur account.
3. **Shortcut panels and gestures**: the accessory key bar from `Key`/`Modifiers`, mouse and scroll
   forwarding (the core already has `click`/`scroll`; the facade exposes neither yet), selection.
4. **Agent chat view** from the activity events and the agent's transcript, **diff and files** (the facade has
   `filesList` and `gitSummary`; the rest of `GitRepository` and `ProjectFiles` is a `match` arm each),
   **Live Activity / ongoing notification** driven by `activity` events (needs a push path while the app is
   suspended, which direct connections cannot provide on iOS), and **voice** input into the same `input`
   call.

Also open: image paste into prompts on a direct pane (`PromptComposer` still posts to the bridge), several
paired computers in the UI (the storage already keeps one credential per server id), and a deep link for
the pairing code.
