#!/usr/bin/env bash
set -euo pipefail

VPS="${VPS_HOST:-vps-voltrus}"
REMOTE_DIR="/opt/atur"
CARGO_ENV="PATH=/opt/cloudagni/rustup/toolchains/stable-x86_64-unknown-linux-gnu/bin:/usr/bin:/bin RUSTUP_HOME=/opt/cloudagni/rustup CARGO_HOME=/opt/cloudagni/cargo"

# Colors
info()  { echo -e "\033[1;34m[INFO]\033[0m $*"; }
ok()    { echo -e "\033[1;32m[OK]\033[0m $*"; }
err()   { echo -e "\033[1;31m[ERR]\033[0m $*" >&2; exit 1; }

usage() {
  echo "Usage: $0 [OPTIONS]"
  echo ""
  echo "Deploy Atur (Plane PMO) to VPS."
  echo ""
  echo "Options:"
  echo "  --ui-only       Only rebuild and upload frontend UI"
  echo "  --backend-only  Only rebuild Rust backend"
  echo "  --no-build      Skip builds, just upload and restart"
  echo "  --vps HOST      VPS hostname (default: vps-voltrus)"
  echo "  --restart-only  Just restart the service on VPS"
  echo ""
  echo "Default: build UI + backend, upload, restart"
  exit 0
}

UI_ONLY=false
BACKEND_ONLY=false
NO_BUILD=false
RESTART_ONLY=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --ui-only)       UI_ONLY=true; shift ;;
    --backend-only)  BACKEND_ONLY=true; shift ;;
    --no-build)      NO_BUILD=true; shift ;;
    --restart-only)  RESTART_ONLY=true; shift ;;
    --vps)           VPS="$2"; shift 2 ;;
    -h|--help)       usage ;;
    *)               err "Unknown option: $1" ;;
  esac
done

cd "$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel 2>/dev/null || echo "$(dirname "$0")/..")"

# ── Restart only ──
if $RESTART_ONLY; then
  info "Restarting atur on $VPS..."
  ssh "$VPS" "sudo systemctl restart atur && sleep 2 && sudo systemctl status atur --no-pager | head -5"
  ok "Done"
  exit 0
fi

# ── Build frontend ──
if ! $BACKEND_ONLY && ! $NO_BUILD; then
  info "Building frontend..."
  cd frontend
  npm install --silent 2>/dev/null
  npm run build
  cd ..
  ok "Frontend built → static-app/"
fi

# ── Build backend ──
if ! $UI_ONLY && ! $NO_BUILD; then
  info "Building backend on VPS (this takes a few minutes)..."

  # Upload source
  info "Packaging source..."
  tar czf /tmp/atur-source.tar.gz \
    --exclude=target \
    --exclude=node_modules \
    --exclude=data \
    --exclude=.git \
    --exclude=static-app \
    --exclude=static-editor \
    .

  info "Uploading source..."
  scp -q /tmp/atur-source.tar.gz "$VPS:/tmp/atur-source.tar.gz"

  info "Extracting and building on VPS..."
  ssh "$VPS" bash -s <<REMOTE
    set -e
    sudo -u cloudagni tar xzf /tmp/atur-source.tar.gz -C $REMOTE_DIR
    sudo -u cloudagni bash -c 'cd $REMOTE_DIR && $CARGO_ENV cargo build --release 2>&1 | tail -3'
REMOTE
  ok "Backend built"
fi

# ── Upload assets ──
info "Uploading static assets..."
scp -rq static-app/* "$VPS:/tmp/atur-static/"
ssh "$VPS" bash -s <<REMOTE
  set -e
  sudo rm -rf $REMOTE_DIR/static/*
  sudo cp -r /tmp/atur-static/* $REMOTE_DIR/static/
  sudo chown -R cloudagni:cloudagni $REMOTE_DIR/static/
REMOTE

if [ -d static-editor ]; then
  info "Uploading static-editor..."
  scp -rq static-editor/* "$VPS:/tmp/atur-editor/"
  ssh "$VPS" bash -s <<REMOTE
    set -e
    sudo rm -rf $REMOTE_DIR/static-editor/*
    sudo cp -r /tmp/atur-editor/* $REMOTE_DIR/static-editor/
    sudo chown -R cloudagni:cloudagni $REMOTE_DIR/static-editor/
REMOTE
fi

# ── Restart ──
info "Restarting atur service..."
ssh "$VPS" bash -s <<REMOTE
  set -e
  sudo systemctl restart atur
  sleep 2
  STATUS=\$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:5555/)
  if [ "\$STATUS" = "200" ]; then
    echo "Atur is live on port 5555 (HTTP \$STATUS)"
  else
    echo "WARNING: Atur returned HTTP \$STATUS"
    sudo systemctl status atur --no-pager | tail -10
  fi
REMOTE

ok "Deploy complete!"
