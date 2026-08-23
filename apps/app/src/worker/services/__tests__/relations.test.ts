import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../repositories/relations", () => ({
  findById: vi.fn(),
  createRelation: vi.fn(),
  listByIssue: vi.fn(),
  removeRelation: vi.fn(),
}));

import { remove } from "../relations";
import * as relationsRepo from "../../repositories/relations";

const findById = vi.mocked(relationsRepo.findById);
const removeRelation = vi.mocked(relationsRepo.removeRelation);

// rows returned by the service's `db.select().from(issues).where(...)` — the
// workspace scope of both relation endpoints.
let issueRows: { id: string }[] = [];
const db = {
  select: () => ({
    from: () => ({
      where: async () => issueRows,
    }),
  }),
} as any;

beforeEach(() => {
  vi.clearAllMocks();
  issueRows = [];
});

describe("relationsService.remove", () => {
  const relation = {
    id: "rel-1",
    issueId: "i-1",
    relatedIssueId: "i-2",
    relationType: "blocks",
  } as any;

  it("removes a relation when BOTH endpoints are in the caller's workspace", async () => {
    findById.mockResolvedValue(relation);
    issueRows = [{ id: "i-1" }, { id: "i-2" }];

    await remove(db, "rel-1", "ws-1");

    expect(removeRelation).toHaveBeenCalledWith(db, "rel-1");
  });

  it("404s and never removes when the related endpoint is foreign (one-sided match)", async () => {
    findById.mockResolvedValue(relation);
    // The related side (i-2) is not in the caller's workspace → only 1 row.
    issueRows = [{ id: "i-1" }];

    await expect(remove(db, "rel-1", "ws-1")).rejects.toThrow("Relation not found");
    expect(removeRelation).not.toHaveBeenCalled();
  });

  it("404s and never removes when neither endpoint is in the caller's workspace", async () => {
    findById.mockResolvedValue(relation);
    issueRows = [];

    await expect(remove(db, "rel-1", "ws-1")).rejects.toThrow("Relation not found");
    expect(removeRelation).not.toHaveBeenCalled();
  });

  it("404s a missing relation without querying issues", async () => {
    findById.mockResolvedValue(null as any);

    await expect(remove(db, "rel-1", "ws-1")).rejects.toThrow("Relation not found");
    expect(removeRelation).not.toHaveBeenCalled();
  });
});
