# Atur on the App Store: listing copy and answers

Bundle id `com.diatur.app`, team `F6Q6UFUK69`, version 1.1.0. Build and upload commands: [`native-release.md`](native-release.md). The pattern is JoyoFit's (`../watch-fit/docs/app-store.md`). This document is what to enter in App Store Connect; nothing here has been submitted.

State on 2026-10-18: the bundle id `com.diatur.app` is registered with the **Sign in with Apple** capability enabled (done through the App Store Connect API by `scripts/ios/enable-capabilities.py`). There is **no App Store Connect app record yet**: the API cannot create one, so step 1 below is yours.

"Verified" means read in this repo. "[INFERENCE]" marks reasoning where nothing was read.

## 1. Create the app record (owner)

App Store Connect -> Apps -> `+` -> New App:

| Field            | Value                                                         |
| ---------------- | ------------------------------------------------------------- |
| Platforms        | iOS                                                           |
| Name             | `Atur: Project Management`                                    |
| Primary language | English (U.S.). Add Indonesian as a localization (section 2). |
| Bundle ID        | `com.diatur.app` (pick it from the list; it exists already)   |
| SKU              | `atur-ios`                                                    |
| User access      | Full access                                                   |

Then: Pricing and availability -> Free, all territories (base Indonesia, as the siblings). Category: Productivity (primary), Business (secondary) [INFERENCE: either fits; Productivity is the usual home of issue trackers]. Content rights: the app contains no third-party content (answer No).

## 2. Names, subtitle, keywords, promotional text

Source of truth: `docs/store-listing.json`; `scripts/check-store-listing.py` verifies the limits (name 30, subtitle 30, keywords 100, promotional text 170, description 4000) and that the text below matches the JSON.

|                              | en-US (primary)                                                                                                       | id                                                                                                                                        |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Name (24 / 22)               | `Atur: Project Management`                                                                                            | `Atur: Manajemen Proyek`                                                                                                                  |
| Subtitle (25 / 29)           | `Issues, sprints, your day`                                                                                           | `Isu, sprint, kerjaan hari ini`                                                                                                           |
| Keywords (94 / 89)           | `issues,tasks,sprint,kanban,team,workspace,tracker,to-do,agile,backlog,productivity,tickets,crm`                      | `isu,tugas,sprint,kanban,tim,workspace,tracker,to-do,agile,backlog,produktivitas,tiket,crm`                                               |
| Promotional text (115 / 135) | `See what is on your plate today, triage issues, comment and create work from your phone. Same workspace as the web.` | `Lihat kerjaan yang menunggumu hari ini, pilah isu, beri komentar, dan buat tugas baru dari ponsel. Workspace-nya sama dengan versi web.` |

- Privacy policy URL: `https://diatur.com/privacy`. Support URL: `https://diatur.com/support`. Marketing URL: `https://diatur.com`.
- Keywords carry no word already in the name or subtitle (Apple indexes those), no competitor names, no spaces after commas.
- Copyright: `2026 JoyoDigitama`.

### Description (en-US) (1088 characters)

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
• Sign in with email and password, a one-time email code, Google or Sign in with Apple: the same account you use at app.diatur.com.
• Delete your account any time from Profile.

Atur has no ads and does not sell your data.
Privacy policy: https://diatur.com/privacy
Support: https://diatur.com/support
Open source (AGPL-3.0): https://github.com/dzulfikar08/atur
```

### Description (id) (1142 characters)

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
• Masuk dengan email dan kata sandi, kode sekali pakai lewat email, Google, atau Sign in with Apple: akun yang sama dengan di app.diatur.com.
• Hapus akunmu kapan saja dari Profil.

Atur tanpa iklan dan tidak menjual datamu.
Kebijakan privasi: https://diatur.com/privacy
Bantuan: https://diatur.com/support
Open source (AGPL-3.0): https://github.com/dzulfikar08/atur
```

What's New (1.1.0), en-US: `Today home, filters and grouping, a faster issue detail with comments, search, and Sign in with Apple. You can now delete your account from Profile.` (id): `Beranda Hari Ini, filter dan pengelompokan, detail isu yang lebih cepat dengan komentar, pencarian, dan Sign in with Apple. Kini kamu bisa menghapus akun dari Profil.`

## 3. Screenshots

The app is iPhone-only (`supportsTablet: false`), so no iPad screenshots. Provide the 6.9" set (1290x2796 or 1320x2868) or the 6.5" set (1242x2688 / 1284x2778): 3 to 10 images. Plan, capture script and renderer: `scripts/store-shots/README.md`.

## 4. App Review information

Sign-in: Atur offers email + password, a one-time email code, Google and Sign in with Apple. Because Google sign-in is offered, Sign in with Apple is also offered (guideline 4.8, verified in `apps/native/app/login.tsx` once the account work lands). Review account: create a user on `https://app.diatur.com`, give it a populated demo workspace (section 5 of `play-store.md` describes the content), and enter it in App Store Connect -> App Review Information -> Sign-in information. Keep the password out of the repo.

