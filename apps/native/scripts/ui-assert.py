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
  ui-assert.py focus-matrix <cells> <max-swipes> <min-rows> <drift-px>
                                             phase 5: from the bottom of the pane, swipe back with
                                             each of the comma-separated <cells> (idle: nothing
                                             focused; tap: a tap on the text focuses the terminal
                                             and opens the soft keyboard; hwkb: that input still
                                             focused, no soft keyboard; composer: the prompt composer
                                             focused) and need <min-rows> rows back within
                                             <max-swipes>, the first swipe already moving the view,
                                             and the soft keyboard as it was; <drift-px> is the
                                             sideways travel of a swipe. Every cell runs; the exit
                                             status says whether all of them held
  ui-assert.py colour <r,g,b> <tol> <min-fraction> [timeout]
                                             phase 6: a screenshot (adb exec-out screencap, decoded
                                             here, nothing to install) in which at least <min-fraction>
                                             of the pixels are within <tol> of the colour on every
                                             channel; prints the box the colour fills and seen_at_ms
  ui-assert.py no-colour <r,g,b> <tol> [timeout]
                                             the colour is (nearly) gone from the screen
  ui-assert.py picture-tap --colour r,g,b ...  tap or long-press a place of the picture (found by its
                                             colour) and check which pointer event reaches the fake
                                             desktop's log (or that none does); see picture_tap
  ui-assert.py log-wait <file> <from-line> <regex> [timeout]
                                             a line of the fake desktop's log after <from-line> matches

The timeout is in seconds (default 30). A failure prints what was on screen and exits 1, so the
job log says why. `ANDROID_SERIAL` selects the device as with adb.
"""

import argparse
import json
import os
import re
import struct
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
                print(f"tapped_at_ms={int(time.time() * 1000)}")
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


# --- Phase 5: does a swipe scroll whatever has the focus? ---------------------------------------------
#
# A pane showing the scrollback is swiped back with nothing focused, with the terminal's input
# focused (a tap on the text: the soft keyboard opens), with that input focused and no soft keyboard
# (Back hides it, the focus stays: a hardware keyboard), and with the prompt composer focused. Each
# starts at the bottom of the pane and must go back at least <min-rows> rows; the first swipe must
# already move the view; and a swipe must not change whether the soft keyboard is up.

KEY_ROW_BUTTONS = ("Toggle keyboard", "More keys", "Fewer keys")
SHOT_DIR = os.environ.get("SHOT_DIR", "")
# A soft keyboard moves the key row (it rides above it) by far more than anything else does.
KEYBOARD_MIN_PX = 300


def shot(name: str) -> None:
    if not SHOT_DIR:
        return
    png = subprocess.run(
        ["adb", "exec-out", "screencap", "-p"], check=False, capture_output=True
    ).stdout
    with open(os.path.join(SHOT_DIR, f"{name}.png"), "wb") as out:
        out.write(png)


def key_row_top(found):
    """Top edge of one of the key row's buttons (a shell pane has the keyboard key, an agent pane's
    slim row the more-keys one). The key row rides above the soft keyboard, so how far it has moved
    up from where it rests says whether the keyboard is on screen."""
    node = next((n for n in found if any(has(n, label) for label in KEY_ROW_BUTTONS)), None)
    return node["box"][1] if node else None


def keyboard_up(found, rest) -> bool:
    top = key_row_top(found)
    return top is not None and rest - top >= KEYBOARD_MIN_PX


def terminal_rows(found):
    """The nodes of the terminal's numbered rows (row-N, live-N, msg-N), top to bottom."""
    rows = []
    for node in found:
        x1, y1, x2, y2 = node["box"]
        if y2 <= y1:
            continue
        for value in values(node):
            if any(TERMINAL_ROW.match(part.strip()) for part in [value] + re.split(r"[\n,]", value)):
                rows.append(node)
                break
    return sorted(rows, key=lambda n: n["box"][1])


