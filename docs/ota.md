# Over-the-air JS updates (EAS Update)

JS and asset fixes (screens, copy, logic) reach installed apps in minutes instead of waiting for a store build and review. Native binaries are still built by our own scripts (`scripts/build-native-aab.sh`, `scripts/ios/mac-build.sh`, the `Release *` workflows). Only the update hosting is EAS: EAS Update works with self-built binaries, no EAS Build is involved.

|                |                                                                                                                                                          |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Library        | `expo-updates`                                                                                                                                           |
| EAS project    | `@dzulfikar08/atur`, id `469744b3-e97c-4b0d-ab1e-209fb803751e` (`apps/native/app.json`: `extra.eas.projectId`, `updates.url`, `owner`)                   |
| runtimeVersion | `{ "policy": "fingerprint" }`                                                                                                                            |
| Channels       | `production` (App Store, TestFlight and Play builds: `updates.requestHeaders["expo-channel-name"]`). `preview` exists on EAS; no build listens to it yet |
| Publish        | `scripts/ota.sh "<message>"` or the **OTA update** workflow                                                                                              |
| Signing        | none: EAS Update code signing needs a paid EAS plan (see Signing)                                                                                        |

## What may ship over the air (store policy)

Only JS and asset bug fixes and improvements that leave the app doing what it was submitted to do: the Atur issue tracker client (issues, projects, inbox, search, feedback).

- Apple: interpreted code may be downloaded as long as it does not change the app's primary purpose or add features inconsistent with what was reviewed (guidelines 3.3.1 and 4.7). It runs in React Native's own JS engine, not a downloaded native binary.
- Google Play: the Device and Network Abuse policy forbids an app from modifying or replacing itself outside Play's update mechanism, with an exception for code run in an interpreter or VM that reaches Android APIs only indirectly. Hermes JS is that case. Native code never ships over the air.

Fine over the air: layout, copy, spacing, logic fixes, screens built from what the app already does, image assets.

**Not** over the air, ship a reviewed build:

- a new primary purpose, or a feature the store listing and review notes do not describe;
- new permissions or a new use of one, new data collection or sharing (Play Data safety, App Store privacy labels), new SDKs or trackers, new endpoints for data the policies list;
- anything that opens a store of other code or bypasses OS signing or sandboxing;
- native code, `app.json` native settings, native dependencies (they change the runtime and cannot ship over the air anyway).

This is our reading of the policies; read the current Apple and Google text before a gray-area change.

## How a build and an update find each other: runtimeVersion

Policy `fingerprint`: every binary embeds a hash of its native side, and the server only offers an update published for that hash. An update can never land on a binary with incompatible native code; a mismatch is silent and safe (the server answers 204 and the app keeps what it has).

The hash covers the resolved Expo config of `app.json` (including `version`, `ios.buildNumber`, `extra`, plugins, `updates`), icon and splash images, every autolinked native package, and `scripts` in `package.json`. It does **not** cover JS/TS source, JS-only dependencies or the generated `android/` and `ios/` folders. Bumping `version` or touching any native-relevant line creates a new runtimeVersion; updates published afterwards reach only binaries built from that state.

Check what a commit resolves to: `scripts/ota.sh --runtime` (prints android and ios). Profile, App updates shows the first 8 characters of the runtime a device runs; they must match for the update to reach it.

## Behaviour in the app

- `checkAutomatically: ON_LOAD`, `fallbackToCacheTimeout: 0`: a cold start launches immediately with the newest bundle already on the device, checks in the background and downloads a newer update. It applies on the next cold start.
- `apps/native/lib/ota.ts` (`useUpdates`) drives the UI. When an update is downloaded, `components/update-banner.tsx` (mounted in the root layout) shows "Update ready — Restart to update" with **Restart to update** and **Later**.
- Profile, **App updates**: status, channel, running bundle (built into the app, or update id and date), runtime (8 characters), **Check for updates**, **Restart to update**.
- Returning to the foreground re-checks, at most every 6 hours (`CHECK_THROTTLE_MS`).
- Off in dev clients, Expo Go and web (`Updates.isEnabled` false): the section and banner do not render.
- Failure falls back: a failed check or download changes nothing, and a downloaded update that crashes on start is dropped by expo-updates' launch error recovery (the previous or embedded bundle runs). Not yet exercised on a device: do the test below after the first OTA-enabled build.

