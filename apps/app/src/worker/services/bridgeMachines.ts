// Customer machines that connect their own atur-bridge through the relay
// (bridge_machines). The token is `atb_…`, shown once; only its SHA-256 is kept.
import { and, eq, isNull } from "drizzle-orm";
import type { DbClient } from "../db/index";
import * as schema from "../db/schema";
import { sha256Hex } from "../lib/identify";
import { nowISO } from "../lib/pagination";
import { newMachineId, newMachineToken } from "../lib/relayProtocol";

export type BridgeMachine = typeof schema.bridgeMachines.$inferSelect;

/** Create a machine for `userId`; the plaintext token is returned once, never stored. */
export async function createMachine(
  db: DbClient,
  userId: string,
  name: string,
): Promise<{ machine: BridgeMachine; token: string }> {
  const token = newMachineToken();
  const tokenHash = await sha256Hex(token);
  for (let attempt = 0; ; attempt++) {
    const row = {
      id: newMachineId(),
      userId,
      name,
      tokenHash,
      createdAt: nowISO(),
      lastSeenAt: null,
      revokedAt: null,
    };
    try {
      await db.insert(schema.bridgeMachines).values(row);
      return { machine: row, token };
    } catch (err) {
      // 29M ids: a collision is a freak event, anything else is a real failure.
      if (attempt >= 4) throw err;
    }
  }
}

export async function listActive(db: DbClient, userId: string): Promise<BridgeMachine[]> {
  const rows = await db
    .select()
    .from(schema.bridgeMachines)
    .where(and(eq(schema.bridgeMachines.userId, userId), isNull(schema.bridgeMachines.revokedAt)));
  // Newest first (ISO timestamps sort lexicographically).
  return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** The caller's own live machine, or null (unknown id, someone else's, revoked). */
export async function findOwned(
  db: DbClient,
  userId: string,
  machineId: string,
): Promise<BridgeMachine | null> {
  const [row] = await db
    .select()
    .from(schema.bridgeMachines)
    .where(
      and(
        eq(schema.bridgeMachines.id, machineId),
        eq(schema.bridgeMachines.userId, userId),
        isNull(schema.bridgeMachines.revokedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Resolve a presented machine token to its live (not revoked) machine. */
export async function findActiveByToken(
  db: DbClient,
  token: string,
): Promise<BridgeMachine | null> {
  const [row] = await db
    .select()
    .from(schema.bridgeMachines)
    .where(
      and(
        eq(schema.bridgeMachines.tokenHash, await sha256Hex(token)),
        isNull(schema.bridgeMachines.revokedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** True when a live machine of `userId` was revoked by this call. */
export async function revoke(db: DbClient, userId: string, machineId: string): Promise<boolean> {
  const rows = await db
    .update(schema.bridgeMachines)
    .set({ revokedAt: nowISO() })
    .where(
      and(
        eq(schema.bridgeMachines.id, machineId),
        eq(schema.bridgeMachines.userId, userId),
        isNull(schema.bridgeMachines.revokedAt),
      ),
    )
    .returning({ id: schema.bridgeMachines.id });
  return rows.length > 0;
}

export async function touchLastSeen(db: DbClient, machineId: string): Promise<void> {
  await db
    .update(schema.bridgeMachines)
    .set({ lastSeenAt: nowISO() })
    .where(eq(schema.bridgeMachines.id, machineId));
}
