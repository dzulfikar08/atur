# Atur on Google Play: runbook

Package `com.diatur.app`, native app `apps/native`. Everything below is for the Play Console steps only the account owner can click through; the app, the upload artifact and the upload script are prepared in this repo. The pattern is JoyoRogo's (`../joyorogo/docs/play-store.md`). Build/upload commands and version schemes: [`native-release.md`](native-release.md).

"Verified" means read in this repo or on the cited page. "[INFERENCE]" marks reasoning where nothing was read.

## 0. What the repo ships for Play

| Item             | Where                                                                                                                                                                                  |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Build the bundle | `scripts/build-native-aab.sh` writes `apps/native/dist/atur-play-<versionCode>.aab` (gitignored): arm64-v8a + armeabi-v7a, R8 + resource shrinking, bundletool permission guard        |
| Upload           | `scripts/play-upload.py [--track internal\|alpha\|beta] [--status draft\|completed]` (service account, Android Publisher API)                                                          |
| versionCode      | minutes since 2024-01-01 UTC, computed per build. Play caps it at 2100000000.                                                                                                          |
| Signing          | `apps/native/keystore/atur-release.jks`, password in the gitignored `keystore.properties` next to it. Signs the AAB as the Play upload key (section 2). Back both up outside the repo. |

Atur is distributed only through Google Play and the App Store: no sideload APK, no in-app updater, no download route on the worker. The Profile screen has no install or update row. **v1.0.x sideload users must uninstall and install from Play**: with Play App Signing the installed key can differ (Google-generated app signing key), so Android refuses to update the old APK in place.

Release keystore fingerprints (public; compare with the Play Console upload-key screen after the first upload):

```
SHA-1:   6F:8B:42:01:C9:40:FB:F2:C6:95:93:82:3D:B5:D8:09:3C:B6:6D:D0
SHA-256: 10:FF:38:66:03:05:0D:72:EC:B2:C6:E6:9A:55:58:05:DA:CF:D1:C6:85:87:B3:36:56:13:12:FB:D6:41:F6:51
```

## 1. Developer account: personal vs organization

Source: https://support.google.com/googleplay/android-developer/answer/14151465

|                   | Personal                                                                                                                                            | Organization                                         |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Needs             | Government ID verification, phone, payment profile, one-time USD 25                                                                                 | D-U-N-S number, legal entity, website, phone, USD 25 |
| Production access | Accounts created after 13 Nov 2023 must run a closed test with **at least 12 testers opted in continuously for 14 days**, then apply for production | Exempt from the 12x14 rule                           |
| Public name       | Your legal name and a contact email appear on the store page                                                                                        | Organization name                                    |

Atur ships under the same Play account as JoyoRogo. Check Console -> Settings -> Account details for the account type. [INFERENCE] JoyoRogo's runbook assumed a personal account; if that holds, Atur also needs the 12x14 closed test (section 3) before production. Apps can be moved between developer accounts later, but confirm in Play Console help before relying on it.

## 2. Create the app and Play App Signing

1. Console -> **Create app**. Name `Atur: Project Management`, default language English (United States) `en-US`, App (not game), Free, accept the declarations.
2. **Test and release -> Setup -> App signing**. Two choices, and the choice at the first upload is permanent:

|                                  | A. Google-generated signing key (default)                                                                               | B. Upload `atur-release.jks` as the app signing key (PEPK)                                              |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Play installs are signed with    | A key Google creates and holds                                                                                          | The same key as the site APK                                                                            |
| `atur-release.jks` is            | The **upload key** only; lost or leaked, Play resets it ("Request upload key reset")                                    | The app signing key too; exposure compromises installs, and Play cannot rotate it for existing installs |
| Moving between site APK and Play | Needs an uninstall: the signatures differ, so neither channel updates the other (the session is lost with the app data) | Installs update in place both ways                                                                      |
| Cost                             | None                                                                                                                    | Run Google's PEPK tool once at app creation (steps below)                                               |

