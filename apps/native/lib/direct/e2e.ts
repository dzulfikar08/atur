import {
  directManager,
  openDirectPane,
  type DirectLink,
  type DirectPaneHandle,
} from "@/lib/direct";
import { parseRow, rowText } from "@/lib/ansi";
import { applyModifiers, editDraft } from "@/lib/terminal-keys";
import { HISTORY_FULL_LINES, TerminalScreen, type ScreenState } from "@/lib/terminal-screen";
import type { DirectConnection } from "@/modules/atur-direct";

// The on-device proof run (CI, emulator): pairs with a real server through the real native module,
// opens a terminal through the same pane code the app uses, types, measures, and survives the app
// going to the background and the network dropping. Built into the app only when
// EXPO_PUBLIC_ATUR_E2E=1 (see app/direct-e2e.tsx); the host script reads the `ATUR_E2E` log lines.

const TAG = "ATUR_E2E";
/**
 * Which scenario the route plays: the scripted one, the one on a lossy, slow link, or the one that
 * leaves an omp-like workload in a pane for the host to scroll back through.
 */
export type E2EScenario = "base" | "lossy" | "scroll";
const STEP_TIMEOUT_MS = 90_000;

export interface E2EReport {
  ok: boolean;
  failure?: string;
  metrics: Record<string, number | string>;
}

type Say = (line: string) => void;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function percentile(sorted: number[], fraction: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
}

function summarize(samples: number[]): string {
  const sorted = [...samples].sort((a, b) => a - b);
  const round = (n: number) => Math.round(n * 10) / 10;
  return `p50=${round(percentile(sorted, 0.5))}ms p90=${round(percentile(sorted, 0.9))}ms max=${round(sorted[sorted.length - 1] ?? 0)}ms n=${sorted.length}`;
}

function waitFor<T>(
  what: string,
  poll: () => T | null | undefined | false,
  timeoutMs = STEP_TIMEOUT_MS,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      const value = poll();
      if (value) return resolve(value);
      if (Date.now() - started > timeoutMs)
        return reject(new Error(`timed out waiting for ${what}`));
      setTimeout(tick, 5);
    };
    tick();
  });
}

/** A valid 1x1 PNG (70 bytes). */
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

/** What the app would show on screen, without escape sequences. */
function screenText(screen: TerminalScreen): string[] {
  return screen.getState().lines.map((line) => rowText(parseRow(line)));
}

