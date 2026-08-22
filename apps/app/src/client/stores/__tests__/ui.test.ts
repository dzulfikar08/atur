import { describe, it, expect, beforeEach, vi } from "vitest";
import { useUiPrefsStore } from "../ui";

async function freshStore() {
  vi.resetModules();
  const mod = await import("../ui");
  return mod.useUiPrefsStore;
}

describe("useUiPrefsStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useUiPrefsStore.setState({ workspaceRail: false });
  });

  it("defaults the rail on when no pref is stored", async () => {
    const fresh = await freshStore();
    expect(fresh.getState().workspaceRail).toBe(true);
  });

  it("respects an explicit opt-out ('0')", async () => {
    localStorage.setItem("ui-workspace-rail", "0");
    const fresh = await freshStore();
    expect(fresh.getState().workspaceRail).toBe(false);
  });

  it("keeps the rail on for a stored '1'", async () => {
    localStorage.setItem("ui-workspace-rail", "1");
    const fresh = await freshStore();
    expect(fresh.getState().workspaceRail).toBe(true);
  });

  it("setWorkspaceRail turns the rail on", () => {
    useUiPrefsStore.getState().setWorkspaceRail(true);
    expect(useUiPrefsStore.getState().workspaceRail).toBe(true);
  });

  it("persists workspaceRail to localStorage", () => {
    useUiPrefsStore.getState().setWorkspaceRail(false);
    expect(localStorage.getItem("ui-workspace-rail")).toBe("0");
  });
});
