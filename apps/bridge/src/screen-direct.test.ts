import { describe, expect, it } from "bun:test";
import {
  TicketLedger,
  directUrl,
  parseListen,
  redeemScreenTicket,
  reportDirectStop,
  signScreenTicket,
} from "./screen-direct";

const KEY = "bridge-secret";
const claims = { sub: "user-1", audit: "audit-1", jti: "jti-1", exp: 1_060_000 };

describe("screen tickets", () => {
  it("accepts a ticket minted by the Worker (shared vector with its test)", () => {
    const fromWorker =
      "eyJ2IjoxLCJhdWQiOiJzY3JlZW4iLCJzdWIiOiJ1c2VyLTEiLCJhdWRpdCI6ImF1ZGl0LTEiLCJqdGkiOiJqdGktMSIsImV4cCI6MTA2MDAwMH0.UibtRkB7tQHsIsBJngBnRPRkooN2XW5_vGexh_3LYr4";
    expect(signScreenTicket(KEY, claims)).toBe(fromWorker);
    expect(redeemScreenTicket(KEY, fromWorker, new TicketLedger(), 1_000_000)).toEqual(claims);
  });

  it("is single use", () => {
    const ledger = new TicketLedger();
    const t = signScreenTicket(KEY, claims);
    expect(redeemScreenTicket(KEY, t, ledger, 1_000_000)).not.toBeNull();
    expect(redeemScreenTicket(KEY, t, ledger, 1_000_001)).toBeNull();
  });

  it("rejects expired, wrong-key, tampered and malformed tickets", () => {
    const t = signScreenTicket(KEY, claims);
    expect(redeemScreenTicket(KEY, t, new TicketLedger(), 1_060_000)).toBeNull();
    expect(redeemScreenTicket("other", t, new TicketLedger(), 1_000_000)).toBeNull();
    const [payload, mac] = t.split(".");
    const forged = Buffer.from(
      JSON.stringify({ v: 1, aud: "screen", ...claims, sub: "attacker" }),
    ).toString("base64url");
    expect(redeemScreenTicket(KEY, `${forged}.${mac}`, new TicketLedger(), 1_000_000)).toBeNull();
    for (const bad of ["", "x", `${payload}`, `${payload}.`, `${t}.extra`, `.${mac}`]) {
      expect(redeemScreenTicket(KEY, bad, new TicketLedger(), 1_000_000)).toBeNull();
    }
  });

  it("rejects a validly signed ticket for another audience", () => {
    const payload = Buffer.from(JSON.stringify({ v: 1, aud: "attach", ...claims })).toString(
      "base64url",
    );
    const mac = new Bun.CryptoHasher("sha256", KEY)
      .update(`atur-screen-ticket-v1\n${payload}`)
      .digest("base64url");
    expect(redeemScreenTicket(KEY, `${payload}.${mac}`, new TicketLedger(), 1_000_000)).toBeNull();
  });

  it("forgets spent ids once they have expired", () => {
    const ledger = new TicketLedger();
    expect(ledger.claim("a", 100, 0)).toBe(true);
    expect(ledger.claim("a", 100, 50)).toBe(false);
    expect(ledger.claim("a", 200, 150)).toBe(true);
  });
});

describe("parseListen", () => {
  const ts = () => "100.64.0.9";
  it("is empty by default", () => {
    expect(parseListen(undefined, 7602, ts)).toEqual([]);
    expect(parseListen("", 7602, ts)).toEqual([]);
  });

  it("takes host[:port] entries, the tailscale keyword, and the default port", () => {
    expect(parseListen("tailscale, 10.0.0.5:9000, [fd7a::1]", 7602, ts)).toEqual([
      { hostname: "100.64.0.9", port: 7602 },
      { hostname: "10.0.0.5", port: 9000 },
      { hostname: "fd7a::1", port: 7602 },
    ]);
  });

  it("never listens on every interface", () => {
    for (const bad of ["0.0.0.0", "0.0.0.0:7602", "::", "[::]:7602", "*"]) {
      expect(() => parseListen(bad, 7602, ts)).toThrow("wildcard");
    }
  });

  it("fails loudly when tailscale has no address or the port is bad", () => {
    expect(() => parseListen("tailscale", 7602, () => null)).toThrow("tailscale");
    expect(() => parseListen("10.0.0.5:99999", 7602, ts)).toThrow("bad port");
  });
});

describe("directUrl", () => {
  it("derives scheme and host, or uses the override, and always ends in /screen", () => {
    const l = { hostname: "100.64.0.9", port: 7602 };
    expect(directUrl(undefined, l, false)).toBe("ws://100.64.0.9:7602/screen");
    expect(directUrl(undefined, l, true)).toBe("wss://100.64.0.9:7602/screen");
    expect(directUrl("wss://box.tail.ts.net:7602/", l, true)).toBe(
      "wss://box.tail.ts.net:7602/screen",
    );
    expect(directUrl(undefined, undefined, false)).toBeNull();
  });
});

describe("reportDirectStop", () => {
  it("posts the audit id with the bridge token, and swallows failures", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const ok = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response("{}");
    }) as unknown as typeof fetch;
    await reportDirectStop({ url: "https://atur.example", token: "t" }, "audit-1", ok);
    expect(seen!.url).toBe("https://atur.example/api/bridge/screen-events");
    expect(JSON.parse(seen!.init.body as string)).toEqual({ audit_id: "audit-1", event: "stop" });
    expect((seen!.init.headers as Record<string, string>)["x-bridge-token"]).toBe("t");
    const boom = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    await reportDirectStop({ url: "https://atur.example", token: "t" }, "audit-1", boom);
    await reportDirectStop(null, "audit-1", boom);
  });
});
