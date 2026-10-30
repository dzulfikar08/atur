#!/usr/bin/env python3
"""Reads the Android screen through uiautomator (CI: scripts/e2e-direct-android.sh).

  ui-assert.py dump                          print every text and content description on screen
  ui-assert.py wait <substring> [timeout]    succeed once a visible node's text or description has it
  ui-assert.py wait-line <text> [timeout]    same, for a node whose text (or one line or comma part of
                                             it) is exactly <text>: the output of a command, not the
                                             command that was typed
  ui-assert.py tap <substring> [timeout]     tap the centre of the first enabled node that has it,
                                             scrolling down a few times when it is below the screen
  ui-assert.py wait-frozen <substring> [t]   same as `wait`, with the workload's output paused for the dump
                                             (a screen that changes ten times a second dumps stale)
  ui-assert.py wait-regex <regex> [timeout]  same as `wait`, for a node whose text (or one line or
                                             comma part of it) matches the regular expression
  ui-assert.py absent <substring> [timeout]  succeed once no visible node has it
  ui-assert.py numbers                       print the numbered rows on screen (`row-N`, `live-N`)

The scrolling proof (scripts/e2e-direct-android.sh, phase 4) reads a terminal that holds `row-1`
to `row-2500` and below them one `live-N` row per 100 ms. A row's place in it is `N` for a `row`
and 2500 + N for a `live`; the commands share their state in $SCROLL_STATE:
  ui-assert.py scroll-up <swipes> <min-rows> <hold-s>
                                             swipe back <swipes> times (70% of the screen each),
                                             need at least <min-rows> rows between what was at
                                             the bottom and the oldest row seen, then need the
                                             visible rows to stay the same for <hold-s> seconds
                                             while the output goes on; prints the metrics
                                             `scroll_rows_reached` and `scroll_held_ms`
  ui-assert.py scroll-top <max-swipes>       keep swiping back until `row-1` is within reach
  ui-assert.py jump-to-bottom                tap the jump button, then the live rows are back, newer
                                             than before the swipes, the button is gone, and the
                                             view follows the output again
  ui-assert.py jump-prompt                   the workload also prints a `msg-N` row after every 100
                                             `row-N`, each marked as a prompt (OSC 133;A). From the
                                             bottom: tap "Previous prompt" and need a `msg-N` among
                                             the first rows at the top of the terminal, tap it again
                                             and need `msg-(N-1)` there, then tap "Next prompt" and
                                             need `msg-N` again; prints `jump_ok=1` when all hold

The timeout is in seconds (default 30). A failure prints what was on screen and exits 1, so the
job log says why. `ANDROID_SERIAL` selects the device as with adb.
"""

import json
import os
import re
import subprocess
import sys
import time
import xml.etree.ElementTree as ET

REMOTE = "/sdcard/ui.xml"
# The workload (lib/direct/e2e.ts) stops printing while this file exists, so the screen can idle:
# uiautomator cannot dump a UI that changes ten times a second. The server runs on this host.
PAUSE_FILE = "/tmp/atur-live-pause"
BOUNDS = re.compile(r"\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]")


def adb(*args: str) -> str:
    return subprocess.run(
        ["adb", *args], check=False, capture_output=True, text=True
    ).stdout


def pause_output() -> None:
    open(PAUSE_FILE, "w").close()
    time.sleep(2)


def resume_output() -> None:
    if os.path.exists(PAUSE_FILE):
        os.remove(PAUSE_FILE)


def frozen_nodes():
    """`nodes()` of a screen whose output is paused: a dump taken while rows scroll in at 10 Hz can
    be the tree of an earlier moment (uiautomator reads a cache that the flood of changes keeps
    invalidating), which made a view that had scrolled far back look as if it never moved."""
    pause_output()
    try:
        return nodes()
    finally:
        resume_output()


def nodes():
    """The nodes of the current screen: text, description, enabled, bounds."""
    # uiautomator waits for an idle UI and gives up while rows scroll in at 10 Hz: try again.
    for _ in range(12):
        adb("shell", "uiautomator", "dump", REMOTE)
        xml = adb("exec-out", "cat", REMOTE)
        try:
            root = ET.fromstring(xml)
            break
        except ET.ParseError:
            time.sleep(0.5)
    else:
        return []
    found = []
    for node in root.iter("node"):
        match = BOUNDS.fullmatch(node.get("bounds", ""))
        if not match:
            continue
        x1, y1, x2, y2 = (int(v) for v in match.groups())
        found.append(
            {
                "text": node.get("text", ""),
                "desc": node.get("content-desc", ""),
                "enabled": node.get("enabled", "true") == "true",
                "box": (x1, y1, x2, y2),
            }
        )
    return found


