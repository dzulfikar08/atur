#!/bin/bash
# Host side of the direct-connection proof run on an Android emulator (CI: .github/workflows/native-direct.yml).
#
#   e2e-direct-android.sh <apk> <pairing-link> <server-port> <out-dir>
#
# Installs the build made with EXPO_PUBLIC_ATUR_E2E=1, opens atur://direct-e2e?link=..., and plays
# the host's part of the scenario in app/direct-e2e.tsx while it logs `ATUR_E2E` lines:
#   WAIT background  -> press Home, stay away past the app's 30 s grace, bring the app back
#   WAIT drop        -> reset the app's connection on the server side (REJECT with tcp-reset)
# Exit status is 0 only when the app logs `ATUR_E2E RESULT PASS`.
set -uo pipefail

APK="$1" LINK="$2" PORT="$3" OUT="$4"
PACKAGE=com.diatur.app
mkdir -p "$OUT"
LOG="$OUT/logcat.txt"

adb wait-for-device
adb shell input keyevent KEYCODE_WAKEUP
adb shell wm dismiss-keyguard 2>/dev/null || true
adb install -r "$APK" >/dev/null || { echo "install failed"; exit 1; }
adb logcat -c
adb logcat -v time ReactNativeJS:V AndroidRuntime:E libc:F DEBUG:F '*:S' > "$LOG" &
LOGCAT=$!
trap 'kill $LOGCAT 2>/dev/null' EXIT

ENCODED="$(python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$LINK")"
adb shell am start -a android.intent.action.VIEW -d "'atur://direct-e2e?link=$ENCODED'" "$PACKAGE" >/dev/null

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
    sleep 6
    sudo iptables -D INPUT -p tcp --dport "$PORT" -j REJECT --reject-with tcp-reset
    echo "host: connections allowed again"
  fi
  sleep 1
done
shot final
sleep 2
kill $LOGCAT 2>/dev/null

echo "--- ATUR_E2E lines"
grep -o "ATUR_E2E.*" "$LOG" | tee "$OUT/e2e-lines.txt"
grep -q "ATUR_E2E RESULT PASS" "$LOG"
