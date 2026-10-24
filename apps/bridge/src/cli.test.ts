import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEnvFile, parseEnvFile, UsageError, upsertEnvKey, writeConnectToken } from "./cli";
import { HOOK_SCRIPTS, installHooks } from "./hooks";
import { BRIDGE_VERSION } from "./version";

const dirs: string[] = [];
async function tmp(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), "atur-cli-"));
  dirs.push(d);
  return d;
}
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

describe("env file", () => {
  test("upsert appends, replaces in place, and keeps other lines", () => {
    expect(upsertEnvKey("", "A", "1")).toBe("A=1\n");
    expect(upsertEnvKey("# hi\nBRIDGE_PORT=7601\n", "ATUR_CONNECT_TOKEN", "atb_x")).toBe(
      "# hi\nBRIDGE_PORT=7601\nATUR_CONNECT_TOKEN=atb_x\n",
    );
    expect(upsertEnvKey("X=1\nATUR_CONNECT_TOKEN=old\nY=2\n", "ATUR_CONNECT_TOKEN", "new")).toBe(
      "X=1\nATUR_CONNECT_TOKEN=new\nY=2\n",
    );
  });

  test("parse handles comments, quotes and blanks", () => {
    expect(parseEnvFile(`# c\n\nA=1\nB="two words"\nC='x'\nBAD\n`)).toEqual({
      A: "1",
      B: "two words",
      C: "x",
    });
  });

  test("loadEnvFile never overrides what is already set", async () => {
    const path = join(await tmp(), "bridge.env");
    await writeFile(path, "A=file\nB=file\n");
    const env: Record<string, string | undefined> = { A: "real" };
    expect(await loadEnvFile(path, env)).toEqual(["B"]);
    expect(env).toEqual({ A: "real", B: "file" });
    expect(await loadEnvFile(join(await tmp(), "missing.env"), env)).toEqual([]);
  });
});

describe("connect", () => {
  test("writes the token, mode 600, creating the directory and keeping other keys", async () => {
    const path = join(await tmp(), "nested", "atur", "bridge.env");
    await writeConnectToken("atb_abc123", path);
    expect(await readFile(path, "utf8")).toBe("ATUR_CONNECT_TOKEN=atb_abc123\n");
    expect((await stat(path)).mode & 0o777).toBe(0o600);

    await writeFile(path, "BRIDGE_PORT=7601\nATUR_CONNECT_TOKEN=atb_abc123\n", { mode: 0o644 });
    await writeConnectToken("atb_new", path);
    expect(await readFile(path, "utf8")).toBe("BRIDGE_PORT=7601\nATUR_CONNECT_TOKEN=atb_new\n");
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  test("rejects anything that is not a machine token", async () => {
    const path = join(await tmp(), "bridge.env");
    await expect(writeConnectToken("pk_live_nope", path)).rejects.toBeInstanceOf(UsageError);
    await expect(readFile(path)).rejects.toThrow();
  });
});

describe("hooks and version", () => {
  test("embedded hook scripts are written executable", async () => {
    const dir = join(await tmp(), "hooks");
    const paths = await installHooks(dir);
    expect(paths.length).toBe(Object.keys(HOOK_SCRIPTS).length);
    for (const p of paths) {
      expect((await stat(p)).mode & 0o111).not.toBe(0);
      expect(await readFile(p, "utf8")).toStartWith("#!/bin/sh");
    }
  });

  test("version comes from package.json", () => {
    expect(BRIDGE_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});