def values(node):
    return [v for v in (node["text"], node["desc"]) if v]


def has(node, needle: str) -> bool:
    return any(needle in v for v in values(node))


def is_line(node, wanted: str) -> bool:
    for value in values(node):
        parts = [value] + re.split(r"[\n,]", value)
        if any(part.strip() == wanted for part in parts):
            return True
    return False


def describe(found) -> str:
    seen = []
    for node in found:
        for value in values(node):
            if value not in seen:
                seen.append(value)
    shown = "\n".join(f"  - {v[:120]!r}" for v in seen[:60])
    return shown or "  (nothing readable on screen)"


def fail(message: str, found) -> None:
    print(f"FAIL: {message}\non screen:\n{describe(found)}", file=sys.stderr)
    sys.exit(1)


def wait(predicate, what: str, timeout: float, freeze: bool = False) -> None:
    deadline = time.time() + timeout
    while True:
        found = frozen_nodes() if freeze else nodes()
        if any(predicate(node) for node in found):
            print(f"ok: {what}")
            return
        if time.time() >= deadline:
            fail(f"{what} did not appear within {timeout:g} s", found)
        time.sleep(1)


def screen_size(found):
    return (
        max((n["box"][2] for n in found), default=1080),
        max((n["box"][3] for n in found), default=1920),
    )


def matches(node, pattern) -> bool:
    for value in values(node):
        parts = [value] + re.split(r"[\n,]", value)
        if any(pattern.search(part.strip()) for part in parts):
            return True
    return False


ROW = re.compile(r"^(row|live)-(\d+)$")
PRINTED_FIRST = 2500
TERMINAL_ROW = re.compile(r"^(row|live|msg)-(\d+)$")
# A prompt jump puts its row at the top edge; a row clipped by the edge, or the one above it, may
# be the first to read.
TOP_ROWS = 3
SCROLL_STATE = os.environ.get("SCROLL_STATE", "/tmp/ui-scroll-state.json")


def numbered(found):
    """The numbered rows (kind, N) wholly on screen, with their place in the terminal's history."""
    _, height = screen_size(found)
    seen = set()
    for node in found:
        x1, y1, x2, y2 = node["box"]
        if y2 <= y1 or y1 < 0 or y2 > height:
            continue
        for value in values(node):
            for part in [value] + re.split(r"[\n,]", value):
                match = ROW.match(part.strip())
                if match:
                    seen.add((match.group(1), int(match.group(2))))
    return seen


def place(row) -> int:
    kind, number = row
    return number if kind == "row" else PRINTED_FIRST + number


def newest_live(rows) -> int:
    return max((n for kind, n in rows if kind == "live"), default=0)


def top_numbered(found, count: int):
    """The first `count` numbered rows (kind, N) from the top of the terminal, kind being row, live
    or msg; only rows wholly on screen count, in the order they are laid out."""
    _, height = screen_size(found)
    seen = set()
    for node in found:
        x1, y1, x2, y2 = node["box"]
        if y2 <= y1 or y1 < 0 or y2 > height:
            continue
        for value in values(node):
            for part in [value] + re.split(r"[\n,]", value):
                match = TERMINAL_ROW.match(part.strip())
                if match:
                    seen.add((y1, match.group(1), int(match.group(2))))
    return [(kind, number) for _, kind, number in sorted(seen)[:count]]


def metric(name: str, value) -> None:
    print(f"ATUR_E2E METRIC {name}={value}")


def swipe_back(width: int, height: int) -> None:
    """One finger swipe over 70% of the screen, downwards: the pane scrolls back in time."""
    x = width // 2
    adb(
        "shell", "input", "swipe",
        str(x), str(int(height * 0.17)), str(x), str(int(height * 0.87)), "350",
    )


