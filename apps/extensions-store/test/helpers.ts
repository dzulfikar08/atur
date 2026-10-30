import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { toHex } from "../src/crypto";
import type { Env } from "../src/types";

/** A real SQLite database behind the D1 surface the store calls. */
export function fakeD1(): D1Database {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(
    readFileSync(new URL("../migrations/0001_init.sql", import.meta.url).pathname, "utf8"),
  );
  const statement = (sql: string, params: unknown[]) => {
    const run = () => {
      const result = sqlite.prepare(sql).run(...(params as never[]));
      return { success: true, results: [], meta: { changes: Number(result.changes) } };
    };
    const all = () => ({
      success: true,
      results: sqlite.prepare(sql).all(...(params as never[])),
      meta: {},
    });
    return {
      bind: (...next: unknown[]) => statement(sql, next),
      run: async () => run(),
      all: async () => all(),
      first: async () => all().results[0] ?? null,
      // Batches run inside one transaction, like D1.
      execute: () => (/^\s*(select|with)/i.test(sql) ? all() : run()),
    };
  };
  return {
    prepare: (sql: string) => statement(sql, []),
    batch: async (statements: { execute: () => unknown }[]) => {
      sqlite.exec("BEGIN");
      try {
        const results = statements.map((item) => item.execute());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  } as unknown as D1Database;
}

export function fakeR2(): R2Bucket & { objects: Map<string, Uint8Array> } {
  const objects = new Map<string, Uint8Array>();
  return {
    objects,
    put: async (key: string, value: Uint8Array) => {
      objects.set(key, new Uint8Array(value));
    },
    get: async (key: string) => {
      const bytes = objects.get(key);
      return bytes
        ? { body: new Blob([bytes as unknown as ArrayBuffer]).stream(), size: bytes.length }
        : null;
    },
    delete: async (keys: string | string[]) => {
      for (const key of [keys].flat()) objects.delete(key);
    },
  } as unknown as R2Bucket & { objects: Map<string, Uint8Array> };
}

export const TOKEN = "t".repeat(64);

export async function signer() {
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const raw = new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer);
  return {
    publicKey: btoa(String.fromCharCode(...raw)),
    sign: async (data: Uint8Array) =>
      btoa(
        String.fromCharCode(
          ...new Uint8Array(
            await crypto.subtle.sign({ name: "Ed25519" }, pair.privateKey, data as BufferSource),
          ),
        ),
      ),
  };
}

export async function testEnv() {
  const keys = await signer();
  const env: Env & { ARCHIVES: ReturnType<typeof fakeR2> } = {
    DB: fakeD1(),
    ARCHIVES: fakeR2(),
    SIGNING_PUBKEY: keys.publicKey,
    EXTENSIONS_PUBLISH_TOKEN: TOKEN,
  };
  return { env, keys };
}

const encoder = new TextEncoder();

/** Builds a zip. `deflate` compresses entries to exercise the inflate path. */
export async function zip(files: Record<string, string>, deflate = false): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = encoder.encode(content);
    let body = data;
    if (deflate) {
      const stream = new Blob([data as unknown as ArrayBuffer])
        .stream()
        .pipeThrough(new CompressionStream("deflate-raw"));
      body = new Uint8Array(await new Response(stream).arrayBuffer());
    }
    const method = deflate ? 8 : 0;
    const nameBytes = encoder.encode(name);
    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, method, true);
    lv.setUint32(18, body.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    const entry = new Uint8Array(46 + nameBytes.length);
    const ev = new DataView(entry.buffer);
    ev.setUint32(0, 0x02014b50, true);
    ev.setUint16(4, 20, true);
    ev.setUint16(6, 20, true);
    ev.setUint16(10, method, true);
    ev.setUint32(20, body.length, true);
    ev.setUint32(24, data.length, true);
    ev.setUint16(28, nameBytes.length, true);
    ev.setUint32(42, offset, true);
    entry.set(nameBytes, 46);
    central.push(entry);
    chunks.push(local, body);
    offset += local.length + body.length;
  }
  const directorySize = central.reduce((sum, item) => sum + item.length, 0);
  const end = new Uint8Array(22);
  const dv = new DataView(end.buffer);
  dv.setUint32(0, 0x06054b50, true);
  dv.setUint16(8, central.length, true);
  dv.setUint16(10, central.length, true);
  dv.setUint32(12, directorySize, true);
  dv.setUint32(16, offset, true);
  const all = [...chunks, ...central, end];
  const out = new Uint8Array(all.reduce((sum, item) => sum + item.length, 0));
  let cursor = 0;
  for (const item of all) {
    out.set(item, cursor);
    cursor += item.length;
  }
  return out;
}

export interface PackageOptions {
  name?: string;
  version?: string;
  publisher?: string;
  permissions?: string[];
  description?: string;
  categories?: string[];
  firstParty?: boolean;
  nested?: boolean;
  deflate?: boolean;
  zipName?: string;
  zipVersion?: string;
  zipPermissions?: string[];
}

export async function publishRequest(
  keys: Awaited<ReturnType<typeof signer>>,
  options: PackageOptions = {},
  extra: { token?: string | null; tamper?: (form: FormData) => void } = {},
): Promise<Request> {
  const name = options.name ?? "files";
  const version = options.version ?? "1.0.0";
  const permissions = options.permissions ?? ["files:read"];
  const manifest = JSON.stringify({
    name: options.zipName ?? name,
    version: options.zipVersion ?? version,
    "atur-terminal": { permissions: options.zipPermissions ?? permissions },
  });
  const files = options.nested
    ? { [`${name}/package.json`]: manifest, [`${name}/index.html`]: "<html></html>" }
    : { "package.json": manifest, "index.html": "<html></html>" };
  const archive = await zip(files, options.deflate);
  const icon = encoder.encode('<svg xmlns="http://www.w3.org/2000/svg"/>');
  const metadata = encoder.encode(
    JSON.stringify({
      name,
      version,
      sha256: toHex(await crypto.subtle.digest("SHA-256", archive as BufferSource)),
      size: archive.length,
      description: options.description ?? "Browse files",
      permissions,
      author: { name: "Atur", github: "dzulfikar08" },
      homepage: "https://diatur.com",
      repository: "https://github.com/dzulfikar08/atur-terminal-extensions",
      categories: options.categories ?? ["files"],
      icon: {
        field: "icon",
        filename: "icon.svg",
        sha256: toHex(await crypto.subtle.digest("SHA-256", icon as BufferSource)),
      },
      screenshots: [],
      publisher: options.publisher ?? "dzulfikar08/atur-terminal-extensions",
      firstParty: options.firstParty ?? true,
    }),
  );
  const form = new FormData();
  form.set(
    "artifact",
    new File([archive as unknown as ArrayBuffer], `${name}-${version}.zip`, {
      type: "application/zip",
    }),
  );
  form.set(
    "metadata",
    new File([metadata as unknown as ArrayBuffer], "metadata.json", { type: "application/json" }),
  );
  form.set("signature", await keys.sign(archive));
  form.set("metadataSignature", await keys.sign(metadata));
  form.set(
    "icon",
    new File([icon as unknown as ArrayBuffer], "icon.svg", { type: "image/svg+xml" }),
  );
  extra.tamper?.(form);
  const token = extra.token === undefined ? TOKEN : extra.token;
  return new Request("https://extensions.diatur.com/api/publish", {
    method: "POST",
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: form,
  });
}
