# Atur native app: building and releasing

`apps/native` (Expo SDK 57, package and bundle id `com.diatur.app`) ships three ways. Store builds (Play AAB, App Store IPA, site APK) are produced by GitHub Actions: **[`ci-release.md`](ci-release.md)** is the primary path (`gh workflow run release-android.yml ...`, `gh workflow run release-ios.yml ...`; no heavy build runs on the laptop). The commands below are the same scripts the workflows call; use them only as a fallback.

| Channel                                      | Command                                                            | Output                                         | Where it goes                                                                             |
| -------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Site APK (sideload, with the in-app updater) | `scripts/build-native-apk.sh [--publish]`                          | `apps/native/dist/atur-release.apk`            | `--publish` uploads it to R2; `https://app.diatur.com/public/downloads/android` serves it |
| Google Play bundle                           | `scripts/build-native-apk.sh --play` then `scripts/play-upload.py` | `apps/native/dist/atur-play-<versionCode>.aab` | a Play track (`internal`, `alpha`, `beta`)                                                |
| App Store / TestFlight                       | `scripts/build-ios-linux.sh [--upload]`                            | `$ATUR_IOS_WORK/out/Atur.ipa`                  | App Store Connect                                                                         |

Store runbooks: [`play-store.md`](play-store.md), [`app-store.md`](app-store.md). Listing copy lives in [`store-listing.json`](store-listing.json) and is length-checked by `scripts/check-store-listing.py`.

## Distribution flag

`apps/native/app.config.ts` wraps `app.json` and exposes `ATUR_DISTRIBUTION` (`site`, default, or `play`) as `extra.distribution`; `apps/native/lib/distribution.ts` turns it into `IS_PLAY_BUILD`. The only behavioural difference: the Play build hides Profile's "Download latest Android app" row (Play forbids apps that distribute their own updates). The app never installs packages itself (the row opens the download in the system browser), so `REQUEST_INSTALL_PACKAGES` is not in either manifest. The iOS build is always `site` (the row is Android-only).

## Version numbers

- **Version name**: `expo.version` in `apps/native/app.json` (currently `1.1.0`). Bump it by hand for a user-visible release; the stores show it.
- **Android versionCode**: minutes since 2024-01-01 UTC, computed by `build-native-apk.sh` for both the APK and the AAB and patched into `android/app/build.gradle` on every run. It rises with every build, stays below Play's 2100000000 cap for millennia, and is above the `3` of the first sideload APK, so devices that have 1.0.2 (versionCode 3) update to any new build. `app.json`'s `android.versionCode` is only the prebuild template value.
- **iOS build number** (`CFBundleVersion`): UTC `YYYYMMDDHHmm`, stamped into the IPA by `asc.py stamp`. `BUILD_NUMBER=<n>` overrides it. App Store Connect needs it to rise per version; the timestamp always does. `app.json`'s `ios.buildNumber` is only the prebuild template value.

## Android

```bash
scripts/build-native-apk.sh                # site APK, arm64-v8a
scripts/build-native-apk.sh --publish      # ...and upload to R2 (wrangler login required)
scripts/build-native-apk.sh --play         # AAB, arm64-v8a + armeabi-v7a
scripts/build-native-apk.sh --play --clean # force a fresh prebuild
ARCHS=x86_64 scripts/build-native-apk.sh   # emulator-testable APK
```

