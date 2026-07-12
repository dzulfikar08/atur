#!/bin/bash
# Install atur
set -e

OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

echo "Installing atur..."
echo "  OS:   $OS"
echo "  ARCH: $ARCH"

# Check for Rust toolchain
if ! command -v cargo &>/dev/null; then
    echo "Error: cargo not found. Install Rust from https://rustup.rs"
    exit 1
fi

echo ""
echo "Building atur from source..."
cargo build --release

echo ""
echo "Installing binary to /usr/local/bin..."
if [ -w /usr/local/bin ]; then
    cp target/release/atur /usr/local/bin/
else
    echo "sudo required to write to /usr/local/bin"
    sudo cp target/release/atur /usr/local/bin/
fi

echo ""
echo "Done! Run: atur serve"
echo ""
echo "Quick start:"
echo "  1. Copy config.example.toml to config.toml and edit"
echo "  2. Run: atur migrate"
echo "  3. Run: atur serve"
