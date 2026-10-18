#!/usr/bin/env bash
# iOS build on Linux, no Xcode and no Mac.
#
#   scripts/build-ios-linux.sh            build + sign Atur.ipa (App Store)
#   scripts/build-ios-linux.sh --upload   ...then upload it to App Store Connect (TestFlight)
#   scripts/build-ios-linux.sh --dev      build + development-sign Atur-dev.ipa
#                                         for the team's registered iPhones (USB install)
#
# FROM_STEP=<n> resumes at step n (1-5 prepare the project, 6 is the incremental ninja
# build, 7 assembles and signs); steps 1-5 must have run once before.
#
# Pipeline: expo prebuild -> pod install (CocoaPods on Linux, shims in
# scripts/ios/shims/pod) -> ExpoModulesJSI cross-built with SwiftPM ->
# scripts/ios/gen-ninja.rb turns the Pods + app projects into build.ninja ->
# ninja compiles every pod with the Swift toolchain's clang/swiftc against the
# iPhoneOS SDK -> JS bundle + Hermes bytecode -> asset catalog, launch
# screen, Info.plist -> signature (rcodesign) -> .ipa.
#
# Everything heavy (the prebuilt ios/ project, Pods, ninja output, tool caches)
# lives under ATUR_IOS_WORK, not in the repo and not in $HOME. The prebuild
# runs in $WORK/project, a farm of symlinks to apps/native's inputs, so the
# generated ios/ never touches the working tree (a symlinked ios/ would break
# CocoaPods, which resolves ../node_modules from the real path).
#
# ATUR_IOS_SHARED_CACHE=<dir> reuses another project's tool caches (Expo macros
# plugin, CocoaPods, SwiftPM) instead of building them again: the ioswork volume
# is small. Only caches that are keyed by version/content are read from it.
#
# One-time host setup (see docs/native-release.md):
#   - Swift 6.4 toolchain                    SWIFT_BIN   (~/.local/swift-6.4/usr/bin)
#   - omarchy-apple-dev, with its darwin Swift SDK built from Xcode 27's .xip
#     (`xtool sdk build`), Linux actool built  OMARCHY_APPLE_DEV (~/.local/share/omarchy-apple-dev)
#   - CocoaPods gem, ninja, rcodesign, ld64.lld, llvm-ar, rsync
#   - App Store Connect API key              ASC_KEY_PATH ASC_KEY_ID ASC_ISSUER_ID
set -euo pipefail
cd "$(dirname "$0")/.."
if [ "${ATUR_ALLOW_IOS_LINUX_WITHOUT_UPDATES:-0}" != 1 ]; then
  echo "build-ios-linux.sh cannot embed the expo-updates resources (app.manifest, runtime in Expo.plist); use scripts/ios/mac-build.sh or the Release iOS workflow (docs/ota.md)." >&2
  exit 1
fi
ROOT=$PWD
NATIVE=$ROOT/apps/native
WORK=${ATUR_IOS_WORK:-/run/media/dzul/ioswork/atur-ios}
PROJ=$WORK/project
IOS=$PROJ/ios
OUT=$WORK/out
CACHE=$WORK/cache
SHARED=${ATUR_IOS_SHARED_CACHE:-$CACHE}
SWIFT_BIN=${SWIFT_BIN:-$HOME/.local/swift-6.4/usr/bin}
OAD=${OMARCHY_APPLE_DEV:-$HOME/.local/share/omarchy-apple-dev}
SWIFTPM_DIR=${XDG_CONFIG_HOME:+$XDG_CONFIG_HOME/swiftpm}
DARWIN=${DARWIN_SDK:-${SWIFTPM_DIR:-$HOME/.swiftpm}/swift-sdks/darwin.artifactbundle}
PY=${ASC_PYTHON:-$HOME/.local/share/joyorogo-ios/venv/bin/python}
mode=${1:-}
FROM_STEP=${FROM_STEP:-1}

