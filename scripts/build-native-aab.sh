#!/usr/bin/env bash
# Android release build for apps/native: the Play AAB, signed with the local release
# keystore, R8 + resource shrinking.
#
#   scripts/build-native-aab.sh            -> apps/native/dist/atur-play-<versionCode>.aab
#                                          (arm64-v8a + armeabi-v7a)
#   --clean forces a fresh prebuild. Upload with scripts/play-upload.py.
#
# The keystore lives OUTSIDE android/ (prebuild wipes android/) and is
# gitignored. Back it up: it is the Play upload key (docs/play-store.md).
#
# versionCode = minutes since 2024-01-01 UTC (strictly increases per build, stays
# far below Play's 2100000000 cap).
# Guide: docs/native-release.md.
set -euo pipefail
CLEAN=0
for arg in "$@"; do
  case "$arg" in
    --clean) CLEAN=1 ;;
    *) echo "unknown option: $arg" >&2; exit 1 ;;
  esac
done
cd "$(dirname "$0")/.."
# Absolute repo root: later steps run from apps/native/android.
ROOT="$(pwd)"
NATIVE=apps/native
KEYSTORE_DIR="$NATIVE/keystore"
KEYSTORE="$KEYSTORE_DIR/atur-release.jks"
PROPS="$KEYSTORE_DIR/keystore.properties"

export JAVA_HOME="${JAVA_HOME:-$HOME/jdk17}"
export PATH="$JAVA_HOME/bin:$PATH"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/android-sdk}"

# ~/.gradle may be a symlink to the SSD image (/run/media/dzul/ioswork/gradle-home), which is
# small and shared; GRADLE_USER_HOME=<dir> keeps this build's Gradle caches elsewhere.
if [ -z "${GRADLE_USER_HOME:-}" ] && [ -L "$HOME/.gradle" ] && [ ! -d "$HOME/.gradle/" ]; then
  echo "~/.gradle -> $(readlink "$HOME/.gradle") is not there: the ioswork SSD image is not mounted." >&2
  exit 1
fi

export ARCHS="${ARCHS:-arm64-v8a,armeabi-v7a}"
export VERSION_CODE="$(( ($(date -u +%s) - 1704067200) / 60 ))"

# The API baked into the bundle. Set in the process so it beats any
# apps/native/.env used for local dev.
export NODE_ENV=production
export EXPO_PUBLIC_SERVER_URL="${EXPO_PUBLIC_SERVER_URL:-https://app.diatur.com}"

# 1. Keystore — generated once, reused forever.
if [ ! -f "$KEYSTORE" ]; then
  mkdir -p "$KEYSTORE_DIR"
  STORE_PASS="$(openssl rand -hex 24)"
  keytool -genkeypair -v -keystore "$KEYSTORE" -alias atur \
    -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass "$STORE_PASS" -keypass "$STORE_PASS" \
    -dname "CN=Atur, OU=JoyoDigitama, O=JoyoDigitama, L=Malang, ST=JawaTimur, C=ID"
  cat >"$PROPS" <<EOF
storeFile=$PWD/$KEYSTORE
storePassword=$STORE_PASS
keyAlias=atur
keyPassword=$STORE_PASS
EOF
  chmod 600 "$PROPS"
  echo "keystore created: $KEYSTORE"
fi

# 2. Prebuild, only when native inputs changed (wiping android/ also wipes the
#    CMake caches and recompiles all native code). Inputs: app config, deps,
#    assets prebuild copies (icons, splash), google-services.json (FCM).
cd "$NATIVE"
STAMP=android/.prebuild-hash
PREBUILD_HASH="$(
  { sha256sum app.json app.config.ts package.json "$ROOT/bun.lock"
    # Optional Firebase config (FCM): its presence changes the prebuilt Gradle project.
    [ -f google-services.json ] && sha256sum google-services.json
    find assets -type f -print0 | sort -z | xargs -0 sha256sum
  } | sha256sum | cut -d' ' -f1
)"
if [ "$CLEAN" = 1 ] || [ ! -f "$STAMP" ] || [ "$(cat "$STAMP")" != "$PREBUILD_HASH" ]; then
  rm -rf android
  bunx expo prebuild -p android --no-install 2>&1 | tail -1
  echo "$PREBUILD_HASH" > "$STAMP"
