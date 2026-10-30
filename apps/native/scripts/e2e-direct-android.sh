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
# Phase 3 is the same APK on a bad link: the app pairs again (a third link) and runs the lossy
# scenario (`&scenario=lossy`). Once connected it logs `WAIT shape`; the host then shapes the TLS port
# and the UDP port ($UDP_PORT, the server's ATUR_TERM_UDP_PORTS) on the loopback with tc netem (prio
# qdisc, u32 filters on dport and sport: 400 ms +- 200 ms delay and 5% loss each way, so about 800 ms
# round trip and 10% round-trip loss), and on each `WAIT outage` drops both ports for 10 s. The
# emulator reaches the host as 10.0.2.2, which arrives on the host's loopback. Everything is
# removed at the end, also on failure.
# Phase 4 is scrolling back in a pane that prints all the time, the way an agent on the main screen
# does: the app pairs again (a fourth link) and plays the scroll scenario (`&scenario=scroll`): a
# shell prints 2500 numbered rows (`row-N`, a distinctive `msg-N` row after every 100 of them, each
# marked as a prompt with OSC 133;A) and then one `live-N` row per 100 ms. The scenario proves
# at the data level that the whole scrollback comes in order through the pane screen's own
# TerminalScreen wiring, then opens the app's pane screen (`/direct-pane/<id>`) and logs `STEP ui`.
# The host then swipes back with `adb shell input swipe` (12 swipes of 70% of the screen), reads the
# rows off the screen with uiautomator (ui-assert.py) and needs: rows far back in the history on
# screen (`scroll_rows_reached`), the same rows on screen for 5 s of live output
# (`scroll_held_ms`), the start of the scrollback within reach of more swipes, and the jump-to-bottom
# button bringing the live rows back, after which the view follows the output again, and the
# prompt buttons: "Previous prompt" brings a `msg-N` row to the top, again `msg-(N-1)`, and
# "Next prompt" returns to `msg-N` (`STEP jump`, `jump_ok=1` in ui-assert.py).
# Phase 5 is whether a swipe scrolls the pane whatever has the focus (an agent pane: the prompt
# composer is there too). Four runs of the scroll scenario, each from a fresh app launch: (1) swipe
# back from the bottom with nothing focused, with the terminal focused (a tap on its text opens the
# soft keyboard: the swipes must not close or open it), with it focused and the soft keyboard hidden
# (a hardware keyboard), and with the composer focused; (2) the pane screen is open before the agent
# prints anything (`&late=1`) and the view sits at the bottom while 2500 rows go into the scrollback,
# then swipes with nothing focused and after a tap; (3) the pane screen's first two scrollback
# reads fail (`&failreads=2`), and nothing is focused; (4) a second client lays the pane out at
# 160x50 (`&wide=1`), as the desktop app would, and the swipes drift sideways as a thumb's do.
# Every cell needs >= 200 rows back, and the first swipe must already move the view.
# Exit status is 0 only when phase 1 logs `ATUR_E2E RESULT PASS`, every check of phase 2 passes,
# phase 3 logs `ATUR_E2E RESULT lossy PASS`, phase 4 logs `ATUR_E2E RESULT scroll PASS` and passes
# every UI check, and every run of phase 5 passes.
#
# ATUR_E2E_PHASES selects the phases to run (default 12345; the lean scroll workflow sets 45). A phase
# that is not selected counts as passed. ATUR_E2E_CPU_LOAD=<n> keeps <n> busy loops running on the
# device during phase 4, to see scrolling on a device that is short of CPU (a slow phone).
# ATUR_E2E_PHASE4_RUNS=<n> plays phase 4 <n> times.
set -uo pipefail

APK="$1" LINK="$2" PORT="$3" OUT="$4" SERVER_DIR="$5"
PACKAGE=com.diatur.app
UDP_PORT=60096
UDP_PORT_MASK=0xfff8   # 60096-60103: the server may hold several offers at once
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PHASES="${ATUR_E2E_PHASES:-12345}"
want() { [[ "$PHASES" == *"$1"* ]]; }
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
# Lifts the outage's drops (both ports, both directions).
unshape_cut() {
  while sudo iptables -D INPUT -p tcp --dport "$PORT" -j DROP 2>/dev/null; do :; done
  while sudo iptables -D INPUT -p tcp --sport "$PORT" -j DROP 2>/dev/null; do :; done
  while sudo iptables -D INPUT -p udp --dport "$UDP_PORT:$((UDP_PORT + 7))" -j DROP 2>/dev/null; do :; done
  while sudo iptables -D INPUT -p udp --sport "$UDP_PORT:$((UDP_PORT + 7))" -j DROP 2>/dev/null; do :; done
}
# Lifts everything phase 3 did to the host's network.
unshape() {
  sudo tc qdisc del dev lo root 2>/dev/null || true
  unshape_cut
}
trap 'kill $LOGCAT 2>/dev/null; unshape' EXIT

