/**
 * Muxy 2 wire protocol (protocol version 2), the part the bridge needs:
 * length-prefixed frames, a minimal CBOR codec, the request/reply shapes and
 * the postcard screen rows. Transcribed from `muxy-protocol` (tag v2.2.0,
 * MIT), whose `tests/fixtures/v2/*.bin` the unit tests replay.
 *
 * Frame: `u32 length` (everything after it) | `u16 version` | `u32 channel` |
 * `u8 kind` | payload, little-endian. Channel 0 is control (requests, replies,
 * pushed invalidations); every attached terminal gets its own channel.
 * Every payload but raw input is one CBOR array of the message's fields; a
 * derived enum is `[variant, [fields...]]`, a unit variant `[variant, []]`,
 * and trailing `None` fields are left out.
 */

export const PROTOCOL_VERSION = 2;
/** Features offered by the server's hello reply. Numbers are permanent. */
export const FEATURE_TERMINAL_INPUT = 1;
export const CONTROL = 0;
const HEADER_LEN = 11;
export const MAX_FRAME = 16 * 1024 * 1024;
/** Largest `Input` / `WriteInput` / paste payload the server accepts. */
export const MAX_INPUT = 1024 * 1024;
/** History pages hold 1 through 500 rows. */
export const MAX_HISTORY_ROWS = 500;

/** Message kinds (the frame header's last byte). */
export const Kind = {
  Hello: 1,
  Request: 2,
  FrameAck: 3,
  HelloReply: 4,
  VersionUnsupported: 5,
  Reply: 6,
  SessionEnded: 7,
  Fatal: 8,
  Input: 9,
  Frame: 10,
  Metadata: 11,
  Mouse: 12,
  ServerRestarting: 13,
  CellSize: 14,
  Changed: 15,
  GitChanged: 17,
  Progress: 18,
  SessionMetadata: 20,
  FilesChanged: 21,
  TerminalInput: 23,
} as const;

/** `Changed` topics: what to refetch. */
export const Topic = { Catalog: 0, Sessions: 1, Activity: 2, RemoteAccess: 3 } as const;

/** Request variants this client sends. */
const Req = {
  ListSessions: 1,
  ReadCatalog: 2,
  MutateProject: 3,
  CreateSession: 5,
  EndSession: 6,
  Detach: 8,
  Resize: 9,
  HistoryPage: 13,
  ReadActivity: 25,
  SyncSessionReferences: 21,
  WriteInput: 29,
  AttachWithoutResize: 39,
} as const;

/** Reply variants this client reads. */
export const Rep = {
  Sessions: 0,
  Catalog: 1,
  ProjectMutated: 2,
  SessionCreated: 4,
  SessionEnded: 5,
  Detached: 6,
  Resized: 7,
  Pong: 8,
  Error: 9,
  Attached: 13,
  HistoryPage: 14,
  SessionReferencesSynced: 21,
  Activity: 25,
  InputWritten: 29,
} as const;

/** `ErrorReply.code` numbers. */
export const ErrorCode = {
  UnknownProject: 0,
  CatalogChanged: 1,
  UnknownSession: 2,
  UnknownChannel: 3,
  BadSize: 4,
  BadPath: 5,
  SpawnFailed: 6,
  BadRequest: 7,
  SavedContentUnavailable: 8,
  StaleHistoryCursor: 9,
  HistoryUnavailable: 10,
  PersistenceFailed: 11,
  Unauthorized: 12,
  Unsupported: 13,
} as const;

// ── CBOR (the subset the protocol uses) ───────────────────────────────────

/** A u64 as the protocol sees it: a number while exact, a bigint beyond 2^53. */
export type U64 = number | bigint;

export class WireError extends Error {}

const text = new TextDecoder("utf-8");
const utf8 = new TextEncoder();

export class CborWriter {
  private buf = new Uint8Array(256);
  private len = 0;

  private reserve(n: number): void {
    if (this.len + n <= this.buf.length) return;
    const next = new Uint8Array(Math.max(this.buf.length * 2, this.len + n));
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
  }

