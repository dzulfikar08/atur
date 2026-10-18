# Atur on the App Store: listing copy and answers

Bundle id `com.diatur.app`, team `F6Q6UFUK69`, version 1.1.0. Build and upload commands: [`native-release.md`](native-release.md), CI in [`ci-release.md`](ci-release.md). The pattern is JoyoFit's (`../watch-fit/docs/app-store.md`). This document records what was entered in App Store Connect on 2026-10-18 (through the App Store Connect API, except App Privacy, which has no API and was filled in the web UI).

State on 2026-10-18: app record `6824116330` exists (SKU `atur`, primary locale en-US); bundle id resource `54UZQC9S93` has **Sign in with Apple** enabled (`scripts/ios/enable-capabilities.py`). Everything in sections 1 to 6 is entered. What remains is the build: see section 7.

"Verified" means read in this repo. "[INFERENCE]" marks reasoning where nothing was read.

## 1. App record, category, pricing (entered)

| Field               | Value                                                                                                    |
| ------------------- | -------------------------------------------------------------------------------------------------------- |
| App id              | `6824116330`                                                                                             |
| Name                | `Atur: Project Management` (en-US), `Atur: Manajemen Proyek` (id)                                        |
| Primary language    | English (U.S.), plus an Indonesian localization (section 2)                                              |
| Bundle ID           | `com.diatur.app`                                                                                         |
| SKU                 | `atur` (set when the record was created; the earlier draft said `atur-ios`; SKU cannot be changed)       |
| Primary / secondary | Productivity / Business (`appInfos/25b36ead-83b7-42d8-b99b-1271b06b4a3c`)                                |
| Content rights      | `DOES_NOT_USE_THIRD_PARTY_CONTENT`                                                                       |
| Price               | Free: price point 0 in base territory Indonesia (`appPriceSchedules/6824116330`)                         |
| Availability        | All 175 territories available, `availableInNewTerritories` true (`/v2/appAvailabilities`)                |
| Version             | 1.1.0 (the record was created with a placeholder `1.0`; renamed through the API), release AFTER_APPROVAL |
| Copyright           | `2026 JoyoDigitama`                                                                                      |

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
- The repository is still private, so the "Open source (AGPL-3.0): https://github.com/dzulfikar08/atur" line is **not** in the App Store descriptions. Add it back (en-US and id, and in `docs/store-listing.json`) once the repo is public.
- Entered: app info localizations en-US (`17755fd6-6bf5-4fe0-8bff-ff8cf0ada154`) and id with name, subtitle and privacy policy URL; version localizations en-US (`bf57ca87-f4d4-4998-889d-deec82bd81e6`) and id (`89beb5ab-a037-4e76-b0aa-77a9e83d6134`) with description, keywords, promotional text, support URL and marketing URL.

### Description (en-US) (1028 characters)

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
```

### Description (id) (1082 characters)

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
```

What's New (1.1.0), en-US: `Today home, filters and grouping, a faster issue detail with comments, search, and Sign in with Apple. You can now delete your account from Profile.` (id): `Beranda Hari Ini, filter dan pengelompokan, detail isu yang lebih cepat dengan komentar, pencarian, dan Sign in with Apple. Kini kamu bisa menghapus akun dari Profil.` **Not entered**: App Store Connect refuses `whatsNew` on the first version of an app (HTTP 409 "cannot be edited at this time"); it only applies from the next update.

## 3. Screenshots

The app is iPhone-only (`supportsTablet: false`, verified in `apps/native/app.json`), so no iPad screenshots are needed. Uploaded through the screenshot reservation API (create set, reserve, upload parts, commit with MD5), the same 8 images in both localizations (en-US and id), in this order: `01-today`, `04-project-issues`, `06-issue`, `05-filters`, `08-inbox`, `07-search`, `02-today-list`, `09-today-dark`:

