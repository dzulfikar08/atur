#!/usr/bin/env python3
"""A stand-in for `wayvnc` for the screen phase of the proof run (scripts/e2e-direct-android.sh, phase 6).

The isolated test server (scripts/start-test-server.sh with ATUR_TEST_SCREEN=1) starts it where it
would start wayvnc, with wayvnc's own arguments (`-r -L warning -f 60 -S <control> [-g] unix:<path>`,
or `... 127.0.0.1 <port>`), and relays the phone's RFB conversation to it. It is a real, minimal
RFB 3.8 server: security None, a ServerInit of 320x180 (the size of the H.264 fixture), SetPixelFormat,
SetEncodings, FramebufferUpdateRequest, key, pointer and cut-text messages.

What it shows depends on $FAKE_WAYVNC_DIR/mode, read again for every connection:
  h264 (default)  a client that offers H.264 (encoding 50) gets the access units of
                  scripts/fixtures/solid-cbp.h264 up to picture 14: red, green, then blue (0, 0, 254), as
                  H.264 rectangles; the first unit, and the first of a stream that restarts after a full
                  update request, flag a new context. Any other client gets ZRLE.
  zrle            H.264 is refused, as a wayvnc without GPU encoding does: ZRLE even for a client that
                  offers encoding 50.
ZRLE (or Raw, for a client that offers neither) is one solid colour, (200, 40, 200), over the desktop, so
a screenshot tells the two paths apart.

It appends one line per event to $FAKE_WAYVNC_DIR/input.log, each starting with the time in
milliseconds since the epoch:
  <ms> connect mode=<mode>
  <ms> encodings <list>
  <ms> first-update <h264|zrle|raw>
  <ms> pointer <x> <y> <button mask>
  <ms> key <down|up> <keysym>
  <ms> cut <text>
  <ms> full-update
The server that started it owns it: it exits when that server is gone.
"""
import os
import socket
import struct
import sys
import threading
import time
import zlib

WIDTH, HEIGHT = 320, 180
H264_LAST_UNIT = 14  # picture 14 is the last blue one
H264_RESTART_UNIT = 10  # a key frame, blue
ZRLE_COLOUR = (200, 40, 200)
ENC_RAW, ENC_ZRLE, ENC_H264 = 0, 16, 50

DIRECTORY = os.environ["FAKE_WAYVNC_DIR"]
FIXTURE = os.environ.get(
    "FAKE_WAYVNC_H264",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", "solid-cbp.h264"),
)
PARENT = os.getppid()
LOG_LOCK = threading.Lock()


def log(line):
    with LOG_LOCK:
        with open(os.path.join(DIRECTORY, "input.log"), "a", encoding="utf-8") as out:
            out.write("%d %s\n" % (time.time() * 1000, line))


def mode():
    try:
        with open(os.path.join(DIRECTORY, "mode"), encoding="utf-8") as source:
            return source.read().strip() or "h264"
    except OSError:
        return "h264"


def access_units(data):
    """Splits an Annex B stream into pictures: the parameter sets and SEI in front of a slice go with it."""
    starts = []
    at = data.find(b"\x00\x00\x01")
    while at != -1:
        starts.append(at - 1 if at > 0 and data[at - 1] == 0 else at)
        at = data.find(b"\x00\x00\x01", at + 3)
    units, pending = [], []
    for index, begin in enumerate(starts):
        end = starts[index + 1] if index + 1 < len(starts) else len(data)
        unit = data[begin:end]
        kind = unit[unit.index(b"\x01") + 1] & 0x1F
        pending.append(unit)
        if kind in (1, 5):
            units.append(b"".join(pending))
            pending = []
    return units


def read_exact(connection, count):
    data = b""
    while len(data) < count:
        chunk = connection.recv(count - len(data))
        if not chunk:
            raise EOFError
        data += chunk
    return data


def listen_on(argv):
    """The address wayvnc was given: `unix:<path>`, or a host and a port; options are skipped."""
    rest, index = [], 1
    while index < len(argv):
        if argv[index] in ("-L", "-f", "-S"):
            index += 2
        elif argv[index].startswith("-"):
            index += 1
        else:
            rest.append(argv[index])
            index += 1
    if rest and rest[-1].startswith("unix:"):
        listener = socket.socket(socket.AF_UNIX)
        listener.bind(rest[-1][len("unix:"):])
    elif len(rest) >= 2:
        listener = socket.socket(socket.AF_INET)
        listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        listener.bind((rest[-2], int(rest[-1])))
    else:
        sys.exit("fake wayvnc: no address in %r" % (argv[1:],))
    listener.listen(4)
    return listener


