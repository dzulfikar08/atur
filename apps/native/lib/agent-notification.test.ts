import { describe, expect, test } from "bun:test";

import { isViewingPane, parseAgentNotification } from "./agent-notification";

describe("parseAgentNotification", () => {
  test("accepts the agent payload", () => {
    expect(parseAgentNotification({ type: "agent", pane_id: "wR:p2", status: "blocked" })).toEqual({
      paneId: "wR:p2",
      status: "blocked",
    });
    expect(parseAgentNotification({ type: "agent", pane_id: "a:b", status: "done" })?.status).toBe(
      "done",
    );
  });

  test("rejects anything else", () => {
    expect(parseAgentNotification(undefined)).toBeNull();
    expect(parseAgentNotification(null)).toBeNull();
    expect(parseAgentNotification({ type: "issue", pane_id: "wR:p2", status: "done" })).toBeNull();
    expect(parseAgentNotification({ type: "agent", pane_id: "", status: "done" })).toBeNull();
    expect(parseAgentNotification({ type: "agent", pane_id: "wR:p2", status: "idle" })).toBeNull();
    expect(parseAgentNotification({ type: "agent", status: "done" })).toBeNull();
  });
});

describe("isViewingPane", () => {
  test("matches the pane route, encoded or not", () => {
    expect(isViewingPane("/pane/wR:p2", "wR:p2")).toBe(true);
    expect(isViewingPane("/pane/wR%3Ap2", "wR:p2")).toBe(true);
    expect(isViewingPane("/pane/wR:p2?x=1", "wR:p2")).toBe(true);
  });

  test("other routes and other panes don't", () => {
    expect(isViewingPane("/pane/wR:p3", "wR:p2")).toBe(false);
    expect(isViewingPane("/panes", "wR:p2")).toBe(false);
    expect(isViewingPane("/", "wR:p2")).toBe(false);
    expect(isViewingPane("/pane/%E0%A4%A", "wR:p2")).toBe(false);
  });
});
