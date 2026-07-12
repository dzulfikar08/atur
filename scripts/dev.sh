#!/usr/bin/env bash
# ─── Atur Local Development Script ───
#   server     — Native Rust server + SQLite (port 8080)
#   worker     — Cloudflare Worker via wrangler dev (port 8787)
#   full       — Worker + frontend Vite dev server (8787 + 5173)
#   frontend   — Vite dev only (proxies to 8787)

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FRONTEND_DIR="$PROJECT_ROOT/frontend"
WORKER_DIR="$PROJECT_ROOT/crates/atur-worker"
BUILD_DIR="$PROJECT_ROOT/build"
DATA_DIR="$PROJECT_ROOT/data"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${GREEN}[dev]${NC} $*"; }
warn() { echo -e "${YELLOW}[warn]${NC} $*"; }
err()  { echo -e "${RED}[err]${NC} $*"; }
info() { echo -e "${CYAN}[info]${NC} $*"; }

check_deps() {
    local missing=()
    for dep in cargo node npm; do
        command -v "$dep" &>/dev/null || missing+=("$dep")
    done
    if [ ${#missing[@]} -gt 0 ]; then
        err "Missing: ${missing[*]}"
        exit 1
    fi
    if ! rustup target list --installed 2>/dev/null | grep -q wasm32-unknown-unknown; then
        warn "wasm32-unknown-unknown not installed. Run: rustup target add wasm32-unknown-unknown"
    fi
}

setup_frontend() {
    if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
        log "Installing frontend deps..."
        (cd "$FRONTEND_DIR" && npm install --prefer-offline) || {
            err "npm install failed"
            return 1
        }
    else
        log "Frontend deps already installed"
    fi
}

build_worker() {
    log "Building atur-worker (Rust -> WASM)..."
    bash "$WORKER_DIR/build.sh" || {
        err "Worker build failed"
        return 1
    }
}

build_frontend_static() {
    log "Building frontend static assets..."
    (cd "$FRONTEND_DIR" && npm run build) || {
        warn "Frontend build had warnings (static-app may be incomplete)"
    }
}

setup_d1_local() {
    log "Setting up local D1 database..."

    # wrangler needs the D1 binding in its config to execute locally.
    # Write a temp config first, then run the schema.
    cat > "$PROJECT_ROOT/wrangler.local.toml" << 'TOML'
name = "atur-dev"
main = "build/worker/shim.mjs"
compatibility_date = "2026-04-08"
compatibility_flags = ["nodejs_compat"]

[[d1_databases]]
binding = "DB"
database_name = "atur-db-local"
database_id = "local"

[[kv_namespaces]]
binding = "RATE_LIMIT"
id = "local"

[[r2_buckets]]
binding = "R2"
bucket_name = "atur-assets-local"

[assets]
directory = "static-app"
not_found_handling = "single-page-application"
binding = "ASSETS"
run_worker_first = true

[dev]
port = 8787
TOML

    npx wrangler d1 execute atur-db-local --local --config="$PROJECT_ROOT/wrangler.local.toml" --file="$WORKER_DIR/schema.sql" || {
        warn "D1 schema failed — you may need to run manually:"
        info "  npx wrangler d1 execute atur-db-local --local --config=wrangler.local.toml --file=crates/atur-worker/schema.sql"
    }

    log "Seeding dev data (user: dev@atur.local / password123, workspace: dev)..."
    npx wrangler d1 execute atur-db-local --local --config="$PROJECT_ROOT/wrangler.local.toml" --file="$WORKER_DIR/seed.sql" || {
        warn "Seed failed — run manually"
    }
}

run_worker_dev() {
    log "Starting wrangler dev on http://localhost:8787 ..."
    kill_port 8787
    cd "$PROJECT_ROOT"

    cat > "$PROJECT_ROOT/wrangler.local.toml" << 'TOML'
name = "atur-dev"
main = "build/worker/shim.mjs"
compatibility_date = "2026-04-08"
compatibility_flags = ["nodejs_compat"]

[[d1_databases]]
binding = "DB"
database_name = "atur-db-local"
database_id = "local"

[[kv_namespaces]]
binding = "RATE_LIMIT"
id = "local"

[[r2_buckets]]
binding = "R2"
bucket_name = "atur-assets-local"

[assets]
directory = "static-app"
not_found_handling = "single-page-application"
binding = "ASSETS"
run_worker_first = true

[dev]
port = 8787
TOML

    mkdir -p "$BUILD_DIR/worker"
    if [ ! -f "$BUILD_DIR/worker/shim.mjs" ]; then
        build_worker || return 1
    fi

    npx wrangler dev --config wrangler.local.toml --local &
    WRANGLER_PID=$!
    echo "$WRANGLER_PID" > /tmp/atur-wrangler.pid
    log "wrangler PID: $WRANGLER_PID"
}

run_server_dev() {
    log "Starting Rust server on http://localhost:8080 ..."
    mkdir -p "$DATA_DIR/uploads" "$DATA_DIR/search"

    if [ ! -f "$PROJECT_ROOT/config.toml" ]; then
        warn "No config.toml, copying from example..."
        cp "$PROJECT_ROOT/config.example.toml" "$PROJECT_ROOT/config.toml"
    fi

    cd "$PROJECT_ROOT"
    log "Running migrations..."
    cargo run --release --bin atur -- --config config.toml migrate 2>/dev/null || {
        warn "Migration may have partially failed (tables may exist already)"
    }

    cargo run --release --bin atur -- --config config.toml serve &
    SERVER_PID=$!
    echo "$SERVER_PID" > /tmp/atur-server.pid
    log "Server PID: $SERVER_PID"
}

run_frontend_dev() {
    log "Starting Vite dev server on http://localhost:5173 ..."
    kill_port 5173
    cd "$FRONTEND_DIR"
    npm run dev &
    VITE_PID=$!
    echo "$VITE_PID" > /tmp/atur-vite.pid
    log "Vite PID: $VITE_PID"
}

cleanup() {
    log "Shutting down..."
    for pidfile in /tmp/atur-wrangler.pid /tmp/atur-server.pid /tmp/atur-vite.pid; do
        if [ -f "$pidfile" ]; then
            local pid
            pid=$(cat "$pidfile")
            if kill -0 "$pid" 2>/dev/null; then
                kill "$pid" 2>/dev/null || true
                log "Stopped PID $pid"
            fi
            rm -f "$pidfile"
        fi
    done
    rm -f "$PROJECT_ROOT/wrangler.local.toml"
    log "All processes stopped."
}

# Kill anything already on the dev ports
kill_port() {
    local port="$1"
    local pid
    pid=$(lsof -ti ":$port" 2>/dev/null || true)
    if [ -n "$pid" ]; then
        warn "Port $port in use by PID $pid — killing..."
        kill -9 $pid 2>/dev/null || true
        sleep 1
    fi
}

trap cleanup EXIT INT TERM

# ─────────────────────────────────────────────
main() {
    local mode="${1:-full}"
    check_deps

    case "$mode" in
        server)
            log "=== Server Mode ==="
            run_server_dev
            info "Server: http://localhost:8080"
            info "Press Ctrl+C to stop"
            wait
            ;;

        worker)
            log "=== Worker Mode ==="
            setup_frontend
            build_frontend_static
            build_worker
            setup_d1_local
            run_worker_dev
            info "Worker: http://localhost:8787"
            info "Press Ctrl+C to stop"
            wait
            ;;

        full)
            log "=== Full Stack Dev Mode ==="
            setup_frontend

            # Worker: build WASM and optional static-app
            build_worker
            setup_d1_local

            # Build static-app so wrangler can serve the frontend as fallback
            if [ ! -d "$PROJECT_ROOT/static-app" ] || [ ! -f "$PROJECT_ROOT/static-app/index.html" ]; then
                build_frontend_static
            else
                log "static-app already built (skip with: rm -rf static-app)"
            fi

            run_worker_dev
            sleep 3
            run_frontend_dev

            echo ""
            info "══════════════════════════════════════════"
            info "  Frontend : http://localhost:5173"
            info "  Worker   : http://localhost:8787"
            info "  Health   : http://localhost:8787/health"
            info "══════════════════════════════════════════"
            info "Press Ctrl+C to stop"
            echo ""
            wait
            ;;

        frontend)
            log "=== Frontend Only ==="
            setup_frontend
            run_frontend_dev
            info "Frontend: http://localhost:5173 (proxies /api to localhost:8787)"
            info "Press Ctrl+C to stop"
            wait
            ;;

        *)
            echo "Usage: bash scripts/dev.sh {server|worker|full|frontend}"
            echo ""
            echo "  server    — Rust server + SQLite on port 8080"
            echo "  worker    — wrangler dev on port 8787"
            echo "  full      — worker (8787) + Vite dev (5173)   ← recommended"
            echo "  frontend  — Vite dev only, needs backend on 8787"
            exit 1
            ;;
    esac
}

main "$@"
