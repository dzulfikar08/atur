import { describe, it, expect } from "vitest";
import {
  activeMentionQuery,
  buildCandidates,
  classifyToken,
  filterCandidates,
  mentionHref,
  parseNoteTokens,
  resolveToken,
} from "@/lib/mentions";

describe("classifyToken", () => {
  it("splits entity kinds by casing and shape", () => {
    expect(classifyToken("DEV-29")).toBe("issue");
    expect(classifyToken("DEV")).toBe("project");
    expect(classifyToken("diatur")).toBe("workspace");
    expect(classifyToken("youtube-automation")).toBe("workspace");
  });

  it("rejects mixed-case and malformed tokens", () => {
    expect(classifyToken("Dev")).toBeNull();
    expect(classifyToken("DEV-2X")).toBeNull();
    // Classification is syntactic: "dev-29" is slug-shaped (a workspace
    // candidate), never an issue key — resolution decides whether it links.
    expect(classifyToken("dev-29")).toBe("workspace");
  });
});

describe("parseNoteTokens", () => {
  it("finds word-initial tokens and classifies them", () => {
    const tokens = parseNoteTokens("ship @DEV-29 with @alice, see @diatur");
    expect(tokens.map((t) => t.token)).toEqual(["DEV-29", "alice", "diatur"]);
    // "alice" is slug-shaped — it renders muted unless a workspace matches.
    expect(tokens.map((t) => t.kind)).toEqual(["issue", "workspace", "workspace"]);
  });

  it("ignores emails and mid-word @", () => {
    expect(parseNoteTokens("mail alice@x.com or foo@bar")).toEqual([]);
  });

  it("matches a token at string start and reports spans", () => {
    const tokens = parseNoteTokens("@DEV is late");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ token: "DEV", kind: "project", at: 0, start: 1, end: 4 });
  });

  it("points at the @ for mid-sentence tokens so text slices exclude it", () => {
    const content = "braindump: check @DEMO-2 ";
    const tokens = parseNoteTokens(content);
    expect(tokens[0]).toMatchObject({ token: "DEMO-2", at: 17, start: 18, end: 24 });
    // The renderer contract: text before the chip must stop at `at`.
    expect(content.slice(0, tokens[0]!.at)).not.toContain("@");
    expect(content.slice(tokens[0]!.start, tokens[0]!.end)).toBe("DEMO-2");
  });
});

describe("activeMentionQuery", () => {
  it("returns the trailing query while typing", () => {
    expect(activeMentionQuery("talk to @de")).toEqual({ query: "de", start: 9 });
    expect(activeMentionQuery("@")).toBeNull(); // bare @ is not a token yet
  });

  it("closes after a space or non-token context", () => {
    expect(activeMentionQuery("talk to @dev ")).toBeNull();
    expect(activeMentionQuery("email a@b")).toBeNull();
  });
});

describe("resolveToken", () => {
  const candidates = buildCandidates(
    [{ slug: "diatur", name: "JoyoDigitama" }],
    [
      {
        id: "p1",
        name: "App",
        identifier: "DEV",
        workspace_slug: "diatur",
        workspace_name: "JoyoDigitama",
      },
      {
        id: "p2",
        name: "Other App",
        identifier: "DEV",
        workspace_slug: "voltrus",
        workspace_name: "Voltrus",
      },
    ],
    [
      {
        name: "Fix login",
        sequence_id: 29,
        project_id: "p1",
        project_identifier: "DEV",
        workspace_slug: "diatur",
        workspace_name: "JoyoDigitama",
      },
    ],
  );

  it("prefers the workspace being browsed for ambiguous identifiers", () => {
    expect(resolveToken("DEV", candidates, "voltrus")?.projectId).toBe("p2");
    expect(resolveToken("DEV", candidates, "diatur")?.projectId).toBe("p1");
    // No current workspace → first candidate wins deterministically.
    expect(resolveToken("DEV", candidates)?.projectId).toBe("p1");
  });

  it("resolves case-insensitively and returns null for unknown tokens", () => {
    expect(resolveToken("dev-29", candidates)?.seqId).toBe(29);
    expect(resolveToken("nope", candidates)).toBeNull();
  });
});

describe("mentionHref", () => {
  it("builds SPA targets per entity kind", () => {
    expect(mentionHref("workspace", { slug: "diatur" })).toBe("/diatur");
    expect(mentionHref("project", { slug: "diatur", projectId: "p1" })).toBe("/diatur/projects/p1");
    expect(mentionHref("issue", { slug: "diatur", projectId: "p1", seqId: 29 })).toBe(
      "/diatur/projects/p1/issues/29",
    );
    expect(mentionHref("issue", { slug: "diatur" })).toBeNull();
  });
});

describe("filterCandidates", () => {
  const pool = buildCandidates([{ slug: "diatur", name: "JoyoDigitama" }], [], []).concat(
    buildCandidates(
      [],
      [],
      [
        {
          name: "Add quick notes",
          sequence_id: 30,
          project_id: "p1",
          project_identifier: "DEV",
          workspace_slug: "diatur",
          workspace_name: "JoyoDigitama",
        },
      ],
    ),
  );

  it("ranks prefix matches before substring matches and caps results", () => {
    const hits = filterCandidates("d", pool, 1);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.token).toBe("diatur"); // startsWith("d") beats DEV-30's contains
  });

  it("matches by label too", () => {
    expect(filterCandidates("quick", pool).map((c) => c.token)).toEqual(["DEV-30"]);
  });
});
