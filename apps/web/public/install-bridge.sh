#!/bin/sh
# atur-bridge installer: connects this machine's terminals to Atur Cloud.
#
#   curl -fsSL https://diatur.com/install-bridge.sh | sh -s -- <token>
#
# <token> is the machine token (atb_...) from the Machines page at app.diatur.com.
# Safe to re-run: it updates the binary, keeps your settings and restarts the service.
#
# Environment:
#   ATUR_INSTALL_DRY_RUN=1     print what would happen, change nothing (no network)
#   ATUR_INSTALL_FORCE_ROOT=1  allow running as root (the service is per user, so rarely wanted)
#   ATUR_BRIDGE_VERSION=<tag>  install this release (for example bridge-v0.1.0) instead of the latest
#   ATUR_INSTALL_DIR=<dir>     binary directory (default ~/.local/bin)
#   ATUR_INSTALL_BASE_URL=<u>  download assets from <u> instead of the GitHub release (mirrors, testing)
set -eu

REPO="dzulfikar08/atur"
TAG_PREFIX="bridge-v"
DRY_RUN="${ATUR_INSTALL_DRY_RUN:-0}"
INSTALL_DIR="${ATUR_INSTALL_DIR:-$HOME/.local/bin}"
BIN="$INSTALL_DIR/atur-bridge"
CONFIG_DIR="$HOME/.config/atur"
ENV_FILE="$CONFIG_DIR/bridge.env"
TOKEN="${1:-}"

say() { printf '%s\n' "$*"; }
fail() {
  printf 'install-bridge: %s\n' "$*" >&2
  exit 1
}

# run <cmd...>: executes, or only prints in dry-run mode.
run() {
  if [ "$DRY_RUN" = 1 ]; then
    say "  would run: $*"
  else
    "$@"
  fi
}

# write_file <path> <mode>: file body on stdin.
write_file() {
  if [ "$DRY_RUN" = 1 ]; then
    say "  would write $1 (mode $2):"
    sed 's/^/    | /'
  else
    mkdir -p "$(dirname "$1")"
    cat >"$1"
    chmod "$2" "$1"
  fi
}

have() { command -v "$1" >/dev/null 2>&1; }

fetch() { # fetch <url> <dest>
  if have curl; then
    curl -fsSL --retry 3 -o "$2" "$1"
  elif have wget; then
    wget -q -O "$2" "$1"
  else
    fail "curl or wget is required"
  fi
}

sha256_of() {
  if have sha256sum; then
    sha256sum "$1" | cut -d ' ' -f 1
  elif have shasum; then
    shasum -a 256 "$1" | cut -d ' ' -f 1
  else
    fail "sha256sum or shasum is required to verify the download"
  fi
}

if [ "$(id -u)" = 0 ] && [ "${ATUR_INSTALL_FORCE_ROOT:-0}" != 1 ]; then
  fail "refusing to run as root: the bridge runs as the user who owns your terminals. Re-run as that user, or set ATUR_INSTALL_FORCE_ROOT=1 to override."
fi

# --- platform ---------------------------------------------------------------
case "$(uname -s)" in
  Linux) OS=linux ;;
  Darwin) OS=darwin ;;
  *) fail "unsupported OS: $(uname -s) (Linux and macOS are supported)" ;;
esac
case "$(uname -m)" in
  x86_64 | amd64) ARCH=x64 ;;
  aarch64 | arm64) ARCH=arm64 ;;
  *) fail "unsupported CPU: $(uname -m) (x64 and arm64 are supported)" ;;
esac
ASSET="atur-bridge-$OS-$ARCH"

if [ "$DRY_RUN" = 1 ]; then
  say "atur-bridge installer (dry run: nothing is changed)"
else
  say "atur-bridge installer"
fi
say "  platform: $OS-$ARCH"

if ! have tmux && ! have herdr && ! have atur-term && ! have muxy \
  && [ ! -x "/Applications/Atur Terminal.app/Contents/MacOS/atur-term" ] \
  && [ ! -x /Applications/Muxy.app/Contents/MacOS/muxy ]; then
  say "  note: none of tmux, herdr or Atur Terminal was found. Install tmux (the bridge shows panes of whatever tmux runs)."