def scroll_up(swipes: int, min_rows: int, hold: float) -> None:
    found = frozen_nodes()
    width, height = screen_size(found)
    start = numbered(found)
    if not start:
        fail("no numbered row (row-N / live-N) is on screen before scrolling", found)
    bottom = max(place(r) for r in start)
    bottom_live = newest_live(start)
    print(f"ok: the bottom shows rows up to place {bottom} (live-{bottom_live})")
    if any(has(n, "Jump to bottom") for n in found):
        fail(
            "before any swipe the view is already away from the bottom (the jump button is shown): "
            "it did not follow the output",
            found,
        )
    print("ok: the view is at the bottom before the swipes (no jump button)")
    swiping = time.time()
    for _ in range(swipes):
        swipe_back(width, height)
        time.sleep(0.4)
    swiped = time.time()
    metric("swipes_ms", int((swiped - swiping) * 1000))
    time.sleep(2.5)
    # For the record: what a dump taken while the output runs says (it has been seen to show the
    # view as it was before the swipes).
    live_rows = numbered(nodes())
    if live_rows:
        metric("scroll_rows_reached_unfrozen_dump", bottom - min(place(r) for r in live_rows))
    found = frozen_nodes()
    seen = numbered(found)
    if not seen:
        fail(f"after {swipes} swipes no numbered row is on screen", found)
    lowest = min(place(r) for r in seen)
    metric("scroll_rows_reached_early", bottom - lowest)
    # A device short of CPU carries the touches out late: the view is read again until it stops
    # moving (two dumps agree), and how long that took is a metric of its own.
    while True:
        again = frozen_nodes()
        seen_again = numbered(again)
        if seen_again and min(place(r) for r in seen_again) == lowest:
            break
        if time.time() - swiped > 90:
            fail("scroll_settle: the view was still moving 90 s after the last swipe", again)
        if seen_again:
            found, seen, lowest = again, seen_again, min(place(r) for r in seen_again)
    metric("scroll_settle_ms", int((time.time() - swiped) * 1000))
    reached = bottom - lowest
    metric("scroll_rows_reached", reached)
    with open(SCROLL_STATE, "w") as state:
        json.dump({"bottom": bottom, "bottom_live": bottom_live}, state)
    if reached < min_rows:
        fail(
            f"scroll_rows_reached: {swipes} swipes went back only {reached} rows "
            f"(need {min_rows}); the lowest row on screen is place {lowest}",
            found,
        )
    print(f"ok: {swipes} swipes went back {reached} rows")
    # The output goes on (one line per 100 ms) while the reader stays where they are: look again
    # after `hold` seconds of it (the screen is only frozen for the dump itself).
    baseline = sorted(seen)
    started = time.time()
    time.sleep(hold)
    found = frozen_nodes()
    now = sorted(numbered(found))
    held = int((time.time() - started) * 1000)
    if now != baseline:
        metric("scroll_held_ms", 0)
        fail(
            f"scroll_held_ms: the view moved during {hold:g} s of live output\n"
            f"  before: {baseline}\n  after:  {now}",
            found,
        )
    metric("scroll_held_ms", int(hold * 1000))
    print(f"ok: the visible rows stayed put for {hold:g} s of live output (dump after {held} ms)")


def scroll_top(max_swipes: int) -> None:
    found = frozen_nodes()
    width, height = screen_size(found)
    lowest = None
    for count in range(1, max_swipes + 1):
        swipe_back(width, height)
        time.sleep(0.3)
        if count % 6 and count != max_swipes:
            continue
        time.sleep(1.5)
        found = frozen_nodes()
        seen = numbered(found)
        if seen:
            lowest = min(place(r) for r in seen)
            if lowest <= 20:
                metric("scroll_top_swipes", count)
                print(f"ok: the start of the scrollback (place {lowest}) is on screen")
                return
    fail(
        f"scroll_top: the start of the scrollback was not reached in {max_swipes} swipes "
        f"(lowest place seen: {lowest})",
        found,
    )


def jump_to_bottom() -> None:
    with open(SCROLL_STATE) as state:
        before = json.load(state)
    tap("Jump to bottom", 20, freeze=True)
    # Output goes on while the view settles at the bottom, then stops for the dump.
    time.sleep(3)
    pause_output()
    deadline = time.time() + 120
    while True:
        found = nodes()
        rows = numbered(found)
        gone = not any(has(n, "Jump to bottom") for n in found)
        if rows and newest_live(rows) > before["bottom_live"] and gone:
            break
        if time.time() >= deadline:
            fail(
                "jump to bottom: after the tap the button did not go and the live rows "
                f"newer than live-{before['bottom_live']} did not come back "
                f"(newest live row {newest_live(rows)}, button gone: {gone})",
                found,
            )
        time.sleep(1)
    print(f"ok: back at the bottom, newest row live-{newest_live(rows)}")
    # At the bottom the view follows the output again.
    first = newest_live(rows)
    resume_output()
    time.sleep(3)
    pause_output()
    found = nodes()
    resume_output()
    later = newest_live(numbered(found))
    if later <= first:
        fail(f"following: newest live row {later} after 3 s, was {first}", found)
    print(f"ok: the view follows the output (live-{first} -> live-{later})")


