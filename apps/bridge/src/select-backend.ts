/**
 * Backend choice: `BRIDGE_BACKEND=herdr|tmux|muxy` forces one; otherwise herdr
 * when its socket exists (existing installs keep working untouched), else Muxy
 * when its server socket exists, else tmux when the `tmux` binary is on PATH.
 */
import { existsSync } from "node:fs";
import { herdrSocketPath, type PaneBackend } from "./backend";
import { HerdrBackend } from "./backend-herdr";
import { MuxyBackend, muxySocketPath } from "./backend-muxy";
import { TmuxBackend } from "./backend-tmux";

export type BackendKind = PaneBackend["kind"];

export interface Probes {
  herdrSocketExists(): boolean;
  muxySocketExists(): boolean;
  tmuxInstalled(): boolean;
}

export function chooseBackendKind(
  env: Record<string, string | undefined>,
  probes: Probes,
): BackendKind {
  const forced = (env.BRIDGE_BACKEND ?? "").trim().toLowerCase();
  if (forced === "herdr" || forced === "tmux" || forced === "muxy") return forced;
  if (forced !== "" && forced !== "auto") {
    throw new Error(`BRIDGE_BACKEND must be herdr, tmux, muxy or auto (got "${forced}")`);
  }
  if (probes.herdrSocketExists()) return "herdr";
  if (probes.muxySocketExists()) return "muxy";
  if (probes.tmuxInstalled()) return "tmux";
  throw new Error(
    "no terminal backend found: start herdr or Muxy, install tmux, or set BRIDGE_BACKEND (see docs/bridge.md)",
  );
}

export function createBackend(env: Record<string, string | undefined> = process.env): PaneBackend {
  const kind = chooseBackendKind(env, {
    herdrSocketExists: () => existsSync(herdrSocketPath(env)),
    muxySocketExists: () => existsSync(muxySocketPath(env)),
    tmuxInstalled: () => Bun.which("tmux") !== null,
  });
  if (kind === "herdr") return new HerdrBackend();
  if (kind === "muxy") return new MuxyBackend({ env });
  return new TmuxBackend({ socket: env.TMUX_SOCKET });
}