fi

# --- release ----------------------------------------------------------------
TAG="${ATUR_BRIDGE_VERSION:-}"
if [ -z "$TAG" ]; then
  if [ "$DRY_RUN" = 1 ]; then
    say "  would query https://api.github.com/repos/$REPO/releases for the newest ${TAG_PREFIX}* release"
    TAG="${TAG_PREFIX}<latest>"
  else
    TMP_JSON="$(mktemp)"
    fetch "https://api.github.com/repos/$REPO/releases?per_page=30" "$TMP_JSON" ||
      fail "could not list releases of $REPO (GitHub API unreachable or rate limited). Retry, or set ATUR_BRIDGE_VERSION=${TAG_PREFIX}X.Y.Z."
    # Newest first; the repo also tags other things, so pick the first bridge release.
    TAG="$(grep -o "\"tag_name\": *\"${TAG_PREFIX}[^\"]*\"" "$TMP_JSON" | head -n 1 | sed 's/.*: *"\(.*\)"/\1/')"
    rm -f "$TMP_JSON"
    [ -n "$TAG" ] || fail "no ${TAG_PREFIX}* release found in $REPO"
  fi
fi
case "$TAG" in
  "$TAG_PREFIX"*) ;;
  *) fail "ATUR_BRIDGE_VERSION must look like ${TAG_PREFIX}X.Y.Z (got $TAG)" ;;
esac
VERSION="${TAG#"$TAG_PREFIX"}"
BASE_URL="${ATUR_INSTALL_BASE_URL:-https://github.com/$REPO/releases/download/$TAG}"
say "  release: $TAG"

# --- binary -----------------------------------------------------------------
INSTALLED=""
if [ "$DRY_RUN" != 1 ] && [ -x "$BIN" ]; then
  INSTALLED="$("$BIN" --version 2>/dev/null || true)"
fi

if [ "$INSTALLED" = "$VERSION" ]; then
  say "  atur-bridge $VERSION is already installed at $BIN"
else
  say "  downloading $ASSET"
  if [ "$DRY_RUN" = 1 ]; then
    say "  would download $BASE_URL/$ASSET"
    say "  would download $BASE_URL/SHA256SUMS and verify the checksum (abort on mismatch)"
    say "  would install to $BIN"
  else
    WORK="$(mktemp -d)"
    trap 'rm -rf "$WORK"' EXIT INT TERM
    fetch "$BASE_URL/$ASSET" "$WORK/$ASSET" || fail "download failed: $BASE_URL/$ASSET"
    fetch "$BASE_URL/SHA256SUMS" "$WORK/SHA256SUMS" || fail "download failed: $BASE_URL/SHA256SUMS"
    EXPECTED="$(grep " $ASSET\$" "$WORK/SHA256SUMS" | head -n 1 | cut -d ' ' -f 1)"
    [ -n "$EXPECTED" ] || fail "$ASSET is not listed in SHA256SUMS of $TAG"
    ACTUAL="$(sha256_of "$WORK/$ASSET")"
    [ "$EXPECTED" = "$ACTUAL" ] || fail "checksum mismatch for $ASSET (expected $EXPECTED, got $ACTUAL). Nothing was installed."
    say "  checksum ok"
    chmod 755 "$WORK/$ASSET"
    if [ "$OS" = darwin ]; then
      xattr -d com.apple.quarantine "$WORK/$ASSET" 2>/dev/null || true
      "$WORK/$ASSET" --version >/dev/null 2>&1 || codesign --force --sign - "$WORK/$ASSET" 2>/dev/null || true
    fi
    "$WORK/$ASSET" --version >/dev/null 2>&1 || fail "the downloaded binary does not run on this machine"
    mkdir -p "$INSTALL_DIR"
    # mv within one filesystem replaces atomically; a running service keeps its old inode until restarted.
    cp "$WORK/$ASSET" "$BIN.new"
    mv -f "$BIN.new" "$BIN"
    say "  installed $BIN"
  fi
fi

case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *) say "  note: $INSTALL_DIR is not on your PATH. Add it to your shell profile to run atur-bridge by hand." ;;
esac

