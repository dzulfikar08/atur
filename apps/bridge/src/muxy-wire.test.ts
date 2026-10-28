/**
 * Muxy wire codec against frames Muxy's own protocol tests pin
 * (`muxy-protocol/tests/fixtures/v2/*.bin`, tag v2.2.0): requests this client
 * builds must equal the bytes Muxy builds, replies and pushes must parse.
 */
import { describe, expect, test } from "bun:test";
import {
  CborReader,
  CborWriter,
  FrameParser,
  Kind,
  WireError,
  cursorGeneration,
  decodeCbor,
  frameAck,
  hello,
  keyFrame,
  parseHelloReply,
  parseReply,
  parseScreenFrame,
  parseSessionMetadata,
  parseTerminalEvent,
  pasteFrame,
  requests,
  uuidBytes,
  uuidText,
  type Cbor,
} from "./muxy-wire";

const bytes = (hex: string) => Uint8Array.from(Buffer.from(hex, "hex"));
const hex = (data: Uint8Array) => Buffer.from(data).toString("hex");

/** One fixture frame → its decoded message. */
function parse(fixture: string) {
  const [message, ...rest] = new FrameParser().push(bytes(fixture));
  expect(rest).toEqual([]);
  if (!message) throw new Error("no message");
  return message;
}

const UUID_1 = "00000000000000000000000000000001";
const UUID_2 = "00000000000000000000000000000002";

describe("requests equal the frames Muxy encodes", () => {
  test("hello", () => {
    expect(hex(hello())).toBe("0a00000002000000000001818102");
  });

  test("unit and simple requests", () => {
    expect(hex(requests.readActivity(1))).toBe("0d00000002000000000002820182181980");
    expect(hex(requests.attachWithoutResize(41, "1"))).toBe(
      "0f000000020000000000028218298218278101",
    );
  });

  test("create session (project, operation, directory, size)", () => {
    expect(hex(requests.createSession(1, UUID_1, UUID_2, "/tmp", 4, 1))).toBe(
      "3600000002000000000002820182058450000000000000000000000000000000015000000000000000000000000000000002442f746d70820401",
    );
  });

  test("history page and write input", () => {
    expect(hex(requests.historyPage(3, 1, 42, 500))).toBe(
      "12000000020000000000028203820d8301182a1901f4",
    );
    expect(hex(requests.writeInput(1, 1, new TextEncoder().encode("pwd\r")))).toBe(
      "1300000002000000000002820182181d8201447077640d",
    );
  });

  test("frame ack", () => {
    expect(hex(frameAck(1, 1))).toBe("0a00000002000000000003820101");
  });

  test("terminal input: a key press, a paste", () => {
    const key = { key: "a", modifiers: 0, text: "a", unshiftedCodepoint: 0x61 };
    // The fixture presses with action Repeat and modifiers 1/1; this client always presses.
    const pressed = parse(hex(keyFrame(1, key)));
    expect(pressed.kind).toBe(Kind.TerminalInput);
    expect(pressed.channel).toBe(1);
    expect(hex(keyFrame(1, key))).toBe(
      // header (length 24, version 2, channel 1, kind 23), then [[0, [[key, press, 0, 0, text, codepoint, false]]]]
      "18000000" +
        "0200" +
        "01000000" +
        "17" +
        "81820081" +
        "87" +
        "6161" +
        "820080" +
        "00" +
        "00" +
        "6161" +
        "1861" +
        "f4",
    );
    expect(hex(pasteFrame(1, new TextEncoder().encode("one\ntwo")))).toBe(
      "130000000200010000001781820181476f6e650a74776f",
    );
  });

  test("a project create carries the full descriptor", () => {
    const frame = requests.createProject(5, UUID_2, {
      id: UUID_1,
      directory: "/tmp/x",
      name: "x",
      color: "#e5484d",
    });
    const [message] = new FrameParser().push(new Uint8Array(frame));
    // Request [id, [3, [[operation, [0, [descriptor]]]]]]
    const fields = message?.fields as Cbor[];
    expect(fields[0]).toBe(5);
    const body = (fields[1] as Cbor[])[1] as Cbor[];
    expect((fields[1] as Cbor[])[0]).toBe(3);
    const intent = body[0] as Cbor[];
    expect(uuidText(intent[0] as Cbor)).toBe(UUID_2);
    const descriptor = ((intent[1] as Cbor[])[1] as Cbor[])[0] as Cbor[];
    expect(descriptor).toHaveLength(9);
    expect(uuidText(descriptor[0] as Cbor)).toBe(UUID_1);
    expect(descriptor[1]).toBe(false);
    expect(descriptor[3]).toBe("x");
    expect(descriptor[6]).toBe("#e5484d");
  });
});