export ASC_KEY_ID=${ASC_KEY_ID:-BUU2CPKLGM}
export ASC_ISSUER_ID=${ASC_ISSUER_ID:-9e34111d-e39f-4122-9000-6eb4628fe9b9}
export ASC_KEY_PATH=${ASC_KEY_PATH:-$HOME/Downloads/AuthKey_$ASC_KEY_ID.p8}
# The Apple Distribution certificate is team-wide; JoyoRogo's identity is reused.
export ASC_IDENTITY_DIR=${ASC_IDENTITY_DIR:-$HOME/.config/joyorogo-ios/distribution}
# asc.py stamp writes DTXcode/DTXcodeBuild; a .xip-built SDK does not record them.
# The SDK here comes from Xcode 27.0 (27A266a).
export XCODE_VERSION=${XCODE_VERSION:-27.0} XCODE_BUILD=${XCODE_BUILD:-27A266a}

# Release JS env. The API baked into the bundle; set in the process so it beats
# any apps/native/.env used for local dev.
export NODE_ENV=production
export EXPO_PUBLIC_SERVER_URL="${EXPO_PUBLIC_SERVER_URL:-https://app.diatur.com}"

SDK=$(ls -d "$DARWIN"/Developer/Platforms/iPhoneOS.platform/Developer/SDKs/iPhoneOS[0-9]*.sdk | tail -n1)
[ -d "$SDK" ] || { echo "no iPhoneOS SDK under $DARWIN; build it from Xcode.xip (docs/native-release.md)" >&2; exit 1; }
export PATH="$SWIFT_BIN:$PATH"
GEM_BIN=$(ruby -e 'print Gem.user_dir')/bin
export PATH="$GEM_BIN:$PATH"
mkdir -p "$WORK" "$OUT" "$CACHE" "$SHARED/xdg" "$SHARED/CocoaPods" "$WORK/tmp"
# SwiftPM, CocoaPods and temp downloads stay on the work volume.
export XDG_CACHE_HOME=$SHARED/xdg CP_CACHE_DIR=$SHARED/CocoaPods TMPDIR=$WORK/tmp

# `if step N title; then ... fi`: prints the heading, fails when FROM_STEP skips step N.
step() {
  [ "$FROM_STEP" -le "$1" ] || return 1
  printf '\n== %s. %s ==\n' "$1" "$2"
}

# Bun's isolated install does not hoist expo-modules-core: reach it through expo.
MACROS_SRC=$(node -p "const r = (m, p) => require.resolve(m + '/package.json', {paths: [p]}); require('path').dirname(r('@expo/expo-modules-macros-plugin', r('expo-modules-core', r('expo', '$NATIVE'))))")/apple
MACROS_VERSION=$(node -p "require('$MACROS_SRC/../package.json').version")
MACROS=$SHARED/macros-$MACROS_VERSION
# On Linux SwiftPM names a macro's host tool after the target, no -tool suffix.
MACRO_TOOL=$MACROS/.build/release/ExpoModulesMacros

if step 1 "Expo prebuild"; then
  # app.json, package.json and tsconfig.json are copies: prebuild may rewrite them.
  rm -rf "$PROJ"
  mkdir -p "$PROJ"
  cp "$NATIVE/app.json" "$NATIVE/package.json" "$NATIVE/tsconfig.json" "$PROJ/"
  for entry in assets node_modules; do ln -s "$NATIVE/$entry" "$PROJ/$entry"; done
  (cd "$PROJ" && bunx expo prebuild -p ios --no-install 2>&1 | tail -1)
fi

if step 2 "pod install (release precompiled Expo modules)"; then
  (cd "$IOS" && PATH="$ROOT/scripts/ios/shims/pod:$ROOT/scripts/ios/shims:$PATH" \
    LANG=en_US.UTF-8 NODE_BINARY="$(command -v node)" TAR_OPTIONS=--warning=no-unknown-keyword \
    EXPO_PRECOMPILED_FLAVOR=release pod install > "$OUT/pod-install.log" 2>&1) ||
    { tail -40 "$OUT/pod-install.log" >&2; exit 1; }
fi

if step 3 "Expo macros plugin (Linux host build)"; then
  if [ ! -x "$MACRO_TOOL" ]; then
    rm -rf "$MACROS" && mkdir -p "$MACROS"
    cp -r "$MACROS_SRC/Package.swift" "$MACROS_SRC/Package.resolved" "$MACROS_SRC/Sources" "$MACROS/"
    # SwiftPM only builds a macro's host tool for a dependent target.
    "$PY" - "$MACROS/Package.swift" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read()
