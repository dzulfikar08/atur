import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const { apiMocks, apiFetchMock, toastMocks } = vi.hoisted(() => ({
  apiMocks: {
    listWorkspaceLinks: vi.fn(),
    updateWorkspaceLink: vi.fn(),
    deleteWorkspaceLink: vi.fn(),
  },
  apiFetchMock: vi.fn(),
  toastMocks: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/api", () => ({
  api: apiMocks,
  apiFetch: apiFetchMock,
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.name = "ApiError";
      this.status = status;
    }
  },
}));

vi.mock("sonner", () => ({ toast: toastMocks }));

import WorkspaceBindingsPage from "@/pages/admin/WorkspaceBindingsPage";
import { useAuthStore } from "@/stores/auth";
import { ApiError } from "@/lib/api";
import type { WorkspaceLink } from "@/lib/api";

const LINK: WorkspaceLink = {
  workspace: "acme",
  repo_urls: ["owner/repo-one", "owner/repo-two"],
  local_path: "/srv/acme",
  default_branch: "main",
  herdr_workspace: "acme-herdr",
  notes: "seeded by ops",
  mode: "direct-PR",
  auto_merge: "yolo",
  updated_at: "2026-09-01T00:00:00Z",
};

const ADMIN = { id: "u-admin", member_id: "u-admin", role: 20, is_active: true };
const PLAIN = { id: "u-plain", member_id: "u-plain", role: 15, is_active: true };

function stubSession(userId: string) {
  useAuthStore.setState({
    user: {
      id: userId,
      email: "a@b.c",
      display_name: "A",
      username: "a",
      avatar: null,
    },
    isAuthenticated: true,
    initialized: true,
  });
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/acme/admin/bindings"]}>
        <Routes>
          <Route path="/:slug/admin/bindings" element={<WorkspaceBindingsPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function firstByLabelText(text: string): HTMLElement {
  const el = screen.getAllByLabelText(text)[0];
  if (!el) throw new Error(`no element labeled "${text}"`);
  return el;
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ user: null, isAuthenticated: false, initialized: false });
  apiMocks.listWorkspaceLinks.mockResolvedValue({ results: [LINK] });
  apiFetchMock.mockResolvedValue({ results: [ADMIN, PLAIN] });
});

describe("WorkspaceBindingsPage (DEV-29 gap 1)", () => {
  it("lists every binding with repos as chips", async () => {
    renderPage();
    // Both the stacked mobile layout and the desktop table render (jsdom has
    // no media queries), so workspace and chips appear twice.
    expect((await screen.findAllByText("acme")).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("owner/repo-one").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("owner/repo-two").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("/srv/acme").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("yolo").length).toBeGreaterThanOrEqual(1);
    expect(apiMocks.listWorkspaceLinks).toHaveBeenCalledTimes(1);
  });

  it("hides edit affordances from plain members and says the page is read-only", async () => {
    stubSession("u-plain");
    renderPage();
    await screen.findAllByText("acme");
    expect(screen.queryAllByLabelText("Edit binding for acme")).toHaveLength(0);
    expect(screen.queryAllByLabelText("Delete binding for acme")).toHaveLength(0);
    expect(screen.getByText(/Read-only/)).toBeTruthy();
  });

  it("admin saves through the per-slug PUT: textarea lines become the repo_urls array", async () => {
    const user = userEvent.setup();
    stubSession("u-admin");
    apiMocks.updateWorkspaceLink.mockResolvedValue({ ...LINK, local_path: "/srv/acme-2" });

    renderPage();
    await screen.findAllByText("acme");
    await user.click(firstByLabelText("Edit binding for acme"));

    const dialog = await screen.findByRole("dialog");
    const repos = dialog.querySelector("#binding-repos") as HTMLTextAreaElement;
    const localPath = dialog.querySelector("#binding-local-path") as HTMLInputElement;
    await user.clear(repos);
    await user.type(repos, "owner/repo-one\n owner/repo-three \n\n");
    await user.clear(localPath);
    await user.type(localPath, "/srv/acme-2");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(apiMocks.updateWorkspaceLink).toHaveBeenCalledWith("acme", {
        repo_urls: ["owner/repo-one", "owner/repo-three"],
        local_path: "/srv/acme-2",
        default_branch: "main",
        herdr_workspace: "acme-herdr",
        notes: "seeded by ops",
        mode: "direct-PR",
        auto_merge: "yolo",
      }),
    );
    expect(toastMocks.success).toHaveBeenCalled();
  });

  it("surfaces a 403 from the per-slug PUT as an error toast", async () => {
    const user = userEvent.setup();
    stubSession("u-admin");
    apiMocks.updateWorkspaceLink.mockRejectedValue(
      new ApiError(403, "Only the workspace owner or an admin can perform this action"),
    );

    renderPage();
    await screen.findAllByText("acme");
    await user.click(firstByLabelText("Edit binding for acme"));
    await screen.findByRole("dialog");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(toastMocks.error).toHaveBeenCalled());
    const call = toastMocks.error.mock.calls[0];
    if (!call) throw new Error("expected an error toast");
    const [title, opts] = call;
    expect(String((opts as { description?: string }).description)).toContain("403");
  });

  it("deletes a binding through the confirm dialog", async () => {
    const user = userEvent.setup();
    stubSession("u-admin");
    apiMocks.deleteWorkspaceLink.mockResolvedValue(undefined);

    renderPage();
    await screen.findAllByText("acme");
    await user.click(firstByLabelText("Delete binding for acme"));
    expect(await screen.findByText("Delete binding for acme?")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(apiMocks.deleteWorkspaceLink).toHaveBeenCalledWith("acme"));
    expect(toastMocks.success).toHaveBeenCalled();
  });
});
