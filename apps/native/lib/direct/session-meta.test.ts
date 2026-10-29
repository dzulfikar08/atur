import { expect, test } from "bun:test";

import { describeDirectError, describeFailure } from "@/lib/direct/describe";
import {
  directAttention,
  directSessionDetail,
  directSessionTitle,
  openableSessions,
} from "@/lib/direct/session-meta";
import { session } from "@/lib/direct/test-support";
import { DirectError } from "@/modules/atur-direct/src/types";

test("the agent state decides what the session asks of you", () => {
  expect(directAttention(session("1"))).toBe("shell");
  expect(directAttention(session("1", { agent: { provider: "claude", state: "blocked" } }))).toBe(
    "needs-you",
  );
  expect(directAttention(session("1", { agent: { provider: "claude", state: "working" } }))).toBe(
    "working",
  );
  expect(directAttention(session("1", { agent: { provider: "claude", state: "idle" } }))).toBe(
    "idle",
  );
  expect(directAttention(session("1", { agent: { provider: "claude", state: "unknown" } }))).toBe(
    "idle",
  );
});

test("only live and starting sessions open, agents that need you first, order otherwise kept", () => {
  const list = [
    session("1"),
    session("2", { status: "ended" }),
    session("3", { agent: { provider: "claude", state: "working" } }),
    session("4", { status: "starting", agent: { provider: "claude", state: "blocked" } }),
    session("5", { status: "unavailable" }),
    session("6", { agent: { provider: "codex", state: "working" } }),
    session("7"),
  ];
  expect(openableSessions(list).map((s) => s.id)).toEqual(["4", "3", "6", "1", "7"]);
});

test("titles and details fall back to what is known", () => {
  expect(directSessionTitle(session("1", { projectName: "atur" }))).toBe("atur");
  expect(directSessionTitle(session("1", { projectName: "" }))).toBe("shell");
  expect(
    directSessionTitle(
      session("1", { projectName: "", agent: { provider: "claude", state: "idle" } }),
    ),
  ).toBe("claude session");
  expect(
    directSessionDetail(
      session("1", {
        directory: "/home/dev/work/atur",
        agent: { provider: "claude", state: "idle" },
      }),
    ),
  ).toBe("claude · work/atur");
  expect(directSessionDetail(session("1", { directory: "" }))).toBe("");
});

test("failures read as sentences and never echo the core's reason unless it is all there is", () => {
  expect(describeDirectError(new DirectError("Unauthorized", "token xyz rejected"))).not.toContain(
    "xyz",
  );
  expect(describeDirectError(new DirectError("Unreachable", "tcp 10.0.0.1"))).not.toContain(
    "10.0.0.1",
  );
  expect(describeDirectError(new DirectError("Server", "disk full"))).toContain("disk full");
  expect(describeFailure({ code: "IdentityMismatch", reason: "" })).toContain("Pair again");
  expect(describeDirectError(new Error("boom"))).toBe("boom");
  expect(describeDirectError("weird")).toBe("Something went wrong.");
});
