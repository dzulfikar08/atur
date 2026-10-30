// Minimal read-only ZIP reader: just enough to list entries and pull out the
// package.json the client will load, so a publish whose archive disagrees with
// its metadata is refused before anyone downloads it.

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const MAX_ENTRIES = 20_000;
const MAX_MANIFEST = 1024 * 1024;

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  offset: number;
}

export function listZip(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip archive");
  const count = view.getUint16(eocd + 10, true);
  let cursor = view.getUint32(eocd + 16, true);
  if (count > MAX_ENTRIES) throw new Error("zip has too many entries");
  const entries: ZipEntry[] = [];
  const decoder = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > bytes.length || view.getUint32(cursor, true) !== CENTRAL) {
      throw new Error("corrupt zip directory");
    }
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const end = cursor + 46 + nameLength;
    if (end > bytes.length) throw new Error("corrupt zip directory");
    entries.push({
      method: view.getUint16(cursor + 10, true),
      compressedSize: view.getUint32(cursor + 20, true),
      size: view.getUint32(cursor + 24, true),
      offset: view.getUint32(cursor + 42, true),
      name: decoder.decode(bytes.subarray(cursor + 46, end)),
    });
    cursor = end + extraLength + commentLength;
  }
  return entries;
}

/** True for entry names that could escape the extraction directory. */
export function unsafeEntryName(name: string): boolean {
  return (
    name.startsWith("/") ||
    name.includes("\\") ||
    name.includes("\0") ||
    /^[A-Za-z]:/.test(name) ||
    name.split("/").includes("..")
  );
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as unknown as ArrayBuffer])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  const out = new Uint8Array(await new Response(stream).arrayBuffer());
  if (out.length > MAX_MANIFEST) throw new Error("package.json is too large");
  return out;
}

async function read(bytes: Uint8Array, entry: ZipEntry): Promise<Uint8Array> {
  if (entry.size > MAX_MANIFEST) throw new Error("package.json is too large");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (entry.offset + 30 > bytes.length || view.getUint32(entry.offset, true) !== LOCAL) {
    throw new Error("corrupt zip entry");
  }
  const start =
    entry.offset +
    30 +
    view.getUint16(entry.offset + 26, true) +
    view.getUint16(entry.offset + 28, true);
  const data = bytes.subarray(start, start + entry.compressedSize);
  if (data.length !== entry.compressedSize) throw new Error("corrupt zip entry");
  if (entry.method === 0) return data;
  if (entry.method === 8) return inflate(data);
  throw new Error("unsupported zip compression");
}

/**
 * The extension's package.json the way the client finds it: at the archive root,
 * or inside the one top-level directory that holds it.
 */
export async function readPackageJson(bytes: Uint8Array): Promise<unknown> {
  const entries = listZip(bytes);
  for (const entry of entries) {
    if (unsafeEntryName(entry.name)) throw new Error(`unsafe path in archive: ${entry.name}`);
  }
  const root = entries.find((entry) => entry.name === "package.json");
  let target = root;
  if (!target) {
    const nested = entries.filter((entry) => /^[^/]+\/package\.json$/.test(entry.name));
    if (nested.length !== 1) throw new Error("archive must contain one extension package");
    target = nested[0];
  }
  if (!target) throw new Error("archive must contain one extension package");
  return JSON.parse(new TextDecoder().decode(await read(bytes, target)));
}
