#!/bin/bash
# Install plane-pmo
set -e

OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

echo "Installing plane-pmo..."
echo "  OS:   $OS"
echo "  ARCH: $ARCH"

# Check for Rust toolchain
if ! command -v cargo &>/dev/null; then
    echo "Error: cargo not found. Install Rust from https://rustup.rs"
    exit 1
fi

echo ""
echo "Building plane-pmo from source..."
cargo build --release

echo ""
echo "Installing binary to /usr/local/bin..."
if [ -w /usr/local/bin ]; then
    cp target/release/plane-pmo /usr/local/bin/
else
    echo "sudo required to write to /usr/local/bin"
    sudo cp target/release/plane-pmo /usr/local/bin/
fi

echo ""
echo "Done! Run: plane-pmo serve"
echo ""
echo "Quick start:"
echo "  1. Copy config.example.toml to config.toml and edit"
echo "  2. Run: plane-pmo migrate"
echo "  3. Run: plane-pmo serve"