def swipe_in(region, width: int, drift: int) -> None:
    """One finger swipe downwards over 70% of the terminal's rows (and `drift` px sideways, as a
    thumb does): the pane scrolls back in time. Never starts on the soft keyboard."""
    top, bottom = region
    span = bottom - top
    x = width // 2
    adb(
        "shell", "input", "swipe",
        str(x - drift // 2), str(top + int(span * 0.15)),
        str(x + drift // 2), str(top + int(span * 0.85)), "350",
    )


def to_bottom():
    """Tap the jump button until it is gone; the nodes of the pane at the bottom."""
    for _ in range(6):
        found = frozen_nodes()
        if not any(has(n, "Jump to bottom") for n in found):
            return found
        tap("Jump to bottom", 20, freeze=True)
        time.sleep(3)
    return frozen_nodes()


def settled():
    """The nodes and the lowest place on screen once the view has stopped moving (two dumps agree)."""
    time.sleep(2.5)
    found = frozen_nodes()
    deadline = time.time() + 90
    while True:
        lowest = min((place(r) for r in numbered(found)), default=None)
        again = frozen_nodes()
        lowest_again = min((place(r) for r in numbered(again)), default=None)
        if lowest_again == lowest or time.time() > deadline:
            return again, lowest_again
        found = again


def swipe_cell(name, expect_keyboard, rest, swipes_max, min_rows, drift):
    """One cell of the matrix: None when it holds, otherwise what went wrong."""
    found = to_bottom()
    seen = numbered(found)
    if not seen:
        return "no numbered row on screen at the bottom of the pane"
    # Rows between the newest row at the bottom of the view and the oldest one on screen after the
    # swipes (the view's own height counts; output going on meanwhile only lowers it).
    bottom_before = max(place(r) for r in seen)
    width, _ = screen_size(found)
    region = None
    rows = terminal_rows(found)
    if rows:
        region = (rows[0]["box"][1], rows[-1]["box"][3])
    if region is None:
        return "the terminal's rows are not on screen"
    before = keyboard_up(found, rest)
    if before != expect_keyboard:
        return f"the soft keyboard was {'up' if before else 'down'} before the swipes, not {'up' if expect_keyboard else 'down'}"
    shot(f"focus-{name}-before")
    done = 0
    reached = 0
    away_first = None
    while done < swipes_max and reached < min_rows:
        batch = 1 if done == 0 else 6
        for _ in range(batch):
            swipe_in(region, width, drift)
            done += 1
            time.sleep(0.4)
        found, lowest = settled()
        reached = bottom_before - lowest if lowest is not None else 0
        if away_first is None:
            # The jump-to-bottom button shows once the view has left the bottom: the swipe took.
            away_first = any(has(n, "Jump to bottom") for n in found)
    metric(f"focus_{name}_first_swipe_left_bottom", 1 if away_first else 0)
    metric(f"focus_{name}_reached", reached)
    metric(f"focus_{name}_swipes", done)
    after = keyboard_up(found, rest)
    metric(f"focus_{name}_keyboard", "up" if after else "down")
    shot(f"focus-{name}-after")
    if after != before:
        return f"the swipes {'opened' if after else 'closed'} the soft keyboard"
    if reached < min_rows:
        return (
            f"{done} swipes went back only {reached} rows from where the view started (need "
            f"{min_rows}): the pane did not scroll"
        )
    if not away_first:
        return "the first swipe did not move the view off the bottom"
    return None


def hide_keyboard(rest) -> bool:
    adb("shell", "input", "keyevent", "4")
    time.sleep(1.5)
    return not keyboard_up(frozen_nodes(), rest)


def focus_matrix(cells, swipes_max: int, min_rows: int, drift: int) -> None:
    print("ATUR_E2E STEP focus")
    adb("shell", "settings", "put", "secure", "show_ime_with_hard_keyboard", "1")
    found = to_bottom()
    rest = key_row_top(found)
    if rest is None:
        fail(f"none of the key row's buttons {KEY_ROW_BUTTONS} is on screen", found)
    print(f"ok: the key row rests at y={rest}")
    results = []

    def run(name, expect_keyboard):
        problem = swipe_cell(name, expect_keyboard, rest, swipes_max, min_rows, drift)
        results.append((name, problem))
        print(f"{'ok' if problem is None else 'FAIL'}: {name}" + (f": {problem}" if problem else ""))

    for cell in cells:
        if cell == "idle":
            run("idle", False)
        elif cell == "tap":
            rows = terminal_rows(to_bottom())
            if not rows:
                results.append(("tap", "no terminal row to tap"))
                continue
            x1, y1, x2, y2 = rows[len(rows) // 2]["box"]
            adb("shell", "input", "tap", str((x1 + x2) // 2), str((y1 + y2) // 2))
            time.sleep(2.5)
            if not keyboard_up(frozen_nodes(), rest):
                results.append(("tap", "a stationary tap on the terminal's text did not open the soft keyboard"))
                print(f"FAIL: tap: {results[-1][1]}")
                continue
            print("ok: a stationary tap on the terminal's text opened the soft keyboard")
            run("tap", True)
        elif cell == "hwkb":
            if not hide_keyboard(rest):
                results.append(("hwkb", "Back did not hide the soft keyboard"))
                print(f"FAIL: hwkb: {results[-1][1]}")
                continue
            run("hwkb", False)
        elif cell == "composer":
            to_bottom()
            tap("Prompt", 30, freeze=True)
            time.sleep(2.5)
            if not keyboard_up(frozen_nodes(), rest):
                results.append(("composer", "a tap on the prompt composer did not open the soft keyboard"))
                print(f"FAIL: composer: {results[-1][1]}")
                continue
            run("composer", True)
    if keyboard_up(frozen_nodes(), rest):
        hide_keyboard(rest)
    failed = [(name, problem) for name, problem in results if problem]
    metric("focus_cells", ",".join(f"{name}={'ok' if not problem else 'FAIL'}" for name, problem in results))
    if failed:
        fail("; ".join(f"{name}: {problem}" for name, problem in failed), [])
    print("ok: every cell scrolled")


# --- Phase 6: the computer's screen over Direct ----------------------------------------------------------
#
# The picture is read off a screenshot: the test server's fake desktop (scripts/fake-wayvnc.py) paints one
# solid colour per codec, so the box of that colour is where the picture is, and a tap at a fraction of that
# box must reach the desktop at the same fraction of its 320x180 pixels (the fake logs what it receives).

LOG_POINTER = re.compile(r"^\d+ pointer (\d+) (\d+) (\d+)$")
LOG_INPUT = re.compile(r"^\d+ (pointer|key|cut) ")


def parse_pair(text: str, kind=int):
    first, second = text.replace("x", ",").split(",")[:2]
    return kind(first), kind(second)


def parse_rgb(text: str):
    red, green, blue = (int(v) for v in text.split(","))
    return red, green, blue


def capture():
    """The screen as (width, height, RGBA bytes), or None: raw `screencap` is a header (width, height,
    format, and on newer Androids the colour space) and then the rows."""
    raw = subprocess.run(["adb", "exec-out", "screencap"], check=False, capture_output=True).stdout
    if len(raw) < 12:
        return None
    width, height = struct.unpack("<II", raw[:8])
    offset = len(raw) - width * height * 4
    if width == 0 or height == 0 or not 12 <= offset <= 64:
        return None
    return width, height, memoryview(raw)[offset:]


def find_colour(shot, rgb, tol: int, step: int = 4):
    """(fraction of the sampled pixels within tol of rgb, (x1, y1, x2, y2) of where most of them are).
    The box leaves out stray spots: a row or column counts when at least half as many pixels as the best
    one have the colour. The box is as exact as the sampling step."""
    width, height, pixels = shot
    stride = width * 4
    columns = [0] * len(range(0, width, step))
    rows = []
    hits = total = 0
    for y in range(0, height, step):
        row = bytes(pixels[y * stride:(y + 1) * stride])
        found = 0
        samples = zip(row[0::4 * step], row[1::4 * step], row[2::4 * step])
        for i, (red, green, blue) in enumerate(samples):
            if abs(red - rgb[0]) <= tol and abs(green - rgb[1]) <= tol and abs(blue - rgb[2]) <= tol:
                found += 1
                columns[i] += 1
        rows.append(found)
        hits += found
        total += len(columns)
    if hits == 0:
        return 0.0, None
    row_ids = [i for i, n in enumerate(rows) if n * 2 >= max(rows)]
    column_ids = [i for i, n in enumerate(columns) if n * 2 >= max(columns)]
    box = (column_ids[0] * step, row_ids[0] * step, column_ids[-1] * step, row_ids[-1] * step)
    return hits / total, box


def wait_colour(rgb, tol: int, minimum: float, timeout: float):
    deadline = time.time() + timeout
    best = 0.0
    while True:
        shot = capture()
        if shot:
            fraction, box = find_colour(shot, rgb, tol)
            best = max(best, fraction)
            if fraction >= minimum and box:
                return fraction, box
        if time.time() >= deadline:
            fail(
                f"colour {rgb} (within {tol}) never filled {minimum:.0%} of the screen in {timeout:g} s"
                f" (the most it filled was {best:.1%})",
                nodes(),
            )
        time.sleep(0.5)


def colour(rgb, tol: int, minimum: float, timeout: float) -> None:
    fraction, box = wait_colour(rgb, tol, minimum, timeout)
    print(f"ok: colour {rgb} fills {fraction:.0%} of the screen, in the box {box}")
    print(f"colour_box={','.join(str(v) for v in box)}")
    print(f"seen_at_ms={int(time.time() * 1000)}")


def no_colour(rgb, tol: int, timeout: float) -> None:
    deadline = time.time() + timeout
    while True:
        shot = capture()
        fraction = find_colour(shot, rgb, tol)[0] if shot else 1.0
        if fraction < 0.01:
            print(f"ok: colour {rgb} is not on the screen")
            return
        if time.time() >= deadline:
            fail(f"colour {rgb} still fills {fraction:.1%} of the screen after {timeout:g} s", nodes())
        time.sleep(0.5)


def log_lines(path: str):
    try:
        with open(path, encoding="utf-8") as source:
            return source.read().splitlines()
    except OSError:
        return []


def log_wait(path: str, start: int, pattern: str, timeout: float) -> None:
    wanted = re.compile(pattern)
    deadline = time.time() + timeout
    while True:
        lines = log_lines(path)[start:]
        hit = next((line for line in lines if wanted.search(line)), None)
        if hit:
            print(f"ok: the desktop's log has {hit!r}")
            return
        if time.time() >= deadline:
            fail(f"no line matching {pattern!r} in the desktop's log within {timeout:g} s; it has {lines[-12:]!r}", [])
        time.sleep(0.3)


def picture_tap(args) -> None:
    """Taps (or, with --hold, presses for that many ms) the place --at (fractions of the picture's width and
    height, found by its colour), and then needs the desktop's log to show a pointer event with button
    mask --mask within --tolerance framebuffer pixels of --expect-at (default: the same place), followed
    by one with the mask released. With --none nothing may reach the desktop in --timeout seconds."""
    rgb = parse_rgb(args.colour)
    fb_width, fb_height = parse_pair(args.fb)
    at = parse_pair(args.at, float)
    expect = parse_pair(args.expect_at, float) if args.expect_at else at
    _, (x1, y1, x2, y2) = wait_colour(rgb, args.tol, 0.05, 30)
    x = round(x1 + at[0] * (x2 - x1))
    y = round(y1 + at[1] * (y2 - y1))
    start = len(log_lines(args.log))
    if args.hold:
        adb("shell", "input", "swipe", str(x), str(y), str(x), str(y), str(args.hold))
    else:
        adb("shell", "input", "tap", str(x), str(y))
    print(f"tapped the picture at {x},{y} (box {x1},{y1},{x2},{y2})")
    deadline = time.time() + args.timeout
    if args.none:
        time.sleep(args.timeout)
        sent = [line for line in log_lines(args.log)[start:] if LOG_INPUT.match(line)]
        if sent:
            fail(f"the desktop got input although it should not have: {sent[:6]!r}", [])
        print("ok: nothing reached the desktop")
        return
    want_x, want_y = expect[0] * fb_width, expect[1] * fb_height
    while True:
        events = [m.groups() for m in map(LOG_POINTER.match, log_lines(args.log)[start:]) if m]
        for i, (px, py, mask) in enumerate(events):
            px, py, mask = int(px), int(py), int(mask)
            if mask == args.mask and abs(px - want_x) <= args.tolerance and abs(py - want_y) <= args.tolerance:
                if any(int(m) == 0 for _, _, m in events[i + 1:]):
                    print(
                        f"ok: pointer mask {mask} at ({px},{py}), expected ({want_x:.0f},{want_y:.0f}), then released"
                    )
                    print(f"pointer_error_px={max(abs(px - want_x), abs(py - want_y)):.1f}")
                    return
        if time.time() >= deadline:
            fail(
                f"no pointer press with mask {args.mask} within {args.tolerance} px of ({want_x:.0f},{want_y:.0f})"
                f" and a release after it in {args.timeout:g} s; the log has {events[-8:]!r}",
                [],
            )
        time.sleep(0.3)


def picture_tap_args(argv):
    parser = argparse.ArgumentParser(prog="ui-assert.py picture-tap")
    parser.add_argument("--colour", required=True, help="r,g,b of the picture")
    parser.add_argument("--tol", type=int, default=70)
    parser.add_argument("--fb", default="320x180", help="the desktop's size")
    parser.add_argument("--at", required=True, help="fx,fy: where in the picture to tap, as fractions")
    parser.add_argument("--expect-at", help="fx,fy: where the desktop should see it (default: --at)")
    parser.add_argument("--hold", type=int, default=0, help="press for this many ms (a long press)")
    parser.add_argument("--log", required=True, help="the fake desktop's input.log")
    parser.add_argument("--mask", type=int, default=1, help="button mask of the press: 1 left, 4 right")
    parser.add_argument("--tolerance", type=float, default=8, help="framebuffer pixels")
    parser.add_argument("--timeout", type=float, default=10)
    parser.add_argument("--none", action="store_true", help="nothing may reach the desktop")
    return parser.parse_args(argv)


def main(argv) -> None:
    if len(argv) >= 5 and argv[1] == "colour":
        colour(parse_rgb(argv[2]), int(argv[3]), float(argv[4]), float(argv[5]) if len(argv) > 5 else 30.0)
        return
    if len(argv) >= 4 and argv[1] == "no-colour":
        no_colour(parse_rgb(argv[2]), int(argv[3]), float(argv[4]) if len(argv) > 4 else 30.0)
        return
    if len(argv) >= 2 and argv[1] == "picture-tap":
        picture_tap(picture_tap_args(argv[2:]))
        return
    if len(argv) >= 5 and argv[1] == "log-wait":
        log_wait(argv[2], int(argv[3]), argv[4], float(argv[5]) if len(argv) > 5 else 30.0)
        return
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
    if len(argv) >= 6 and argv[1] == "focus-matrix":
        focus_matrix(argv[2].split(","), int(argv[3]), int(argv[4]), int(argv[5]))
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
