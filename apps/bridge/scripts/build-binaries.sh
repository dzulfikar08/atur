#!/bin/sh
# Builds single-file atur-bridge binaries with `bun build --compile`.
#
#   scripts/build-binaries.sh                 all four targets
#   scripts/build-binaries.sh linux-x64 ...   only the named targets
#
# Output: apps/bridge/dist/atur-bridge-<os>-<arch> and dist/SHA256SUMS.
# Bun cross-compiles, so every target builds on one machine (the first build of a
# target downloads that target's Bun runtime, so it needs network access).
# The agent hook scripts are embedded in the binary: `atur-bridge hooks` writes them out.
set -eu

cd "$(dirname "$0")/.."

ALL_TARGETS="linux-x64 linux-arm64 darwin-x64 darwin-arm64"
TARGETS=${*:-$ALL_TARGETS}

mkdir -p dist
rm -f dist/SHA256SUMS

for target in $TARGETS; do
  case " $ALL_TARGETS " in
    *" $target "*) ;;
    *)
      echo "unknown target: $target (expected one of: $ALL_TARGETS)" >&2
      exit 2
      ;;
  esac
  out="dist/atur-bridge-$target"
  echo "building $out"
  bun build --compile --minify --target="bun-$target" src/main.ts --outfile "$out"
done

(
  cd dist
  for target in $TARGETS; do
    if command -v sha256sum >/dev/null 2>&1; then
      sha256sum "atur-bridge-$target"
    else
      shasum -a 256 "atur-bridge-$target"
    fi
  done > SHA256SUMS
)
cat dist/SHA256SUMS
