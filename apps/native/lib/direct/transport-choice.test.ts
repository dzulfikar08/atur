import { expect, test } from "bun:test";

import type { DirectState } from "@/lib/direct/manager";
import {
  DIRECT_CONNECT_TIMEOUT_MS,
  DIRECT_LOST_TIMEOUT_MS,
  availabilityOf,
  directPaneId,
  directPaneStatus,
  fallbackDelay,
  parsePaneTarget,
  shouldReturnToDirect,
  shouldUseDirect,
  type DirectAvailability,
} from "@/lib/direct/transport-choice";
import { FakeLink, session } from "@/lib/direct/test-support";

const BRIDGE_PANE = parsePaneTarget("12");

function availability(overrides: Partial<DirectAvailability> = {}): DirectAvailability {
  return {
    preferDirect: true,
    state: "connected",
    connectionId: "c1",
    sessionIds: ["11", "12"],
    failedConnectionId: null,
    ...overrides,
  };
}

test("direct: panes carry their session id and are direct only", () => {
  expect(parsePaneTarget("direct:12")).toEqual({ directOnly: true, sessionId: "12" });
  expect(parsePaneTarget("12")).toEqual({ directOnly: false, sessionId: "12" });
  expect(parsePaneTarget(directPaneId("7"))).toEqual({ directOnly: true, sessionId: "7" });
});

test("a direct: pane is direct whatever the connection looks like", () => {
  const target = parsePaneTarget("direct:12");
  for (const state of ["unpaired", "offline", "needs-pairing", "connected"] as DirectState[]) {
    expect(shouldUseDirect(target, availability({ state, preferDirect: false }))).toBe(true);
  }
});

test("a bridge pane goes direct when preferred, connected and listed", () => {
  expect(shouldUseDirect(BRIDGE_PANE, availability())).toBe(true);
});

test("a connection that is still being made counts, with the cached list", () => {
  expect(
    shouldUseDirect(BRIDGE_PANE, availability({ state: "connecting", connectionId: null })),
  ).toBe(true);
});

test("a bridge pane stays on the bridge when direct is not preferred", () => {
  expect(shouldUseDirect(BRIDGE_PANE, availability({ preferDirect: false }))).toBe(false);
});

test("a bridge pane stays on the bridge unless the computer lists it", () => {
  expect(shouldUseDirect(BRIDGE_PANE, availability({ sessionIds: ["11", "13"] }))).toBe(false);
  expect(shouldUseDirect(BRIDGE_PANE, availability({ sessionIds: [] }))).toBe(false);
});

test("a bridge pane stays on the bridge unless the computer is connected or connecting", () => {
  for (const state of [
    "unsupported",
    "unpaired",
    "idle",
    "offline",
    "needs-pairing",
    "incompatible",
  ] as DirectState[]) {
    expect(shouldUseDirect(BRIDGE_PANE, availability({ state }))).toBe(false);
  }
});

test("a connection on which the attach already failed is not tried again", () => {
  expect(shouldUseDirect(BRIDGE_PANE, availability({ failedConnectionId: "c1" }))).toBe(false);
  // A new connection gets a new chance.
  expect(shouldUseDirect(BRIDGE_PANE, availability({ failedConnectionId: "c0" }))).toBe(true);
});

test("returning to direct needs a connected computer, not one still connecting", () => {
  expect(shouldReturnToDirect(BRIDGE_PANE, availability())).toBe(true);
  expect(
    shouldReturnToDirect(BRIDGE_PANE, availability({ state: "connecting", connectionId: null })),
  ).toBe(false);
  expect(shouldReturnToDirect(BRIDGE_PANE, availability({ failedConnectionId: "c1" }))).toBe(false);
  expect(shouldReturnToDirect(BRIDGE_PANE, availability({ preferDirect: false }))).toBe(false);
});

test("fallback: 4 s to attach, 6 s to come back, at once on a refusal, never for direct panes", () => {
  expect(fallbackDelay("waiting", false)).toBe(DIRECT_CONNECT_TIMEOUT_MS);
  expect(DIRECT_CONNECT_TIMEOUT_MS).toBe(4000);
  expect(fallbackDelay("lost", false)).toBe(DIRECT_LOST_TIMEOUT_MS);
  expect(DIRECT_LOST_TIMEOUT_MS).toBe(6000);
  expect(fallbackDelay("failed", false)).toBe(0);
  expect(fallbackDelay("attached", false)).toBeNull();
  expect(fallbackDelay("exited", false)).toBeNull();
  for (const phase of ["waiting", "lost", "failed", "attached", "exited"] as const) {
    expect(fallbackDelay(phase, true)).toBeNull();
  }
});

test("the pane status follows the direct phase and the manager's state", () => {
  expect(directPaneStatus("attached", "connected")).toBe("connected");
  expect(directPaneStatus("exited", "connected")).toBe("exited");
  expect(directPaneStatus("failed", "connected")).toBe("unreachable");
  expect(directPaneStatus("waiting", "connecting")).toBe("connecting");
  expect(directPaneStatus("waiting", "idle")).toBe("connecting");
  expect(directPaneStatus("waiting", "offline")).toBe("reconnecting");
  expect(directPaneStatus("lost", "offline")).toBe("reconnecting");
  expect(directPaneStatus("lost", "connecting")).toBe("reconnecting");
  for (const state of ["needs-pairing", "incompatible", "unsupported", "unpaired"] as const) {
    expect(directPaneStatus("waiting", state)).toBe("unreachable");
    expect(directPaneStatus("lost", state)).toBe("unreachable");
  }
});

test("availability is read from the manager's snapshot", () => {
  const link = new FakeLink();
  const read = availabilityOf(
    {
      preferDirect: false,
      state: "connected",
      connection: link,
      sessions: [session("3"), session("4")],
    },
    "c9",
  );
  expect(read).toEqual({
    preferDirect: false,
    state: "connected",
    connectionId: link.id,
    sessionIds: ["3", "4"],
    failedConnectionId: "c9",
  });
  expect(
    availabilityOf({ preferDirect: true, state: "offline", connection: null, sessions: [] }, null)
      .connectionId,
  ).toBeNull();
});