Review notes (paste, replace the placeholders):

```
Atur is the mobile client of the Atur workspace (https://app.diatur.com): issues, projects and notifications for teams.

SIGN IN. Use the email and password fields on the first screen with the demo account:
  Email: <demo account email>
  Password: <demo account password>
The account belongs to the "Demo" workspace, which already has a project, issues, comments and notifications. Google and Sign in with Apple also work; neither is needed for review.

WHAT TO TRY. Today (assigned issues and decisions), My Issues (filters), a project, an issue (change state or priority, comment, subscribe), New issue, Search, Inbox, and Profile (workspace switcher, appearance, Delete account).

ACCOUNT DELETION. Profile -> Delete account permanently deletes the account. The web explanation is https://diatur.com/privacy#delete-account. (Use a throwaway account to test it, not the demo account.)

USER CONTENT. Workspaces are private: only invited members see a workspace's issues and comments. There is no public feed and no way to message strangers.

PURCHASES. The app has no in-app purchases, no subscriptions and no links to buy anything. It is free.

PERMISSIONS. The app asks for none. Network access only. Sign in with Apple and Google sign-in use the system authentication sheets; Google sign-in opens the system browser (ASWebAuthenticationSession) and returns to the app through the atur:// link.

ENCRYPTION. ITSAppUsesNonExemptEncryption is false: the app only uses HTTPS and OS-provided cryptography.

Contact: support@diatur.com.
```

[INFERENCE] items above to confirm against the final code before submitting: that Profile shows a "Delete account" row, that Apple sign-in is on the login screen, and that issue state/priority editing and subscribing are in the shipped issue screen (`apps/native/app/issue/**` was being refined at the time of writing).

## 5. App Privacy (nutrition label)

Data is only sent to `https://app.diatur.com`. Verified: no analytics, crash-reporting or advertising SDK in `apps/native/package.json`; no tracking (no ATT prompt, no `NSUserTrackingUsageDescription`, no IDFA use). Answer "**No, we do not track**" for every type.

| Data type                                                                                                                                          | Collected | Linked to the user | Used for                                                                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contact info: **Name**                                                                                                                             | Yes       | Yes                | App functionality                                                                                                                                                                                                                                       |
| Contact info: **Email address**                                                                                                                    | Yes       | Yes                | App functionality (account, sign-in, notifications)                                                                                                                                                                                                     |
| Identifiers: **User ID**                                                                                                                           | Yes       | Yes                | App functionality                                                                                                                                                                                                                                       |
| User content: **Other user content** (issues, comments)                                                                                            | Yes       | Yes                | App functionality                                                                                                                                                                                                                                       |
| Usage data, diagnostics, location, health and fitness, financial info, contacts, photos, audio, browsing/search history, purchases, sensitive info | No        |                    | Not requested by the app. The in-app **Search** sends the query to the server to return results; it is not retained for analytics [INFERENCE: confirm the server does not log search terms; if it does, add Search history, linked, App functionality]. |

Sign in with Apple may hand the app a private relay email and the name; both fall under Name and Email above. Device ID: **No** (no push token, no IDFA).

## 6. Age rating, export compliance, other

- **Age rating:** answer the questionnaire with none for violence, sexual content, profanity, horror, gambling, medical, alcohol/drugs. User-generated content and messaging capability: private team workspaces, comments between invited members [INFERENCE]; expect **4+** (the new questionnaire may give 9+ if "user-generated content" counts; accept what it computes). No web view with unrestricted access (the system browser is used only for sign-in).
- **Export compliance:** `ITSAppUsesNonExemptEncryption = false` is baked into the IPA (`ios.config.usesNonExemptEncryption: false`), so the build upload asks no encryption question. The app uses only HTTPS and OS cryptography (PKCE hashing via `expo-crypto`), which is exempt. Confirming that remains the owner's call (it is a legal declaration).
- **Content rights, advertising identifier:** the app does not use IDFA; answer No for ads.
- **Sign in with Apple (4.8):** entitlement `com.apple.developer.applesignin = ["Default"]`; the capability is on the bundle id and the App Store profile carries it (the build signs only keys the profile grants). The server verifies the Apple identity token for audience `com.diatur.app` at `POST https://app.diatur.com/api/auth/apple/native`.
- **Account deletion (5.1.1(v)):** in app, Profile -> Delete account; web, `https://diatur.com/privacy#delete-account`. Deploy `apps/app` and `apps/web` first.
- **Health, kids, and other categories:** not applicable.

## 7. Submit

1. `scripts/build-ios-linux.sh --upload` (builds, validates, uploads the IPA with `asc.py`). Processing takes 10 to 30 minutes; the build appears under TestFlight, then under the version's Build section.
2. TestFlight: add yourself as an internal tester to try the build ([INFERENCE]: internal testing needs no review).
3. Select the build for version 1.1.0, fill the sections above, **Add for Review**.
