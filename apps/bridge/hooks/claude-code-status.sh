#!/bin/sh
# Claude Code hook: report state to atur-bridge (tmux backend).
#
#   claude-code-status.sh <idle|working|blocked|done|off>
#
# See docs/bridge.md for the ~/.claude/settings.json hooks that call this.
exec "$(dirname "$0")/tmux-status.sh" claude "$@"
