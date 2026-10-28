/**
 * ScreenHub against a fake wayvnc: a script that listens on the port given as
 * its last argument, greets with an RFB banner and echoes whatever it gets.
 * Real timers on purpose: this exercises a real child
 * process, real sockets and the real grace-period timer, which fake timers can't drive.
 */
import { afterEach, beforeAll, describe, expect, it } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SCREEN_CLOSE, ScreenHub, type ScreenConfig, type ScreenWs } from "./screen";

let fakeBin = "";
let nextPort = 15900 + Math.floor(Math.random() * 1000);

beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), "screen-test-"));
  const server = join(dir, "fake-vnc.ts");
  writeFileSync(
    server,
    `const port = Number(process.argv[process.argv.length - 1]);
const host = process.argv[process.argv.length - 2];
if (host !== "127.0.0.1") process.exit(3);
if (process.env.FAKE_ARGS_FILE) require("node:fs").appendFileSync(process.env.FAKE_ARGS_FILE, process.argv.slice(2).join(" ") + "\\n");
if (process.env.FAKE_REJECT_GPU && process.argv.includes("-g")) {
  console.error("no usable GPU");
  process.exit(4);
}
// "flood\\n" makes the server stream 8 MiB of a counting pattern as fast as the socket takes it.
const TOTAL = 8 * 1024 * 1024;
const sent = new WeakMap();
function pump(s) {
  let at = sent.get(s) ?? 0;
  while (at < TOTAL) {
    const n = Math.min(65536, TOTAL - at);
    const buf = new Uint8Array(n);
    for (let i = 0; i < n; i++) buf[i] = (at + i) % 251;
    const w = s.write(buf);
    at += w;
    if (w < n) break; // unwritten tail is regenerated from the offset on drain
  }
  sent.set(s, at);
}
Bun.listen({
  hostname: host,
  port,
  socket: {
    open(s) { s.write("RFB 003.008\\n"); },
    data(s, d) { if (Buffer.from(d).toString() === "flood\\n") pump(s); else s.write(d); },
    drain(s) { if ((sent.get(s) ?? 0) < TOTAL && (sent.get(s) ?? 0) > 0) pump(s); },
    close() {}, error() {},
  },
});
process.on("SIGTERM", () => process.exit(0));
`,
  );
  fakeBin = join(dir, "fake-wayvnc");
  writeFileSync(fakeBin, `#!/bin/sh\nexec bun run ${server} "$@"\n`);
  chmodSync(fakeBin, 0o755);
});

interface FakeWs extends ScreenWs {
  received: Uint8Array[];
  texts: string[];
  closed: { code?: number; reason?: string } | null;
}

function fakeWs(id: number): FakeWs {
  const ws: FakeWs = {
    data: { screen: true, id },
    received: [],
    texts: [],
    closed: null,
    send(data) {
      if (typeof data === "string") ws.texts.push(data);
      else ws.received.push(Uint8Array.from(data));
      return data.length;
    },
    close(code, reason) {
      ws.closed = { code, reason };
    },
  };
  return ws;
}

/** A viewer whose socket queues every send until `release()` (a stalled phone link). */
function slowWs(id: number): FakeWs & { queued: number; release(): number } {
  const ws = fakeWs(id) as FakeWs & { queued: number; release(): number };
  ws.queued = 0;
  ws.getBufferedAmount = () => ws.queued;
  const plain = ws.send;
  ws.send = (data) => {
    plain(data);
    if (typeof data !== "string") ws.queued += data.length;
    return ws.queued > 0 ? -1 : data.length;
  };
  ws.release = () => {
    const n = ws.queued;
    ws.queued = 0;
    return n;
  };
  return ws;
}

function text(ws: FakeWs): string {
  return Buffer.concat(ws.received).toString();
}

async function until(cond: () => boolean, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("timeout");
    await Bun.sleep(20);
  }
}

function makeHub(over: Partial<ScreenConfig> = {}): {
  hub: ScreenHub;
  notes: string[];
  cfg: ScreenConfig;
} {
  const cfg: ScreenConfig = {
    port: nextPort++,
    wayvncBin: fakeBin,
    libDir: "",
    waylandDisplay: "wayland-test",
    runtimeDir: tmpdir(),
    output: "",
    graceMs: 100,
    maxViewers: 2,
    startTimeoutMs: 5000,
    viewerTimeoutMs: 30_000,
    wlCopyBin: "wl-copy",
    gpu: false,
    fps: 60,
    maxQueueBytes: 256 * 1024,
    ...over,
  };
  const notes: string[] = [];
  const hub = new ScreenHub(cfg, (_t, body) => notes.push(body));
  return { hub, notes, cfg };
}

const hubs: ScreenHub[] = [];
afterEach(async () => {
  await Promise.all(hubs.splice(0).map((h) => h.shutdown()));
});

