#!/bin/sh
# Codex hook: report state to atur-bridge (tmux backend).
#
#   codex-status.sh <idle|working|blocked|done|off>
#
# See docs/bridge.md for the ~/.codex/hooks.json hooks that call this.
exec "$(dirname "$0")/tmux-status.sh" codex "$@"
