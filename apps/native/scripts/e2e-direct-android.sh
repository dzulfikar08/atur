#!/bin/bash
# Host side of the direct-connection proof run on an Android emulator (CI: .github/workflows/native-direct.yml).
#
#   e2e-direct-android.sh <apk> <pairing-link> <server-port> <out-dir> <server-dir>
#
# Phase 1 installs the build made with EXPO_PUBLIC_ATUR_E2E=1, opens atur://direct-e2e?link64=..., and
# plays the host's part of the scenario in app/direct-e2e.tsx while it logs `ATUR_E2E` lines:
#   WAIT background  -> press Home, stay away past the app's 30 s grace, bring the app back
#   WAIT drop        -> reset the app's connection on the server side (REJECT with tcp-reset)
# Phase 2 is the app as a person meets it, on the same APK: its data is cleared, it opens signed out,
# "Use Direct without signing in" leads to the Direct area, a tapped pairing link (a second one, asked
# of the server in <server-dir>, see start-test-server.sh) opens the confirmation, Confirm pairs, a
# session is opened and a command typed into it shows its output on screen. Every check reads the UI
# through uiautomator (ui-assert.py), so nothing depends on a screenshot.
# Exit status is 0 only when phase 1 logs `ATUR_E2E RESULT PASS` and every check of phase 2 passes.
set -uo pipefail

APK="$1" LINK="$2" PORT="$3" OUT="$4" SERVER_DIR="$5"
PACKAGE=com.diatur.app
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mkdir -p "$OUT"
LOG="$OUT/logcat.txt"
PHASE2="$OUT/phase2.txt"
: > "$PHASE2"

adb wait-for-device
adb shell input keyevent KEYCODE_WAKEUP
adb shell wm dismiss-keyguard 2>/dev/null || true
adb install -r "$APK" >/dev/null || { echo "install failed"; exit 1; }
adb logcat -c
adb logcat -v time ReactNativeJS:V AndroidRuntime:E libc:F DEBUG:F '*:S' > "$LOG" &
LOGCAT=$!
trap 'kill $LOGCAT 2>/dev/null' EXIT

ENCODED="$(python3 -c 'import base64, sys; print(base64.urlsafe_b64encode(sys.argv[1].encode()).decode().rstrip("="))' "$LINK")"
adb shell am start -a android.intent.action.VIEW -p "$PACKAGE" -d "'atur://direct-e2e?link64=$ENCODED'" >/dev/null

seen() { grep -q "$1" "$LOG"; }
shot() { adb exec-out screencap -p > "$OUT/$1.png" 2>/dev/null || true; }

deadline=$((SECONDS + 600))
did_background=0 did_drop=0 shot_attach=0
while [ $SECONDS -lt $deadline ]; do
  if grep -q "ATUR_E2E RESULT" "$LOG"; then break; fi
  if [ $shot_attach = 0 ] && seen "ATUR_E2E STEP echo"; then shot attached; shot_attach=1; fi
  if [ $did_background = 0 ] && seen "ATUR_E2E WAIT background"; then
    did_background=1
    shot before-background
    echo "host: app to the background for 40 s"
    adb shell input keyevent KEYCODE_HOME
    sleep 40
    adb shell am start -a android.intent.action.MAIN -c android.intent.category.LAUNCHER -n "$PACKAGE/.MainActivity" >/dev/null
    echo "host: app back in front"
  fi
  if [ $did_drop = 0 ] && seen "ATUR_E2E WAIT drop"; then
    did_drop=1
    echo "host: resetting connections to port $PORT"
    sudo iptables -I INPUT -p tcp --dport "$PORT" -j REJECT --reject-with tcp-reset
    sleep 8
    sudo iptables -D INPUT -p tcp --dport "$PORT" -j REJECT --reject-with tcp-reset
    echo "host: connections allowed again"
  fi
  sleep 1
done
shot final
sleep 2