# --- token ------------------------------------------------------------------
HAVE_TOKEN=0
if [ -n "$TOKEN" ]; then
  if [ "$DRY_RUN" = 1 ]; then
    say "  would run: $BIN connect <token>   (writes ATUR_CONNECT_TOKEN to $ENV_FILE, mode 600)"
  else
    "$BIN" connect "$TOKEN" >/dev/null || fail "the token was rejected: expected a machine token starting with atb_ from app.diatur.com"
    say "  saved the machine token to $ENV_FILE"
  fi
  HAVE_TOKEN=1
elif [ -f "$ENV_FILE" ] && grep -q '^ATUR_CONNECT_TOKEN=' "$ENV_FILE"; then
  say "  keeping the machine token already saved in $ENV_FILE"
  HAVE_TOKEN=1
fi

# --- agent hooks ------------------------------------------------------------
if [ "$DRY_RUN" = 1 ]; then
  say "  would run: $BIN hooks   (writes the agent status scripts to $CONFIG_DIR/hooks)"
else
  "$BIN" hooks >/dev/null 2>&1 && say "  agent status scripts: $CONFIG_DIR/hooks (see docs/bridge.md to wire them into Claude Code or Codex)"
fi

# --- service ----------------------------------------------------------------
if [ "$HAVE_TOKEN" != 1 ]; then
  say ""
  say "No machine token yet, so the service was not started."
  say "Create one on the Machines page at https://app.diatur.com, then run:"
  say "  curl -fsSL https://diatur.com/install-bridge.sh | sh -s -- <token>"
  exit 0
fi

install_systemd() {
  UNIT_DIR="$HOME/.config/systemd/user"
  write_file "$UNIT_DIR/atur-bridge.service" 644 <<UNIT
[Unit]
Description=atur-bridge: connects this machine's terminals to Atur Cloud
After=network-online.target
Wants=network-online.target

[Service]
EnvironmentFile=%h/.config/atur/bridge.env
ExecStart=%h/.local/bin/atur-bridge
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
UNIT
  if [ "$DRY_RUN" != 1 ] && { ! have systemctl || ! systemctl --user show-environment >/dev/null 2>&1; }; then
    say ""
    say "systemd --user is not available here, so no service was installed."
    say "Run the bridge yourself with: $BIN"
    return
  fi
  run systemctl --user daemon-reload
  run systemctl --user enable atur-bridge.service
  run systemctl --user restart atur-bridge.service
  if [ "$DRY_RUN" = 1 ]; then
    say "  would run: loginctl enable-linger \"\$USER\"   (keeps it running after logout; failure is ignored)"
  else
    loginctl enable-linger "$USER" >/dev/null 2>&1 || say "  note: could not enable linger; run 'loginctl enable-linger $USER' to keep the bridge running after you log out."
  fi
  say "  service: systemctl --user status atur-bridge   (logs: journalctl --user -u atur-bridge -f)"
}

install_launchd() {
  LABEL="com.diatur.atur-bridge"
  PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
  LOG="$HOME/Library/Logs/atur-bridge.log"
  write_file "$PLIST" 644 <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$BIN</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>3</integer>
  <key>StandardOutPath</key>
  <string>$LOG</string>
  <key>StandardErrorPath</key>
  <string>$LOG</string>
</dict>
</plist>
PLIST
  UID_NOW="$(id -u)"
  if [ "$DRY_RUN" = 1 ]; then
    say "  would run: launchctl bootout gui/$UID_NOW/$LABEL   (ignored when not loaded)"
  else
    launchctl bootout "gui/$UID_NOW/$LABEL" >/dev/null 2>&1 || true
  fi
  run launchctl bootstrap "gui/$UID_NOW" "$PLIST"
  run launchctl kickstart -k "gui/$UID_NOW/$LABEL"
  say "  service: launchctl print gui/$UID_NOW/$LABEL   (logs: $LOG)"
}

if [ "$OS" = linux ]; then
  install_systemd
else
  install_launchd
fi

say ""
say "Done. This machine shows up as online on the Machines page at https://app.diatur.com."