s = s.replace("  targets: [\n", '  targets: [\n    .target(name: "UseMacros", dependencies: ["ExpoModulesMacros"]),\n', 1)
open(p, "w").write(s)
PY
    mkdir -p "$MACROS/Sources/UseMacros" && echo "// builds the macro tool" > "$MACROS/Sources/UseMacros/Use.swift"
    (cd "$MACROS" && swift build -c release --target UseMacros 2>&1 | tail -2)
  fi
  echo "$MACRO_TOOL"
fi

if step 4 "ExpoModulesJSI.xcframework (SwiftPM cross build)"; then
  CACHE="$CACHE" bash "$ROOT/scripts/ios/build-jsi.sh" "$IOS/Pods" "$DARWIN"
fi

if step 5 "build.ninja"; then
  cat > "$OUT/toolchain.json" <<EOF
{"sdk": "$SDK", "clang": "$SWIFT_BIN/clang", "swiftc": "$SWIFT_BIN/swiftc",
 "swift_resource_dir": "$DARWIN/Developer/Toolchains/XcodeDefault.xctoolchain/usr/lib/swift",
 "ar": "$(command -v llvm-ar)", "ld": "$DARWIN/toolset/bin/ld64.lld",
 "macro_plugin": "$MACRO_TOOL", "node": "$(command -v node)"}
EOF
  ruby "$ROOT/scripts/ios/gen-ninja.rb" "$IOS" "$OUT" "$OUT/toolchain.json"
fi

if step 6 "Compile and link"; then
  # Script phases are stamp files without inputs: ninja runs each once and never again. The one that writes app.config
  # (app.json's `extra`, the scheme) has to run every build, or the first config ships for ever.
  for phase in $(grep -l get-app-config-ios.sh "$OUT"/phases/*.sh 2>/dev/null); do
    rm -f "$OUT/stamps/$(basename "$phase" .sh).stamp"
  done
  (cd "$IOS" && bash -l -c "./Pods/Target\ Support\ Files/Pods-Atur/expo-configure-project.sh" > /dev/null)
  ninja -C "$OUT" ${NINJA_ARGS:-}
fi

step 7 "Assemble, sign, package" || exit 0
"$PY" "$ROOT/scripts/ios/assemble-app.py" "$OUT" "$NATIVE" "$SDK" "$OAD"
APP=$(ls -d "$OUT"/Payload/*.app)
ASC="$OAD/tools/asc.py"
BUNDLE_ID=$(node -p "require('$OUT/app.json').bundle_id")

# Sign in with Apple is a portal capability: register the bundle id and enable it before any profile is made.
"$PY" "$ROOT/scripts/ios/enable-capabilities.py" "$BUNDLE_ID" APPLE_ID_AUTH

if [ "$mode" = --dev ]; then
  # iOS Development certificate + profile for every registered iPhone, reused on later runs.
  "$PY" "$OAD/tools/provision-dev.py" --bundle-id "$BUNDLE_ID" | tail -2
  rm -f "$OUT/Atur-dev.ipa"
  PATH="$(dirname "$PY"):$HOME/.cargo/bin:$PATH" bash "$OAD/tools/sign-dev.sh" "$APP" "$OUT/Atur-dev.ipa" \
    > "$OUT/sign-dev.log" 2>&1 || { tail -20 "$OUT/sign-dev.log" >&2; exit 1; }
  tail -1 "$OUT/sign-dev.log"
  "$PY" "$OAD/tools/macho-lint.py" "$OUT/Atur-dev.ipa" | tail -1
  echo "ipa: $OUT/Atur-dev.ipa"
  exit 0
fi

DARWIN_SDK="$DARWIN" "$PY" "$ASC" stamp "$APP" "${BUILD_NUMBER:-$(date -u +%Y%m%d%H%M)}"
PATH="$HOME/.cargo/bin:$PATH" OMARCHY_APPLE_DEV="$OAD" \
  APP_ENTITLEMENTS=$(node -p "require('$OUT/app.json').entitlements") \
  "$PY" "$ROOT/scripts/ios/sign-app.py" "$APP" "$OUT/identity"
rm -f "$OUT/Atur.ipa"
(cd "$OUT" && zip -qry Atur.ipa Payload)
DARWIN_SDK="$DARWIN" "$PY" "$ASC" validate "$OUT/Atur.ipa"
echo "ipa: $OUT/Atur.ipa"

if [ "$mode" = --upload ]; then
  printf '\n== 8. Upload to App Store Connect ==\n'
  "$PY" "$ASC" upload "$OUT/Atur.ipa"
fi
