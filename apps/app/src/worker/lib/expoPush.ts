import type { Env } from "./env";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
// Expo accepts at most 100 messages per request.
const CHUNK = 100;

export interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  sound: "default";
  priority: "high";
  channelId: string;
  data: Record<string, unknown>;
}

export type ExpoPushTicket =
  | { status: "ok"; id?: string }
  | { status: "error"; message?: string; details?: { error?: string } };

export class ExpoPushError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExpoPushError";
  }
}

export interface ExpoPushResult {
  /** One ticket per input message, in order. */
  tickets: ExpoPushTicket[];
  /** Tokens Expo reports as unregistered; callers should delete them. */
  deadTokens: string[];
}

/** Throws ExpoPushError when Expo is unreachable or answers with a non-2xx / malformed body. */
export async function sendExpoPush(env: Env, messages: ExpoPushMessage[]): Promise<ExpoPushResult> {
  const headers: Record<string, string> = {
    accept: "application/json",
    "accept-encoding": "gzip, deflate",
    "content-type": "application/json",
  };
  if (env.EXPO_ACCESS_TOKEN) headers.authorization = `Bearer ${env.EXPO_ACCESS_TOKEN}`;

  const tickets: ExpoPushTicket[] = [];
  const deadTokens: string[] = [];
  for (let i = 0; i < messages.length; i += CHUNK) {
    const chunk = messages.slice(i, i + CHUNK);
    let res: Response;
    try {
      res = await fetch(EXPO_PUSH_URL, { method: "POST", headers, body: JSON.stringify(chunk) });
    } catch (err) {
      throw new ExpoPushError(`Expo push unreachable: ${(err as Error).message}`);
    }
    if (!res.ok) throw new ExpoPushError(`Expo push responded ${res.status}`);
    const body = (await res.json().catch(() => null)) as { data?: ExpoPushTicket[] } | null;
    if (!body || !Array.isArray(body.data) || body.data.length !== chunk.length) {
      throw new ExpoPushError("Expo push returned a malformed response");
    }
    body.data.forEach((ticket, idx) => {
      tickets.push(ticket);
      if (ticket.status === "error" && ticket.details?.error === "DeviceNotRegistered") {
        deadTokens.push(chunk[idx]!.to);
      }
    });
  }
  return { tickets, deadTokens };
}