  private head(major: number, value: U64): void {
    const m = major << 5;
    const v = BigInt(value);
    if (v < 0n) throw new WireError("negative length");
    if (v < 24n) {
      this.reserve(1);
      this.buf[this.len++] = m | Number(v);
    } else if (v < 0x100n) {
      this.reserve(2);
      this.buf[this.len++] = m | 24;
      this.buf[this.len++] = Number(v);
    } else if (v < 0x10000n) {
      this.reserve(3);
      this.buf[this.len++] = m | 25;
      this.buf[this.len++] = Number(v >> 8n);
      this.buf[this.len++] = Number(v & 0xffn);
    } else if (v < 0x100000000n) {
      this.reserve(5);
      this.buf[this.len++] = m | 26;
      for (let shift = 24n; shift >= 0n; shift -= 8n)
        this.buf[this.len++] = Number((v >> shift) & 0xffn);
    } else {
      if (v >= 1n << 64n) throw new WireError("integer exceeds u64");
      this.reserve(9);
      this.buf[this.len++] = m | 27;
      for (let shift = 56n; shift >= 0n; shift -= 8n)
        this.buf[this.len++] = Number((v >> shift) & 0xffn);
    }
  }

  uint(value: U64): this {
    this.head(0, value);
    return this;
  }

  bytes(value: Uint8Array): this {
    this.head(2, value.length);
    this.reserve(value.length);
    this.buf.set(value, this.len);
    this.len += value.length;
    return this;
  }

  str(value: string): this {
    const encoded = utf8.encode(value);
    this.head(3, encoded.length);
    this.reserve(encoded.length);
    this.buf.set(encoded, this.len);
    this.len += encoded.length;
    return this;
  }

  array(length: number): this {
    this.head(4, length);
    return this;
  }

  bool(value: boolean): this {
    this.reserve(1);
    this.buf[this.len++] = value ? 0xf5 : 0xf4;
    return this;
  }

  null(): this {
    this.reserve(1);
    this.buf[this.len++] = 0xf6;
    return this;
  }

  /** A derived enum variant: `[index, [fields...]]`; the caller then writes the fields. */
  variant(index: number, fields: number): this {
    return this.array(2).uint(index).array(fields);
  }

  /** The bytes written so far, as a view valid until the next write. */
  finish(): Uint8Array {
    return this.buf.subarray(0, this.len);
  }
}

export type Cbor =
  | U64
  | string
  | boolean
  | null
  | undefined
  | Uint8Array
  | Cbor[]
  | Map<Cbor, Cbor>;

function normalize(v: bigint): U64 {
  return v <= BigInt(Number.MAX_SAFE_INTEGER) && v >= BigInt(Number.MIN_SAFE_INTEGER)
    ? Number(v)
    : v;
}

export class CborReader {
  pos = 0;
  constructor(private readonly buf: Uint8Array) {}

  private need(n: number): void {
    if (this.pos + n > this.buf.length) throw new WireError("truncated CBOR");
  }

  private argument(info: number): bigint {
    if (info < 24) return BigInt(info);
    const size = info === 24 ? 1 : info === 25 ? 2 : info === 26 ? 4 : info === 27 ? 8 : 0;
    if (size === 0) throw new WireError("indefinite or reserved CBOR length");
    this.need(size);
    let v = 0n;
    for (let i = 0; i < size; i++) v = (v << 8n) | BigInt(this.buf[this.pos++] as number);
    return v;
  }

  private length(info: number): number {
    const n = this.argument(info);
    if (n > BigInt(this.buf.length)) throw new WireError("CBOR length exceeds the payload");
    return Number(n);
  }