**Recommendation: A.** It is Google's default, keeps the sideload key from being the single point of failure for every Play user, and supports key reset. The price is a one-time reinstall for the few people who have the sideload build and want to switch to Play. Pick B only if keeping those people signed in matters more than the key-recovery safety net.

Option B steps (only at app creation, before any upload): App signing -> "Export and upload a key from a Java keystore" -> download the `pepk.jar` and the encryption public key shown, then:

```bash
java -jar pepk.jar --keystore=apps/native/keystore/atur-release.jks --alias=atur \
  --output=atur-play-signing.zip --include-cert --rsa-aes-encryption \
  --encryption-key-path=<encryption_public_key.pem from the Console>
```

Upload `atur-play-signing.zip` in the Console. The alias and password are in `keystore.properties`. Then register `atur-release.jks` as the upload key too ("Use a different upload key" lets you create a separate one, which is the better pairing with B).

3. Upload the first AAB in a release (section 3). With option A, Play registers the AAB's signature as the **upload key**: it must be `atur-release.jks` (fingerprints above); every later upload must use the same keystore.

## 3. Testing tracks and the closed test

The upload script and tracks: `internal` (up to 100 testers, no review wait, good for a smoke test), `alpha` (Closed testing - Alpha, the track the 12x14 rule counts), `beta`.

1. Console -> **Test and release -> Testing -> Internal testing -> Create release**, or run `scripts/play-upload.py --track internal` (the first-ever release of an app may have to be created in the Console; see the checklist in `native-release.md`).
2. Closed test for the 12x14 rule: create a Google Group, e.g. `atur-testers`, with "Anyone can ask" to join. Console -> **Closed testing -> Create track** (or the default Alpha) -> **Testers** -> create an email list containing the group address and your own account. Upload the AAB: `scripts/play-upload.py --track alpha --status completed` or in the Console.
3. Review and **Start rollout to Closed testing**. Review of the first release takes hours to a few days.
4. Console -> Closed testing -> Testers tab -> copy the **opt-in URL**; for this package it is `https://play.google.com/apps/testing/com.diatur.app`. Each tester joins the group with the same Google account as their phone, opens the URL, taps **Become a tester**, then installs from Play.
5. **12 x 14 rule** (personal accounts): 12 or more testers opted in at the same time for 14 days in a row. Recruit 15 to 20. Count opted-in testers, not group members. After 14 days Console -> **Dashboard -> Apply for production**, answer the questions honestly (how you recruited, feedback, changes). Ship at least one update through the track during the 14 days.
6. After production access, promote the same AAB from the closed track to Production instead of rebuilding.

Release notes example (`<en-US>` block):

```
<en-US>
First Atur release on Google Play: Today, My Issues, projects, issue detail with comments, search and inbox.
</en-US>
```

## 4. Store listing

Source of truth: `docs/store-listing.json`; `scripts/check-store-listing.py` verifies the limits (title 30, short description 80, full description 4000) and that the text below matches the JSON.

### English (`en-US`, default)

- **App name** (24): `Atur: Project Management`
- **Short description** (55): `Your team's issues, projects and inbox, in your pocket.`
- **Full description** (1086):

```
Atur is the mobile client for your Atur workspace: the issues, projects and notifications your team already uses on the web, always at hand.

YOUR DAY AT A GLANCE
• Today shows what is assigned to you and what is waiting on a decision.
• My Issues lists everything on your plate, filtered by state and priority.

TRIAGE ON THE GO
• Open an issue to read it, change its state and priority, and follow the discussion.
• Comment from your phone so work does not wait for a laptop.
• Create a new issue in a few taps.
• Search issues across your workspace.

STAY IN THE LOOP
• An inbox for mentions, assignments and updates, with unread counts.
• Switch between workspaces and projects.
• Light, dark or system theme.

ONE ACCOUNT
• Sign in with email and password, a one-time email code, Google, or Apple on iPhone: the same account you use at app.diatur.com.
• Delete your account any time from Profile.

Atur has no ads and does not sell your data. Privacy policy: https://diatur.com/privacy
Support: https://diatur.com/support
Open source (AGPL-3.0): https://github.com/dzulfikar08/atur
```

