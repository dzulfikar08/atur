#!/usr/bin/env python3
"""Reads the Android screen through uiautomator (CI: scripts/e2e-direct-android.sh).

  ui-assert.py dump                          print every text and content description on screen
  ui-assert.py wait <substring> [timeout]    succeed once a visible node's text or description has it
  ui-assert.py wait-line <text> [timeout]    same, for a node whose text (or one line or comma part of
                                             it) is exactly <text>: the output of a command, not the
                                             command that was typed
  ui-assert.py tap <substring> [timeout]     tap the centre of the first enabled node that has it,
                                             scrolling down a few times when it is below the screen

The timeout is in seconds (default 30). A failure prints what was on screen and exits 1, so the
job log says why. `ANDROID_SERIAL` selects the device as with adb.
"""

import re
import subprocess
import sys
import time
import xml.etree.ElementTree as ET

REMOTE = "/sdcard/ui.xml"
BOUNDS = re.compile(r"\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]")


def adb(*args: str) -> str:
    return subprocess.run(
        ["adb", *args], check=False, capture_output=True, text=True
    ).stdout


def nodes():
    """The nodes of the current screen: text, description, enabled, bounds."""
    for _ in range(3):
        adb("shell", "uiautomator", "dump", REMOTE)
        xml = adb("exec-out", "cat", REMOTE)
        try:
            root = ET.fromstring(xml)
            break
        except ET.ParseError:
            time.sleep(1)
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


def wait(predicate, what: str, timeout: float) -> None:
    deadline = time.time() + timeout
    while True:
        found = nodes()
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


def tap(needle: str, timeout: float) -> None:
    deadline = time.time() + timeout
    scrolls = 0
    while True:
        found = nodes()
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
    if len(argv) < 3 or argv[1] not in ("wait", "wait-line", "tap"):
        print(__doc__, file=sys.stderr)
        sys.exit(2)
    command, needle = argv[1], argv[2]
    timeout = float(argv[3]) if len(argv) > 3 else 30.0
    if command == "wait":
        wait(lambda n: has(n, needle), f"{needle!r} on screen", timeout)
    elif command == "wait-line":
        wait(lambda n: is_line(n, needle), f"line {needle!r} on screen", timeout)
    else:
        tap(needle, timeout)


if __name__ == "__main__":
    main(sys.argv)