- `android/` is reused between builds when `app.json`, `app.config.ts`, `package.json`, `bun.lock`, `assets/` and the distribution flag are unchanged; otherwise prebuild runs again. A cold build takes about 30 minutes, a warm one a few.
- The release keystore is `apps/native/keystore/atur-release.jks` with `keystore.properties` next to it (both gitignored; the script generates them once if missing, never overwrites). **Back both up outside the repo.** The site APK is signed with it, and the Play AAB is signed with it as the Play **upload key** (see `play-store.md`, "Play App Signing").
- The script fails when the merged manifest contains `REQUEST_INSTALL_PACKAGES`, `SYSTEM_ALERT_WINDOW`, `QUERY_ALL_PACKAGES` or `MANAGE_EXTERNAL_STORAGE` (bundletool for the AAB, aapt2 for the APK), and when the JS bundle does not contain the API URL. `EXPO_PUBLIC_SERVER_URL` defaults to `https://app.diatur.com` and beats any `apps/native/.env`.
- `~/.gradle` is a symlink to the ioswork volume on this machine, which is small and shared: the script stops with a message if that volume is not mounted, and a full build peaked high enough on it to hit "No space left on device" (R8). Use `GRADLE_USER_HOME=$HOME/.cache/atur-gradle scripts/build-native-apk.sh ...` to keep Gradle's caches on /home (a first build then downloads the dependencies again).
- `BUNDLETOOL` overrides the bundletool jar (default `~/.cache/bundletool/bundletool.jar`).

### Uploading to Play

```bash
scripts/play-upload.py                                   # newest dist/atur-play-*.aab -> internal, draft
scripts/play-upload.py --track alpha --status completed  # closed testing, rolled out
scripts/play-upload.py --track internal --notes "First test build" --dry-run
```

The script is the Android Publisher API's edits flow (insert edit, upload bundle, set the track release, commit) with a service-account JWT. Credentials: `~/.config/joyorogo/play-billing-sa.json`, or `PLAY_SERVICE_ACCOUNT_JSON=<path>`. It needs the standard library plus `cryptography`; `~/.local/share/joyorogo-ios/venv/bin/python scripts/play-upload.py ...` has it. The service account must be invited on the **Atur** app in Play Console (see the checklist below); the same JoyoRogo service account works once it has been granted access to this app. Play answers `Package not found: com.diatur.app` until the app exists in the Console.

## iOS (Linux, no Mac, no Xcode)

```bash
scripts/build-ios-linux.sh            # App Store-signed Atur.ipa, checked by asc.py validate
scripts/build-ios-linux.sh --upload   # ...then upload to App Store Connect (TestFlight)
scripts/build-ios-linux.sh --dev      # development-signed Atur-dev.ipa for the team's registered iPhones
FROM_STEP=6 scripts/build-ios-linux.sh   # resume at step n (1-7)
NINJA_ARGS="-k 0" scripts/build-ios-linux.sh   # ninja arguments: -k 0 lists every compile error
```

It is JoyoFit's pipeline (`../watch-fit/scripts/build-ios-linux.sh`, `docs/ios-linux.md`; JoyoRogo's is the original) adapted to a monorepo app: `expo prebuild` runs in `$WORK/project` (symlinks to `apps/native/assets` and `node_modules`, copies of the config files) so the repo never gets an `ios/`; CocoaPods installs the pods with shims; the Expo macros plugin and `ExpoModulesJSI` are built with SwiftPM; `scripts/ios/gen-ninja.rb` turns the Xcode projects into `build.ninja`; ninja compiles every pod with the Swift toolchain against the iPhoneOS SDK; `assemble-app.py` bundles the JS (Hermes bytecode), compiles the asset catalog and writes `Info.plist`; `enable-capabilities.py` registers `com.diatur.app` and turns on Sign in with Apple (`APPLE_ID_AUTH`) via the App Store Connect API; `sign-app.py` signs with the team's Apple Distribution identity (rcodesign); `asc.py validate` checks the IPA.

