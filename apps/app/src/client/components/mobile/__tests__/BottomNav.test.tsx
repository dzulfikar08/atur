import { describe, it, expect, vi } from "vitest";
import { type ReactElement } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import BottomNav from "@/components/mobile/BottomNav";

vi.mock("@/hooks/useWorkspaces", () => ({
  useWorkspaces: () => ({
    data: [{ id: "ws-1", slug: "acme", name: "Acme", logo: null }],
    isLoading: false,
    isError: false,
    isSuccess: true,
    refetch: vi.fn(),
  }),
}));

const authState = { user: { display_name: "A", email: "a@b.c" }, logout: vi.fn() };
vi.mock("@/stores/auth", () => ({
  useAuthStore: (selector: (s: typeof authState) => unknown) => selector(authState),
}));

vi.mock("@/stores/workspace", () => ({
  useWorkspaceStore: () => ({ currentSlug: "acme", setCurrentSlug: vi.fn() }),
}));

function renderWith(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/acme"]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("BottomNav", () => {
  it("renders the primary tabs + More button", () => {
    renderWith(<BottomNav />);
    expect(screen.getByText("Home")).toBeInTheDocument();
    expect(screen.getByText("More")).toBeInTheDocument();
  });

  it("exposes Create workspace from the More drawer", async () => {
    const user = userEvent.setup();
    renderWith(<BottomNav />);
    await user.click(screen.getByRole("button", { name: "More" }));
    expect(await screen.findByRole("button", { name: "Create workspace" })).toBeInTheDocument();
  });

  it("links Panes to the absolute /panes route from the More drawer", async () => {
    const user = userEvent.setup();
    renderWith(<BottomNav />);
    await user.click(screen.getByRole("button", { name: "More" }));
    const link = await screen.findByRole("link", { name: "Panes" });
    // Absolute, NOT slug-scoped: /panes, not /acme/panes.
    expect(link).toHaveAttribute("href", "/panes");
  });

  it("lists the active workspace in the More drawer", async () => {
    const user = userEvent.setup();
    renderWith(<BottomNav />);
    await user.click(screen.getByRole("button", { name: "More" }));
    expect(await screen.findByText("Acme")).toBeInTheDocument();
  });
});
