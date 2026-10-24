import type { Env } from "./env";
import { relayObjectName } from "./relayProtocol";

/** The user's BridgeRelay Durable Object, or null when the binding is absent. */
export function relayStub(env: Env, userId: string) {
  return env.BRIDGE_RELAY?.getByName(relayObjectName(userId)) ?? null;
}
