import { cleanPaneTitle } from "@/lib/pane-meta";
import type { DirectSession } from "@/modules/atur-direct/src/types";

/** What a direct session asks of the human, in the Panes tab's vocabulary. */
export type DirectAttention = "needs-you" | "done" | "working" | "idle" | "shell";

const ATTENTION_ORDER: Record<DirectAttention, number> = {
  "needs-you": 0,
  done: 1,
  working: 2,
  idle: 3,
  shell: 4,
};

export const DIRECT_ATTENTION_LABEL: Record<Exclude<DirectAttention, "shell">, string> = {
  "needs-you": "Needs you",
  done: "Done",
  working: "Working",
  idle: "Idle",
};

export function directAttention(session: DirectSession): DirectAttention {
  if (!session.agent) return "shell";
  switch (session.agent.state) {
    case "blocked":
      return "needs-you";
    case "done":
      return "done";
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

/** How an agent provider is shown: "Oh My Pi" is "omp" (any case); others are left as the core names them. */
export function agentDisplayName(provider: string): string {
  return provider.trim().toLowerCase() === "oh my pi" ? "omp" : provider;
}

/** The terminal's own title (what the desktop session list shows), then the project, then the agent. */
export function directSessionTitle(session: DirectSession): string {
  return (
    cleanPaneTitle(session.title) ??
    (session.projectName ||
      (session.agent ? `${agentDisplayName(session.agent.provider)} session` : "shell"))
  );
}

function basename(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? "";
}

/** "omp · atur · web": the agent, the project and the folder, minus whatever the title already says. */
export function directSessionDetail(session: DirectSession): string {
  const primary = directSessionTitle(session);
  const parts: string[] = [];
  for (const part of [
    session.agent ? agentDisplayName(session.agent.provider) : "",
    session.projectName,
    basename(session.directory),
  ]) {
    if (part && part !== primary && !parts.includes(part)) parts.push(part);
  }
  return parts.join(" · ");
}