export async function runDirectE2E(
  link: string,
  say: Say,
  appCycles: () => number,
): Promise<E2EReport> {
  const metrics: E2EReport["metrics"] = {};
  const step = (name: string) => say(`${TAG} STEP ${name}`);
  const record = (key: string, value: number | string) => {
    metrics[key] = value;
    say(`${TAG} METRIC ${key}=${value}`);
  };

  try {
    // 1. Pair, with the link the server printed, and connect.
    step("pair");
    await directManager.start();
    // The connection-reset step below breaks TCP; this scenario is about the TLS connection (the
    // UDP one is proven by the lossy scenario), so it asks for TLS only.
    await directManager.setTransport("tls");
    const pairStart = Date.now();
    await directManager.pair(link, "Atur E2E emulator");
    await waitFor("connected", () => directManager.getSnapshot().state === "connected");
    record("pair_and_connect_ms", Date.now() - pairStart);

    const live = () => directManager.getSnapshot().connection as unknown as DirectConnection | null;
    const link0 = live();
    if (!link0) throw new Error("connected without a connection");
    record("server_version", link0.serverVersion);
    const rtt = [];
    for (let i = 0; i < 10; i++) rtt.push(await link0.ping());
    record("ping", summarize(rtt));

    // 2. A fresh shell in the Home project, attached through the pane code the app uses.
    step("attach");
    const projects = await link0.projects();
    const home = projects.find((project) => project.isHome) ?? projects[0];
    if (!home) throw new Error("the server has no project");
    const session = await link0.createSession(home.id, 80, 24);
    const screen = new TerminalScreen();
    let snapshots = 0;
    let attached = 0;
    let firstSnapshotAt = 0;
    const attachStart = Date.now();
    const pane = openDirectPane(
      directManager,
      session.id,
      {
        onHello: ({ cols, rows }) => screen.hello(cols, rows),
        onSnapshot: (ansi) => {
          snapshots += 1;
          firstSnapshotAt ||= Date.now();
          screen.snapshot(ansi);
        },
        onDiff: (rows) => screen.diff(rows),
        onAttached: () => {
          attached += 1;
        },
      },
      { cols: 80, rows: 24 },
    );
    await waitFor("first snapshot", () => snapshots > 0);
    record("attach_to_snapshot_ms", firstSnapshotAt - attachStart);

    const typeAndSee = async (command: string, expect: string, label: string) => {
      const started = Date.now();
      if (!pane.sendInput(`${command}\r`)) throw new Error(`${label}: input was refused`);
      await waitFor(`${label}: "${expect}" on screen`, () =>
        screenText(screen).some((line) => line.trim() === expect),
      );
      return Date.now() - started;
    };

    // 3. Type, see the output.
    step("type");
    record("type_and_output_ms", await typeAndSee("echo e2e-$((40+2))", "e2e-42", "first command"));

    // 3b. Image paste without the bridge: the core writes the file on the computer and answers
    // with its path; the shell proves it is there.
    step("paste-image");
    const pasteStart = Date.now();
    const pasted = await link0.pasteImage(session.id, "paste-e2e.png", TINY_PNG_BASE64);
    record("paste_image_ms", Date.now() - pasteStart);
    if (!pasted.path.endsWith("/.cache/atur/pastes/paste-e2e.png"))
      throw new Error(`unexpected pasted image path: ${pasted.path}`);
    await typeAndSee(`test -s '${pasted.path}' && echo img-ok`, "img-ok", "image on the computer");

    // 4. Echo latency with the predictor off and on, one key at a time into `cat`.
    step("echo");
    pane.sendInput("cat >/dev/null\r");
    await sleep(1200);
    for (const mode of ["never", "always"] as const) {
      await link0.setEchoMode(mode);
      const letter = mode === "never" ? "q" : "w";
      const samples: number[] = [];
      let typed = "";
      for (let i = 0; i < 30; i++) {
        typed += letter;
        const started = Date.now();
        pane.sendInput(letter);
        await waitFor(`echo of ${typed.length} ${letter}`, () =>
          screenText(screen).some((line) => line.includes(typed)),
        );
        samples.push(Date.now() - started);
        await sleep(100);
      }
      record(`echo_${mode}`, summarize(samples));
      pane.sendInput("\u0004"); // Ctrl-D ends cat; the next round starts a new one
      await sleep(1200);
      pane.sendInput("cat >/dev/null\r");
      await sleep(1200);
    }
    pane.sendInput("\u0004");
    await sleep(1200);
    await link0.setEchoMode("auto");

    // 4b. Ctrl+A is ^A, as a terminal sends it: readline moves to the start of the line, so the
    // "a" typed after it lands before "bc". The bytes are the ones the key row and a hardware
    // keyboard produce (lib/terminal-keys); `cat` would not do, its line editing is the tty's.
    step("ctrl-a");
    pane.sendInput("bash -c 'read -e -r x; echo ctrl-a-got:$x'\r");
    await sleep(1500);
    pane.sendInput("bc");
    pane.sendInput(applyModifiers("a", { ctrl: true, alt: false }));
    pane.sendInput("a");
    pane.sendInput("\r");
    await waitFor("ctrl-a: the line read as abc", () =>
      screenText(screen).some((line) => line.trim() === "ctrl-a-got:abc"),
    );

    // 4c. The prompt composer edits its draft like a terminal line (Ctrl+A = start of line), then
    // sends it as the pane code does: the draft "cho composer-ok" becomes "echo composer-ok".
    step("composer-ctrl-a");
    {
      let draft = "cho composer-ok";
      const edited = editDraft(draft, draft.length, "a");
      if (!edited || edited.caret !== 0) throw new Error("Ctrl+A did not move to the line start");
      draft = `e${edited.text}`;
      if (!pane.sendInput(`${draft}\r`)) throw new Error("composer draft refused");
      await waitFor("composer-ctrl-a: the edited draft ran", () =>
        screenText(screen).some((line) => line.trim() === "composer-ok"),
      );
    }

    // 4d. Done: an omp-titled process works, then finishes. The computer reports Done until the
    // session is viewed; acknowledging (what opening the pane does) makes it Idle again.
    step("done");
    {
      const agentSession = await link0.createSession(home.id, 80, 24);
      let shown = 0;
      const agentPane = openDirectPane(
        directManager,
        agentSession.id,
        {
          onSnapshot: () => {
            shown += 1;
          },
        },
        { cols: 80, rows: 24 },
      );
      const state = async () =>
        (await link0.activity()).agents.find((agent) => agent.session === agentSession.id)?.state ??
        null;
      const until = async (wanted: string, label: string) => {
        const limit = Date.now() + 30_000;
        for (;;) {
          const got = await state();
          if (got === wanted) return;
          if (Date.now() > limit)
            throw new Error(`${label}: the agent is ${got}, wanted ${wanted}`);
          await sleep(250);
        }
      };
      await waitFor("the agent session's first snapshot", () => shown > 0);
      await sleep(1000);
      agentPane.sendInput("bash -c 'exec -a omp /bin/cat'\r");
      await until("idle", "done: omp detected");
      agentPane.sendInput("\x1b]0;π ⠋ Inspect files\x07\r");
      await until("working", "done: working");
      agentPane.sendInput("\x1b]0;π > Inspect files\x07\r");
      await until("done", "done: finished");
      await directManager.acknowledge(agentSession.id);
      await until("idle", "done: acknowledged");
      if ((await link0.activity()).events.some((event) => event.session === agentSession.id)) {
        throw new Error("done: an unread event is left after the acknowledge");
      }
      agentPane.close();
      await link0.endSession(agentSession.id);
    }

    // 5. Background and foreground: the host presses Home, waits, and brings the app back.
    step("background");
    const cyclesBefore = appCycles();
    const attachedBefore = attached;
    say(`${TAG} WAIT background`);
    await waitFor("the app to leave and return", () => appCycles() > cyclesBefore, 180_000);
    await waitFor("connected again", () => directManager.getSnapshot().state === "connected");
    // The connection either survived the trip (nothing to attach again) or was dropped after the
    // grace period and the pane attached on the new one; both must leave a working terminal.
    await sleep(2000);
    record(
      "reattached_after_background",
      attached > attachedBefore ? "yes" : "no (connection survived)",
    );
    record(
      "after_background_ms",
      await typeAndSee("echo after-bg-$((1+1))", "after-bg-2", "after background"),
    );

    // 6. The network drops: the host resets the connection.
    step("drop");
    const attachedAtDrop = attached;
    say(`${TAG} WAIT drop`);
    await waitFor(
      "the connection to drop",
      () => directManager.getSnapshot().state !== "connected",
      60_000,
    );
    const dropped = Date.now();
    await waitFor("connected again", () => directManager.getSnapshot().state === "connected");
    await waitFor("reattached", () => attached > attachedAtDrop);
    record("reconnect_ms", Date.now() - dropped);
    record(
      "after_drop_ms",
      await typeAndSee("echo after-drop-$((1+2))", "after-drop-3", "after drop"),
    );

    // 7. The scrollback path the selector uses.
    step("history");
    const history = await (directManager.getSnapshot().connection as DirectLink).history(
      session.id,
      200,
    );
    if (history.rows.length < 5 || history.visible < 1) throw new Error("history came back empty");
    record("history_rows", history.rows.length);

    // Nerd Font icons in the last rows of the pane: phase 2 opens this session in the app and
    // screenshots it, which shows the symbols font drawing them (no boxes).
    step("glyphs");
    await typeAndSee(
      "echo '\ue0b0 \uf013 \uf09b \uf07b \uf121 \u{f0e7b} glyphs'",
      "\ue0b0 \uf013 \uf09b \uf07b \uf121 \u{f0e7b} glyphs",
      "icon glyphs",
    );

    // The session stays on the computer: the host's second phase (scripts/e2e-direct-android.sh)
    // opens it from the Direct area of a freshly installed app.
    pane.close();
    record("snapshots", snapshots);
    return { ok: true, metrics };
  } catch (error) {
    const failure = error instanceof Error ? error.message : String(error);
    say(`${TAG} FAILURE ${failure}`);
    return { ok: false, failure, metrics };
  }
}

