# CI: Play and App Store release builds

Store builds run on GitHub Actions, never on the laptop (no Gradle, Xcode or `expo prebuild` runs there). Two manual workflows, modelled on JoyoRogo's (`../joyorogo/docs/ci-release.md`):

| Workflow              | Runs on         | Does                                                                                                                                                                                                |
| --------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `release-android.yml` | `ubuntu-latest` | `scripts/build-native-aab.sh` (Play AAB), bundletool permission guard, artifacts + SHA-256, optional Play upload (`r0adkll/upload-google-play`). Play is the only Android channel (no sideload APK) |
| `release-ios.yml`     | `macos-latest`  | `scripts/ios/mac-build.sh`: `expo prebuild`, pods, `xcodebuild archive` + export, IPA checks, optional TestFlight upload                                                                            |

Both run only on `workflow_dispatch` (tag triggers are commented out at the top of each file) and are bound to the GitHub environment `release`. The existing `ci.yml` (lint, typecheck, tests) is separate and takes no secrets.

## Running a release

```bash
# Play AAB, artifact only
gh workflow run release-android.yml -R dzulfikar08/atur -f play_track=none
# Play AAB to the internal track as a draft (first upload to a new Play app must be a draft)
gh workflow run release-android.yml -R dzulfikar08/atur -f play_track=internal -f play_status=draft
# iOS IPA only / with TestFlight upload (needs the ASC app record for com.diatur.app)
gh workflow run release-ios.yml -R dzulfikar08/atur -f upload_testflight=false
gh workflow run release-ios.yml -R dzulfikar08/atur -f upload_testflight=true
```

Inputs: `play_track` = `none` | `internal` | `alpha` | `beta` (production is deliberately not offered); `play_status` = `draft` | `completed`; iOS `upload_testflight`, `xcode_version` (default `latest-stable`). Results are artifacts for 30 days: `atur-android-<run>` (AAB, `mapping-play.txt`; checksums in the run summary) and `atur-ios-<run>` (`Atur.ipa`).

Build numbers follow the laptop scripts: Android `versionCode` = minutes since 2024-01-01 UTC, iOS `CFBundleVersion` = `YYYYMMDDHHMM` UTC.

## GitHub setup

- Environment `release` on `dzulfikar08/atur`: deployments only from `master` (the default branch) and `v*` tags. **No required reviewer**: the repo is private on a plan that rejects the required-reviewers rule (HTTP 422 "billing plan"), so runs start without approval. Whoever can dispatch a workflow on `master` can use the secrets; keep write access limited. Add the reviewer (`dzulfikar08`, id 99225357) under Settings -> Environments -> release if the plan changes.
- All secrets are **environment secrets** of `release`, so workflows on other branches cannot read them. Signing files are written to the runner and removed in a final `always()` step; `GITHUB_TOKEN` is `contents: read`; actions are pinned to commit SHAs (same as JoyoRogo).
- The repo is private, so macOS minutes are billed (10x Linux minutes); an iOS run takes about 20-25 minutes.

## Secrets (environment `release`)

Set with `gh secret set NAME --env release -R dzulfikar08/atur` (value from stdin or `< file`).

| Secret                                                                   | Used by              | Source                                                                                                                                            |
| ------------------------------------------------------------------------ | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ANDROID_KEYSTORE_BASE64`                                                | Android              | base64 of `apps/native/keystore/atur-release.jks` (the Play **upload** key)                                                                       |
| `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` | Android              | `apps/native/keystore/keystore.properties`                                                                                                        |
| `GOOGLE_SERVICES_JSON` (optional)                                        | Android              | `apps/native/google-services.json` from the Firebase project (raw JSON or base64). Without it the AAB builds but cannot receive agent push alerts |
| `PLAY_SERVICE_ACCOUNT_JSON`                                              | Android, Play upload | `~/.config/joyorogo/play-billing-sa.json` (`joyorogo-play-billing@joyorogo.iam.gserviceaccount.com`, has an edit on `com.diatur.app`)             |
| `ASC_KEY_BASE64`, `ASC_KEY_ID`, `ASC_ISSUER_ID`                          | iOS                  | `~/Downloads/AuthKey_BUU2CPKLGM.p8` (base64), `BUU2CPKLGM`, `9e34111d-e39f-4122-9000-6eb4628fe9b9`                                                |
| `IOS_DIST_CERT_P12_BASE64`, `IOS_DIST_CERT_PASSWORD`                     | iOS                  | `.p12` of the team-wide Apple Distribution identity `~/.config/joyorogo-ios/distribution/{cert.der,key.pem}`, random password                     |

Rebuild the `.p12` (new certificate or password):

```bash
cd ~/.config/joyorogo-ios/distribution
pw=$(openssl rand -hex 16)
openssl x509 -inform der -in cert.der -out /tmp/cert.pem
openssl pkcs12 -export -inkey key.pem -in /tmp/cert.pem -out /tmp/dist.p12 -name "Apple Distribution" \
  -certpbe PBE-SHA1-3DES -keypbe PBE-SHA1-3DES -macalg sha1 -password pass:$pw   # macOS `security import` needs the old algorithms
base64 -w0 /tmp/dist.p12 | gh secret set IOS_DIST_CERT_P12_BASE64 --env release -R dzulfikar08/atur
printf %s "$pw" | gh secret set IOS_DIST_CERT_PASSWORD --env release -R dzulfikar08/atur
shred -u /tmp/dist.p12 /tmp/cert.pem
```

## Android notes

- The keystore is restored to `apps/native/keystore/` with an absolute `storeFile`, which `scripts/build-native-aab.sh` finds and never regenerates. Back up the original outside the repo: losing it means losing the Play upload key (reset via Play Console).
- The script's own guard (bundletool for the AAB) rejects `REQUEST_INSTALL_PACKAGES`, `SYSTEM_ALERT_WINDOW`, `QUERY_ALL_PACKAGES`, `MANAGE_EXTERNAL_STORAGE`; the workflow adds a second check for SMS, call log, contacts and the ad ID.
- A new Play app may only accept `draft` for the first release; use `play_status=draft`, then finish the rollout in Play Console. If Play answers 403, grant the service account "Release to testing tracks" on Atur (Users and permissions).

## iOS signing

The archive is signed automatically through the API key (`-allowProvisioningUpdates`); the export is manual: the job imports the `.p12` into a temporary keychain, `scripts/ios/asc-ci-profile.py` finds the certificate on App Store Connect by serial and reuses or creates the App Store profile `joyo-ci com.diatur.app <cert id>` (separate from the Linux pipeline's profile), and `mac-build.sh` exports with it as `EXPORT_PROFILE`. The script then checks the IPA: bundle id, build number, iOS 26 SDK, Apple Distribution authority, App Store profile (no device list), `get-task-allow` false, the **Sign in with Apple** entitlement, code signature, fresh `app.config`, inlined API URL and app code in `main.jsbundle`. The bundle id `com.diatur.app` already has `APPLE_ID_AUTH` enabled on the portal.

TestFlight upload (`upload_testflight`) fails until the owner has created the App Store Connect app record for `com.diatur.app` (the API cannot).

## Not yet proven by a CI run

- Android: first `bundleRelease` on a runner (R8 heap, bundletool path), and the first Play upload to `com.diatur.app`.
- iOS: the Xcode scheme/workspace name `Atur` that `expo prebuild` generates from `app.json` (`name`), the archive with automatic signing, and the `Atur.app/Info.plist` path used for the build number.