describe("messages from the server", () => {
  test("hello reply: version, build and features", () => {
    const m = parse("1a0000000200000000000483810282836766697874757265158102018101");
    expect(m.kind).toBe(Kind.HelloReply);
    expect(parseHelloReply(m.fields as Cbor[])).toEqual({
      versions: [2],
      version: "fixture",
      features: [1],
    });
  });

  test("attached reply: channel, size, styled rows, title, directory", () => {
    const m = parse(
      "49000000020000000000068202820d818c8382081080808100018204015818010001044d757879040250b4f0010001000000000000000084000003f582f5f5644d757879442f746d704100f600",
    );
    const reply = parseReply((m.fields as Cbor[])[1] as Cbor);
    if (reply.type !== "attached") throw new Error(`got ${reply.type}`);
    expect(reply.attached).toMatchObject({
      channel: 1,
      size: { cols: 4, rows: 1 },
      title: "Muxy",
      directory: "/tmp",
      process: null,
      history: [],
      historyCursor: null,
      historyTotal: 0,
    });
    expect(reply.attached.rows).toEqual([
      {
        index: 0,
        runs: [
          {
            text: "Muxy",
            style: {
              fg: { Rgb: [80, 180, 240] },
              bg: { Indexed: 0 },
              bold: true,
              italic: false,
              underline: "None",
              underline_color: "Default",
              invisible: false,
              overline: false,
              inverse: false,
              strikethrough: false,
              faint: false,
            },
          },
        ],
      },
    ]);
  });

  test("pushed frame", () => {
    const m = parse(
      "310000000200010000000a8187820401f601f55818010001044d757879040250b4f0010001000000000000000084000003f582f5f5",
    );
    expect(m.kind).toBe(Kind.Frame);
    const frame = parseScreenFrame(m.fields as Cbor[]);
    expect(frame).toMatchObject({ size: { cols: 4, rows: 1 }, seq: 1, reset: true });
    expect(frame.rows[0]?.runs[0]?.text).toBe("Muxy");
  });

  test("session metadata leaves a trailing missing process as none", () => {
    const m = parse("1d000000020000000000148201826d46696e6973686564207461736b442f746d70");
    expect(m.kind).toBe(Kind.SessionMetadata);
    expect(parseSessionMetadata(m.fields as Cbor[])).toEqual({
      session: "1",
      meta: { title: "Finished task", directory: "/tmp", process: null },
    });
  });

  test("terminal metadata events: title, directory, process, history", () => {
    const events = [
      parse("100000000200010000000b81820081644d757879"),
      parse("0f0000000200010000000b8182058183f5f4f5"),
      parse("0e0000000200010000000b81820481191388"),
    ].map((m) => parseTerminalEvent(m.fields as Cbor[]));
    expect(events[0]).toEqual({ type: "title", title: "Muxy" });
    expect(events[1]).toBeNull(); // input modes: not tracked
    expect(events[2]).toEqual({ type: "history", total: 5000 });
  });

  test("invalidations, session end and restart", () => {
    const changed = parse("0a0000000200000000000f820102");
    expect(changed.kind).toBe(Kind.Changed);
    expect(changed.fields).toEqual([1, 2]);
    expect(parse("0c000000020000000000078201820000").kind).toBe(Kind.SessionEnded);
    expect(parse("080000000200000000000d80").kind).toBe(Kind.ServerRestarting);
  });
});