seen() { grep -q "$1" "$LOG"; }
shot() { adb exec-out screencap -p > "$OUT/$1.png" 2>/dev/null || true; }

PHASE1=0
if want 1; then
  ENCODED="$(python3 -c 'import base64, sys; print(base64.urlsafe_b64encode(sys.argv[1].encode()).decode().rstrip("="))' "$LINK")"
  adb shell am start -a android.intent.action.VIEW -p "$PACKAGE" -d "'atur://direct-e2e?link64=$ENCODED'" >/dev/null

  deadline=$((SECONDS + 600))
  did_background=0 did_drop=0 shot_attach=0
  while [ $SECONDS -lt $deadline ]; do
    if grep -qE "ATUR_E2E RESULT (PASS|FAIL)" "$LOG"; then break; fi
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
fi

# --- Phase 2: signed out, from a clean install ---------------------------------------------------

ui() { python3 "$HERE/ui-assert.py" "$@"; }

# must <what> <command...>: runs the command; a failure names the check, keeps a screenshot and
# the screen's texts, and ends the phase (phase 2 until phase 4 sets these).
PHASE_LABEL="phase 2" PHASE_FILE="$PHASE2" PHASE_SHOT=phase2
must() {
  local what="$1" status
  shift
  echo "$PHASE_LABEL: $what" | tee -a "$PHASE_FILE"
  "$@" 2>&1 | tee -a "$PHASE_FILE"
  status=${PIPESTATUS[0]}
  if [ "$status" -ne 0 ]; then
    echo "::error::$PHASE_LABEL failed at: $what"
    echo "FAIL $what" >> "$PHASE_FILE"
    shot "$PHASE_SHOT-failed"
    ui dump >> "$PHASE_FILE" 2>&1 || true
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
type_text() {
  local command="$1" char i
  for ((i = 0; i < ${#command}; i++)); do
    char="${command:i:1}"
    [ "$char" = " " ] && char='%s'
    adb shell input text "$char" || return 1
    sleep 0.25
  done
}

type_command() {
  type_text 'echo tap-pair-ok' || return 1
  adb shell input keyevent 66
}

# A hardware Ctrl+A (the keyboard's own chord, not the key row's Ctrl): the terminal must get ^A, so
# readline moves to the start of the line and the "e" and "c" typed after it make `echo` of what
# was typed before it. If the keystroke went to the text field instead, the line stays
# `hoecctrla-ok` and bash finds no such command.
ctrl_a_check() {
  type_text 'ho ctrla-ok' || return 1
  adb shell input keycombination KEYCODE_CTRL_LEFT KEYCODE_A || return 1
  sleep 0.5
  type_text 'ec' || return 1
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
  must "a hardware Ctrl+A reaches the terminal as ^A (cursor to line start)" ctrl_a_check || return 1
  must "the line ran as echo, so the cursor had moved to the start" ui wait-line "ctrla-ok" 30 || return 1
  shot phase2-ctrl-a
}

PHASE2_STATUS=0
if want 2; then
  phase2
  PHASE2_STATUS=$?
  if [ $PHASE2_STATUS -eq 0 ]; then
    echo "PASS phase 2" | tee -a "$PHASE2"
  fi
fi

# --- Phase 3: a lossy link, TLS against UDP ---------------------------------------------------------

LOSSY="$OUT/lossy-lines.txt"
: > "$LOSSY"

# Delay and loss only for the two ports of the proof; everything else on lo stays untouched.
shape() {
  sudo modprobe sch_netem sch_prio 2>/dev/null || true
  sudo tc qdisc add dev lo root handle 1: prio || return 1
  sudo tc qdisc add dev lo parent 1:3 handle 30: netem delay 400ms 200ms loss 5% || return 1
  local port dir mask
  for port in "$PORT" "$UDP_PORT"; do
    mask=0xffff
    [ "$port" = "$UDP_PORT" ] && mask="$UDP_PORT_MASK"
    for dir in dport sport; do
      sudo tc filter add dev lo protocol ip parent 1:0 prio 3 u32 \
        match ip "$dir" "$port" "$mask" flowid 1:3 || return 1
      sudo tc filter add dev lo protocol ipv6 parent 1:0 prio 4 u32 \
        match ip6 "$dir" "$port" "$mask" flowid 1:3 || return 1
    done
  done
}

cut_ports() {
  sudo iptables -I INPUT -p tcp --dport "$PORT" -j DROP
  sudo iptables -I INPUT -p tcp --sport "$PORT" -j DROP
  sudo iptables -I INPUT -p udp --dport "$UDP_PORT:$((UDP_PORT + 7))" -j DROP
  sudo iptables -I INPUT -p udp --sport "$UDP_PORT:$((UDP_PORT + 7))" -j DROP
}

phase3() {
  must "ask the server for a third pairing link (10.0.2.2)" \
    "$HERE/start-test-server.sh" pair "$SERVER_DIR" 10.0.2.2 "$OUT/link3.txt" || return 1
  local link64
  link64="$(python3 -c 'import base64, sys; print(base64.urlsafe_b64encode(open(sys.argv[1]).read().strip().encode()).decode().rstrip("="))' "$OUT/link3.txt")"
  adb shell am force-stop "$PACKAGE"
  adb shell am start -a android.intent.action.VIEW -p "$PACKAGE" -d "'atur://direct-e2e?link64=$link64&scenario=lossy'" >/dev/null
  local deadline3=$((SECONDS + 1500)) shaped=0 outages=0
  while [ $SECONDS -lt $deadline3 ]; do
    if grep -qE "ATUR_E2E RESULT lossy (PASS|FAIL)" "$LOG"; then break; fi
    if [ $shaped = 0 ] && seen "ATUR_E2E WAIT shape"; then
      shaped=1
      if shape; then
        echo "host: lo shaped for ports $PORT and $UDP_PORT (400 ms +- 200 ms, 5% loss each way)"
      else
        echo "::error::phase 3: could not shape the loopback with tc netem"
        sudo tc qdisc show dev lo || true
        return 1
      fi
    fi
    if [ "$(grep -c "ATUR_E2E WAIT outage" "$LOG")" -gt $outages ]; then
      outages=$((outages + 1))
      echo "host: dropping ports $PORT and $UDP_PORT for 10 s (outage $outages)"
      cut_ports
      sleep 10
      unshape_cut
      echo "host: outage over"
    fi
    sleep 0.5
  done
  # The scenario's own lines: from its last `STEP pair` on.
  grep -o "ATUR_E2E.*" "$LOG" | tac | sed '/ATUR_E2E STEP pair/q' | tac > "$LOSSY" || true
  grep -q "ATUR_E2E RESULT lossy PASS" "$LOG" || {
    echo "::error::phase 3 (lossy link) did not log ATUR_E2E RESULT lossy PASS"
    grep -o "ATUR_E2E FAILURE.*" "$LOG" | tail -1 || true
    return 1
  }
}

PHASE3_STATUS=0
if want 3; then
  phase3
  PHASE3_STATUS=$?
  unshape
  shot phase3-final
  echo "--- phase 3 lines"
  cat "$LOSSY"
fi

# --- Phase 4: scrolling back while the pane keeps printing --------------------------------------------

PHASE4="$OUT/phase4.txt"
: > "$PHASE4"
export SCROLL_STATE="$OUT/scroll-state.json"

# Lines of the log before this run of the scenario: only what comes after is its own.
P4_START=1
seen_now() { tail -n +"$P4_START" "$LOG" | grep -q "$1"; }

# Waits for a line of the scroll scenario in the log, up to <seconds>; a FAILURE line ends the wait.
wait_scroll_line() {
  local pattern="$1" until=$((SECONDS + $2))
  while [ $SECONDS -lt $until ]; do
    seen_now "$pattern" && return 0
    if seen_now "ATUR_E2E RESULT scroll FAIL"; then return 1; fi
    sleep 1
  done
  return 1
}

# Busy loops on the device, one per unit of ATUR_E2E_CPU_LOAD; stopped with the device shell's job.
LOAD_PIDS=()
start_load() {
  local i
  for ((i = 0; i < ${ATUR_E2E_CPU_LOAD:-0}; i++)); do
    adb shell 'while :; do :; done' &
    LOAD_PIDS+=($!)
  done
  [ ${#LOAD_PIDS[@]} -gt 0 ] && echo "host: ${#LOAD_PIDS[@]} busy loops on the device"
  return 0
}
stop_load() {
  [ ${#LOAD_PIDS[@]} -gt 0 ] && kill "${LOAD_PIDS[@]}" 2>/dev/null
  adb shell 'pkill -f "while :; do :; done"' 2>/dev/null
  return 0
}

phase4() {
  PHASE_LABEL="phase 4" PHASE_FILE="$PHASE4" PHASE_SHOT=phase4
  must "ask the server for a fourth pairing link (10.0.2.2)" \
    "$HERE/start-test-server.sh" pair "$SERVER_DIR" 10.0.2.2 "$OUT/link4.txt" || return 1
  local link64
  link64="$(python3 -c 'import base64, sys; print(base64.urlsafe_b64encode(open(sys.argv[1]).read().strip().encode()).decode().rstrip("="))' "$OUT/link4.txt")"
  adb shell am force-stop "$PACKAGE"
  P4_START=$(($(wc -l < "$LOG") + 1))
  adb shell am start -a android.intent.action.VIEW -p "$PACKAGE" -d "'atur://direct-e2e?link64=$link64&scenario=scroll'" >/dev/null
  must "the scenario puts the workload's whole scrollback in order through the pane code" \
    wait_scroll_line "ATUR_E2E STEP ui" 420 || {
      tail -n +"$P4_START" "$LOG" | grep -o "ATUR_E2E FAILURE.*" | tail -1 | tee -a "$PHASE4" || true
      return 1
    }
  # While rows scroll in at 10 Hz the UI never idles and uiautomator cannot dump it: the bottom is
  # proven by the screenshot and the scenario's data checks; the frozen, scrolled-up view is dumped.
  sleep 5
  start_load
  shot phase4-bottom
  must "12 swipes of 70% of the screen go back at least 400 rows, and the rows then stay put for 5 s of live output" \
    ui scroll-up 12 400 5 || return 1
  shot phase4-scrolled-up
  must "the jump-to-bottom button is on screen while scrolled up" ui wait-frozen "Jump to bottom" 20 || return 1
  must "more swipes reach the first row of the scrollback" ui scroll-top 200 || return 1
  shot phase4-top
  must "the jump-to-bottom button brings the live rows back and the view follows the output" \
    ui jump-to-bottom || return 1
  shot phase4-jumped
  must "previous prompt, previous again and next prompt move between the msg-N rows, each at the top of the view" \
    ui jump-prompt || return 1
  shot phase4-prompts
  tail -n +"$P4_START" "$LOG" | grep -o "ATUR_E2E RESULT scroll.*" | tail -1 | tee -a "$PHASE4"
}

PHASE4_STATUS=0
if want 4; then
  # ATUR_E2E_PHASE4_RUNS plays the phase more than once on the same build (how steady is it?).
  for ((run = 1; run <= ${ATUR_E2E_PHASE4_RUNS:-1}; run++)); do
    echo "=== phase 4, run $run" | tee -a "$PHASE4"
    phase4
    status=$?
    stop_load
    if [ $status -eq 0 ]; then
      echo "PASS phase 4 (run $run)" | tee -a "$PHASE4"
    else
      PHASE4_STATUS=1
    fi
  done
  # The scenario's own lines: from its last `STEP pair` on, with the host's UI metrics.
  { grep -o "ATUR_E2E.*" "$LOG" | tac | sed '/ATUR_E2E STEP pair/q' | tac; grep -h "^ATUR_E2E METRIC" "$PHASE4"; } > "$OUT/scroll-lines.txt" || true
  echo "--- phase 4 lines"
  cat "$OUT/scroll-lines.txt"
fi

# --- Phase 5: a swipe scrolls whatever has the focus -----------------------------------------------------

PHASE5="$OUT/phase5.txt"
: > "$PHASE5"
FOCUS_LINES="$OUT/focus-lines.txt"
: > "$FOCUS_LINES"

# phase5_run <label> <scenario query> <step to wait for> <cells> <drift px> [agent]: plays the scroll
# scenario with the given options (an app launch of its own, a pairing link of its own), then runs
# the host's focus matrix (ui-assert.py focus-matrix) on the pane screen it opened.
phase5_run() {
  local label="$1" query="$2" ready="$3" cells="$4" drift="$5" agent="${6:-}" link64
  PHASE_LABEL="phase 5 ($label)" PHASE_FILE="$PHASE5" PHASE_SHOT="phase5-$label"
  must "ask the server for a pairing link (10.0.2.2)" \
    "$HERE/start-test-server.sh" pair "$SERVER_DIR" 10.0.2.2 "$OUT/link5-$label.txt" || return 1
  link64="$(python3 -c 'import base64, sys; print(base64.urlsafe_b64encode(open(sys.argv[1]).read().strip().encode()).decode().rstrip("="))' "$OUT/link5-$label.txt")"
  adb shell am force-stop "$PACKAGE"
  P4_START=$(($(wc -l < "$LOG") + 1))
  adb shell am start -a android.intent.action.VIEW -p "$PACKAGE" -d "'atur://direct-e2e?link64=$link64&scenario=scroll$query'" >/dev/null
  local status=0
  must "the scenario fills the pane's scrollback and opens the pane screen" \
    wait_scroll_line "ATUR_E2E STEP $ready" 480 || status=1
  if [ $status -eq 0 ]; then
    sleep 5
    shot "phase5-$label-open"
    if [ -n "$agent" ]; then
      must "the computer reports an agent: the pane shows the prompt composer" \
        ui wait-frozen "Prompt" 120 || status=1
    fi
    if [ "$ready" = wide ] && [ $status -eq 0 ]; then
      must "the pane is wider than the phone: the view offers Fit width" \
        ui wait-frozen "Fit terminal width" 60 || status=1
    fi
  else
    tail -n +"$P4_START" "$LOG" | grep -o "ATUR_E2E FAILURE.*" | tail -1 | tee -a "$PHASE5" || true
  fi
  if [ $status -eq 0 ]; then
    must "from the bottom a swipe goes back at least 200 rows with each of: $cells" \
      ui focus-matrix "$cells" 42 200 "$drift" || status=1
  fi
  { echo "=== $label"; tail -n +"$P4_START" "$LOG" | grep -o "ATUR_E2E [A-Z]*.*" | grep -v "ATUR_E2E SCROLL"; grep -h "^ATUR_E2E METRIC focus" "$PHASE5"; } >> "$FOCUS_LINES" || true
  return $status
}

PHASE5_STATUS=0
if want 5; then
  # The soft keyboard must be able to appear on the emulator (it has a hardware keyboard).
  adb shell settings put secure show_ime_with_hard_keyboard 1
  export SHOT_DIR="$OUT"
  # A pane of an agent: nothing focused, the terminal focused (soft keyboard up), focused without
  # the soft keyboard, the composer focused.
  phase5_run focus "&agent=1" ui "idle,tap,hwkb,composer" 0 agent || PHASE5_STATUS=1
  # The pane screen is open before the agent prints anything, the view stays at the bottom while
  # 2500 rows go into the scrollback, and then it is swiped back, nothing focused (the way a pane
  # is watched), then with a tap that opens the keyboard.
  phase5_run late-output "&agent=1&late=1" late "idle,tap" 0 agent || PHASE5_STATUS=1
  # The pane screen's first two scrollback reads fail; it must still be scrollable with nothing focused.
  phase5_run dropped-reads "&agent=1&failreads=2" ui "idle" 0 agent || PHASE5_STATUS=1
  # The desktop app laid the pane out wider than the phone; swipes drift sideways as a thumb's do.
  phase5_run wide "&agent=1&wide=1" wide "idle" 90 agent || PHASE5_STATUS=1
  if [ $PHASE5_STATUS -eq 0 ]; then echo "PASS phase 5" | tee -a "$PHASE5"; fi
  echo "--- phase 5 lines"
  cat "$FOCUS_LINES"
fi

kill $LOGCAT 2>/dev/null
[ $PHASE1 -eq 0 ] && [ $PHASE2_STATUS -eq 0 ] && [ $PHASE3_STATUS -eq 0 ] && [ $PHASE4_STATUS -eq 0 ] && [ $PHASE5_STATUS -eq 0 ]