def press_prompt(label: str, wanted, previous) -> int:
    """Tap the button, then wait until a msg-N row is among the first rows at the top of the terminal
    (and, with `wanted`, until it is msg-<wanted>). Returns N."""
    tap(label, 30, freeze=True)
    deadline = time.time() + 60
    while True:
        found = frozen_nodes()
        top = top_numbered(found, TOP_ROWS)
        msgs = [n for kind, n in top if kind == "msg"]
        if msgs and (wanted is None or msgs[0] == wanted) and msgs[0] != previous:
            print(f"ok: after {label!r} msg-{msgs[0]} is at the top (first rows: {top})")
            return msgs[0]
        if time.time() >= deadline:
            fail(
                f"jump: after {label!r} no msg-"
                f"{'N' if wanted is None else wanted} row came to the top of the terminal "
                f"(first rows: {top})",
                found,
            )
        time.sleep(1)


def jump_prompt() -> None:
    print("ATUR_E2E STEP jump")
    first = press_prompt("Previous prompt", None, None)
    if first < 2:
        fail(f"jump: the newest prompt row is msg-{first}; the workload prints several", [])
    earlier = press_prompt("Previous prompt", first - 1, first)
    back = press_prompt("Next prompt", first, earlier)
    metric("jump_from", f"msg-{first}")
    metric("jump_ok", 1)
    print(f"ok: previous went to msg-{first}, then msg-{earlier}; next came back to msg-{back}")


def tap(needle: str, timeout: float, freeze: bool = False) -> None:
    deadline = time.time() + timeout
    scrolls = 0
    while True:
        found = frozen_nodes() if freeze else nodes()
        width, height = screen_size(found)
        target = next((n for n in found if n["enabled"] and has(n, needle)), None)
        if target:
            x1, y1, x2, y2 = target["box"]
            x, y = (x1 + x2) // 2, (y1 + y2) // 2
            if 0 <= y < height and 0 <= x < width:
                adb("shell", "input", "tap", str(x), str(y))
                print(f"ok: tapped {needle!r} at {x},{y}")
                return
            if scrolls < 4:
                scrolls += 1
                adb(
                    "shell", "input", "swipe",
                    str(width // 2), str(int(height * 0.75)),
                    str(width // 2), str(int(height * 0.25)), "300",
                )
                time.sleep(1)
                continue
        if time.time() >= deadline:
            fail(f"nothing to tap with {needle!r} within {timeout:g} s", found)
        time.sleep(1)


def main(argv) -> None:
    if len(argv) >= 2 and argv[1] == "dump":
        print(describe(nodes()))
        return
    if len(argv) >= 2 and argv[1] == "numbers":
        found = nodes()
        print(sorted(numbered(found), key=place))
        return
    if len(argv) >= 2 and argv[1] == "jump-to-bottom":
        jump_to_bottom()
        return
    if len(argv) >= 2 and argv[1] == "jump-prompt":
        jump_prompt()
        return
    if len(argv) >= 5 and argv[1] == "scroll-up":
        scroll_up(int(argv[2]), int(argv[3]), float(argv[4]))
        return
    if len(argv) >= 3 and argv[1] == "scroll-top":
        scroll_top(int(argv[2]))
        return
    commands = ("wait", "wait-frozen", "wait-line", "wait-regex", "absent", "tap")
    if len(argv) < 3 or argv[1] not in commands:
        print(__doc__, file=sys.stderr)
        sys.exit(2)
    command, needle = argv[1], argv[2]
    timeout = float(argv[3]) if len(argv) > 3 else 30.0
    if command == "wait":
        wait(lambda n: has(n, needle), f"{needle!r} on screen", timeout)
    elif command == "wait-frozen":
        wait(lambda n: has(n, needle), f"{needle!r} on screen", timeout, freeze=True)
    elif command == "wait-line":
        wait(lambda n: is_line(n, needle), f"line {needle!r} on screen", timeout)
    elif command == "wait-regex":
        pattern = re.compile(needle)
        wait(lambda n: matches(n, pattern), f"a line matching {needle!r} on screen", timeout)
    elif command == "absent":
        deadline = time.time() + timeout
        while True:
            found = nodes()
            if not any(has(n, needle) for n in found):
                print(f"ok: {needle!r} is not on screen")
                return
            if time.time() >= deadline:
                fail(f"{needle!r} still on screen after {timeout:g} s", found)
            time.sleep(1)
    else:
        tap(needle, timeout)


if __name__ == "__main__":
    main(sys.argv)