  read(): Cbor {
    this.need(1);
    const initial = this.buf[this.pos++] as number;
    const major = initial >> 5;
    const info = initial & 31;
    switch (major) {
      case 0:
        return normalize(this.argument(info));
      case 1:
        return normalize(-1n - this.argument(info));
      case 2: {
        const n = this.length(info);
        this.need(n);
        const out = this.buf.subarray(this.pos, this.pos + n);
        this.pos += n;
        return out;
      }
      case 3: {
        const n = this.length(info);
        this.need(n);
        const out = text.decode(this.buf.subarray(this.pos, this.pos + n));
        this.pos += n;
        return out;
      }
      case 4: {
        const n = this.length(info);
        const out: Cbor[] = [];
        for (let i = 0; i < n; i++) out.push(this.read());
        return out;
      }
      case 5: {
        const n = this.length(info);
        const out = new Map<Cbor, Cbor>();
        for (let i = 0; i < n; i++) out.set(this.read(), this.read());
        return out;
      }
      case 6:
        this.argument(info);
        return this.read();
      default:
        return this.simple(info);
    }
  }

  private simple(info: number): Cbor {
    if (info === 20) return false;
    if (info === 21) return true;
    if (info === 22) return null;
    if (info === 23) return undefined;
    if (info === 25 || info === 26 || info === 27) {
      const size = info === 25 ? 2 : info === 26 ? 4 : 8;
      this.need(size);
      const view = new DataView(this.buf.buffer, this.buf.byteOffset + this.pos, size);
      this.pos += size;
      if (size === 4) return view.getFloat32(0);
      if (size === 8) return view.getFloat64(0);
      throw new WireError("half-precision floats are not used by the protocol");
    }
    throw new WireError(`unsupported CBOR simple value ${info}`);
  }

  get done(): boolean {
    return this.pos === this.buf.length;
  }
}

export function decodeCbor(payload: Uint8Array): Cbor {
  const reader = new CborReader(payload);
  const value = reader.read();
  if (!reader.done) throw new WireError("trailing bytes after the payload");
  return value;
}

// ── Typed access to decoded CBOR ──────────────────────────────────────────

function fail(what: string): never {
  throw new WireError(`unexpected ${what}`);
}

export function arr(v: Cbor, what: string): Cbor[] {
  return Array.isArray(v) ? v : fail(what);
}

export function num(v: Cbor, what: string): number {
  return typeof v === "number" ? v : fail(what);
}

/** u64 fields that stay opaque (cursors, ids): exact in either representation. */
export function u64(v: Cbor, what: string): U64 {
  return typeof v === "number" || typeof v === "bigint" ? v : fail(what);
}

export function str(v: Cbor, what: string): string {
  return typeof v === "string" ? v : fail(what);
}

export function flag(v: Cbor | undefined, what: string): boolean {
  return typeof v === "boolean" ? v : fail(what);
}

export function bin(v: Cbor, what: string): Uint8Array {
  return v instanceof Uint8Array ? v : fail(what);
}

/** `ServerPath` and other byte-string text. */
export function pathText(v: Cbor, what: string): string {
  return text.decode(bin(v, what));
}

/** A derived enum `[variant, [fields...]]`. */
export function variant(v: Cbor, what: string): { index: number; fields: Cbor[] } {
  const [index, fields] = arr(v, what);
  return { index: num(index as Cbor, what), fields: arr(fields as Cbor, what) };
}

/** `Option<T>` field: absent (a trailing `None` is left out) and null are both none. */
export function optional(v: Cbor | undefined): Cbor | null {
  return v === undefined || v === null ? null : v;
}

export function sessionIdText(v: Cbor): string {
  return String(u64(v, "session id"));
}

const HEX = "0123456789abcdef";
/** A project / operation uuid as Muxy prints it: 32 lowercase hex digits. */
export function uuidText(v: Cbor): string {
  const b = bin(v, "uuid");
  if (b.length !== 16) fail("uuid length");
  let out = "";
  for (const byte of b) out += HEX.charAt(byte >> 4) + HEX.charAt(byte & 15);
  return out;
}

