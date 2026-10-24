/**
 * The agent-status hook scripts (apps/bridge/hooks) embedded as text, so the
 * single-file binary can write them out on demand (`atur-bridge hooks`).
 */
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import claudeCode from "../hooks/claude-code-status.sh" with { type: "text" };
import codex from "../hooks/codex-status.sh" with { type: "text" };
import tmuxStatus from "../hooks/tmux-status.sh" with { type: "text" };

export const HOOK_SCRIPTS: Record<string, string> = {
  "claude-code-status.sh": claudeCode,
  "codex-status.sh": codex,
  "tmux-status.sh": tmuxStatus,
};

/** Writes the scripts (mode 755) into `dir`, overwriting older copies; returns their paths. */
export async function installHooks(dir: string): Promise<string[]> {
  await mkdir(dir, { recursive: true });
  const paths: string[] = [];
  for (const [name, text] of Object.entries(HOOK_SCRIPTS)) {
    const path = join(dir, name);
    await writeFile(path, text);
    await chmod(path, 0o755);
    paths.push(path);
  }
  return paths;
}