## When the printed runtime does not match the installed one

`--runtime` computes the fingerprint on a clean tree; a Gradle build computes it while it runs, and the two can differ [inference from JoyoFit, where they did]. An update published for the printed hash then reaches nobody. Read what the binary carries:

- Android: `unzip -p app.apk assets/fingerprint` (from the APK, or `unzip -p app.aab base/assets/fingerprint`), or Profile, App updates, Runtime (8 characters).
- Publish for exactly that value: `scripts/ota.sh --platform android --runtime-version <40 hex> "message"`, or the workflow's `runtime_version` input (single platform).

## Publish

```
scripts/ota.sh "Fix the issue list header"     # production, android + ios
scripts/ota.sh --platform ios "Copy fix"       # one platform
scripts/ota.sh --runtime                       # runtimeVersion only
```

It runs `bunx tsc --noEmit` in `apps/native`, then per platform a release `expo export` (fails when the bundle holds no app code), then `eas update --channel production --skip-bundler`, and prints one line per platform: `android  channel=production  runtimeVersion=<hash>  group=<id>`. Android and iOS are two update groups. Nothing goes to a store.

From GitHub: Actions, **OTA update**, Run workflow (`message`, `channel`, `platform`, `runtime_version`). The job runs in the `release` environment and uses its `EXPO_TOKEN` secret. Group ids land in the job summary. The repo is private and the environment has no required reviewer on this plan, so anyone who can dispatch workflows can publish.

## Roll back

Instant, no store involved; devices pick it up at their next check.

```
bunx eas-cli update:rollback <group id> --non-interactive
bunx eas-cli update:roll-back-to-embedded --channel production --runtime-version <hash> --platform android
bunx eas-cli update:republish --group <older group id>
bunx eas-cli update:list --branch production
```

The group must be the latest of its branch and runtimeVersion. Roll Android and iOS back separately.

## When OTA is not enough

Anything that changes the runtimeVersion, or is on the "not over the air" list, needs a new binary via the `Release *` workflows; updates then target the new runtime. To keep fixing an older binary, publish from a checkout of the commit it was built from. Binaries built before expo-updates was added have no OTA.

Both store builds run `expo prebuild`, so expo-updates' native config is generated at build time: Android Gradle (`createUpdatesResources`) embeds the manifest and fingerprint, iOS (`scripts/ios/mac-build.sh`: prebuild, xcodebuild) embeds `app.manifest` and the runtime in `Expo.plist`. `scripts/build-ios-linux.sh` refuses to run because its Xcode-free pipeline does not embed those resources; `ATUR_ALLOW_IOS_LINUX_WITHOUT_UPDATES=1` overrides.

## Signing

EAS Update code signing is not enabled: it needs the EAS Production or Enterprise plan (the free account `dzulfikar08` fails with "EAS Update code signing requires a subscription"). A binary that embeds a certificate rejects unsigned updates, so config and plan must change together. Until then trust rests on TLS to `u.expo.dev` plus control of the Expo account and the `EXPO_TOKEN` secret: keep 2FA on the Expo account.

## Accounts and secrets

- Expo account `dzulfikar08`; project `atur` created with `eas init`; channels with `eas channel:create production|preview`.
- `EXPO_TOKEN`: account-wide personal access token (shared with JoyoFit), stored as the `release` environment secret of `dzulfikar08/atur` (`gh secret set EXPO_TOKEN --env release -R dzulfikar08/atur < ~/.config/joyofit/expo-token`) and in `~/.config/joyofit/expo-token`. Revoke on expo.dev, Account settings, Access tokens if it leaks.

## Testing after the first OTA-enabled build

1. Install the build. Profile, App updates: "Built into the app", channel `production`, 8-character runtime equal to `scripts/ota.sh --runtime` for that platform.
2. Publish a visible JS change: `scripts/ota.sh --platform <p> "test"`. Cold start twice: the first downloads (banner "Update ready" appears), the second runs it; Running shows the update id and date.
3. `bunx eas-cli update:rollback <group> --non-interactive`, cold start twice: back to "Built into the app".
4. Airplane mode, cold start: the app starts normally.
