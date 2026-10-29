#!/bin/bash
# An isolated Atur Terminal server for CI (.github/workflows/native-direct.yml), never the live one.
#
#   start-test-server.sh start <dir> <bin-dir> [mobile-port]
#       Starts the server found in <bin-dir> (atur-term and atur-term-server, built by the `server`
#       job of the workflow from the atur-terminal commit in modules/atur-direct/core.ref, so it
#       has the UDP offer) in its own profile under <dir>, and with a port also turns on phone
#       access on that port. The server offers UDP on ATUR_TERM_UDP_PORTS (default 60100-60100,
#       the port the lossy-link proof shapes) and nothing else is opened.
#       Writes <dir>/env.sh, which exports BIN, ATUR_TERM_DIR, ATUR_TERM_UDP_PORTS and SHELL for
#       the next steps.
#   start-test-server.sh pair <dir> <address> <out-file>
#       Asks that server for a pairing link naming <address> and writes the link (one line) to
#       <out-file>. A link works once and for five minutes: call this once per pairing.
set -euo pipefail

LINK_PATTERN='^[a-z-]+://pair\?'

start() {
  local dir="$1" bin_dir="$2" port="${3:-}"
  mkdir -p "$dir"
  local bin
  bin="$(cd "$bin_dir" && pwd)"
  chmod +x "$bin/atur-term" "$bin/atur-term-server"
  mkdir -p "$dir/profile"
  {
    echo "export BIN='$bin'"
    echo "export ATUR_TERM_DIR='$dir/profile'"
    echo "export ATUR_TERM_UDP_PORTS='${ATUR_TERM_UDP_PORTS:-60100-60100}'"
    echo "export SHELL=/bin/bash"
  } > "$dir/env.sh"
  # shellcheck disable=SC1091
  . "$dir/env.sh"
  nohup "$BIN/atur-term-server" > "$dir/server.log" 2>&1 &
  for _ in $(seq 100); do [ -S "$ATUR_TERM_DIR/server.sock" ] && break; sleep 0.1; done
  [ -S "$ATUR_TERM_DIR/server.sock" ] || { echo "the server did not start" >&2; cat "$dir/server.log" >&2; exit 1; }
  if [ -n "$port" ]; then "$BIN/atur-term" mobile enable --port "$port"; fi
}

pair() {
  local dir="$1" address="$2" out="$3"
  # shellcheck disable=SC1091
  . "$dir/env.sh"
  local log="$out.log"
  nohup "$BIN/atur-term" mobile pair --address "$address" > "$log" 2>&1 &
  # A code can be refused while the previous one is still live; keep trying for a while.
  for _ in $(seq 1200); do grep -qE "$LINK_PATTERN" "$log" && break; sleep 0.25; done
  grep -E "$LINK_PATTERN" "$log" | head -1 > "$out"
  if [ ! -s "$out" ]; then
    echo "no pairing link from the server; its answer was:" >&2
    cat "$log" >&2
    exit 1
  fi
}

case "${1:-}" in
  start) shift; start "$@" ;;
  pair) shift; pair "$@" ;;
  *) echo "usage: start-test-server.sh start <dir> <bin-dir> [mobile-port] | pair <dir> <address> <out-file>" >&2; exit 2 ;;
esac