- Work directory `ATUR_IOS_WORK` (default `/run/media/dzul/ioswork/atur-ios`): `project/`, `out/` (`Atur.ipa`, `build.ninja`, logs), `cache/`. The volume is small (a few GB free); set `ATUR_IOS_SHARED_CACHE=<dir with macros-*, CocoaPods, xdg>` (for example `/run/media/dzul/ioswork/joyofit-ios/cache`) to reuse another project's tool caches instead of rebuilding them. Do not delete other projects' directories there.
- Host prerequisites are the same as JoyoFit's (`../watch-fit/docs/ios-linux.md`): Swift 6.4 at `~/.local/swift-6.4/usr/bin`, omarchy-apple-dev with its `darwin` Swift SDK (Xcode 27 `.xip`), CocoaPods, `ninja`, `rcodesign`, `ld64.lld`, `llvm-ar`, Bun, Node, Ruby, and a Python with `cryptography` (`ASC_PYTHON`, default `~/.local/share/joyorogo-ios/venv/bin/python`).
- App Store Connect API key: `ASC_KEY_ID=BUU2CPKLGM`, `ASC_ISSUER_ID=9e34111d-e39f-4122-9000-6eb4628fe9b9`, `ASC_KEY_PATH=~/Downloads/AuthKey_BUU2CPKLGM.p8` (defaults in the script; override with env). The Apple Distribution certificate is team-wide (team `F6Q6UFUK69`): `ASC_IDENTITY_DIR` defaults to JoyoRogo's `~/.config/joyorogo-ios/distribution`.
- `--upload` needs an App Store Connect app record for `com.diatur.app`. The API cannot create one: see the checklist.
- Nothing here runs the app on an iPhone. A build that passes `asc.py validate` has not been launched; install `--dev` builds on a registered iPhone to smoke-test.
- The iOS app is iPhone-only (`supportsTablet: false`): the UI is portrait-only and not laid out for iPad, which also means App Store Connect asks for no iPad screenshots. Flip it only together with an iPad layout pass and iPad screenshots.

## Where secrets live (none are in the repo)

| Secret                               | Location                                                                                        |
| ------------------------------------ | ----------------------------------------------------------------------------------------------- |
| Android release keystore + passwords | `apps/native/keystore/` (gitignored). Back up elsewhere.                                        |
| Play service account                 | `~/.config/joyorogo/play-billing-sa.json` (shared with JoyoRogo) or `PLAY_SERVICE_ACCOUNT_JSON` |
| App Store Connect API key            | `~/Downloads/AuthKey_BUU2CPKLGM.p8` (`ASC_KEY_PATH`)                                            |
| Apple Distribution identity          | `~/.config/joyorogo-ios/distribution` (`ASC_IDENTITY_DIR`)                                      |
| Apple sign-in server secrets         | the Worker's secrets (see `apps/app/src/worker/lib/env.ts`), not in this repo                   |

## Owner-only checklist (what the scripts cannot do)

Play:

1. Create the Play Console app `Atur` with package `com.diatur.app` (`play-store.md`, section 2) and choose the App Signing option before the first upload.
2. Grant the service account (`client_email` in `play-billing-sa.json`) access to the new app: Play Console -> Users and permissions -> invite it with "Release to testing tracks" (plus "Manage testing tracks and edit tester lists" for closed testing). Console grants on a per-app basis.
3. Upload the first AAB by hand in the Console (Play wants the first release created in the UI before the API can manage it) or try `scripts/play-upload.py --status draft`, then fill in the store listing, App content (data safety, content rating, app access, health/financial declarations) from `play-store.md`, screenshots, and the closed test (12 testers x 14 days if the account is personal).

App Store:

4. App Store Connect -> Apps -> `+` -> New App: platform iOS, name, primary language, bundle id `com.diatur.app` (already registered with Sign in with Apple), SKU `atur-ios`. The API key cannot create apps.
5. Fill the listing, App Privacy, age rating, review account and screenshots from `app-store.md`; set the privacy policy URL `https://diatur.com/privacy` and support URL `https://diatur.com/support`.
6. Run `scripts/build-ios-linux.sh --upload`, wait for processing, pick the build for version 1.1.0, submit for review.

Both stores:

7. Create a demo account for the reviewers (password login works; do not commit the password) and put it in the review notes.
8. Deploy the server pieces (account deletion, Apple sign-in endpoint) and the web `/privacy#delete-account` section before submitting: both stores check them.
9. Capture screenshots (`scripts/store-shots/README.md`).
