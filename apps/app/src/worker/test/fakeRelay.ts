// Test-only stand-in for the BRIDGE_RELAY namespace. The real BridgeRelay needs
// workerd (hibernating WebSockets, WebSocketPair), so route tests drive a fake
// stub and the DO stays a thin mux over the pure helpers in lib/relayProtocol.ts.
import type { Env } from "../lib/env";
import type {
  RelayOnlineMachine,
  RelayPaneList,
  RelayRequest,
  RelayResponse,
} from "../lib/relayProtocol";

export interface FakeRelay {
  /** Assign to env.BRIDGE_RELAY. */
  namespace: NonNullable<Env["BRIDGE_RELAY"]>;
  /** Durable Object names the Worker asked for (`user:<id>`). */
  names: string[];
  online: Record<string, RelayOnlineMachine>;
  panes: RelayPaneList[];
  closed: string[];
  requests: { machineId: string; req: RelayRequest }[];
  /** Answer for request(); defaults to 200 `{}`. */
  respond: (machineId: string, req: RelayRequest) => RelayResponse;
  /** Upgrade requests forwarded through stub.fetch. */
  fetched: Request[];
  fetchResponse: () => Response;
  /** Replaces the stub the namespace hands out (e.g. one whose calls throw). */
  stubOverride?: unknown;
}

export function fakeRelay(): FakeRelay {
  const relay: FakeRelay = {
    names: [],
    online: {},
    panes: [],
    closed: [],
    requests: [],
    fetched: [],
    respond: () => ({ status: 200, headers: {}, body: new TextEncoder().encode("{}") }),
    fetchResponse: () => Response.json({ error: "machine offline" }, { status: 502 }),
    namespace: undefined as never,
  };
  const stub = {
    onlineMachines: async () => relay.online,
    closeMachine: async (machineId: string) => {
      relay.closed.push(machineId);
    },
    listPanes: async () => relay.panes,
    request: async (machineId: string, req: RelayRequest) => {
      relay.requests.push({ machineId, req });
      return relay.respond(machineId, req);
    },
    fetch: async (input: string | Request, init?: RequestInit) => {
      relay.fetched.push(new Request(input, init));
      return relay.fetchResponse();
    },
  };
  relay.namespace = {
    getByName: (name: string) => {
      relay.names.push(name);
      return relay.stubOverride ?? stub;
    },
  } as never;
  return relay;
}
