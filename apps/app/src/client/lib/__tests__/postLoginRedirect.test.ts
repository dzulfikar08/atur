import { afterEach, describe, expect, it, vi } from "vitest";
import { goAfterLogin, takePostLoginRedirect } from "../postLoginRedirect";

afterEach(() => {
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

describe("post-login redirect", () => {
  it("returns the stored target once, defaulting to /", () => {
    sessionStorage.setItem("redirect_after_login", "/issues?x=1");
    expect(takePostLoginRedirect()).toBe("/issues?x=1");
    expect(sessionStorage.getItem("redirect_after_login")).toBeNull();
  });

  it("keeps a just-taken target available for the racing second consumer", () => {
    sessionStorage.setItem("redirect_after_login", "/oauth/authorize?a=b");
    takePostLoginRedirect();
    expect(takePostLoginRedirect()).toBe("/oauth/authorize?a=b");
  });

  it("uses a real navigation for worker-served /oauth/ targets, the router otherwise", () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { assign });
    const navigate = vi.fn();
    goAfterLogin(navigate, "/oauth/authorize?a=b");
    expect(assign).toHaveBeenCalledWith("/oauth/authorize?a=b");
    expect(navigate).not.toHaveBeenCalled();
    goAfterLogin(navigate, "/issues");
    expect(navigate).toHaveBeenCalledWith("/issues", { replace: true });
  });
});
