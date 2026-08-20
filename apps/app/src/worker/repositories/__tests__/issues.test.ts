import { describe, expect, it } from "vitest";
import { isUniqueConstraintError, insertIssueWithRetry } from "../issues";

type Db = Parameters<typeof insertIssueWithRetry>[0];
type Row = Parameters<typeof insertIssueWithRetry>[1];

const baseRow = (seq: number, projectId = "project-1"): Row =>
  ({
    id: "00000000-0000-4000-8000-000000000001",
    name: "sub-issue",
    sequenceId: seq,
    projectId,
    workspaceId: "workspace-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  } as Row);

const UNIQUE_ERR = new Error(
  "SQLITE_CONSTRAINT: UNIQUE constraint failed: issues.sequence_id",
);

// A mock D1/Drizzle client. `taken` models the sequence ids already grabbed by
// concurrent creators. getNextSequence() reads MAX(taken)+1; an insert rejects
// with a unique violation when its sequenceId is already taken.
function mockDb(taken: number[] = []) {
  const state = { attempts: 0, inserts: 0, max: taken.length ? Math.max(...taken) : 0 };
  const db = {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve([{ maxSeq: state.max }]),
      }),
    }),
    insert: () => ({
      values: (row: { sequenceId: number }) => {
        state.attempts++;
        if (taken.includes(row.sequenceId)) {
          return Promise.reject(UNIQUE_ERR);
        }
        taken.push(row.sequenceId);
        state.max = row.sequenceId;
        state.inserts++;
        return Promise.resolve();
      },
    }),
  };
  return { db: db as unknown as Db, state };
}

describe("isUniqueConstraintError", () => {
  it("matches SQLite/D1 unique-constraint messages", () => {
    expect(isUniqueConstraintError(UNIQUE_ERR)).toBe(true);
    expect(
      isUniqueConstraintError(
        new Error("D1_ERROR: UNIQUE constraint failed: uq_issue_sequence"),
      ),
    ).toBe(true);
  });

  it("matches Postgres duplicate-key (SQLSTATE 23505)", () => {
    expect(
      isUniqueConstraintError({ code: "23505", message: "duplicate key value" }),
    ).toBe(true);
  });

  it("does NOT retry on non-unique constraint errors", () => {
    expect(
      isUniqueConstraintError(new Error("FOREIGN KEY constraint failed")),
    ).toBe(false);
    expect(
      isUniqueConstraintError(new Error("NOT NULL constraint failed: issues.name")),
    ).toBe(false);
    expect(isUniqueConstraintError(new Error("something else"))).toBe(false);
  });
});

describe("insertIssueWithRetry", () => {
  it("inserts once with the caller's sequence when there is no collision", async () => {
    const { db, state } = mockDb([]);
    const row = baseRow(5);
    await insertIssueWithRetry(db, row);
    expect(state.attempts).toBe(1);
    expect(state.inserts).toBe(1);
    expect(row.sequenceId).toBe(5);
  });

  it("re-derives and retries after a unique collision", async () => {
    const { db, state } = mockDb([5]); // seq 5 already taken by a peer
    const row = baseRow(5); // caller proposed the now-stale 5
    await insertIssueWithRetry(db, row);
    // attempt 1 (seq 5) collided -> re-read MAX(=5)+1=6 -> attempt 2 succeeds
    expect(state.attempts).toBe(2);
    expect(state.inserts).toBe(1);
    expect(row.sequenceId).toBe(6);
  });

  it("does not retry on a non-unique error (re-throws immediately)", async () => {
    const state = { attempts: 0 };
    const db = {
      insert: () => ({
        values: () => {
          state.attempts++;
          return Promise.reject(
            new Error("FOREIGN KEY constraint failed: issues.stateId"),
          );
        },
      }),
    } as unknown as Db;
    await expect(insertIssueWithRetry(db, baseRow(5))).rejects.toThrow(/foreign key/i);
    expect(state.attempts).toBe(1); // no retries for non-unique constraint errors
  });
});
