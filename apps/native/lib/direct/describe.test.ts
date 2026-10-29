import { expect, test } from "bun:test";

import { describeAddresses, describeReroute, describeRoute } from "@/lib/direct/describe";

test("the route reads as its kind and a round trip, the live one once there is one", () => {
  const local = { host: "10.184.172.54", kind: "local", ms: 3.4 } as const;
  const relayed = { host: "100.64.0.1", kind: "tailscale", ms: 123.2 } as const;
  expect(describeRoute(local, null)).toBe("Local · 3 ms");
  expect(describeRoute(relayed, null)).toBe("Tailscale · 123 ms");
  // The ping replaces the time the connection took to set up.
  expect(describeRoute(relayed, 119.6)).toBe("Tailscale · 120 ms");
  expect(describeRoute({ host: "box.example.com", kind: "other", ms: 40 }, null)).toBe(
    "Other · 40 ms",
  );
  expect(describeRoute({ ...local, ms: 0.3 }, null)).toBe("Local · <1 ms");
  expect(describeRoute(null, 12)).toBeNull();
  expect(describeRoute(undefined, null)).toBeNull();
});

test("the addresses are listed by host with the one in use marked", () => {
  expect(describeAddresses(["10.184.172.228", "100.64.0.1", "desk.local"], "100.64.0.1")).toBe(
    "10.184.172.228\n100.64.0.1 (in use)\ndesk.local",
  );
  expect(describeAddresses(["10.0.0.1"], null)).toBe("10.0.0.1");
  expect(describeAddresses([], null)).toBe("");
});

test("what a re-check did is said in a sentence", () => {
  const local = { host: "10.184.172.54", kind: "local", ms: 3 } as const;
  expect(describeReroute("swapped", local)).toContain("Local");
  expect(describeReroute("swapped", null)).toBe("Switched route.");
  expect(describeReroute("kept", local)).toContain("best route");
  expect(describeReroute("failed", null)).toContain("second connection");
  expect(describeReroute("skipped", null)).toBe("Not connected.");
});
