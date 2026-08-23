import { describe, expect, it } from "vitest";
import { isUniqueConstraintError, insertIssueWithRetry, allocateNextSequence } from "../issues";

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
  }) as Row;

const UNIQUE_ERR = new Error("SQLITE_CONSTRAINT: UNIQUE constraint failed: issues.sequence_id");

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
      isUniqueConstraintError(new Error("D1_ERROR: UNIQUE constraint failed: uq_issue_sequence")),
    ).toBe(true);
  });

  it("walks nested cause chains (DrizzleQueryError -> D1 error)", () => {
    // Drizzle wraps D1 failures: message is "Failed query: <SQL>", and the
    // real constraint detail lives on the wrapped cause. The old one-level
    // `error.message ?? cause?.message` never inspected it because the
    // wrapper's own message is always set.
    const d1Error = new Error("UNIQUE constraint failed: uq_issue_sequence");
    const drizzleWrapper = new Error("Failed query: insert into issues ...");
    drizzleWrapper.cause = d1Error;
    expect(isUniqueConstraintError(drizzleWrapper)).toBe(true);

    // Even deeper: D1Error chains another cause level (production path).
    const d1RuntimeError = new Error("D1_ERROR: UNIQUE constraint failed: uq_issue_sequence");
    d1RuntimeError.cause = { message: "UNIQUE constraint failed: uq_issue_sequence" };
    const deepWrapper = new Error("Failed query: insert into issues ...");
    deepWrapper.cause = d1RuntimeError;
    expect(isUniqueConstraintError(deepWrapper)).toBe(true);
  });

  it("matches Postgres duplicate-key (SQLSTATE 23505)", () => {
    expect(isUniqueConstraintError({ code: "23505", message: "duplicate key value" })).toBe(true);
  });

  it("does NOT retry on non-unique constraint errors", () => {
    expect(isUniqueConstraintError(new Error("FOREIGN KEY constraint failed"))).toBe(false);
    expect(isUniqueConstraintError(new Error("NOT NULL constraint failed: issues.name"))).toBe(
      false,
    );
    expect(isUniqueConstraintError(new Error("something else"))).toBe(false);
    // A Drizzle-wrapped FK failure must not be treated as a sequence collision.
    const fkWrapper = new Error("Failed query: insert into issues ...");
    fkWrapper.cause = new Error("FOREIGN KEY constraint failed: issues.state_id");
    expect(isUniqueConstraintError(fkWrapper)).toBe(false);
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
          return Promise.reject(new Error("FOREIGN KEY constraint failed: issues.stateId"));
        },
      }),
    } as unknown as Db;
    await expect(insertIssueWithRetry(db, baseRow(5))).rejects.toThrow(/foreign key/i);
    expect(state.attempts).toBe(1); // no retries for non-unique constraint errors
  });
});

// ── allocateNextSequence (atomic per-project counter) ──

// Models issue_sequence_counters + issues MAX faithfully to the real code:
// 1. INSERT OR IGNORE placeholder (0) → returning() tells us if we won the seed
// 2. If we won: reconcile UPDATE `next = MAX(next, MAX(seq_id)+1)` (no returning)
// 3. Atomic bump UPDATE `next = next + 1` RETURNING next
// The reconcile is awaited without `.returning()`; the bump chains `.returning()`.
function counterDb(init: { maxIssueSeq?: number; existingCounter?: number } = {}) {
  const state = {
    counter: init.existingCounter ?? null,
    maxIssueSeq: init.maxIssueSeq ?? 0,
    bumps: 0,
    seeds: 0,
  };
  const db = {
    insert: () => ({
      values: (row: { projectId: string; nextSequence: number }) => {
        if (state.counter === null) {
          state.counter = row.nextSequence; // placeholder 0
          state.seeds++;
          return {
            onConflictDoNothing: () => ({
              returning: () => Promise.resolve([{ projectId: row.projectId }]),
            }),
          };
        }
        return {
          onConflictDoNothing: () => ({ returning: () => Promise.resolve([]) }),
        };
      },
    }),
    update: () => ({
      set: (vals: { nextSequence?: unknown; updatedAt?: string }) => ({
        where: () => {
          // Apply the SET when the statement is executed (awaited), mirroring
          // D1's single-statement atomicity.
          const apply = (): number => {
            // Drizzle sql template: { queryChunks: [...] }. For the reconcile
            // it's ["MAX(", col, ", ", N, ")"]; for the bump it's ["foo + 1"].
            const chunks = (vals.nextSequence as { queryChunks?: unknown[] } | undefined)
              ?.queryChunks;
            const joined = (chunks ?? [])
              .map((c) =>
                typeof c === "string" ? c : String((c as { value?: unknown }).value ?? c),
              )
              .join(" ");
            const m = /MAX\([^)]*?,\s*(\d+)\s*\)/.exec(joined);
            if (m) {
              // Reconcile: next = MAX(next, N) — never lowers the counter.
              state.counter = Math.max(state.counter ?? 0, Number(m[1]));
              return state.counter;
            }
            // Bump: next = next + 1.
            state.counter = (state.counter ?? 0) + 1;
            state.bumps++;
            return state.counter;
          };
          let applied = false;
          // Drizzle's update builder is a QueryPromise (thenable): awaiting the
          // reconcile (no .returning()) executes it. The bump chains .returning().
          const thenable = {
            returning: () => {
              applied = true;
              return Promise.resolve([{ nextSequence: apply() }]);
            },
            // oxlint-disable-next-line unicorn/no-thenable -- mirrors the real builder
            then: (resolve: (v?: unknown) => void, reject: (e?: unknown) => void) => {
              try {
                if (!applied) apply();
                resolve(undefined);
              } catch (e) {
                reject(e);
              }
            },
          };
          return thenable;
        },
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => Promise.resolve([{ maxSeq: state.maxIssueSeq }]),
      }),
    }),
  };
  return { db: db as unknown as Db, state };
}

describe("allocateNextSequence", () => {
  it("seeds from MAX(sequence_id)+1 then bumps", async () => {
    const { db, state } = counterDb({ maxIssueSeq: 41 });
    const seq = await allocateNextSequence(db, "project-1");
    // seed placeholder (0) -> reconcile to MAX(0, 42)=42 -> bump to 43.
    expect(state.seeds).toBe(1);
    expect(seq).toBe(43);
    expect(state.counter).toBe(43);
  });

  it("bumps sequentially on repeated calls", async () => {
    const { db, state } = counterDb({ existingCounter: 100 });
    const a = await allocateNextSequence(db, "project-1");
    const b = await allocateNextSequence(db, "project-1");
    const c = await allocateNextSequence(db, "project-1");
    expect([a, b, c]).toEqual([101, 102, 103]);
    expect(state.bumps).toBe(3);
    expect(state.seeds).toBe(0); // row already existed — no seed
  });

  it("never lowers the counter below a concurrent peer's bump", async () => {
    // Peer bumps the counter to 50 before this creator reconciles. The
    // reconcile MAX(counter, MAX(seq_id)+1) = MAX(50, 6) = 50 must win, then
    // the bump returns 51. (Counter pre-seeded at 50 = "lost seed" branch.)
    const { db, state } = counterDb({ existingCounter: 50, maxIssueSeq: 5 });
    const seq = await allocateNextSequence(db, "project-1");
    expect(state.counter).toBe(51);
    expect(seq).toBe(51);
  });
});