def listen(connection, state, guard):
    """Reads the client's messages: input is logged, update requests are counted."""
    try:
        while True:
            kind = read_exact(connection, 1)[0]
            if kind == 0:  # SetPixelFormat
                read_exact(connection, 19)
            elif kind == 2:  # SetEncodings
                head = read_exact(connection, 3)
                (count,) = struct.unpack(">H", head[1:3])
                encodings = struct.unpack(">%di" % count, read_exact(connection, 4 * count)) if count else ()
                with guard:
                    state["encodings"] = list(encodings)
                log("encodings " + ",".join(str(e) for e in encodings))
            elif kind == 3:  # FramebufferUpdateRequest
                body = read_exact(connection, 9)
                with guard:
                    state["requests"] += 1
                    if body[0] == 0:
                        state["fulls"] += 1
                if body[0] == 0:
                    log("full-update")
            elif kind == 4:  # KeyEvent
                body = read_exact(connection, 7)
                (keysym,) = struct.unpack(">I", body[3:7])
                log("key %s %d" % ("down" if body[0] else "up", keysym))
            elif kind == 5:  # PointerEvent
                body = read_exact(connection, 5)
                x, y = struct.unpack(">HH", body[1:5])
                log("pointer %d %d %d" % (x, y, body[0]))
            elif kind == 6:  # ClientCutText
                head = read_exact(connection, 7)
                (length,) = struct.unpack(">I", head[3:7])
                log("cut " + read_exact(connection, length).decode("latin-1"))
            elif kind == 150:  # EnableContinuousUpdates
                read_exact(connection, 9)
            else:
                log("unknown message %d" % kind)
                raise EOFError
    except (EOFError, OSError):
        with guard:
            state["done"] = True


def zrle_update(zstream):
    """One update with the whole desktop in one colour: every 64x64 tile is a solid tile (CPIXEL: B, G, R)."""
    red, green, blue = ZRLE_COLOUR
    tiles = ((WIDTH + 63) // 64) * ((HEIGHT + 63) // 64)
    raw = (b"\x01" + bytes([blue, green, red])) * tiles
    data = zstream.compress(raw) + zstream.flush(zlib.Z_SYNC_FLUSH)
    rect = struct.pack(">HHHHi", 0, 0, WIDTH, HEIGHT, ENC_ZRLE) + struct.pack(">I", len(data)) + data
    return struct.pack(">BxH", 0, 1) + rect


def raw_update():
    red, green, blue = ZRLE_COLOUR
    pixels = bytes([blue, green, red, 0]) * (WIDTH * HEIGHT)
    return struct.pack(">BxH", 0, 1) + struct.pack(">HHHHi", 0, 0, WIDTH, HEIGHT, ENC_RAW) + pixels


def h264_update(unit, flags):
    rect = struct.pack(">HHHHi", 0, 0, WIDTH, HEIGHT, ENC_H264) + struct.pack(">II", len(unit), flags) + unit
    return struct.pack(">BxH", 0, 1) + rect


def converse(connection, units):
    chosen = mode()
    log("connect mode=" + chosen)
    connection.sendall(b"RFB 003.008\n")
    if not read_exact(connection, 12).startswith(b"RFB 003."):
        return
    connection.sendall(bytes([1, 1]))  # one security type: none
    read_exact(connection, 1)
    connection.sendall(struct.pack(">I", 0))  # SecurityResult: ok
    read_exact(connection, 1)  # ClientInit
    name = b"fake-desktop"
    pixel_format = bytes([32, 24, 0, 1, 0, 255, 0, 255, 0, 255, 16, 8, 0, 0, 0, 0])
    connection.sendall(struct.pack(">HH", WIDTH, HEIGHT) + pixel_format + struct.pack(">I", len(name)) + name)
    state = {"requests": 0, "fulls": 0, "encodings": [], "done": False}
    guard = threading.Lock()
    threading.Thread(target=listen, args=(connection, state, guard), daemon=True).start()
    zstream = zlib.compressobj()
    served_requests = served_fulls = 0
    next_unit = 0
    sent_picture = False
    announced = False
    while True:
        time.sleep(0.02)
        with guard:
            if state["done"]:
                return
            requests, fulls = state["requests"], state["fulls"]
            encodings = list(state["encodings"])
        if requests <= served_requests:
            continue
        full = fulls > served_fulls
        if chosen == "h264" and ENC_H264 in encodings and units:
            kind = "h264"
            if full and sent_picture:
                # A full request after the stream began restarts it at a key frame, in a new context.
                update = h264_update(units[H264_RESTART_UNIT], 1)
                next_unit = H264_RESTART_UNIT + 1
            elif next_unit <= H264_LAST_UNIT:
                update = h264_update(units[next_unit], 1 if next_unit == 0 else 0)
                next_unit += 1
                time.sleep(0.04)
            else:
                continue
        elif ENC_ZRLE in encodings:
            kind = "zrle"
            if sent_picture and not full:
                continue  # nothing changed: an incremental request is held
            update = zrle_update(zstream)
        else:
            kind = "raw"
            if sent_picture and not full:
                continue
            update = raw_update()
        if not announced:
            log("first-update " + kind)
            announced = True
        sent_picture = True
        served_requests, served_fulls = requests, fulls
        connection.sendall(update)


def serve(connection, units):
    try:
        converse(connection, units)
    except (EOFError, OSError):
        pass
    finally:
        connection.close()


def watch():
    while os.getppid() == PARENT:
        time.sleep(0.2)
    os._exit(0)


def main():
    with open(FIXTURE, "rb") as source:
        units = access_units(source.read())
    if len(units) <= H264_LAST_UNIT:
        sys.exit("fake wayvnc: %s holds %d pictures, need %d" % (FIXTURE, len(units), H264_LAST_UNIT + 1))
    listener = listen_on(sys.argv)
    log("listening pictures=%d" % len(units))
    threading.Thread(target=watch, daemon=True).start()
    while True:
        connection, _ = listener.accept()
        threading.Thread(target=serve, args=(connection, units), daemon=True).start()


if __name__ == "__main__":
    main()