| Display type (API)                                                    | Size      | Source dir                       | Count per locale |
| --------------------------------------------------------------------- | --------- | -------------------------------- | ---------------- |
| `APP_IPHONE_67` (the 6.9" slot; the API has no `APP_IPHONE_69` value) | 1320x2868 | `/tmp/atur-store-shots/ios-6.9/` | 8                |
| `APP_IPHONE_65`                                                       | 1242x2688 | `/tmp/atur-store-shots/ios-6.5/` | 8                |

These are Expo web renders of the same JS UI under a drawn status bar, not on-device captures. Plan, capture script and renderer: `scripts/store-shots/README.md`.

## 4. App Review information

Sign-in: Atur offers email + password, a one-time email code, Google and Sign in with Apple. Because Google sign-in is offered, Sign in with Apple is also offered (guideline 4.8; the Apple button is on `apps/native/app/login.tsx`). Entered (`appStoreReviewDetails/94905175-f68f-4eeb-bd54-72f06abc9d79`): contact Dzulfikar Ats Tsauri, `dzulfikar@joyorogo.com`, +6285156160345; demo account required, with the review account from `~/.config/atur/review-login.txt` (`review@diatur.com`, workspace "Acme Mobile"). The password is only in that file and in App Store Connect, never in the repo.

Review notes as entered:

```
Atur is the mobile client of the Atur workspace (https://app.diatur.com): issues, projects and notifications for teams.

SIGN IN. Use the email and password fields on the first screen with the demo account entered in the Sign-in information fields.
The account belongs to the "Acme Mobile" workspace, which already has 2 projects, issues, comments and notifications. Google and Sign in with Apple also work; neither is needed for review.

WHAT TO TRY. Today (assigned issues and decisions), My Issues (filters), a project, an issue (change state or priority, comment), New issue, Search, Inbox, and Profile (workspace switcher, appearance, Delete account).

ACCOUNT DELETION. Profile -> Delete account permanently deletes the account. The web explanation is https://diatur.com/privacy#delete-account. (Use a throwaway account to test it, not the demo account.)

USER CONTENT. Workspaces are private: only invited members see a workspace's issues and comments. There is no public feed and no way to message strangers.

PURCHASES. The app has no in-app purchases, no subscriptions and no links to buy anything. It is free.

PERMISSIONS. The app asks for none. Network access only. Sign in with Apple and Google sign-in use the system authentication sheets; Google sign-in opens the system browser (ASWebAuthenticationSession) and returns to the app through the atur:// link.

ENCRYPTION. ITSAppUsesNonExemptEncryption is false: the app only uses HTTPS and OS-provided cryptography.

Contact: support@diatur.com.
```

Verified against the code: Profile has a "Delete account" row (`apps/native/app/(tabs)/profile.tsx`), the Apple button is on the login screen, and the issue screen edits state and priority. There is no "subscribe" action in the native issue screen, so the notes do not mention it.

## 5. App Privacy (nutrition label)

Entered and **published** in the App Store Connect web UI on 2026-10-18 (there is no API for it): "Yes, we collect data", four data types, each used for App functionality only, linked to the user's identity, not used for tracking. Result on the product page preview: Data Linked to You: Identifiers, Contact Info, User Content. Data is only sent to `https://app.diatur.com`. Verified: no analytics, crash-reporting or advertising SDK in `apps/native/package.json`; no tracking (no ATT prompt, no `NSUserTrackingUsageDescription`, no IDFA use).

| Data type                                                                                                                                          | Collected | Linked to the user | Used for                                                                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contact info: **Name**                                                                                                                             | Yes       | Yes                | App functionality                                                                                                                                                                                                                                       |
| Contact info: **Email address**                                                                                                                    | Yes       | Yes                | App functionality (account, sign-in, notifications)                                                                                                                                                                                                     |
| Identifiers: **User ID**                                                                                                                           | Yes       | Yes                | App functionality                                                                                                                                                                                                                                       |
| User content: **Other user content** (issues, comments)                                                                                            | Yes       | Yes                | App functionality                                                                                                                                                                                                                                       |
| Usage data, diagnostics, location, health and fitness, financial info, contacts, photos, audio, browsing/search history, purchases, sensitive info | No        |                    | Not requested by the app. The in-app **Search** sends the query to the server to return results; it is not retained for analytics [INFERENCE: confirm the server does not log search terms; if it does, add Search history, linked, App functionality]. |

Sign in with Apple may hand the app a private relay email and the name; both fall under Name and Email above. Device ID: **No** (no push token, no IDFA).

## 6. Age rating, export compliance, other

- **Age rating (entered, `ageRatingDeclarations/25b36ead-83b7-42d8-b99b-1271b06b4a3c`):** none for violence (cartoon and realistic), sexual content, profanity, horror, mature themes, alcohol/tobacco/drugs, guns, medical and health topics, contests and gambling; advertising, loot boxes, messaging and chat, social media, parental controls and unrestricted web access all false; **user-generated content true** (members of a private workspace write issues and comments that other members read). App Store Connect computed **4+**.
- **Export compliance:** `ITSAppUsesNonExemptEncryption = false` is baked into the IPA (`ios.config.usesNonExemptEncryption: false`), so the build upload asks no encryption question. The app uses only HTTPS and OS cryptography (PKCE hashing via `expo-crypto`), which is exempt. Confirming that remains the owner's call (it is a legal declaration).
- **Content rights, advertising identifier:** content rights entered as "does not use third-party content". The app does not use IDFA.
- **Sign in with Apple (4.8):** entitlement `com.apple.developer.applesignin = ["Default"]`; the capability is on the bundle id and the App Store profile carries it (the build signs only keys the profile grants). The server verifies the Apple identity token for audience `com.diatur.app` at `POST https://app.diatur.com/api/auth/apple/native`.
- **Account deletion (5.1.1(v)):** in app, Profile -> Delete account; web, `https://diatur.com/privacy#delete-account`. Deploy `apps/app` and `apps/web` first.
- **Health, kids, and other categories:** not applicable.

## 7. Submit (done 2026-10-18)

Export compliance needs no entry: `ITSAppUsesNonExemptEncryption=false` is in the build (`usesNonExemptEncryption: false` on the build).

1. Built on GitHub Actions only: `release-ios.yml` run `39090776787` (commit `29ce96c`, `upload_testflight=true`). Build `0cf06503-e69d-4435-b96d-e6cbd6bdce20`, version 1.1.0 (build `202610180238`), processing state VALID.
2. TestFlight: internal beta group `Internal` (`c5c558b4-44dd-490a-9b65-4dbbf5daa0c2`, access to all builds, so the build is in it with state IN_BETA_TESTING) and tester `dzulfikar.at@gmail.com` (the account holder; the invitation is pending until accepted).
3. The build is attached to version 1.1.0 (`appStoreVersions/59cae26a-9649-4773-8806-0e3535fecd31`) and submitted through `reviewSubmissions/d0980188-570a-4796-987e-f71c725a8e68` (one item for the version, `submitted: true`). State: **WAITING_FOR_REVIEW**, submitted 2026-10-18T02:56Z. Release type: after approval.
