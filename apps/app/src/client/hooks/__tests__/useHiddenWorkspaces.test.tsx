import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor, act } from "@testing-library/react";
import { api } from "@/lib/api";
import { useHiddenWorkspaces, useSwitcherWorkspaces } from "@/hooks/useHiddenWorkspaces";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/lib/api", () => ({
  api: { listWorkspaces: vi.fn(), hiddenWorkspaces: vi.fn(), setWorkspaceHidden: vi.fn() },
}));

const workspaces = [
  { id: "w1", slug: "alpha", name: "Alpha" },
  { id: "w2", slug: "beta", name: "Beta" },
  { id: "w3", slug: "gamma", name: "Gamma" },
];

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.listWorkspaces).mockResolvedValue(workspaces);
  vi.mocked(api.hiddenWorkspaces).mockResolvedValue(["w2", "w3"]);
});

describe("useSwitcherWorkspaces", () => {
  it("splits hidden workspaces out of the visible list", async () => {
    const { result } = renderHook(() => useSwitcherWorkspaces("alpha"), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.hidden).toHaveLength(2));
    expect(result.current.visible.map((w) => w.slug)).toEqual(["alpha"]);
    expect(result.current.hidden.map((w) => w.slug)).toEqual(["beta", "gamma"]);
  });

  it("always shows the active workspace even when hidden", async () => {
    const { result } = renderHook(() => useSwitcherWorkspaces("beta"), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.hidden).toHaveLength(1));
    expect(result.current.visible.map((w) => w.slug)).toEqual(["alpha", "beta"]);
    expect(result.current.hidden.map((w) => w.slug)).toEqual(["gamma"]);
  });
});

describe("useHiddenWorkspaces", () => {
  it("updates optimistically and rolls back when the save fails", async () => {
    let reject: (e: Error) => void = () => {};
    vi.mocked(api.setWorkspaceHidden).mockReturnValue(
      new Promise((_, r) => {
        reject = r;
      }),
    );
    const { result } = renderHook(() => useHiddenWorkspaces(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.hiddenIds).toEqual(["w2", "w3"]));

    act(() => result.current.setHidden("w1", true));
    await waitFor(() => expect(result.current.hiddenIds).toContain("w1"));
    expect(api.setWorkspaceHidden).toHaveBeenCalledWith("w1", true);

    act(() => reject(new Error("boom")));
    await waitFor(() => expect(result.current.hiddenIds).not.toContain("w1"));
  });
});
