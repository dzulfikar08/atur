import { describe, expect, it } from "vitest";
import { mintScreenTicket, SCREEN_TICKET_TTL_MS } from "../screenTicket";

// The same vector is asserted by apps/bridge/src/screen-direct.test.ts: the
// Worker (WebCrypto) and the bridge (node:crypto) must agree byte for byte.
describe("mintScreenTicket", () => {
  it("matches the bridge's wire format", async () => {
    const { ticket, expiresAt } = await mintScreenTicket(
      "bridge-secret",
      { sub: "user-1", audit: "audit-1", jti: "jti-1" },
      1_000_000,
    );
    expect(expiresAt).toBe(1_000_000 + SCREEN_TICKET_TTL_MS);
    expect(ticket).toBe(
      "eyJ2IjoxLCJhdWQiOiJzY3JlZW4iLCJzdWIiOiJ1c2VyLTEiLCJhdWRpdCI6ImF1ZGl0LTEiLCJqdGkiOiJqdGktMSIsImV4cCI6MTA2MDAwMH0.UibtRkB7tQHsIsBJngBnRPRkooN2XW5_vGexh_3LYr4",
    );
  });
});
