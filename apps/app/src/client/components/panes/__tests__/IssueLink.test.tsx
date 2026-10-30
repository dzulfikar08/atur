import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PaneIssue, IssueSummary, issuePath } from "@/components/panes/IssueLink";
import type { AgentSession } from "@/lib/api";

vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  api: { listWorkspaces: async () => [], listAgentSessions: async () => [] },
}));

const session: AgentSession = {
  id: "s1",
  pane_id: "m1~p1",
  machine_id: "m1",
  agent: "omp",
  state: "blocked",
  state_at: 0,
  source: "claim_comment",
  ended_at: null,
  issue: {
    id: "i1",
    key: "ATUR-12",
    name: "Link panes to issues",
    project_id: "pr-1",
    workspace_slug: "diatur",
    state_name: "In Progress",
    state_group: "started",
    url: "https://app.diatur.com/diatur/projects/pr-1/issues/12",
  },
};

const renderIn = (ui: React.ReactElement) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );

describe("pane issue link", () => {
  it("links to the issue inside the app", () => {
    expect(issuePath(session)).toBe("/diatur/projects/pr-1/issues/12");
    renderIn(<PaneIssue paneId="m1~p1" session={session} />);
    expect(screen.getByRole("link", { name: /ATUR-12/ })).toHaveAttribute(
      "href",
      "/diatur/projects/pr-1/issues/12",
    );
    expect(screen.getByText(/needs you/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change" })).toBeInTheDocument();
  });

  it("offers to link an unlinked pane", () => {
    renderIn(<PaneIssue paneId="p9" />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByRole("button", { name: "Link issue" })).toBeInTheDocument();
  });

  it("summarises key, title and state for pane cards", () => {
    renderIn(<IssueSummary session={session} />);
    expect(screen.getByText("ATUR-12")).toBeInTheDocument();
    expect(screen.getByText("Link panes to issues")).toBeInTheDocument();
  });
});
