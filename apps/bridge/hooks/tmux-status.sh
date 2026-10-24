#!/bin/sh
# Report a coding agent's state to atur-bridge through its tmux pane.
#
#   tmux-status.sh <agent> <idle|working|blocked|done|off>
#
# Sets the pane user options @atur_agent and @atur_status, which the bridge's
# tmux backend reads to show the agent state in the app and to send the
# "finished" and "needs you" push notifications. `off` clears both options.
#
# Meant to be called from an agent hook (Claude Code, Codex). It never prints,
# never blocks the agent, and always exits 0 except on a usage error (exit 1):
# a missing tmux or a pane that is gone must not break a coding session.
# Outside tmux ($TMUX_PANE unset) it does nothing.
agent=${1:-}
state=${2:-}

# Hooks receive an event JSON on stdin; this script does not use it.
[ -t 0 ] || cat >/dev/null 2>&1

case "$state" in
  idle | working | blocked | done | off) ;;
  *)
    echo "usage: tmux-status.sh <agent> <idle|working|blocked|done|off>" >&2
    exit 1
    ;;
esac
[ -n "$agent" ] || { echo "usage: tmux-status.sh <agent> <state>" >&2; exit 1; }

[ -n "${TMUX_PANE:-}" ] || exit 0
command -v tmux >/dev/null 2>&1 || exit 0

if [ "$state" = off ]; then
  tmux set-option -p -u -t "$TMUX_PANE" @atur_status \; \
    set-option -p -u -t "$TMUX_PANE" @atur_agent >/dev/null 2>&1
else
  tmux set-option -p -t "$TMUX_PANE" @atur_agent "$agent" \; \
    set-option -p -t "$TMUX_PANE" @atur_status "$state" >/dev/null 2>&1
fi
exit 0
