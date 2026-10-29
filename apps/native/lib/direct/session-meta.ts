import { shortCwd } from "@/lib/pane-meta";
import type { DirectSession } from "@/modules/atur-direct/src/types";

/** What a direct session asks of the human, in the Panes tab's vocabulary. */
export type DirectAttention = "needs-you" | "working" | "idle" | "shell";

const ATTENTION_ORDER: Record<DirectAttention, number> = {
  "needs-you": 0,
  working: 1,
  idle: 2,
  shell: 3,
};

export const DIRECT_ATTENTION_LABEL: Record<Exclude<DirectAttention, "shell">, string> = {
  "needs-you": "Needs you",
  working: "Working",
  idle: "Idle",
};

export function directAttention(session: DirectSession): DirectAttention {
  if (!session.agent) return "shell";
  switch (session.agent.state) {
    case "blocked":
      return "needs-you";
    case "working":
      return "working";
    default:
      return "idle";
  }
}

/** Sessions that can be opened (starting or live), agents that need you first. Stable otherwise. */
export function openableSessions(sessions: readonly DirectSession[]): DirectSession[] {
  return sessions
    .filter((session) => session.status === "live" || session.status === "starting")
    .map((session, index) => ({ session, index }))
    .sort(
      (a, b) =>
        ATTENTION_ORDER[directAttention(a.session)] - ATTENTION_ORDER[directAttention(b.session)] ||
        a.index - b.index,
    )
    .map(({ session }) => session);
}

export function directSessionTitle(session: DirectSession): string {
  return session.projectName || (session.agent ? `${session.agent.provider} session` : "shell");
}

/** "claude · …/work/atur": the agent and the folder, whichever are known. */
export function directSessionDetail(session: DirectSession): string {
  return [session.agent?.provider, shortCwd(session.directory)].filter(Boolean).join(" · ");
}
