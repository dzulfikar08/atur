import { directManager, openDirectPane, type DirectLink } from "@/lib/direct";
import { parseRow, rowText } from "@/lib/ansi";
import { TerminalScreen } from "@/lib/terminal-screen";
import type { DirectConnection } from "@/modules/atur-direct";

// The on-device proof run (CI, emulator): pairs with a real server through the real native module,
// opens a terminal through the same pane code the app uses, types, measures, and survives the app
// going to the background and the network dropping. Built into the app only when
// EXPO_PUBLIC_ATUR_E2E=1 (see app/direct-e2e.tsx); the host script reads the `ATUR_E2E` log lines.

const TAG = "ATUR_E2E";
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

    // 5. Background and foreground: the host presses Home, waits, and brings the app back.
    step("background");
    const cyclesBefore = appCycles();
    const attachedBefore = attached;
    say(`${TAG} WAIT background`);
    await waitFor("the app to leave and return", () => appCycles() > cyclesBefore, 180_000);
    await waitFor("connected again", () => directManager.getSnapshot().state === "connected");
    await waitFor("reattached", () => attached > attachedBefore);
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

    pane.close();
    await (directManager.getSnapshot().connection as DirectLink).endSession(session.id);
    record("snapshots", snapshots);
    return { ok: true, metrics };
  } catch (error) {
    const failure = error instanceof Error ? error.message : String(error);
    say(`${TAG} FAILURE ${failure}`);
    return { ok: false, failure, metrics };
  }
}
