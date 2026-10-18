import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";

const notifyMock = vi.fn();
vi.mock("../../lib/notify", () => ({
  notify: (...args: unknown[]) => notifyMock(...args),
  actorLine: (n?: string | null) => n ?? "Someone",
  extractMentionedUserIds: () => [],
  extractMentionedUsernames: () => [],
}));
vi.mock("../../repositories/subscribers", () => ({ listByIssue: async () => [] }));

import { notifyCommentAdded } from "../issue_notifications";

function chainy(rows: any[]) {
  const p = Promise.resolve(rows);
  const chain: any = {
    // oxlint-disable-next-line unicorn/no-thenable -- drizzle mock must be both awaitable and chainable
    then: p.then.bind(p),
    catch: p.catch.bind(p),
    finally: p.finally.bind(p),
    limit: () => chain,
    where: () => chain,
    innerJoin: () => chain,
  };
  return chain;
}

describe("notifyCommentAdded", () => {
  beforeEach(() => notifyMock.mockClear());

  it("titles with PROJECT-seq and links by workspace slug", async () => {
    const db: any = {
      select: () => ({
        from: (t: any) =>
          chainy(
            getTableName(t) === "projects"
              ? [{ projectIdentifier: "MOB", workspaceSlug: "acme-mobile" }]
              : [],
          ),
      }),
    };
    await notifyCommentAdded(
      db,
      {} as any,
      { id: "i1", name: "Crash", sequenceId: 2, projectId: "p1", workspaceId: "w1" },
      { id: "c1", commentHtml: "<p>hi</p>", commentStripped: "hi", actorId: "u1" },
      "Dzul",
    );
    const arg = notifyMock.mock.calls[0][2];
    expect(arg.title).toBe("Dzul commented on MOB-2 — Crash");
    expect(arg.email.subject).toBe("[MOB-2] Dzul commented — Crash");
    expect(arg.email.ctaUrl).toBe("https://app.diatur.com/acme-mobile/projects/p1/issues/2");
  });
});