else
  echo "native inputs unchanged; reusing android/"
fi

# 3. Release signing + shrinking + versionCode patches. android/ is reused
#    across builds, so every patch is idempotent.
python3 - <<'PY'
import os, re, pathlib
app = pathlib.Path("android/app/build.gradle")
s = app.read_text()
if "keystore.properties" not in s:
    s = s.replace(
        "android {",
        """def keystoreProperties = new Properties()
def keystorePropertiesFile = rootProject.file("../keystore/keystore.properties")
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
}

android {""",
        1,
    )
    s = s.replace(
        """    signingConfigs {
        debug {""",
        """    signingConfigs {
        release {
            if (keystorePropertiesFile.exists()) {
                storeFile file(keystoreProperties['storeFile'])
                storePassword keystoreProperties['storePassword']
                keyAlias keystoreProperties['keyAlias']
                keyPassword keystoreProperties['keyPassword']
            }
        }
        debug {""",
        1,
    )
# Only the release buildType switches to the release config. The template puts
# comment lines between `release {` and its signingConfig. Fail loudly instead
# of silently shipping a debug-signed build.
s, n = re.subn(
    r"(buildTypes \{.*?\n        release \{.*?signingConfig signingConfigs\.)(?:debug|release)",
    lambda m: m.group(1) + "release",
    s, count=1, flags=re.S,
)
if n != 1 or "keystore.properties" not in s:
    raise SystemExit("build.gradle template changed: release signing patch did not apply")
s, n = re.subn(r"versionCode \d+", "versionCode " + os.environ["VERSION_CODE"], s, count=1)
if n != 1:
    raise SystemExit("build.gradle has no versionCode to patch")
app.write_text(s)

props = pathlib.Path("android/gradle.properties")
p = props.read_text()
p = re.sub(r"reactNativeArchitectures=.*", "reactNativeArchitectures=" + os.environ["ARCHS"], p)
# The template has neither key; a sub on a missing key silently leaves R8 off.
for key in ("android.enableMinifyInReleaseBuilds", "android.enableShrinkResourcesInReleaseBuilds"):
    p = re.sub(rf"^{re.escape(key)}=.*\n?", "", p, flags=re.M)
    p = p.rstrip("\n") + f"\n{key}=true\n"
props.write_text(p)
PY

# 4. Build.
cd android
./gradlew bundleRelease
ARTIFACT=app/build/outputs/bundle/release/app-release.aab
JS_BUNDLE=base/assets/index.android.bundle

# 5. Bundle sanity: the inlined server URL must be the intended API. Capture
# first: `grep -q` exiting early would SIGPIPE the pipeline under pipefail.
BUNDLE_STRINGS=$(unzip -p "$ARTIFACT" "$JS_BUNDLE" | strings)
if ! grep -qF "$EXPO_PUBLIC_SERVER_URL" <<<"$BUNDLE_STRINGS"; then
  echo "release bundle does not contain the API URL $EXPO_PUBLIC_SERVER_URL" >&2
  exit 1
fi

# 6. Manifest guard: permissions Play rejects or the app never uses must not be
#    in the merged manifest (bundletool).
FORBIDDEN='REQUEST_INSTALL_PACKAGES|SYSTEM_ALERT_WINDOW|QUERY_ALL_PACKAGES|MANAGE_EXTERNAL_STORAGE'
BUNDLETOOL="${BUNDLETOOL:-$HOME/.cache/bundletool/bundletool.jar}"
PERMS=$(java -jar "$BUNDLETOOL" dump manifest --bundle "$ARTIFACT" |
  sed -n 's/.*<uses-permission[^>]*android:name="\([^"]*\)".*/\1/p' | sort -u)
echo "merged manifest permissions:"
sed 's/^/  /' <<<"$PERMS"
if grep -qE "$FORBIDDEN" <<<"$PERMS"; then
  echo "merged manifest has a forbidden permission: $(grep -E "$FORBIDDEN" <<<"$PERMS" | tr '\n' ' ')" >&2
  exit 1
fi

mkdir -p ../dist
OUT="$ROOT/$NATIVE/dist/atur-play-$VERSION_CODE.aab"
cp "$ARTIFACT" "$OUT"
ls -la "$OUT"
echo "versionCode=$VERSION_CODE"
echo RELEASE-AAB-DONE
