#!/usr/bin/env bash
# Capture app screens over adb via deep links (scheme atur://).
#
#   ADB_SERIAL=<adb devices serial> scripts/store-shots/capture.sh <out-dir> <name>=<deep-link> [...]
#
#   scripts/store-shots/capture.sh apps/native/dist/store/captures today=atur:// inbox=atur:///inbox
#
# The package defaults to com.diatur.app (PACKAGE overrides). The screen must be awake and unlocked.
# Captures show real workspace data: use a demo account, keep them in the gitignored dist/ folder.
set -euo pipefail

serial="${ADB_SERIAL:-}"
adb=(adb ${serial:+-s "$serial"})
package="${PACKAGE:-com.diatur.app}"
settle="${SETTLE_SECONDS:-4}"

if (($# < 2)); then
  sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'
  exit 2
fi
out="$1"
shift

wake="$("${adb[@]}" shell dumpsys power | tr -d '\r' | sed -n 's/.*mWakefulness=\([A-Za-z]*\).*/\1/p' | head -n 1)"
if [[ "$wake" != "Awake" ]]; then
  echo "phone is $wake: unlock it, then run again" >&2
  exit 1
fi
if "${adb[@]}" shell dumpsys window | tr -d '\r' | grep -q 'isKeyguardShowing=true'; then
  echo "phone shows the lock screen: unlock it, then run again" >&2
  exit 1
fi

mkdir -p "$out"
for item in "$@"; do
  name="${item%%=*}"
  link="${item#*=}"
  "${adb[@]}" shell am start -a android.intent.action.VIEW -d "$link" "$package" >/dev/null
  sleep "$settle"
  "${adb[@]}" exec-out screencap -p >"$out/$name.png"
  echo "$out/$name.png"
done