export function uuidBytes(hex: string): Uint8Array {
  if (!/^[0-9a-f]{32}$/.test(hex)) throw new WireError(`not a Muxy uuid: ${hex}`);
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function randomUuid(): string {
  return crypto.randomUUID().replaceAll("-", "");
}

// ── Postcard screen rows ──────────────────────────────────────────────────
// Rows travel as a postcard blob inside a CBOR byte string: varint lengths,
// varint enum variants, one byte per bool, fields in declaration order. The
// layout is frozen (saved sessions store it too).

export type MuxyColor = "Default" | { Indexed: number } | { Rgb: [number, number, number] };

export interface MuxyStyle {
  fg: MuxyColor;
  bg: MuxyColor;
  bold: boolean;
  italic: boolean;
  /** None | Single | Double | Curly | Dotted | Dashed */
  underline: string;
  underline_color: MuxyColor;
  invisible: boolean;
  overline: boolean;
  inverse: boolean;
  strikethrough: boolean;
  faint: boolean;
}

export interface MuxyRun {
  text: string;
  style: Partial<MuxyStyle>;
}

export interface MuxyRow {
  index: number;
  runs: MuxyRun[];
}

const UNDERLINES = ["None", "Single", "Double", "Curly", "Dotted", "Dashed"];

class Postcard {
  private pos = 0;
  constructor(private readonly buf: Uint8Array) {}

  private byte(): number {
    if (this.pos >= this.buf.length) throw new WireError("truncated screen rows");
    return this.buf[this.pos++] as number;
  }

  varint(): number {
    let out = 0;
    for (let shift = 0; shift < 35; shift += 7) {
      const b = this.byte();
      out += (b & 0x7f) * 2 ** shift;
      if ((b & 0x80) === 0) return out;
    }
    throw new WireError("screen row varint is too long");
  }

  private bool(): boolean {
    const b = this.byte();
    if (b > 1) throw new WireError("bad boolean in screen rows");
    return b === 1;
  }

  private string(): string {
    const n = this.varint();
    if (this.pos + n > this.buf.length) throw new WireError("truncated screen rows");
    const out = text.decode(this.buf.subarray(this.pos, this.pos + n));
    this.pos += n;
    return out;
  }

  private color(): MuxyColor {
    switch (this.varint()) {
      case 0:
        return "Default";
      case 1:
        return { Indexed: this.byte() };
      case 2:
        return { Rgb: [this.byte(), this.byte(), this.byte()] };
      default:
        throw new WireError("unknown colour in screen rows");
    }
  }

  private style(): MuxyStyle {
    const fg = this.color();
    const bg = this.color();
    const bold = this.bool();
    const italic = this.bool();
    const underline = UNDERLINES[this.varint()] ?? fail("underline style");
    const underline_color = this.color();
    return {
      fg,
      bg,
      bold,
      italic,
      underline,
      underline_color,
      invisible: this.bool(),
      overline: this.bool(),
      inverse: this.bool(),
      strikethrough: this.bool(),
      faint: this.bool(),
    };
  }

  rows(): MuxyRow[] {
    const count = this.varint();
    const rows: MuxyRow[] = [];
    for (let i = 0; i < count; i++) {
      const index = this.varint();
      const runCount = this.varint();
      const runs: MuxyRun[] = [];
      for (let r = 0; r < runCount; r++) {
        const runText = this.string();
        this.varint(); // cell width
        runs.push({ text: runText, style: this.style() });
      }
      rows.push({ index, runs });
    }
    if (this.pos !== this.buf.length) throw new WireError("trailing bytes after screen rows");
    return rows;
  }
}

export function decodeRows(blob: Cbor, what: string): MuxyRow[] {
  return new Postcard(bin(blob, what)).rows();
}

// ── Frames ────────────────────────────────────────────────────────────────

export interface Message {
  channel: number;
  kind: number;
  /** Decoded CBOR field array; raw bytes for `Input`. */
  fields: Cbor[] | Uint8Array;
}

/** One frame: header + CBOR payload built by `body`. */
export function encodeFrame(channel: number, kind: number, payload: Uint8Array): Uint8Array {
  if (payload.length > MAX_FRAME - HEADER_LEN) throw new WireError("frame too large");
  const out = new Uint8Array(HEADER_LEN + payload.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, payload.length + HEADER_LEN - 4, true);
  view.setUint16(4, PROTOCOL_VERSION, true);
  view.setUint32(6, channel, true);
  out[10] = kind;
  out.set(payload, HEADER_LEN);
  return out;
}

/** Splits a byte stream into messages; frames from newer builds (unknown kinds) are skipped. */
export class FrameParser {
  private buf: Uint8Array = new Uint8Array(0);

  /** Appends `chunk` and returns every complete message now available. */
  push(chunk: Uint8Array): Message[] {
    if (this.buf.length === 0) this.buf = chunk;
    else {
      const joined = new Uint8Array(this.buf.length + chunk.length);
      joined.set(this.buf);
      joined.set(chunk, this.buf.length);
      this.buf = joined;
    }
    const out: Message[] = [];
    let offset = 0;
    while (this.buf.length - offset >= HEADER_LEN) {
      const view = new DataView(this.buf.buffer, this.buf.byteOffset + offset, HEADER_LEN);
      const length = view.getUint32(0, true);
      if (length < HEADER_LEN - 4 || length > MAX_FRAME - 4)
        throw new WireError("bad frame length");
      const total = length + 4;
      if (this.buf.length - offset < total) break;
      const version = view.getUint16(4, true);
      const channel = view.getUint32(6, true);
      const kind = view.getUint8(10);
      const payload = this.buf.subarray(offset + HEADER_LEN, offset + total);
      offset += total;
      if (version !== PROTOCOL_VERSION) throw new WireError(`unsupported frame version ${version}`);
      if (kind & 0xc0) throw new WireError(`frame flags set (${kind})`);
      if (kind === Kind.Input) {
        out.push({ channel, kind, fields: payload.slice() });
        continue;
      }
      if (!Object.values(Kind).includes(kind as never)) continue;
      out.push({ channel, kind, fields: arr(decodeCbor(payload), "payload") });
    }
    this.buf = offset === this.buf.length ? new Uint8Array(0) : this.buf.slice(offset);
    return out;
  }
}

// ── Messages the client sends ─────────────────────────────────────────────

function message(channel: number, kind: number, write: (w: CborWriter) => void): Uint8Array {
  const w = new CborWriter();
  write(w);
  return encodeFrame(channel, kind, w.finish());
}

export function hello(): Uint8Array {
  return message(CONTROL, Kind.Hello, (w) => w.array(1).array(1).uint(PROTOCOL_VERSION));
}

function request(id: number, write: (w: CborWriter) => void): Uint8Array {
  return message(CONTROL, Kind.Request, (w) => {
    w.array(2).uint(id);
    write(w);
  });
}

function sessionNumber(session: string): bigint {
  if (!/^[1-9][0-9]{0,19}$/.test(session)) throw new WireError(`invalid session id: ${session}`);
  return BigInt(session);
}

export const requests = {
  listSessions: (id: number) => request(id, (w) => w.variant(Req.ListSessions, 0)),
  readCatalog: (id: number, after: string | null, revision: U64 | null) =>
    request(id, (w) => {
      w.variant(Req.ReadCatalog, 2);
      if (after === null) w.null();
      else w.bytes(uuidBytes(after));
      if (revision === null) w.null();
      else w.uint(revision);
    }),
  readActivity: (id: number) => request(id, (w) => w.variant(Req.ReadActivity, 0)),
  syncSessionReferences: (id: number, sessions: readonly string[]) =>
    request(id, (w) => {
      w.variant(Req.SyncSessionReferences, 3).null().uint(0).array(sessions.length);
      for (const s of sessions) w.uint(sessionNumber(s));
    }),
  attachWithoutResize: (id: number, session: string) =>
    request(id, (w) => {
      w.variant(Req.AttachWithoutResize, 1).uint(sessionNumber(session));
    }),
  detach: (id: number, channel: number) =>
    request(id, (w) => {
      w.variant(Req.Detach, 1).uint(channel);
    }),
  resize: (id: number, channel: number, cols: number, rows: number) =>
    request(id, (w) => {
      w.variant(Req.Resize, 2).uint(channel).array(2).uint(cols).uint(rows);
    }),
  historyPage: (id: number, channel: number, before: U64, maxRows: number) =>
    request(id, (w) => {
      w.variant(Req.HistoryPage, 3).uint(channel).uint(before).uint(maxRows);
    }),
  writeInput: (id: number, channel: number, bytes: Uint8Array) =>
    request(id, (w) => {
      w.variant(Req.WriteInput, 2).uint(channel).bytes(bytes);
    }),
  endSession: (id: number, session: string) =>
    request(id, (w) => {
      w.variant(Req.EndSession, 1).uint(sessionNumber(session));
    }),
  createSession: (
    id: number,
    project: string,
    operation: string,
    directory: string,
    cols: number,
    rows: number,
  ) =>
    request(id, (w) => {
      w.variant(Req.CreateSession, 4)
        .bytes(uuidBytes(project))
        .bytes(uuidBytes(operation))
        .bytes(utf8.encode(directory))
        .array(2)
        .uint(cols)
        .uint(rows);
    }),
  /** `MutateProject(Create(ProjectDescriptor))`. */
  createProject: (
    id: number,
    operation: string,
    project: { id: string; directory: string; name: string; color: string },
  ) =>
    request(id, (w) => {
      w.variant(Req.MutateProject, 1).array(2).bytes(uuidBytes(operation));
      w.variant(0, 1);
      w.array(9)
        .bytes(uuidBytes(project.id))
        .bool(false)
        .bytes(utf8.encode(project.directory))
        .str(project.name)
        .null()
        .null()
        .str(project.color)
        .null()
        .null();
    }),
};

/** `FrameAck`: tells the server a pushed frame was consumed (it stops sending without acks). */
export function frameAck(channel: number, seq: U64): Uint8Array {
  return message(CONTROL, Kind.FrameAck, (w) => w.array(2).uint(channel).uint(seq));
}

export interface KeyEvent {
  /** Logical character or lowercase key name: enter, up, pageup, f1, ... */
  key: string;
  /** Bit set: 1 shift, 2 alt, 4 ctrl, 8 super. */
  modifiers: number;
  /** Text the key types (printable keys without ctrl/alt/super); empty otherwise. */
  text: string;
  /** The unshifted Unicode scalar of a character key, else 0. */
  unshiftedCodepoint: number;
}

/** `TerminalInput::Key`: the server encodes it with the terminal's own key modes. */
export function keyFrame(channel: number, event: KeyEvent): Uint8Array {
  return message(channel, Kind.TerminalInput, (w) => {
    w.array(1).variant(0, 1);
    w.array(7)
      .str(event.key)
      .variant(0, 0)
      .uint(event.modifiers)
      .uint(0)
      .str(event.text)
      .uint(event.unshiftedCodepoint)
      .bool(false);
  });
}

/** `TerminalInput::Paste`: the server adds bracketed-paste markers when the program enabled them. */
export function pasteFrame(channel: number, bytes: Uint8Array): Uint8Array {
  return message(channel, Kind.TerminalInput, (w) => {
    w.array(1).variant(1, 1).bytes(bytes);
  });
}

// ── Messages the client reads ─────────────────────────────────────────────

export interface ServerHello {
  versions: number[];
  /** Server release, e.g. "2.2.0". */
  version: string;
  features: number[];
}

export function parseHelloReply(fields: Cbor[]): ServerHello {
  const versions = arr(fields[0] as Cbor, "hello versions").map((v) => num(v, "version"));
  const server = arr(fields[1] as Cbor, "server info");
  const build = arr(server[0] as Cbor, "build info");
  const features = arr(fields[2] as Cbor, "features").map((v) => num(v, "feature"));
  return { versions, version: str(build[0] as Cbor, "server version"), features };
}

export interface ProtocolError {
  code: number;
  message: string;
}

export function parseError(fields: Cbor[]): ProtocolError {
  return {
    code: num(fields[0] as Cbor, "error code"),
    message: str(fields[1] as Cbor, "error message"),
  };
}

export interface SessionInfo {
  project: string;
  id: string;
  directory: string;
}

function sessionInfo(v: Cbor): SessionInfo {
  const f = arr(v, "session info");
  return {
    project: uuidText(f[0] as Cbor),
    id: sessionIdText(f[1] as Cbor),
    directory: pathText(f[2] as Cbor, "session directory"),
  };
}

export interface ProjectInfo {
  id: string;
  name: string;
  directory: string;
  home: boolean;
  /** `#rrggbb` */
  color: string;
}

export interface CatalogPage {
  revision: U64;
  projects: ProjectInfo[];
  /** Last project of this page when more follow. */
  next: string | null;
}

export interface Process {
  name: string;
  isShell: boolean;
}

export interface SessionMeta {
  title: string;
  /** The session's live working directory. */
  directory: string;
  process: Process | null;
}

function process(v: Cbor | undefined): Process | null {
  const f = optional(v);
  if (f === null) return null;
  const p = arr(f, "foreground process");
  return { name: str(p[0] as Cbor, "process name"), isShell: flag(p[1], "process is_shell") };
}

export function parseSessionMetadata(fields: Cbor[]): { session: string; meta: SessionMeta } {
  const meta = arr(fields[1] as Cbor, "session metadata");
  return {
    session: sessionIdText(fields[0] as Cbor),
    meta: {
      title: str(meta[0] as Cbor, "title"),
      directory: pathText(meta[1] as Cbor, "directory"),
      process: process(meta[2]),
    },
  };
}

export interface AgentActivity {
  session: string;
  /** `AgentProvider` number. */
  provider: number;
  /** `AgentState` number: 0 unknown, 1 idle, 2 working, 3 blocked. */
  state: number;
}

export interface ActivitySnapshot {
  revision: U64;
  agents: AgentActivity[];
}

export interface ScreenSnapshot {
  size: { cols: number; rows: number };
  rows: MuxyRow[];
}

export interface Attached extends ScreenSnapshot {
  channel: number;
  title: string;
  directory: string;
  process: Process | null;
  /** Newest scrollback rows above the screen, oldest first. */
  history: MuxyRow[];
  /** Cursor for the next older history page; null at the top. */
  historyCursor: U64 | null;
  historyTotal: number;
}

export interface HistoryPage {
  rows: MuxyRow[];
  next: U64 | null;
  /** History rows held now, whatever this page returned. */
  total: number;
  screen: ScreenSnapshot | null;
}

function size(v: Cbor): { cols: number; rows: number } {
  const f = arr(v, "size");
  return { cols: num(f[0] as Cbor, "cols"), rows: num(f[1] as Cbor, "rows") };
}

function screenOf(v: Cbor): ScreenSnapshot {
  // SavedScreen: graphics, size, rows, cursor, reason
  const f = arr(v, "saved screen");
  return { size: size(f[1] as Cbor), rows: decodeRows(f[2] as Cbor, "screen rows") };
}

export type Reply =
  | { type: "sessions"; sessions: SessionInfo[] }
  | { type: "catalog"; page: CatalogPage }
  | { type: "created"; session: SessionInfo }
  | { type: "attached"; attached: Attached }
  | { type: "history"; page: HistoryPage }
  | { type: "activity"; activity: ActivitySnapshot }
  | { type: "error"; error: ProtocolError }
  | { type: "ok"; variant: number };

export function parseReply(body: Cbor): Reply {
  const { index, fields } = variant(body, "reply");
  switch (index) {
    case Rep.Sessions:
      return {
        type: "sessions",
        sessions: arr(fields[0] as Cbor, "sessions").map(sessionInfo),
      };
    case Rep.Catalog: {
      const page = arr(fields[0] as Cbor, "catalog page");
      const projects = arr(page[3] as Cbor, "projects").map((p): ProjectInfo => {
        const f = arr(p, "project");
        return {
          id: uuidText(f[0] as Cbor),
          home: flag(f[1], "project home"),
          directory: pathText(f[2] as Cbor, "project directory"),
          name: str(f[3] as Cbor, "project name"),
          color: str(f[6] as Cbor, "project color"),
        };
      });
      const next = optional(page[4]);
      return {
        type: "catalog",
        page: {
          revision: u64(page[2] as Cbor, "catalog revision"),
          projects,
          next: next === null ? null : uuidText(next),
        },
      };
    }
    case Rep.SessionCreated:
      return { type: "created", session: sessionInfo(fields[0] as Cbor) };
    case Rep.Attached: {
      const s = arr(fields[0] as Cbor, "attach snapshot");
      const cursor = optional(s[10]);
      return {
        type: "attached",
        attached: {
          channel: num(s[2] as Cbor, "channel"),
          size: size(s[3] as Cbor),
          rows: decodeRows(s[4] as Cbor, "screen rows"),
          title: str(s[7] as Cbor, "title"),
          directory: pathText(s[8] as Cbor, "directory"),
          process: process(fields[1]),
          history: decodeRows(s[9] as Cbor, "history rows"),
          historyCursor: cursor === null ? null : u64(cursor, "history cursor"),
          historyTotal: Number(u64(s[11] as Cbor, "history total")),
        },
      };
    }
    case Rep.HistoryPage: {
      const p = arr(fields[0] as Cbor, "history page");
      const next = optional(p[2]);
      const screen = optional(p[4]);
      return {
        type: "history",
        page: {
          rows: decodeRows(p[1] as Cbor, "history rows"),
          next: next === null ? null : u64(next, "history cursor"),
          total: Number(u64(p[3] as Cbor, "history total")),
          screen: screen === null ? null : screenOf(screen),
        },
      };
    }
    case Rep.Activity: {
      const a = arr(fields[0] as Cbor, "activity");
      return {
        type: "activity",
        activity: {
          revision: u64(a[0] as Cbor, "activity revision"),
          agents: arr(a[1] as Cbor, "agents").map((x): AgentActivity => {
            const f = arr(x, "agent");
            return {
              session: sessionIdText(f[0] as Cbor),
              provider: num(f[2] as Cbor, "provider"),
              state: num(f[3] as Cbor, "agent state"),
            };
          }),
        },
      };
    }
    case Rep.Error:
      return { type: "error", error: parseError(arr(fields[0] as Cbor, "error")) };
    default:
      return { type: "ok", variant: index };
  }
}

/** A pushed `MetadataEvent` on a session channel: only title, directory and process matter here. */
export type TerminalEvent =
  | { type: "title"; title: string }
  | { type: "directory"; directory: string }
  | { type: "process"; process: Process }
  | { type: "history"; total: number };

export function parseTerminalEvent(fields: Cbor[]): TerminalEvent | null {
  const { index, fields: f } = variant(fields[0] as Cbor, "metadata event");
  if (index === 0) return { type: "title", title: str(f[0] as Cbor, "title") };
  if (index === 1) return { type: "directory", directory: pathText(f[0] as Cbor, "directory") };
  if (index === 2) {
    return {
      type: "process",
      process: { name: str(f[0] as Cbor, "process"), isShell: flag(f[1], "is_shell") },
    };
  }
  if (index === 4) return { type: "history", total: Number(u64(f[0] as Cbor, "history total")) };
  return null;
}

/** A pushed screen frame: changed rows only, unless `reset` (resize, clear), which repaints. */
export interface ScreenFrame {
  size: { cols: number; rows: number };
  seq: U64;
  reset: boolean;
  rows: MuxyRow[];
}

export function parseScreenFrame(fields: Cbor[]): ScreenFrame {
  const f = arr(fields[0] as Cbor, "frame");
  return {
    size: size(f[0] as Cbor),
    seq: u64(f[2] as Cbor, "frame seq"),
    reset: flag(f[3], "frame reset"),
    rows: decodeRows(f[4] as Cbor, "frame rows"),
  };
}

/**
 * The generation half of a history cursor. A cursor is `generation tag | row
 * index`; the tag changes whenever scrollback stops being append-only
 * (clear, resize, trimmed top, screen switch), so equal tags mean the rows
 * already read are still the oldest rows.
 */
export function cursorGeneration(cursor: U64): bigint {
  return BigInt(cursor) & ~0xffffffffn;
}