// --- Phase 3: a lossy, slow link -----------------------------------------------------------------
//
// The host (scripts/e2e-direct-android.sh) shapes the TLS port and the UDP port with `tc netem` once
// this logs `WAIT shape` (about 800 ms round trip, ~10% round-trip loss), and cuts both ports for
// 10 s on `WAIT outage`. The same measurement runs for TLS and then for UDP, so the two numbers
// are comparable: 30 single keys one per 400 ms into `cat` with local echo off, then (UDP only)
// with it on, then the time the connection needs to carry a key again after the outage.

const SHAPED_RTT_MS = 300;
const LOSSY_KEYS = 30;
const LOSSY_KEY_GAP_MS = 400;
const LOSSY_ECHO_TIMEOUT_MS = 20_000;
const OUTAGE_MS = 10_000;
const PROBE_GAP_MS = 500;
const RECOVERY_TIMEOUT_MS = 120_000;
const UDP_ATTEMPTS = 3;

export async function runLossyE2E(link: string, say: Say): Promise<E2EReport> {
  const metrics: E2EReport["metrics"] = {};
  const step = (name: string) => say(`${TAG} STEP ${name}`);
  const record = (key: string, value: number | string) => {
    metrics[key] = value;
    say(`${TAG} METRIC ${key}=${value}`);
  };
  const live = () => directManager.getSnapshot().connection as unknown as DirectConnection | null;
  const connected = () => directManager.getSnapshot().state === "connected";

  try {
    step("pair");
    await directManager.start();
    await directManager.setTransport("tls");
    await directManager.pair(link, "Atur E2E emulator");
    await waitFor("connected", connected);
    const first = live();
    if (!first) throw new Error("connected without a connection");
    record("server_version", first.serverVersion);
    if (first.transport !== "tls") throw new Error("asked for TLS only and got " + first.transport);

    step("attach");
    const projects = await first.projects();
    const home = projects.find((project) => project.isHome) ?? projects[0];
    if (!home) throw new Error("the server has no project");
    const session = await first.createSession(home.id, 80, 24);
    const screen = new TerminalScreen();
    let snapshots = 0;
    let attached = 0;
    const pane = openDirectPane(
      directManager,
      session.id,
      {
        onHello: ({ cols, rows }) => screen.hello(cols, rows),
        onSnapshot: (ansi) => {
          snapshots += 1;
          screen.snapshot(ansi);
        },
        onDiff: (rows) => screen.diff(rows),
        onAttached: () => {
          attached += 1;
        },
      },
      { cols: 80, rows: 24 },
    );
    await waitFor("first snapshot", () => snapshots > 0);

    // The host shapes the link now that the app is connected; wait until a ping feels it.
    const awaitShapedLink = async (label: string) => {
      const rtts: number[] = [];
      const started = Date.now();
      for (;;) {
        const conn = live();
        if (conn && connected()) {
          try {
            const ms = await conn.ping();
            rtts.push(ms);
            if (ms > SHAPED_RTT_MS) return rtts;
          } catch {
            // The connection is changing under us; try again.
          }
        }
        if (Date.now() - started > 90_000)
          throw new Error(`${label}: the link is not shaped (pings ${rtts.join(", ")})`);
        await sleep(300);
      }
    };

    step("shape");
    say(`${TAG} WAIT shape`);
    record("lossy_tls_ping", summarize(await awaitShapedLink("tls")));

    const measureEcho = async (letter: string, mode: "never" | "always") => {
      await directManager.setEchoMode(mode);
      pane.sendInput("cat >/dev/null\r");
      // The predictor guesses again only once the server has caught up with the Enter: about
      // four round trips and half a second, so wait that long (shaped link: ~0.8 s round trip).
      await sleep(mode === "always" ? 9000 : 3000);
      const samples: number[] = [];
      let typed = "";
      for (let i = 0; i < LOSSY_KEYS; i++) {
        typed += letter;
        const started = Date.now();
        pane.sendInput(letter);
        await waitFor(
          `echo of ${typed.length} ${letter} (${mode})`,
          () => screenText(screen).some((line) => line.includes(typed)),
          LOSSY_ECHO_TIMEOUT_MS,
        );
        samples.push(Date.now() - started);
        await sleep(LOSSY_KEY_GAP_MS);
      }
      const stats = await live()?.echoStats(session.id);
      say(
        `${TAG} METRIC echo_detail_${mode}=first=${samples.slice(0, 6).join("/")} ` +
          `stats=${JSON.stringify(stats ?? null)}`,
      );
      pane.sendInput("\u0004");
      await sleep(3000);
      return summarize(samples);
    };

    const markerCount = (marker: string) =>
      screenText(screen).reduce((sum, line) => sum + line.split(marker).length - 1, 0);

    // Cut both ports for 10 s (host), then type a probe key every 500 ms starting when the cut
    // ends, and report how long until one of them shows up on screen.
    const measureRecovery = async (marker: string) => {
      await directManager.setEchoMode("never");
      pane.sendInput("cat >/dev/null\r");
      await sleep(3000);
      const baseline = markerCount(marker);
      say(`${TAG} WAIT outage`);
      const cutEnd = Date.now() + OUTAGE_MS;
      await sleep(OUTAGE_MS);
      for (;;) {
        pane.sendInput(marker);
        const until = Date.now() + PROBE_GAP_MS;
        while (Date.now() < until) {
          if (markerCount(marker) > baseline) {
            const recovery = Date.now() - cutEnd;
            pane.sendInput("\u0004");
            await sleep(3000);
            return recovery;
          }
          await sleep(10);
        }
        if (Date.now() - cutEnd > RECOVERY_TIMEOUT_MS)
          throw new Error("no key came back after the outage");
      }
    };

    step("echo-tls");
    record("lossy_tls_echo", await measureEcho("q", "never"));
    step("outage-tls");
    record("lossy_tls_recovery_ms", await measureRecovery("x"));

    // Same link, same measurement, over UDP: reconnect with the preference, shaped link included.
    step("switch-udp");
    let udpNote = "";
    let onUdp = false;
    for (let attempt = 1; attempt <= UDP_ATTEMPTS && !onUdp; attempt++) {
      const attachedBefore = attached;
      await directManager.setTransport("auto");
      await waitFor("connected on the shaped link", connected, 120_000);
      await waitFor("the pane attached again", () => attached > attachedBefore, 120_000);
      const conn = live();
      udpNote = conn?.udpNote ?? "no connection";
      onUdp = conn?.transport === "udp";
      if (!onUdp && attempt < UDP_ATTEMPTS) {
        say(`${TAG} STEP udp-retry ${attempt} note="${udpNote}"`);
        await directManager.setTransport("tls");
        await waitFor("connected again", connected, 120_000);
      }
    }
    record("transport_used", live()?.transport ?? "none");
    if (!onUdp)
      throw new Error(`the app did not end up on UDP after ${UDP_ATTEMPTS} tries: ${udpNote}`);
    record("lossy_udp_ping", summarize(await awaitShapedLink("udp")));

    step("echo-udp");
    record("lossy_udp_echo", await measureEcho("e", "never"));
    step("echo-udp-predicted");
    record("lossy_udp_echo_predicted", await measureEcho("r", "always"));
    step("outage-udp");
    record("lossy_udp_recovery_ms", await measureRecovery("y"));

    await directManager.setEchoMode("auto");
    pane.close();
    return { ok: true, metrics };
  } catch (error) {
    const failure = error instanceof Error ? error.message : String(error);
    say(`${TAG} FAILURE ${failure}`);
    return { ok: false, failure, metrics };
  }
}

