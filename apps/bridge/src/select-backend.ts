/**
 * Backend choice: `BRIDGE_BACKEND=herdr|tmux` forces one; otherwise herdr when
 * its socket exists (existing installs keep working untouched), else tmux when
 * the `tmux` binary is on PATH.
 */
import { existsSync } from "node:fs";
import { herdrSocketPath, type PaneBackend } from "./backend";
import { HerdrBackend } from "./backend-herdr";
import { TmuxBackend } from "./backend-tmux";

export type BackendKind = PaneBackend["kind"];

export interface Probes {
  herdrSocketExists(): boolean;
  tmuxInstalled(): boolean;
}

export function chooseBackendKind(
  env: Record<string, string | undefined>,
  probes: Probes,
): BackendKind {
  const forced = (env.BRIDGE_BACKEND ?? "").trim().toLowerCase();
  if (forced === "herdr" || forced === "tmux") return forced;
  if (forced !== "" && forced !== "auto") {
    throw new Error(`BRIDGE_BACKEND must be herdr, tmux or auto (got "${forced}")`);
  }
  if (probes.herdrSocketExists()) return "herdr";
  if (probes.tmuxInstalled()) return "tmux";
  throw new Error(
    "no terminal backend found: start herdr, install tmux, or set BRIDGE_BACKEND (see docs/bridge.md)",
  );
}

export function createBackend(env: Record<string, string | undefined> = process.env): PaneBackend {
  const kind = chooseBackendKind(env, {
    herdrSocketExists: () => existsSync(herdrSocketPath(env)),
    tmuxInstalled: () => Bun.which("tmux") !== null,
  });
  return kind === "herdr" ? new HerdrBackend() : new TmuxBackend({ socket: env.TMUX_SOCKET });
}