### Indonesian (`id`)

- **App name** (22): `Atur: Manajemen Proyek`
- **Short description** (55): `Isu, proyek, dan kotak masuk timmu, langsung di ponsel.`
- **Full description** (1139):

```
Atur adalah aplikasi seluler untuk workspace Atur-mu: isu, proyek, dan notifikasi yang sudah dipakai timmu di web, kini selalu ada di tangan.

HARIMU SEKILAS
• Halaman Hari Ini menampilkan tugas yang diberikan kepadamu dan keputusan yang menunggu.
• Isu Saya mendaftar semua kerjaanmu, bisa disaring menurut status dan prioritas.

PILAH ISU DI MANA SAJA
• Buka isu untuk membaca, mengubah status dan prioritas, dan mengikuti diskusi.
• Beri komentar dari ponsel supaya kerjaan tidak menunggu laptop.
• Buat isu baru dalam beberapa ketukan.
• Cari isu di seluruh workspace.

TETAP TERUPDATE
• Kotak masuk untuk sebutan, penugasan, dan pembaruan, lengkap dengan hitungan belum dibaca.
• Pindah antar workspace dan proyek.
• Tema terang, gelap, atau mengikuti sistem.

SATU AKUN
• Masuk dengan email dan kata sandi, kode sekali pakai lewat email, Google, atau Apple di iPhone: akun yang sama dengan di app.diatur.com.
• Hapus akunmu kapan saja dari Profil.

Atur tanpa iklan dan tidak menjual datamu. Kebijakan privasi: https://diatur.com/privacy
Bantuan: https://diatur.com/support
Open source (AGPL-3.0): https://github.com/dzulfikar08/atur
```

### Graphics and contact

- App icon: 512 x 512 PNG, source `apps/native/assets/images/icon.png`.
- Feature graphic: 1024 x 500 PNG/JPEG (wordmark plus one headline on the graphite palette).
- Category: Productivity (Business is the alternative; Productivity fits an issue tracker). Tags: project management, to-do, task management.
- Contact email `support@diatur.com`, website `https://diatur.com`, privacy policy `https://diatur.com/privacy`.
- Phone screenshots: 2 minimum, aim for 6 to 8, 1080 x 1920 or larger. Capture plan and the renderer: `scripts/store-shots/README.md`. Use a demo workspace, no real names or emails.

## 5. App content declarations (Policy -> App content)