describe("ScreenHub", () => {
  it("starts wayvnc on first viewer, relays bytes both ways, stops after the last leaves", async () => {
    const { hub, notes } = makeHub();
    hubs.push(hub);
    expect(hub.status().running).toBe(false);

    const ws = fakeWs(1);
    void hub.open(ws);
    await until(() => text(ws).includes("RFB 003.008"));
    expect(hub.status()).toMatchObject({ running: true, viewers: 1 });

    hub.message(ws, new TextEncoder().encode("ping"));
    await until(() => text(ws).endsWith("ping"));

    hub.close(ws);
    expect(hub.status().viewers).toBe(0);
    await until(() => !hub.status().running);
    expect(notes[0]).toContain("Remote viewer connected");
    expect(notes[notes.length - 1]).toContain("disconnected");
  });

  it("keeps wayvnc up while another viewer remains and across a quick reconnect", async () => {
    const { hub } = makeHub({ graceMs: 400 });
    hubs.push(hub);
    const a = fakeWs(1);
    const b = fakeWs(2);
    void hub.open(a);
    await until(() => text(a).includes("RFB"));
    void hub.open(b);
    await until(() => text(b).includes("RFB"));

    hub.close(a);
    await Bun.sleep(600);
    expect(hub.status().running).toBe(true);

    hub.close(b);
    await Bun.sleep(100);
    const c = fakeWs(3);
    void hub.open(c); // within the grace window: no restart
    await until(() => text(c).includes("RFB"));
    await Bun.sleep(450);
    expect(hub.status().running).toBe(true);
    hub.close(c);
  });

  it("queues client bytes sent before the TCP leg is up", async () => {
    const { hub } = makeHub();
    hubs.push(hub);
    const ws = fakeWs(1);
    void hub.open(ws);
    hub.message(ws, new TextEncoder().encode("early"));
    await until(() => text(ws).endsWith("early"));
  });

  it("replaces the oldest viewer when a new one arrives at the cap", async () => {
    const { hub } = makeHub({ maxViewers: 1 });
    hubs.push(hub);
    const a = fakeWs(1);
    const b = fakeWs(2);
    void hub.open(a);
    await until(() => text(a).includes("RFB"));
    void hub.open(b);
    expect(a.closed).toEqual({ code: SCREEN_CLOSE.replaced, reason: "replaced by a newer viewer" });
    await until(() => text(b).includes("RFB"));
    expect(hub.status().viewers).toBe(1);
  });

  it("answers pings on the side channel without touching the RFB stream", async () => {
    const { hub } = makeHub();
    hubs.push(hub);
    const ws = fakeWs(1);
    void hub.open(ws);
    await until(() => text(ws).includes("RFB"));
    hub.message(ws, JSON.stringify({ t: "ping", id: 7, ts: 123.5 }));
    expect(ws.texts.map((t) => JSON.parse(t))).toEqual([{ t: "pong", id: 7, ts: 123.5 }]);
    // The fake server echoes what it gets, in order: once a later binary
    // marker is back, a forwarded ping would already be in the stream.
    hub.message(ws, new TextEncoder().encode("marker"));
    await until(() => text(ws).endsWith("marker"));
    expect(text(ws)).not.toContain("ping");
  });

  it("drops a viewer whose pings stop, but never one that never pinged", async () => {
    const { hub } = makeHub({ viewerTimeoutMs: 300 });
    hubs.push(hub);
    const pinger = fakeWs(1);
    const legacy = fakeWs(2);
    void hub.open(pinger);
    void hub.open(legacy);
    await until(() => text(pinger).includes("RFB") && text(legacy).includes("RFB"));
    hub.message(pinger, JSON.stringify({ t: "ping", id: 1, ts: 0 }));
    await until(() => pinger.closed !== null, 2000);
    expect(pinger.closed?.code).toBe(SCREEN_CLOSE.timedOut);
    expect(legacy.closed).toBeNull();
    expect(hub.status().viewers).toBe(1);
  });

  it("refuses to relay to a listener it did not start", async () => {
    const squatter = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: { open() {}, data() {}, close() {}, error() {} },
    });
    try {
      const { hub } = makeHub({ port: squatter.port });
      hubs.push(hub);
      const ws = fakeWs(1);
      await hub.open(ws);
      expect(ws.closed?.code).toBe(1011);
      expect(hub.status().running).toBe(false);
    } finally {
      squatter.stop(true);
    }
  });

  it("closes viewers when wayvnc fails to start", async () => {
    const { hub } = makeHub({ wayvncBin: "/nonexistent/wayvnc" });
    hubs.push(hub);
    const ws = fakeWs(1);
    await hub.open(ws);
    expect(ws.closed?.code).toBe(1011);
  });

  it("hands a pasted image to wl-copy on the configured Wayland display", () => {
    const dir = mkdtempSync(join(tmpdir(), "wlcopy-test-"));
    const bin = join(dir, "wl-copy");
    // Records argv, the display it was given, and stdin.
    writeFileSync(bin, `#!/bin/sh\necho "$@ $WAYLAND_DISPLAY" > ${dir}/args\ncat > ${dir}/stdin\n`);
    chmodSync(bin, 0o755);
    const { hub } = makeHub({ wlCopyBin: bin });
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 7, 8, 9]);
    return hub.setClipboardImage(png).then(() => {
      expect(readFileSync(join(dir, "args"), "utf8").trim()).toBe("--type image/png wayland-test");
      expect(new Uint8Array(readFileSync(join(dir, "stdin")))).toEqual(png);
    });
  });

  it("reports wl-copy failures with its stderr", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wlcopy-test-"));
    const bin = join(dir, "wl-copy");
    writeFileSync(bin, `#!/bin/sh\necho "no wayland" >&2\nexit 1\n`);
    chmodSync(bin, 0o755);
    const { hub } = makeHub({ wlCopyBin: bin });
    await expect(hub.setClipboardImage(new Uint8Array([1]))).rejects.toThrow(
      "wl-copy exited 1: no wayland",
    );
  });

  it("waits for a stopping wayvnc to release its port before starting the next one", async () => {
    const { hub } = makeHub({ graceMs: 20 });
    hubs.push(hub);
    const a = fakeWs(1);
    void hub.open(a);
    await until(() => text(a).includes("RFB"));
    hub.close(a);
    await until(() => !hub.status().running); // grace stop issued, old process still exiting
    const b = fakeWs(2);
    void hub.open(b);
    await until(() => text(b).includes("RFB"));
    expect(b.closed).toBeNull();
  });

  it("starts wayvnc with -g and the fps cap by default config, without -g when disabled", async () => {
    const argsFile = join(mkdtempSync(join(tmpdir(), "screen-args-")), "args");
    process.env.FAKE_ARGS_FILE = argsFile;
    try {
      const on = makeHub({ gpu: true, fps: 45 });
      hubs.push(on.hub);
      const a = fakeWs(1);
      void on.hub.open(a);
      await until(() => text(a).includes("RFB"));
      expect(readFileSync(argsFile, "utf8")).toContain("-r -f 45 -L warning -g 127.0.0.1");
      const off = makeHub({ gpu: false });
      hubs.push(off.hub);
      const b = fakeWs(2);
      void off.hub.open(b);
      await until(() => text(b).includes("RFB"));
      const lines = readFileSync(argsFile, "utf8").trim().split("\n");
      expect(lines[1]).not.toContain("-g");
    } finally {
      delete process.env.FAKE_ARGS_FILE;
    }
  });

  it("falls back to no -g when wayvnc will not start with it, and remembers", async () => {
    const argsFile = join(mkdtempSync(join(tmpdir(), "screen-args-")), "args");
    process.env.FAKE_ARGS_FILE = argsFile;
    process.env.FAKE_REJECT_GPU = "1";
    const warn = console.warn;
    const warnings: string[] = [];
    console.warn = (...m: unknown[]) => void warnings.push(m.join(" "));
    try {
      const { hub } = makeHub({ gpu: true });
      hubs.push(hub);
      const a = fakeWs(1);
      void hub.open(a);
      await until(() => text(a).includes("RFB"));
      expect(a.closed).toBeNull();
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("no usable GPU");
      hub.close(a);
      await until(() => !hub.status().running);
      await Bun.sleep(300); // the old process releases its port

      const b = fakeWs(2);
      void hub.open(b);
      await until(() => text(b).includes("RFB"));
      // Second start went straight to the working command line; no new warning.
      const lines = readFileSync(argsFile, "utf8").trim().split("\n");
      expect(lines).toHaveLength(3);
      expect(lines[0]).toContain("-g");
      expect(lines[1]).not.toContain("-g");
      expect(lines[2]).not.toContain("-g");
      expect(warnings).toHaveLength(1);
    } finally {
      console.warn = warn;
      delete process.env.FAKE_ARGS_FILE;
      delete process.env.FAKE_REJECT_GPU;
    }
  });

  it("bounds a slow viewer's queue by pausing reads, then delivers every byte in order", async () => {
    const cap = 128 * 1024;
    const { hub } = makeHub({ maxQueueBytes: cap });
    hubs.push(hub);
    const ws = slowWs(1);
    void hub.open(ws);
    await until(() => text(ws).includes("RFB"));
    ws.release();
    hub.drain(ws);
    const banner = "RFB 003.008\n".length;
    let total = 0;
    const bytes = () => ws.received.reduce((n, c) => n + c.length, 0) - banner;

    hub.message(ws, new TextEncoder().encode("flood\n"));
    await Bun.sleep(400);
    // wayvnc wants to send 8 MiB; with the viewer stalled the hub reads about one cap's worth.
    expect(bytes()).toBeGreaterThan(0);
    expect(bytes()).toBeLessThan(cap + 512 * 1024);
    const stalledAt = bytes();
    await Bun.sleep(200);
    expect(bytes()).toBe(stalledAt); // really paused, nothing creeping in

    // The link recovers: drain until the whole stream has arrived.
    const end = Date.now() + 15_000;
    while (bytes() < 8 * 1024 * 1024 && Date.now() < end) {
      total += ws.release();
      hub.drain(ws);
      await Bun.sleep(5);
    }
    expect(bytes()).toBe(8 * 1024 * 1024);
    const all = Buffer.concat(ws.received).subarray(banner);
    for (let i = 0; i < all.length; i += 4099) expect(all[i]).toBe(i % 251);
    expect(total).toBeGreaterThan(0);
  });
});