describe("FrameParser", () => {
  const frames = "0a0000000200000000000f8201020a0000000200000000000f820102";

  test("reassembles frames split at any byte", () => {
    const all = bytes(frames);
    const parser = new FrameParser();
    const seen: number[] = [];
    for (const byte of all) for (const m of parser.push(Uint8Array.of(byte))) seen.push(m.kind);
    expect(seen).toEqual([Kind.Changed, Kind.Changed]);
  });

  test("skips kinds from newer builds but not malformed frames", () => {
    // kind 16 was retired: ignored, the next frame is still read
    const unknown = "0a0000000200000000001082010208000000020000000000" + "0d80";
    const messages = new FrameParser().push(bytes(unknown));
    expect(messages.map((m) => m.kind)).toEqual([Kind.ServerRestarting]);
    expect(() => new FrameParser().push(bytes("0a0000000200000000004f820102"))).toThrow(WireError);
    expect(() => new FrameParser().push(bytes("0a0000000100000000000f820102"))).toThrow(
      /unsupported frame version/,
    );
    expect(() => new FrameParser().push(bytes("020000000200000000000f"))).toThrow(WireError);
  });
});

describe("CBOR", () => {
  test("integers use the shortest form up to u64", () => {
    const w = new CborWriter();
    for (const n of [0, 23, 24, 255, 256, 65535, 65536, 4294967295, 4294967296, 2n ** 64n - 1n])
      w.uint(n);
    expect(hex(w.finish())).toBe(
      "00" +
        "17" +
        "1818" +
        "18ff" +
        "190100" +
        "19ffff" +
        "1a00010000" +
        "1affffffff" +
        "1b0000000100000000" +
        "1bffffffffffffffff",
    );
    const r = new CborReader(w.finish());
    expect([...Array(10)].map(() => r.read())).toEqual([
      0,
      23,
      24,
      255,
      256,
      65535,
      65536,
      4294967295,
      4294967296,
      2n ** 64n - 1n,
    ]);
  });

  test("text, bytes, arrays, null and booleans round-trip", () => {
    const w = new CborWriter();
    w.array(5).str("héllo").bytes(Uint8Array.of(1, 2)).null().bool(true).array(0);
    expect(decodeCbor(w.finish())).toEqual(["héllo", Uint8Array.of(1, 2), null, true, []]);
  });

  test("a length beyond the payload and trailing bytes are rejected", () => {
    expect(() => decodeCbor(bytes("5affffffff00"))).toThrow(WireError);
    expect(() => decodeCbor(bytes("0000"))).toThrow(/trailing/);
    expect(() => decodeCbor(bytes("9f"))).toThrow(WireError); // indefinite length is not used
  });
});

describe("ids", () => {
  test("a uuid is 32 hex digits both ways", () => {
    const id = "e82c5ea846824a8db9a981719985f472";
    expect(uuidText(uuidBytes(id))).toBe(id);
    expect(() => uuidBytes("not-a-uuid")).toThrow(WireError);
  });

  test("a history cursor's generation is its high 32 bits", () => {
    expect(cursorGeneration(0xabcd00000007n)).toBe(0xabcd00000000n);
    expect(cursorGeneration(7)).toBe(0n);
  });

  test("session ids beyond 2^53 keep every digit", () => {
    const reply = parseReply([
      0,
      [[[uuidBytes(UUID_1), 14829814951068633905n, new TextEncoder().encode("/x")]]],
    ]);
    if (reply.type !== "sessions") throw new Error("not sessions");
    expect(reply.sessions[0]?.id).toBe("14829814951068633905");
  });
});
