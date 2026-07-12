#!/usr/bin/env bash
set -euo pipefail

CRATE_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$CRATE_DIR/../.." && pwd)"
BUILD_DIR="$PROJECT_ROOT/build"
TEMP_DIR="$BUILD_DIR/.tmp"
CRATE_NAME="atur_worker"

WASM_BINDGEN="wasm-bindgen"
WASM_BINDGEN_CLI="wasm-bindgen-0.2.126"

if command -v "$WASM_BINDGEN_CLI" &>/dev/null; then
    WASM_BINDGEN="$WASM_BINDGEN_CLI"
elif command -v wasm-bindgen &>/dev/null; then
    # Check if the existing wasm-bindgen matches the required version
    EXISTING_VERSION=$(wasm-bindgen --version 2>&1 | head -1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' || echo "")
    if [ "$EXISTING_VERSION" = "0.2.126" ]; then
        WASM_BINDGEN="wasm-bindgen"
    else
        echo "wasm-bindgen version mismatch (have $EXISTING_VERSION, need 0.2.126)"
        echo "Installing wasm-bindgen-cli 0.2.126..."
        cargo install wasm-bindgen-cli --version 0.2.126
        WASM_BINDGEN="wasm-bindgen"
    fi
else
    echo "wasm-bindgen not found. Installing wasm-bindgen-cli 0.2.126..."
    cargo install wasm-bindgen-cli --version 0.2.126
    WASM_BINDGEN="wasm-bindgen"
fi

echo "=== Building $CRATE_NAME ==="

# Step 1: Compile Rust to WASM
cd "$CRATE_DIR"
cargo build --lib --release --target wasm32-unknown-unknown

WASM_FILE="$PROJECT_ROOT/target/wasm32-unknown-unknown/release/${CRATE_NAME}.wasm"
echo "WASM binary size: $(du -h "$WASM_FILE" | cut -f1)"

# Step 2: Run wasm-bindgen WITHOUT --force-enable-abort-handler
# (that flag causes "externref table required for catch wrappers" error on newer Rust)
mkdir -p "$TEMP_DIR"
"$WASM_BINDGEN" "$WASM_FILE" \
  --out-dir "$TEMP_DIR" \
  --no-typescript \
  --target module \
  --out-name index \
  --experimental-reset-state-function

# Step 3: Copy to build directory (preserving snippets/)
rsync -a "$TEMP_DIR/" "$BUILD_DIR/"
rm -rf "$TEMP_DIR"

# Step 3b: Patch "import source" -> "import" in generated index.js
# (wasm-bindgen 0.2.126 emits "import source" for WASM modules which
# wrangler v4.x cannot bundle in IIFE fallback format)
if [ -f "$BUILD_DIR/index.js" ]; then
  sed -i '' 's/import source wasmModule from/import wasmModule from/' "$BUILD_DIR/index.js"
fi

# Step 3c: Add default export for module format Workers
# wrangler v4 requires a default export for D1 bindings (module format).
# wasm-bindgen 0.2.126 generates named exports (fetch, __wbg_reset_state, etc.)
# but no default export. Add one so wrangler detects this as a module Worker.
if [ -f "$BUILD_DIR/index.js" ]; then
  echo '' >> "$BUILD_DIR/index.js"
  echo 'export default { fetch, __wbg_reset_state }' >> "$BUILD_DIR/index.js"
fi

# Step 4: Create package.json
cat > "$BUILD_DIR/package.json" << 'EOF'
{
  "name": "atur",
  "version": "0.1.0",
  "type": "module",
  "main": "index.js",
  "sideEffects": ["./index.js"],
  "files": ["index_bg.wasm", "index.js", "index.d.ts"]
}
EOF

# Step 5: Create worker/shim.mjs for backwards compat
mkdir -p "$BUILD_DIR/worker"
cat > "$BUILD_DIR/worker/shim.mjs" << 'EOF'
export * from '../index.js';
export { default } from '../index.js';
EOF

echo "=== Build complete ==="
du -sh "$BUILD_DIR"/
ls -lh "$BUILD_DIR"/
