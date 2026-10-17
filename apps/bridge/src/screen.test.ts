/**
 * ScreenHub against a fake wayvnc: a script that listens on the port given as
 * its last argument, greets with an RFB banner and echoes whatever it gets.
 * Real timers on purpose: this exercises a real child
 * process, real sockets and the real grace-period timer, which fake timers can't drive.
 */
import { afterEach, beforeAll, describe, expect, it } from "bun:test";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ScreenHub, type ScreenConfig, type ScreenWs } from "./screen";

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
Bun.listen({
  hostname: host,
  port,
  socket: {
    open(s) { s.write("RFB 003.008\\n"); },
    data(s, d) { s.write(d); },
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
  closed: { code?: number; reason?: string } | null;
}

function fakeWs(id: number): FakeWs {
  const ws: FakeWs = {
    data: { screen: true, id },
    received: [],
    closed: null,
    send(data) {
      ws.received.push(Uint8Array.from(data));
      return data.length;
    },
    close(code, reason) {
      ws.closed = { code, reason };
    },
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

  it("rejects viewers beyond the cap", async () => {
    const { hub } = makeHub({ maxViewers: 1 });
    hubs.push(hub);
    const a = fakeWs(1);
    const b = fakeWs(2);
    void hub.open(a);
    await until(() => text(a).includes("RFB"));
    await hub.open(b);
    expect(b.closed?.code).toBe(1013);
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
});
