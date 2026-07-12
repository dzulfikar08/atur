# ===========================================================================
# Atur - Multi-stage Dockerfile
# ===========================================================================
# Stage 1: Build the Rust binary in release mode
# Stage 2: Minimal runtime image with only what's needed
# ===========================================================================

# ---------------------------------------------------------------------------
# Stage 1: Build
# ---------------------------------------------------------------------------
FROM rust:1.85-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# --- Dependency caching layer ---
# Copy only manifests first so dependencies can be cached independently.
COPY Cargo.toml Cargo.lock ./
COPY crates/server/Cargo.toml crates/server/Cargo.toml
COPY crates/domain/Cargo.toml crates/domain/Cargo.toml
COPY crates/db/Cargo.toml crates/db/Cargo.toml
COPY crates/tasks/Cargo.toml crates/tasks/Cargo.toml
COPY crates/collab/Cargo.toml crates/collab/Cargo.toml
COPY crates/tui/Cargo.toml crates/tui/Cargo.toml

# Create dummy source files so cargo can resolve the workspace.
RUN mkdir -p crates/server/src && echo "fn main() {}" > crates/server/src/main.rs \
    && mkdir -p crates/domain/src && echo "" > crates/domain/src/lib.rs \
    && mkdir -p crates/db/src && echo "" > crates/db/src/lib.rs \
    && mkdir -p crates/tasks/src && echo "" > crates/tasks/src/lib.rs \
    && mkdir -p crates/collab/src && echo "" > crates/collab/src/lib.rs \
    && mkdir -p crates/tui/src && echo "fn main() {}" > crates/tui/src/main.rs

# Build dependencies only (the dummy main will fail to link, which is fine).
RUN cargo build --release 2>/dev/null || true

# --- Real build ---
# Copy the actual source code and rebuild.
COPY . .

# Touch the source files so cargo sees them as newer than the cached deps.
RUN find crates -name "*.rs" -exec touch {} +

RUN cargo build --release

# ---------------------------------------------------------------------------
# Stage 2: Runtime
# ---------------------------------------------------------------------------
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN groupadd --system plane && useradd --system --gid plane --create-home plane

WORKDIR /app

# Copy the compiled binary
COPY --from=builder /app/target/release/atur /usr/local/bin/atur

# Copy static assets served by the application
COPY --from=builder /app/static-app ./static-app
COPY --from=builder /app/static ./static
COPY --from=builder /app/static-editor ./static-editor

# Copy example config (users mount their own config.toml at runtime)
COPY --from=builder /app/config.example.toml ./config.example.toml

# Create data directory for SQLite, uploads, and search index
RUN mkdir -p /app/data /app/data/uploads /app/data/search \
    && chown -R plane:plane /app

USER plane

EXPOSE 8080

# Persistent data volume (SQLite DB, uploads, search index)
VOLUME ["/app/data"]

# Frontend assets volume (allows swapping without rebuild)
VOLUME ["/app/static"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://localhost:8080/health 2>/dev/null | grep -q '"status":"ok"' || exit 1

ENTRYPOINT ["atur"]
CMD ["--config", "config.toml", "serve"]