// --- Phase 4: scrolling back in a pane that prints all the time -------------------------------------
//
// An agent on the main screen: a long scrollback and a line every 100 ms. The scenario starts that
// in a shell, proves at the data level (the same TerminalScreen wiring as the pane screen: first
// read, older reads, top-ups) that every row of the scrollback is there and in order, then opens
// the app's own pane screen (`/direct-pane/<id>`) and logs `STEP ui`. From there the host
// (scripts/e2e-direct-android.sh phase 4, scripts/ui-assert.py) swipes with `adb` and reads the rows
// off the screen with uiautomator.

/** Rows the workload prints before it goes on to print `live-N` ten times a second. */
export const SCROLL_PRINTED_ROWS = 2500;
/**
 * The workload also prints a `msg-N` row after every `SCROLL_MSG_EVERY` rows, each marked as a
 * prompt (OSC 133;A) the way an agent marks the start of a user message: `msg-1` to `msg-25`
 * spread across the scrollback, the targets of the prompt buttons in the pane screen.
 */
const SCROLL_MSG_EVERY = 100;
const SCROLL_MSGS = SCROLL_PRINTED_ROWS / SCROLL_MSG_EVERY;
const SCROLL_WORKLOAD =
  `n=0; while [ $n -lt ${SCROLL_MSGS} ]; do ` +
  `seq -f 'row-%g' $((n*${SCROLL_MSG_EVERY}+1)) $((n*${SCROLL_MSG_EVERY}+${SCROLL_MSG_EVERY})); ` +
  "n=$((n+1)); printf '\\033]133;A\\007msg-%s\\n' $n; done; " +
  'i=0; while :; do if [ ! -e /tmp/atur-live-pause ]; then i=$((i+1)); echo "live-$i"; fi; sleep 0.1; done';

