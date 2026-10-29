import { describe, expect, test } from "bun:test";
import { chooseBackendKind } from "./select-backend";

describe("chooseBackendKind", () => {
  const probes = (herdr: boolean, muxy: boolean, tmux: boolean) => ({
    herdrSocketExists: () => herdr,
    muxySocketExists: () => muxy,
    tmuxInstalled: () => tmux,
  });

  test("auto prefers herdr, then Atur Terminal, then tmux", () => {
    expect(chooseBackendKind({}, probes(true, true, true))).toBe("herdr");
    expect(chooseBackendKind({}, probes(false, true, true))).toBe("atur-terminal");
    expect(chooseBackendKind({}, probes(false, false, true))).toBe("tmux");
    expect(chooseBackendKind({ BRIDGE_BACKEND: "auto" }, probes(false, true, true))).toBe(
      "atur-terminal",
    );
  });

  test("BRIDGE_BACKEND forces a backend regardless of probes", () => {
    expect(chooseBackendKind({ BRIDGE_BACKEND: "tmux" }, probes(true, true, true))).toBe("tmux");
    expect(chooseBackendKind({ BRIDGE_BACKEND: "HERDR" }, probes(false, false, false))).toBe(
      "herdr",
    );
    expect(chooseBackendKind({ BRIDGE_BACKEND: "atur-terminal" }, probes(true, false, true))).toBe(
      "atur-terminal",
    );
  });

  test("BRIDGE_BACKEND=muxy stays an alias of atur-terminal", () => {
    expect(chooseBackendKind({ BRIDGE_BACKEND: " Muxy " }, probes(true, false, true))).toBe(
      "atur-terminal",
    );
  });

  test("nothing available, or a bad value, is an error", () => {
    expect(() => chooseBackendKind({}, probes(false, false, false))).toThrow(/no terminal backend/);
    expect(() => chooseBackendKind({ BRIDGE_BACKEND: "screen" }, probes(true, true, true))).toThrow(
      /must be herdr, tmux, atur-terminal \(alias muxy\) or auto/,
    );
  });
});
