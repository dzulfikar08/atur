/** Command-line helpers for the `atur-bridge` binary: the shared env file and `connect <token>`. */
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** Where `connect` stores the machine token and the service reads its settings. */
export function envFilePath(env: Record<string, string | undefined> = process.env): string {
  return env.ATUR_BRIDGE_ENV || join(homedir(), ".config", "atur", "bridge.env");
}

/** Where `hooks` writes the agent hook scripts. */
export function hooksDir(env: Record<string, string | undefined> = process.env): string {
  return env.ATUR_BRIDGE_HOOKS_DIR || join(homedir(), ".config", "atur", "hooks");
}

/** Parses a systemd-style `KEY=value` file (comments, blank lines, optional matching quotes). */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#") || line.startsWith(";")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      value.length >= 2 &&
      (value[0] === '"' || value[0] === "'") &&
      value.endsWith(value[0] ?? "")
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/** Sets `key` in env-file text, replacing an existing assignment in place and keeping every other line. */
export function upsertEnvKey(text: string, key: string, value: string): string {
  const lines = text === "" ? [] : text.replace(/\n$/, "").split("\n");
  const assignment = `${key}=${value}`;
  let replaced = false;
  const next: string[] = [];
  for (const line of lines) {
    if (new RegExp(`^\\s*${key}\\s*=`).test(line)) {
      if (!replaced) next.push(assignment);
      replaced = true;
    } else {
      next.push(line);
    }
  }
  if (!replaced) next.push(assignment);
  return next.join("\n") + "\n";
}

async function readIfExists(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw e;
  }
}

/** Fills process-style env with the file's keys that are not already set. Returns the keys it applied. */
export async function loadEnvFile(
  path: string,
  env: Record<string, string | undefined> = process.env,
): Promise<string[]> {
  const applied: string[] = [];
  for (const [k, v] of Object.entries(parseEnvFile(await readIfExists(path)))) {
    if (env[k] === undefined) {
      env[k] = v;
      applied.push(k);
    }
  }
  return applied;
}

export class UsageError extends Error {}

/** Writes ATUR_CONNECT_TOKEN into the env file (dir created, mode 600, other keys kept). */
export async function writeConnectToken(token: string, path: string): Promise<void> {
  if (!/^atb_\S+$/.test(token)) {
    throw new UsageError(
      "that does not look like a machine token (expected atb_...). Create one on the Machines page at app.diatur.com.",
    );
  }
  await mkdir(dirname(path), { recursive: true });
  const next = upsertEnvKey(await readIfExists(path), "ATUR_CONNECT_TOKEN", token);
  await writeFile(path, next, { mode: 0o600 });
  // writeFile's mode only applies to new files.
  await chmod(path, 0o600);
}

export function connectNextSteps(path: string): string {
  return [
    `Saved the machine token to ${path} (mode 600).`,
    "",
    "Next:",
    "  atur-bridge            run the bridge in this terminal",
    "  or install the service: curl -fsSL https://diatur.com/install-bridge.sh | sh",
    "",
    "Your machine shows up as online on the Machines page at app.diatur.com.",
  ].join("\n");
}
