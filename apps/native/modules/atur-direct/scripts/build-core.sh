#!/bin/bash
# Builds the Rust core (crates/atur-mobile of Atur Terminal) and installs it into this module:
#
#   android/src/main/jniLibs/<abi>/libatur_mobile.so
#   android/src/main/java/uniffi/atur_mobile/atur_mobile.kt
#   ios/Frameworks/AturMobile.xcframework
#   ios/Generated/atur_mobile.swift
#
# usage: scripts/build-core.sh [android|ios ...]        (default: android, plus ios on macOS)
#
# Where the source comes from:
#   ATUR_TERMINAL_DIR=<checkout>   use a local checkout of dzulfikar08/atur-terminal as it is
#   otherwise                      clone it at the commit pinned in core.ref
# Prebuilt libraries (CI hands them over): ATUR_CORE_ANDROID=<dir with jniLibs/ and kotlin/> and
# ATUR_CORE_IOS=<dir with AturMobile.xcframework and swift/> skip the build for that platform.
#
# The core is MIT licensed. Android needs cargo-ndk and the NDK (ANDROID_NDK_HOME); iOS needs
# macOS and Xcode.
set -euo pipefail

MODULE="$(cd "$(dirname "$0")/.." && pwd)"
PLATFORMS=("$@")
if [[ ${#PLATFORMS[@]} -eq 0 ]]; then
    PLATFORMS=(android)
    [[ "$(uname -s)" == Darwin ]] && PLATFORMS+=(ios)
fi
wants() { [[ " ${PLATFORMS[*]} " == *" $1 "* ]]; }

SOURCE="${ATUR_TERMINAL_DIR:-}"
needs_source=0
wants android && [[ -z "${ATUR_CORE_ANDROID:-}" ]] && needs_source=1
wants ios && [[ -z "${ATUR_CORE_IOS:-}" ]] && needs_source=1
if [[ $needs_source -eq 1 && -z "$SOURCE" ]]; then
    REF="$(tr -d '[:space:]' < "$MODULE/core.ref")"
    SOURCE="${ATUR_CORE_CACHE:-${TMPDIR:-/tmp}/atur-terminal-core}"
    if [[ ! -d "$SOURCE/.git" ]]; then
        git clone --quiet https://github.com/dzulfikar08/atur-terminal.git "$SOURCE"
    fi
    git -C "$SOURCE" fetch --quiet origin "$REF" 2>/dev/null || git -C "$SOURCE" fetch --quiet origin
    git -C "$SOURCE" checkout --quiet --detach "$REF"
fi

OUT="${ATUR_CORE_OUT:-${TMPDIR:-/tmp}/atur-core-out}"
if [[ $needs_source -eq 1 ]]; then
    for platform in "${PLATFORMS[@]}"; do
        PLATFORMS="$platform" "$SOURCE/scripts/build-mobile-sdk.sh" "$OUT"
    done
fi

if wants android; then
    ANDROID_SRC="${ATUR_CORE_ANDROID:-$OUT/android}"
    rm -rf "$MODULE/android/src/main/jniLibs" "$MODULE/android/src/main/java/uniffi"
    mkdir -p "$MODULE/android/src/main/jniLibs" "$MODULE/android/src/main/java/uniffi/atur_mobile"
    cp -R "$ANDROID_SRC/jniLibs/." "$MODULE/android/src/main/jniLibs/"
    cp "$ANDROID_SRC/kotlin/uniffi/atur_mobile/atur_mobile.kt" "$MODULE/android/src/main/java/uniffi/atur_mobile/"
fi

if wants ios; then
    IOS_SRC="${ATUR_CORE_IOS:-$OUT}"
    rm -rf "$MODULE/ios/Frameworks" "$MODULE/ios/Generated"
    mkdir -p "$MODULE/ios/Frameworks" "$MODULE/ios/Generated"
    cp -R "$IOS_SRC/AturMobile.xcframework" "$MODULE/ios/Frameworks/"
    cp "$IOS_SRC/swift/atur_mobile.swift" "$MODULE/ios/Generated/"
fi

echo "Core installed into $MODULE for: ${PLATFORMS[*]}"
