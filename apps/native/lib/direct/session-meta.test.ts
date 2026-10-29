import { expect, test } from "bun:test";

import {
  describeDirectError,
  describeFailure,
  describeTransport,
  directBadgeLabel,
} from "@/lib/direct/describe";
import {
  agentDisplayName,
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

test("the title is the terminal's own, then the project, then the agent", () => {
  expect(directSessionTitle(session("1", { title: "vim notes.md", projectName: "atur" }))).toBe(
    "vim notes.md",
  );
  expect(directSessionTitle(session("1", { title: "", projectName: "atur" }))).toBe("atur");
  expect(directSessionTitle(session("1", { title: "  ", projectName: "atur" }))).toBe("atur");
  expect(directSessionTitle(session("1", { projectName: "" }))).toBe("shell");
  expect(
    directSessionTitle(
      session("1", { projectName: "", agent: { provider: "Oh My Pi", state: "idle" } }),
    ),
  ).toBe("omp session");
  expect(
    directSessionTitle(session("1", { title: "π ⠋ ATUR-33 fix echo", projectName: "atur" })),
  ).toBe("ATUR-33 fix echo");
});

test("the detail names the agent, the project and the folder, without repeating the title", () => {
  const agent = { provider: "Oh My Pi", state: "idle" as const };
  expect(
    directSessionDetail(
      session("1", {
        title: "fixing echo",
        projectName: "atur",
        directory: "/home/dev/work/web",
        agent,
      }),
    ),
  ).toBe("omp · atur · web");
  // No title: the project is the primary text, so the detail leaves it out.
  expect(
    directSessionDetail(
      session("1", { projectName: "atur", directory: "/home/dev/work/web", agent }),
    ),
  ).toBe("omp · web");
  expect(directSessionDetail(session("1", { projectName: "atur", directory: "/x/atur" }))).toBe("");
  expect(
    directSessionDetail(session("1", { title: "zsh", projectName: "atur", directory: "/x/atur" })),
  ).toBe("atur");
  expect(directSessionDetail(session("1", { projectName: "", directory: "" }))).toBe("");
});

test("Oh My Pi is shown as omp, in any case, and other providers are untouched", () => {
  expect(agentDisplayName("Oh My Pi")).toBe("omp");
  expect(agentDisplayName("oh my pi")).toBe("omp");
  expect(agentDisplayName("OH MY PI")).toBe("omp");
  expect(agentDisplayName("claude")).toBe("claude");
  expect(agentDisplayName("Codex")).toBe("Codex");
  expect(agentDisplayName("")).toBe("");
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

test("the badge and the settings name the transport in use", () => {
  expect(directBadgeLabel("udp", 38)).toBe("Direct UDP · 38 ms");
  expect(directBadgeLabel("tls", null)).toBe("Direct TLS");
  expect(directBadgeLabel(undefined, 12)).toBe("Direct · 12 ms");
  expect(describeTransport("udp", "")).toBe("UDP");
  expect(describeTransport("tls", "older server")).toBe("TLS (older server)");
  expect(describeTransport("tls", "")).toBe("TLS");
});
