/**
 * Backend choice: `BRIDGE_BACKEND=herdr|tmux|atur-terminal` forces one (`muxy` is
 * an alias of `atur-terminal`); otherwise herdr when its socket exists (existing
 * installs keep working untouched), else Atur Terminal when its server socket
 * exists (the pre-rename Muxy socket is found as a fallback, see
 * `muxySocketPath`), else tmux when the `tmux` binary is on PATH.
 */
import { existsSync } from "node:fs";
import { herdrSocketPath, type PaneBackend } from "./backend";
import { HerdrBackend } from "./backend-herdr";
import { MuxyBackend, muxySocketExists } from "./backend-muxy";
import { TmuxBackend } from "./backend-tmux";

export type BackendKind = PaneBackend["kind"];

export interface Probes {
  herdrSocketExists(): boolean;
  /** An Atur Terminal (or old Muxy) server socket exists. */
  muxySocketExists(): boolean;
  tmuxInstalled(): boolean;
}

export function chooseBackendKind(
  env: Record<string, string | undefined>,
  probes: Probes,
): BackendKind {
  const forced = (env.BRIDGE_BACKEND ?? "").trim().toLowerCase();
  if (forced === "herdr" || forced === "tmux" || forced === "atur-terminal") return forced;
  if (forced === "muxy") return "atur-terminal";
  if (forced !== "" && forced !== "auto") {
    throw new Error(
      `BRIDGE_BACKEND must be herdr, tmux, atur-terminal (alias muxy) or auto (got "${forced}")`,
    );
  }
  if (probes.herdrSocketExists()) return "herdr";
  if (probes.muxySocketExists()) return "atur-terminal";
  if (probes.tmuxInstalled()) return "tmux";
  throw new Error(
    "no terminal backend found: start herdr or Atur Terminal, install tmux, or set BRIDGE_BACKEND (see docs/bridge.md)",
  );
}

export function createBackend(env: Record<string, string | undefined> = process.env): PaneBackend {
  const kind = chooseBackendKind(env, {
    herdrSocketExists: () => existsSync(herdrSocketPath(env)),
    muxySocketExists: () => muxySocketExists(env),
    tmuxInstalled: () => Bun.which("tmux") !== null,
  });
  if (kind === "herdr") return new HerdrBackend();
  if (kind === "atur-terminal") return new MuxyBackend({ env });
  return new TmuxBackend({ socket: env.TMUX_SOCKET });
}
