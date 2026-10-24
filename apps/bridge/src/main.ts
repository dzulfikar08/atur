/**
 * atur-bridge entry point.
 *
 *   atur-bridge                 run the bridge (default)
 *   atur-bridge connect <token> save a machine token to ~/.config/atur/bridge.env
 *   atur-bridge hooks [dir]     write the agent hook scripts (default ~/.config/atur/hooks)
 *   atur-bridge --version
 *
 * See server.ts for what running does and docs/bridge.md for setup.
 */
import {
  connectNextSteps,
  envFilePath,
  hooksDir,
  loadEnvFile,
  UsageError,
  writeConnectToken,
} from "./cli";
import { installHooks } from "./hooks";
import { BRIDGE_VERSION } from "./version";

const USAGE = `atur-bridge ${BRIDGE_VERSION}

Usage:
  atur-bridge                  run the bridge
  atur-bridge connect <token>  save the machine token from app.diatur.com
  atur-bridge hooks [dir]      write the agent hook scripts to dir (default ~/.config/atur/hooks)
  atur-bridge --version`;

async function main(argv: string[]): Promise<void> {
  const [cmd, arg] = argv;
  switch (cmd) {
    case undefined:
    case "run": {
      // Settings saved by `connect` (and the service's own env file) apply to foreground runs too; real env wins.
      const path = envFilePath();
      const applied = await loadEnvFile(path);
      if (applied.length > 0) console.log(`loaded ${applied.join(", ")} from ${path}`);
      await import("./server");
      return;
    }
    case "--version":
    case "-v":
    case "version":
      console.log(BRIDGE_VERSION);
      return;
    case "--help":
    case "-h":
    case "help":
      console.log(USAGE);
      return;
    case "connect": {
      if (!arg) throw new UsageError("usage: atur-bridge connect <token>");
      const path = envFilePath();
      await writeConnectToken(arg, path);
      console.log(connectNextSteps(path));
      return;
    }
    case "hooks": {
      const paths = await installHooks(arg ?? hooksDir());
      console.log(`Wrote ${paths.length} scripts:\n${paths.map((p) => `  ${p}`).join("\n")}`);
      console.log(
        "Point your agent's hooks at these paths, see docs/bridge.md (Agent state with tmux).",
      );
      return;
    }
    default:
      throw new UsageError(`unknown command: ${cmd}\n\n${USAGE}`);
  }
}

main(process.argv.slice(2)).catch((e: unknown) => {
  if (e instanceof UsageError) {
    console.error(e.message);
    process.exit(2);
  }
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
