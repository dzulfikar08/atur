#!/usr/bin/env bash
# Release APK for apps/native: signed with the local keystore, arm64-only,
# R8 + resource shrinking. ARCHS=x86_64 builds an emulator-testable APK.
#
# The keystore lives OUTSIDE android/ (prebuild wipes android/) and is
# gitignored. Back it up — updates must be signed with the same key.
#
# --publish uploads the APK to R2 (atur-assets/downloads/atur-latest.apk),
# which app.diatur.com serves at /public/downloads/android (profile page link).
set -euo pipefail
PUBLISH=0
[ "${1:-}" = "--publish" ] && PUBLISH=1
cd "$(dirname "$0")/.."
NATIVE=apps/native
KEYSTORE_DIR="$NATIVE/keystore"
KEYSTORE="$KEYSTORE_DIR/atur-release.jks"
PROPS="$KEYSTORE_DIR/keystore.properties"

export JAVA_HOME="${JAVA_HOME:-$HOME/jdk17}"
export PATH="$JAVA_HOME/bin:$PATH"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/android-sdk}"

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

# 2. Fresh prebuild.
cd "$NATIVE"
rm -rf android
bunx expo prebuild -p android --no-install 2>&1 | tail -1

# 3. Release signing + shrinking patches.
python3 - <<'PY'
import os, re, pathlib
app = pathlib.Path("android/app/build.gradle")
s = app.read_text()
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
# comment lines between `release {` and its signingConfig.
s, n = re.subn(
    r"(\n        release \{\n(?:\s*//.*\n)*\s*signingConfig )signingConfigs\.debug",
    r"\1signingConfigs.release",
    s,
    count=1,
)
if n != 1 or "keystore.properties" not in s:
    raise SystemExit("build.gradle template changed: release signing patch did not apply")
app.write_text(s)

props = pathlib.Path("android/gradle.properties")
p = props.read_text()
p = re.sub(r"reactNativeArchitectures=.*", "reactNativeArchitectures=" + os.environ.get("ARCHS", "arm64-v8a"), p)
# The template has neither key; a sub on a missing key silently leaves R8 off.
for key in ("android.enableMinifyInReleaseBuilds", "android.enableShrinkResourcesInReleaseBuilds"):
    p = re.sub(rf"^{re.escape(key)}=.*\n?", "", p, flags=re.M)
    p = p.rstrip("\n") + f"\n{key}=true\n"
props.write_text(p)
PY

# 4. Build.
cd android
./gradlew assembleRelease --no-daemon
APK=app/build/outputs/apk/release/app-release.apk

# 5. Bundle sanity: the inlined server URL must be the intended API. Capture
# first: `grep -q` exiting early would SIGPIPE the pipeline under pipefail.
BUNDLE_STRINGS=$(unzip -p "$APK" assets/index.android.bundle | strings)
if ! grep -qF "$EXPO_PUBLIC_SERVER_URL" <<<"$BUNDLE_STRINGS"; then
  echo "release bundle does not contain the API URL $EXPO_PUBLIC_SERVER_URL" >&2
  exit 1
fi

mkdir -p ../dist
cp "$APK" ../dist/atur-release.apk
ls -la ../dist/atur-release.apk
echo RELEASE-APK-DONE

if [ "$PUBLISH" = 1 ]; then
  cd ../../app
  bunx wrangler r2 object put atur-assets/downloads/atur-latest.apk --remote \
    --file ../native/dist/atur-release.apk \
    --content-type application/vnd.android.package-archive
  echo "published: https://app.diatur.com/public/downloads/android"
fi
