# Store screenshots

Capture plan and tooling for the Play and App Store screenshots. Captures show real workspace data: sign in
with the demo/review account, never a real person's workspace. Outputs go to `apps/native/dist/store/`
(gitignored).

## Review account and web capture (what the current store set used)

- `scripts/store-review-seed.ts` creates / tops up the store-review account on prod (`review@diatur.com`, workspace
  "Acme Mobile", projects Mobile App and Website, 16 issues, a module, a saved view, comments that fill the inbox) and
  writes `~/.config/atur/review-login.txt` (mode 600; never committed). It is idempotent and reads the credentials from
  that file. Re-run it if a reviewer deletes the account (the teammate user inherits the workspace and the script adds
  the review user back) or before recapturing, since dates are relative to the run day.
- `scripts/store-shots/capture-web.ts` captures the Expo web build (`cd apps/native && EXPO_PUBLIC_SERVER_URL=https://app.diatur.com bunx expo start --web --port 8081`)
  with headless Chromium at 360x640, 440x956 and 414x896 CSS px, device scale 3, into `/tmp/atur-store-shots/{play,ios-6.9,ios-6.5}`.
  Expo web has no system chrome, so each capture sits under a drawn status bar (9:41, signal, Wi-Fi, battery); nothing
  else is added. These are web renders of the same JS UI, not on-device captures.
- `scripts/store-shots/graphics.ts` writes the Play icon (512x512) and feature graphic (1024x500).

## Sizes

| Store     | Slot                 | Size                                                                   | Notes                                                                            |
| --------- | -------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Play      | Phone (min 2, max 8) | 1080x1920 or larger, 9:16 to 16:9, long side at most 2x the short side | The renderer's default 1390x2778 fits                                            |
| Play      | Feature graphic      | 1024x500 PNG/JPEG                                                      | One image, no alpha; wordmark + one headline                                     |
| Play      | App icon             | 512x512 PNG                                                            | `apps/native/assets/images/icon.png`, re-exported at 512 px                      |
| App Store | iPhone 6.9"          | 1290x2796 or 1320x2868                                                 | Required unless the 6.5" set is supplied                                         |
| App Store | iPhone 6.5"          | 1242x2688 or 1284x2778                                                 | `--width 1284` below gives 1284x2778                                             |
| App Store | iPad                 | none                                                                   | The app is iPhone-only (`supportsTablet: false`), so no iPad shots are asked for |

2 to 10 screenshots per App Store size. Order matters for the first three.

## What to capture (portrait, light theme, plus one dark)

1. **Today**: the Today home with a few assigned issues and one decision.
2. **Issue**: an issue open (state, priority, description, a couple of comments).
3. **Inbox**: unread notifications.
4. **My Issues / project list**: filtered by state.
5. **Search**: results for a query.
6. **New issue**: the create form.
7. **Profile (dark theme)**: appearance, workspace switcher, account section.

No real names or emails; no pricing (the app shows none).

## Capture

`capture.sh` opens deep links over adb (`atur://`) and runs `screencap`; the phone must be awake and unlocked
(`adb devices` for the serial):

```sh
ADB_SERIAL=<serial> scripts/store-shots/capture.sh apps/native/dist/store/captures \
  today=atur:// inbox=atur:///inbox projects=atur:///projects profile=atur:///profile \
  issue=atur:///issue/<workspace-slug>/<project-id>/<issue-id>
```

iPhone captures need a real iPhone or a Mac simulator; the Linux iOS build cannot launch the app. The same JS
UI renders on Android, so Android captures framed with the renderer are acceptable for the App Store only when
the frame is honest about being Android-captured content; prefer real iPhone captures when one is at hand
(JoyoFit's App Store set used framed Android captures, see `../watch-fit/docs/app-store.md`).

## Render

`atur.json` is a spec for JoyoRogo's renderer (dark slide, wordmark, headline, phone frame), reused as is rather than
copied: it needs `playwright` + `sharp` and Chromium, which JoyoRogo's checkout has. Paths in the spec resolve
relative to the spec file, so run it from the JoyoRogo checkout:

```sh
cd ../joyorogo
bun scripts/store-shots/render.ts ../atur/scripts/store-shots/atur.json                 # 1390x2778 (Play)
bun scripts/store-shots/render.ts ../atur/scripts/store-shots/atur.json --width 1284    # App Store 6.5"
bun scripts/store-shots/render.ts ../atur/scripts/store-shots/atur.json --only slide-01-today
```

Edit `atur.json` headlines to taste; `brandColor`/`highlightColor` are neutral to match Atur's graphite theme.