| Section                                                                                                                                                                          | Answer                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Privacy policy                                                                                                                                                                   | `https://diatur.com/privacy`                                                                                                                                                                                                                                                                                                                 |
| App access                                                                                                                                                                       | Restricted; give the review account (section 6)                                                                                                                                                                                                                                                                                              |
| Ads                                                                                                                                                                              | **No ads.** Verified: no ad SDK in `apps/native/package.json`, and no `AD_ID` permission in the merged manifest (section 8).                                                                                                                                                                                                                 |
| Content rating (IARC questionnaire)                                                                                                                                              | Category: utility / productivity. Violence, sexual content, profanity, controlled substances, gambling: none. **Users interact or exchange content: Yes** (comments in issues; workspace members see each other's content). Shares user location: No. Digital purchases: No (the app has no purchase UI). Expect an Everyone / PEGI 3 class. |
| Target audience                                                                                                                                                                  | **18+** [INFERENCE]: a work tool for teams; choosing under-13 or 13-17 groups brings the Families policy and extra scrutiny with no benefit.                                                                                                                                                                                                 |
| News app                                                                                                                                                                         | No                                                                                                                                                                                                                                                                                                                                           |
| COVID-19 contact tracing / status                                                                                                                                                | No                                                                                                                                                                                                                                                                                                                                           |
| Government app                                                                                                                                                                   | No                                                                                                                                                                                                                                                                                                                                           |
| Financial features                                                                                                                                                               | None. The app has no payments, loans or crypto. Billing, if any, happens on the website, and the app links to none of it (verified: no billing, pricing or upgrade text in `apps/native/app`, `components`, `lib`).                                                                                                                          |
| Health apps                                                                                                                                                                      | Not a health app. Answer "No" for every health feature.                                                                                                                                                                                                                                                                                      |
| Data safety                                                                                                                                                                      | Section 7                                                                                                                                                                                                                                                                                                                                    |
| Account deletion                                                                                                                                                                 | URL `https://diatur.com/privacy#delete-account`; in-app: Profile -> Delete account. See "Known gaps" if either is not live yet.                                                                                                                                                                                                              |
| Advertising ID                                                                                                                                                                   | **No** (no `com.google.android.gms.permission.AD_ID` in the merged manifest).                                                                                                                                                                                                                                                                |
| Foreground service permissions, exact alarms, full-screen intent, photo/video permissions, SMS/call log, `QUERY_ALL_PACKAGES`, `REQUEST_INSTALL_PACKAGES`, `SYSTEM_ALERT_WINDOW` | None present (section 8).                                                                                                                                                                                                                                                                                                                    |

## 6. App access for the reviewer

Atur supports email + password, a one-time email code, Google and (on iPhone) Sign in with Apple. The reviewer should use **email and password**: it needs no second device and no Google/Apple account. Do this before submitting:

1. Create a review user on `https://app.diatur.com` (for example `play-review@diatur.com`, password of your choice), join it to a workspace that has a project with a few issues, comments, and an unread notification so every screen has content. Give it a role that can create and edit issues.
2. Console -> App content -> **App access** -> "All or some functionality is restricted" -> add instructions:

```
Atur is the mobile client of the Atur workspace (https://app.diatur.com).
1. Open the app. On the sign-in screen enter:
   Email: <review account email>
   Password: <review account password>
2. The account is a member of the "Demo" workspace with a project, issues, comments and notifications.
Everything in the app works without extra permissions; the app asks for no camera or location access. Runtime permissions are the microphone, requested the first time you tap the mic button to dictate, and notifications (`POST_NOTIFICATIONS`, Android 13+), requested when you turn on agent alerts (comment, issue description, pane prompt, Send feedback); decline it and the rest of the app is unaffected.
```

Do not put the real password in this repo. Google sign-in works too but needs a Google account; do not rely on it for review.

## 7. Data safety form

Source: https://support.google.com/googleplay/android-developer/answer/10787469 . Everything goes over HTTPS to `https://app.diatur.com` (`apps/native/lib/config.ts`); answer **Yes** to "Data is encrypted in transit". Verified by reading `apps/native/package.json` and the code: no analytics, crash-reporting or ad SDK; no push-notification library (`expo-notifications` is not a dependency), so no push token exists; Google sign-in is the system browser with PKCE, not Google's SDK; the app does not request camera, contacts or location. It requests the microphone only for dictation (`expo-speech-recognition`, `lib/dictation.ts`): audio goes to the device's speech recognizer, on-device whenever `supportsOnDeviceRecognition()` is true, and is never recorded, stored or sent to Atur. The session token is kept in `expo-secure-store` on the device (`apps/native/lib/storage.ts`).

"Shared" in Play's sense is transfer to a third party. Hosting on Cloudflare and e-mail delivery are service-provider processing on Atur's behalf, not sharing [INFERENCE reading of the Play definitions].

| Play category / type                                                                                         | Collected                                                                                                    | Shared                                                  | Optional | Purpose                               | Code evidence                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- | -------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Personal info: **Name**                                                                                      | Yes                                                                                                          | No                                                      | Required | App functionality, Account management | `Me` / `UserRef` in `lib/api.ts`: display name shown in Profile and next to comments                                                                    |
| Personal info: **Email address**                                                                             | Yes                                                                                                          | No                                                      | Required | App functionality, Account management | Sign-in email; shown in Profile                                                                                                                         |
| Personal info: **User IDs**                                                                                  | Yes                                                                                                          | No                                                      | Required | App functionality, Account management | Account id, username, workspace membership                                                                                                              |
| Photos and videos                                                                                            | No                                                                                                           |                                                         |          |                                       | The app shows the profile avatar URL from the account (e.g. from Google) but cannot upload or pick photos                                               |
| App activity: **Other user-generated content**                                                               | Yes                                                                                                          | No (visible to the members of the user's own workspace) | Optional | App functionality                     | Issues created or edited, comments, subscriptions (`api.createIssue`, `updateIssue`, comment calls in `lib/api.ts`)                                     |
| Messages: **Other in-app messages**                                                                          | Yes                                                                                                          | No                                                      | Optional | App functionality                     | Comments on issues; notifications are generated by the server                                                                                           |
| App info and performance: crash logs, diagnostics                                                            | **No**                                                                                                       |                                                         |          |                                       | No crash SDK in the app. Cloudflare keeps standard request logs server-side [INFERENCE: not declared, as Play's guidance covers data the app collects]. |
| Device or other IDs                                                                                          | **No**                                                                                                       |                                                         |          |                                       | No advertising id, no push token                                                                                                                        |
| Location, Contacts, Calendar, Health and fitness, Financial info, Web browsing, Files and docs, SMS/call log | **No**                                                                                                       |                                                         |          |                                       | Not requested; no matching permission in the manifest                                                                                                   |
| Audio: **Voice or sound recordings**                                                                         | **No**                                                                                                       |                                                         |          |                                       | `RECORD_AUDIO` is held for dictation only. The app never records, stores or transmits audio; the OS speech service returns text (see Microphone below). |
| Security practices                                                                                           | Encrypted in transit: **Yes**. Users can request deletion: **Yes** (below). Independent security review: No. |

Credentials: the account password is stored hashed server-side (`apps/app/src/worker/lib/password`); the app only sends it over HTTPS and never stores it.

### Push notifications (`POST_NOTIFICATIONS`)

Agent alerts: a push when an agent pane finishes or needs the user. The device's Expo push token is stored server-side (tied to the user) only to deliver them. Notification content includes the pane title and a short excerpt of the agent's output or question and passes through Expo's push service and Firebase Cloud Messaging. The token is an app-scoped delivery address, not the advertising ID [INFERENCE: if Play review disagrees, declare Device or other IDs: collected, not shared beyond service providers, App functionality]. Needs `google-services.json` at build time (`native-release.md`).

### Microphone (`RECORD_AUDIO`) justification

Declared by the `expo-speech-recognition` config plugin (`apps/native/app.json`). Core purpose: voice input for text fields. It is requested at runtime, the first time the user taps a mic button, and never at launch. Audio is read live by Android's `SpeechRecognizer`: on-device (`requiresOnDeviceRecognition`) whenever the device reports support, otherwise through the device's default recognition service (usually Google's), which is the user's own OS service and not an Atur backend. Atur never records, persists or uploads audio; only the recognised text lands in the field, and it leaves the phone only if the user then sends the comment, issue or feedback. The plugin also adds a `<queries>` entry for `com.google.android.googlequicksearchbox` (package visibility so the recognizer can be found). `RECORD_AUDIO` is a normal runtime permission and needs no Permissions Declaration Form [INFERENCE: not one of Play's restricted permission groups].

Data deletion section of the form: "Can users request that data is deleted?" -> **Yes**. In-app: Profile -> Delete account. Web link: `https://diatur.com/privacy#delete-account`. Declare which data is removed vs retained from what the privacy section says (written by the account-deletion work; re-read the final text before answering).

## 8. Permissions kept in the Play manifest

Source: `bundletool dump manifest` of the Play AAB, printed by `scripts/build-native-aab.sh` on every build and guarded against `REQUEST_INSTALL_PACKAGES`, `SYSTEM_ALERT_WINDOW`, `QUERY_ALL_PACKAGES`, `MANAGE_EXTERNAL_STORAGE`.

@@PERMISSIONS@@

## 9. Update and release routine

1. Bump `expo.version` in `apps/native/app.json` for a user-visible release. versionCode is computed.
2. `scripts/build-native-aab.sh`, then `scripts/play-upload.py --track <track>`; add release notes in the Console (or `--notes`).
3. Testers and users get the update from the Play Store. The app does not self-update from Play (no in-app update API is wired).
4. Promote the same AAB between tracks rather than rebuilding.

## 9b. What is actually entered in the Console (2026-10-18)

Account: JoyoDigitama, **personal** account (Home header), so the **12 testers x 14 days closed test is required** before production (Dashboard -> Production: "0 testers currently opted-in").

- Listings en-US (default) and id via the Android Publisher API from `docs/store-listing.json` (title, short, full), plus icon 512, feature graphic 1024x500 and 8 phone screenshots per language (order 01-today, 04-project-issues, 06-issue, 05-filters, 08-inbox, 07-search, 02-today-list, 09-today-dark; Expo-web renders, not device captures). Details: contact email dzulfikar@joyorogo.com, phone +6285156160345, website https://diatur.com. The service account needed "Edit store listing" style app permissions in Users and permissions (it only had read-level access to Atur until granted in the UI; edit commits returned 403 before).
- Store settings: App, category **Productivity**, contact details as above. No tags.
- Privacy policy: https://diatur.com/privacy.
- Ads: **No**. Advertising ID: **No**. Government: **No**. Financial features: none ("doesn't provide any financial features"). Health: none.
- App access: restricted, review account (`review@diatur.com`; password only in `~/.config/atur/review-login.txt`), instruction: open the app, enter email and password on the sign-in screen, tap Sign in; the account belongs to a demo workspace.
- Content rating (IARC): category All Other App Types; user content sharing **Yes** (UGC is the primary content; interactions can be limited to invited friends: Yes); no nudity/violence sharing, no block/report/moderation features in the app (verified: none in code), no location sharing, digital purchases, browser, news. Result: 12+/Teen equivalents.
- Target audience: **18 and over** only.
- Data safety: collects Name, Email address, User IDs (required; app functionality, account management) and Other in-app messages + Other user-generated content (optional; app functionality); shared with no third parties; encrypted in transit Yes; account creation methods "Username, password and other authentication" and OAuth; delete-account URL https://diatur.com/privacy#delete-account; partial deletion question left unanswered.
- Testers: internal testing uses email list `atur-owner` (dzulfikar.at@gmail.com).
- The repo AGPL line stays out of the listing until the repository is public.
- Tracks (versionCode 1470399, from run 39090775168): internal = completed (rolled out, tester list `atur-owner`); closed testing Alpha = release 1.1.0 full rollout, 178 countries, testers = email list `atur-owner`, feedback email dzulfikar@joyorogo.com. All 16 console changes were sent for review on 2026-10-18 ("Changes in review"). The closed-test opt-in URL appears under Closed testing -> Testers once Alpha is live; 12 testers must opt in for 14 days, then "Apply for production" on the Dashboard. Pricing: free (set at app creation).

## 10. Known gaps and decisions for the owner

1. **Account deletion must be live before production.** Play's policy (https://support.google.com/googleplay/android-developer/answer/13327111) wants an in-app deletion path plus a web link. The Profile section and `https://diatur.com/privacy#delete-account` come from the account-deletion work; deploy `apps/app` and `apps/web` before submitting, and check both.
2. **Site APK and Play install use different signatures under option A** (section 2): one must be uninstalled before the other is installed.
3. **No Play In-App Updates API** is wired; Play's own auto-update is the update path.
4. **Account type** (personal vs organization) decides whether the 12x14 closed test applies (section 1).
5. **Review account** and demo workspace must exist and stay populated (section 6).
