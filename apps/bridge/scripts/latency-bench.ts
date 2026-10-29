// Attach time and input echo through the bridge's loopback socket, for comparison with the direct
// path (docs/native-direct.md). No Cloudflare hop: this is the bridge alone, so the real cloud
// path is slower by that hop's round trip.
//
//   BRIDGE_URL=http://127.0.0.1:7601 BRIDGE_TOKEN=... bun scripts/latency-bench.ts <pane id> [samples]
//
// Prints `bridge ...` lines in the same shape as the direct bench.

const base = (process.env.BRIDGE_URL ?? "http://127.0.0.1:7601").replace(/^http/, "ws");
const token = process.env.BRIDGE_TOKEN ?? "";
const pane = process.argv[2];
const samples = Number(process.argv[3] ?? 30);
if (!pane) throw new Error("usage: latency-bench.ts <pane id> [samples]");

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const plain = (text: string) => text.replace(/\x1b\[[0-9;:?]*[A-Za-z]/g, "");

let rows: string[] = [];
const waiters = new Set<() => void>();
const changed = () => {
  for (const waiter of [...waiters]) waiter();
};

const started = performance.now();
const ws = new WebSocket(`${base}/attach?pane=${encodeURIComponent(pane)}`, {
  headers: { "x-bridge-token": token },
} as unknown as string[]);
let firstSnapshotAt = 0;
let keyboard = false;

ws.onmessage = (event) => {
  const msg = JSON.parse(String(event.data)) as Record<string, unknown>;
  if (msg.type === "hello" || msg.type === "keyboard") {
    keyboard = (msg.keyboard ?? msg.you) === true || keyboard;
  } else if (msg.type === "snapshot" && typeof msg.ansi === "string") {
    firstSnapshotAt ||= performance.now();
    rows = msg.ansi.split("\r\n").map(plain);
    changed();
  } else if (msg.type === "diff" && Array.isArray(msg.rows)) {
    for (const [index, text] of msg.rows as [number, string][]) {
      while (rows.length <= index) rows.push("");
      rows[index] = plain(text);
    }
    changed();
  }
};

function until(check: () => boolean, ms = 15_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out")), ms);
    const waiter = () => {
      if (!check()) return;
      clearTimeout(timer);
      waiters.delete(waiter);
      resolve();
    };
    waiters.add(waiter);
    waiter();
  });
}

await new Promise<void>((resolve, reject) => {
  ws.onopen = () => resolve();
  ws.onerror = () => reject(new Error("bridge refused the socket"));
});
await until(() => firstSnapshotAt > 0);
console.log(`bridge attach_ms=${(firstSnapshotAt - started).toFixed(2)}`);

ws.send(JSON.stringify({ type: "claim" }));
await until(() => keyboard);
ws.send(JSON.stringify({ type: "input", data: "cat >/dev/null\r" }));
await sleep(500);

const times: number[] = [];
let typed = "";
for (let i = 0; i < samples; i++) {
  typed += "q";
  const sent = performance.now();
  ws.send(JSON.stringify({ type: "input", data: "q" }));
  await until(() => rows.some((row) => row.includes(typed)));
  times.push(performance.now() - sent);
  await sleep(25);
}
times.sort((a, b) => a - b);
const at = (f: number) => times[Math.min(times.length - 1, Math.floor(times.length * f))] ?? 0;
console.log(
  `bridge echo n=${times.length} p50_ms=${at(0.5).toFixed(2)} p90_ms=${at(0.9).toFixed(2)} max_ms=${(times[times.length - 1] ?? 0).toFixed(2)}`,
);
ws.send(JSON.stringify({ type: "input", data: "\u0004" }));
ws.close();
process.exit(0);