/** The text of absolute row `row` of the loaded scrollback and grid; empty when it is not loaded. */
function textOfRow(state: ScreenState, row: number): string {
  const index = row - state.historyBase;
  const line =
    index < state.history.length ? state.history[index] : state.lines[index - state.history.length];
  return line === undefined ? "" : rowText(parseRow(line)).trim();
}

/** The numbers N of the `msg-N` rows the computer reports as prompts, in order. */
function promptedMsgs(state: ScreenState): number[] {
  const found: number[] = [];
  for (const row of state.prompts) {
    const match = /^msg-(\d+)$/.exec(textOfRow(state, row));
    if (match) found.push(Number(match[1]));
  }
  return found;
}

/** The numbers of the rows named `<kind>-N` in `rows`, in the order they appear. */
function numberedRows(rows: readonly string[], kind: "row" | "live"): number[] {
  const found: number[] = [];
  const pattern = new RegExp(`^${kind}-(\\d+)$`);
  for (const line of rows) {
    const match = pattern.exec(rowText(parseRow(line)).trim());
    if (match) found.push(Number(match[1]));
  }
  return found;
}

/** Null when `numbers` run first, first + 1, first + 2 ... without gap, repeat or reorder. */
function breakIn(numbers: readonly number[]): string | null {
  for (let i = 1; i < numbers.length; i++) {
    if (numbers[i] !== numbers[i - 1]! + 1) {
      return `${numbers[i - 1]} is followed by ${numbers[i]} (at ${i} of ${numbers.length})`;
    }
  }
  return null;
}

