// Design-token colors for an issue state, from its canonical key and then its
// group. Values are CSS vars (index.css), so they follow the light/dark theme.
export function stateColor(
  state: { key?: string | null; group?: string | null } | null | undefined,
): string {
  switch (state?.key) {
    case "needs_you":
      return "var(--state-needs-you)";
    case "need_review":
      return "var(--state-review)";
    case "in_progress":
      return "var(--state-started)";
    case "todo":
      return "var(--state-unstarted)";
    case "done":
      return "var(--state-completed)";
    case "cancelled":
      return "var(--state-cancelled)";
  }
  switch (state?.group) {
    case "completed":
      return "var(--state-completed)";
    case "cancelled":
      return "var(--state-cancelled)";
    case "started":
      return "var(--state-started)";
    default:
      return "var(--state-backlog)";
  }
}
