import { describe, expect, it } from "vitest";
import { hmacSha256Hex } from "../../lib/identify";
import { answeredAt, toInboxRows, verifyState } from "../threads";

const SECRET = "app-secret";
const NOW = Date.parse("2026-10-20T00:00:00Z");

async function state(slug: string, userId: string, exp: number) {
  return `${slug}.${exp}.${await hmacSha256Hex(SECRET, `${slug}.${userId}.${exp}`)}`;
}

describe("verifyState", () => {
  it("returns the workspace slug for the member who started the flow", async () => {
    const s = await state("joyorogo", "u1", NOW + 60_000);
    expect(await verifyState(SECRET, s, "u1", NOW)).toBe("joyorogo");
  });

  it("keeps dots in the slug", async () => {
    const s = await state("a.b", "u1", NOW + 60_000);
    expect(await verifyState(SECRET, s, "u1", NOW)).toBe("a.b");
  });

  it("rejects a link redeemed by another member", async () => {
    const s = await state("joyorogo", "u1", NOW + 60_000);
    expect(await verifyState(SECRET, s, "u2", NOW)).toBeNull();
  });

  it("rejects an expired link", async () => {
    const s = await state("joyorogo", "u1", NOW - 1);
    expect(await verifyState(SECRET, s, "u1", NOW)).toBeNull();
  });

  it("rejects a slug swapped into a valid link", async () => {
    const s = await state("joyorogo", "u1", NOW + 60_000);
    expect(await verifyState(SECRET, s.replace("joyorogo", "other"), "u1", NOW)).toBeNull();
  });
});

describe("toInboxRows", () => {
  const posts = [
    {
      id: "m1",
      username: "sari",
      text: "Harga paket berapa?",
      permalink: "https://www.threads.com/@sari/post/A",
      timestamp: "2026-10-19T10:00:00+0000",
      replied_to: { id: "p1" },
      root_post: { id: "p1" },
      is_reply_owned_by_me: false,
    },
    { id: "m2", username: "joyorogo", text: "Ours", timestamp: "2026-10-19T10:01:00+0000" },
    {
      id: "m3",
      username: "budi",
      text: "Thread reply we own",
      timestamp: "2026-10-19T10:02:00+0000",
      is_reply_owned_by_me: true,
    },
  ];

  it("keeps other people's posts and drops the account's own", () => {
    const rows = toInboxRows("ws", "joyorogo", "reply", posts, "now");
    expect(rows.map((r) => r.mediaId)).toEqual(["m1"]);
    expect(rows[0]).toMatchObject({
      workspaceId: "ws",
      kind: "reply",
      username: "sari",
      repliedToId: "p1",
      rootPostId: "p1",
      postedAt: "2026-10-19T10:00:00.000Z",
      status: "open",
    });
  });
});

describe("answeredAt", () => {
  it("marks posts we replied to, from Atur or the Threads app, at our first answer", () => {
    const answered = answeredAt("joyorogo", [
      { id: "q1", username: "sari", timestamp: "2026-10-19T10:00:00+0000" },
      {
        id: "a2",
        username: "joyorogo",
        timestamp: "2026-10-19T12:00:00+0000",
        replied_to: { id: "q1" },
      },
      {
        id: "a1",
        timestamp: "2026-10-19T11:00:00+0000",
        replied_to: { id: "q1" },
        is_reply_owned_by_me: true,
      },
      {
        id: "x",
        username: "budi",
        timestamp: "2026-10-19T11:30:00+0000",
        replied_to: { id: "q2" },
      },
    ]);
    expect([...answered]).toEqual([["q1", "2026-10-19T11:00:00.000Z"]]);
  });
});