echo "--- ATUR_E2E lines"
grep -o "ATUR_E2E.*" "$LOG" | tee "$OUT/e2e-lines.txt"
grep -q "ATUR_E2E RESULT PASS" "$LOG"
PHASE1=$?
if [ $PHASE1 -ne 0 ]; then
  echo "::error::phase 1 (direct-e2e scenario) did not log ATUR_E2E RESULT PASS"
  grep -o "ATUR_E2E FAILURE.*" "$LOG" || true
fi

# --- Phase 2: signed out, from a clean install ---------------------------------------------------

ui() { python3 "$HERE/ui-assert.py" "$@"; }

# must <what> <command...>: runs the command; a failure names the check, keeps a screenshot and
# the screen's texts, and ends phase 2.
must() {
  local what="$1" status
  shift
  echo "phase 2: $what" | tee -a "$PHASE2"
  "$@" 2>&1 | tee -a "$PHASE2"
  status=${PIPESTATUS[0]}
  if [ "$status" -ne 0 ]; then
    echo "::error::phase 2 failed at: $what"
    echo "FAIL $what" >> "$PHASE2"
    shot phase2-failed
    ui dump >> "$PHASE2" 2>&1 || true
    return 1
  fi
}

cleared() { adb shell pm clear "$PACKAGE" | grep -q Success; }

launch() {
  adb shell am force-stop "$PACKAGE"
  adb shell am start -a android.intent.action.MAIN -c android.intent.category.LAUNCHER -n "$PACKAGE/.MainActivity" >/dev/null
}

open_link() {
  # The link has & and ? in it: single quotes inside the device shell. Only the first part is
  # rewritten: a link from an older server build may carry the legacy scheme.
  local link2
  link2="$(sed -E 's#^[a-z-]+://#atur://#' "$OUT/link2.txt")"
  adb shell am start -a android.intent.action.VIEW -p "$PACKAGE" -d "'$link2'" >/dev/null
}

# One key at a time: the soft keyboard's composing text doubles characters when `input text` injects
# a whole string faster than the app's text field settles.
type_command() {
  local command='echo tap-pair-ok' char i
  for ((i = 0; i < ${#command}; i++)); do
    char="${command:i:1}"
    [ "$char" = " " ] && char='%s'
    adb shell input text "$char" || return 1
    sleep 0.25
  done
  adb shell input keyevent 66
}

phase2() {
  must "ask the server for a second pairing link (10.0.2.2)" \
    "$HERE/start-test-server.sh" pair "$SERVER_DIR" 10.0.2.2 "$OUT/link2.txt" || return 1
  must "clear the app's data" cleared || return 1
  must "start the app signed out" launch || return 1
  must "the login screen offers Direct without an account" \
    ui wait "Use Direct without signing in" 120 || return 1
  shot phase2-login
  must "tap Use Direct without signing in" ui tap "Use Direct without signing in" || return 1
  must "the Direct area shows a pairing action" ui wait "Scan pairing code" 30 || return 1
  shot phase2-direct-area
  must "open the pairing link the way a tap on it does" open_link || return 1
  must "the confirmation names the computer" ui wait "10.0.2.2:$PORT" 60 || return 1
  shot phase2-confirm
  must "tap Confirm" ui tap "Confirm" || return 1
  must "the Direct area is connected to the computer" ui wait "Connected" 120 || return 1
  shot phase2-connected
  must "the computer's session is listed and opens" ui tap "Open session" 60 || return 1
  must "the terminal is live" ui wait "Toggle keyboard" 60 || return 1
  must "tap the keyboard key" ui tap "Toggle keyboard" || return 1
  sleep 2
  must "type a command" type_command || return 1
  must "the command's output is on screen" ui wait-line "tap-pair-ok" 30 || return 1
  shot phase2-terminal
}

phase2
PHASE2_STATUS=$?
if [ $PHASE2_STATUS -eq 0 ]; then
  echo "PASS phase 2" | tee -a "$PHASE2"
fi

kill $LOGCAT 2>/dev/null
[ $PHASE1 -eq 0 ] && [ $PHASE2_STATUS -eq 0 ]