/** Calls `nudge` every `gapMs` until `done`; the failure names what it was waiting for. */
async function until(
  what: string | (() => string),
  done: () => boolean,
  nudge: () => void,
  timeoutMs = 120_000,
  gapMs = 200,
): Promise<void> {
  const started = Date.now();
  while (!done()) {
    if (Date.now() - started > timeoutMs)
      throw new Error(`timed out waiting for ${typeof what === "string" ? what : what()}`);
    nudge();
    await sleep(gapMs);
  }
}

export async function runScrollE2E(
  link: string,
  say: Say,
  openPane: (session: string) => void,
): Promise<E2EReport> {
  const metrics: E2EReport["metrics"] = {};
  const step = (name: string) => say(`${TAG} STEP ${name}`);
  const record = (key: string, value: number | string) => {
    metrics[key] = value;
    say(`${TAG} METRIC ${key}=${value}`);
  };
  const live = () => directManager.getSnapshot().connection as unknown as DirectConnection | null;

  try {
    step("pair");
    await directManager.start();
    await directManager.setTransport("tls");
    await directManager.pair(link, "Atur E2E emulator");
    await waitFor("connected", () => directManager.getSnapshot().state === "connected");
    const connection = live();
    if (!connection) throw new Error("connected without a connection");

    step("attach");
    const projects = await connection.projects();
    const home = projects.find((project) => project.isHome) ?? projects[0];
    if (!home) throw new Error("the server has no project");
    const session = await connection.createSession(home.id, 80, 24);

    // The pane screen's own wiring: a TerminalScreen fed by the pane, asking it for history.
    const screen = new TerminalScreen();
    const reads: number[] = [];
    let pane: DirectPaneHandle | null = null;
    let snapshots = 0;
    const handle = openDirectPane(
      directManager,
      session.id,
      {
        onHello: ({ cols, rows }) => {
          screen.hello(cols, rows);
          screen.setHistorySource((lines) => {
            reads.push(lines);
            pane?.requestHistory(lines);
          });
          screen.loadHistory("full");
        },
        onSnapshot: (ansi) => {
          snapshots += 1;
          screen.snapshot(ansi);
        },
        onDiff: (rows) => screen.diff(rows),
        onHistory: (rows, visible, prompts) => screen.setHistory(rows, visible, prompts),
        onHistoryFailed: () => screen.historyFailed(),
      },
      { cols: 80, rows: 24 },
    );
    pane = handle;
    await waitFor("first snapshot", () => snapshots > 0);

    step("workload");
    if (!handle.sendInput(`${SCROLL_WORKLOAD}\r`)) throw new Error("workload: input was refused");
    const visibleRows = () => screenText(screen);
    await waitFor("the workload's live rows on screen", () =>
      visibleRows().some((line) => /^live-\d+$/.test(line.trim())),
    );

    // Data level 1: the first read, the way the pane screen makes it on connect, and top-ups
    // until the workload's rows (printed after that read) are in it.
    step("history");
    const readStart = Date.now();
    const loadedRows = () => screen.getState().history;
    await until(
      () => `a first window of scrollback (${loadedRows().length} rows loaded)`,
      () => loadedRows().length >= HISTORY_FULL_LINES - 100,
      () => screen.loadHistory(),
    );
    record("history_first_read_ms", Date.now() - readStart);

    // Data level 2: older reads, asked as the reader nears the top, until row-1 is in.
    const olderStart = Date.now();
    await until(
      () =>
        `row-1 in the loaded scrollback (${loadedRows().length} rows loaded, reads asked for ` +
        `${reads.join(", ")} lines)`,
      () => numberedRows(loadedRows(), "row")[0] === 1,
      () => screen.loadOlder(),
    );
    record("history_to_row_1_ms", Date.now() - olderStart);
    record("history_reads", reads.join(","));
    record("history_rows", loadedRows().length);

    const rowsLoaded = numberedRows(loadedRows(), "row");
    const rowGap = breakIn(rowsLoaded);
    if (rowGap) throw new Error(`the scrollback has a break in row-N: ${rowGap}`);
    // The server may keep a little less than everything that was printed (it trims its history to
    // a budget); what is there must be one unbroken run of rows from the start.
    record("history_row_range", `row-${rowsLoaded[0] ?? 0}..row-${rowsLoaded.at(-1) ?? 0}`);
    if (rowsLoaded.length < SCROLL_PRINTED_ROWS * 0.9)
      throw new Error(
        `scrollback has ${rowsLoaded.length} of the ${SCROLL_PRINTED_ROWS} printed rows (row-1..row-N)`,
      );

    // The prompt marks of the workload (OSC 133;A before every msg-N) come back with the history
    // read as prompt rows, each on its msg-N row: what the pane screen's prompt buttons jump to.
    step("prompts");
    await until(
      () =>
        `the msg-N rows as prompts (${promptedMsgs(screen.getState()).length} of ${SCROLL_MSGS})`,
      () => promptedMsgs(screen.getState()).length >= SCROLL_MSGS * 0.8,
      () => screen.loadHistory(),
      60_000,
    );
    const msgs = promptedMsgs(screen.getState());
    const msgGap = breakIn(msgs);
    if (msgGap) throw new Error(`the prompt rows have a break in msg-N: ${msgGap}`);
    record("prompt_rows", msgs.length);

    // Data level 3: output goes on; a top-up appends below what is loaded without a gap or repeat.
    const liveBefore = numberedRows(loadedRows(), "live");
    const newest = liveBefore.at(-1) ?? 0;
    await until(
      "top-ups that bring in the rows printed meanwhile",
      () => (numberedRows(loadedRows(), "live").at(-1) ?? 0) >= newest + 30,
      () => screen.loadHistory(),
      60_000,
    );
    const liveGap = breakIn(numberedRows(loadedRows(), "live"));
    if (liveGap) throw new Error(`the scrollback has a break in live-N: ${liveGap}`);
    if (numberedRows(loadedRows(), "row").length !== SCROLL_PRINTED_ROWS)
      throw new Error("rows row-N changed while top-ups appended live rows");
    record("history_rows_after_topups", loadedRows().length);

    // The app's own pane screen takes over; the host scrolls it from here.
    handle.close();
    step("ui");
    openPane(session.id);
    return { ok: true, metrics };
  } catch (error) {
    const failure = error instanceof Error ? error.message : String(error);
    say(`${TAG} FAILURE ${failure}`);
    return { ok: false, failure, metrics };
  }
}
