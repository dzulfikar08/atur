# Atur Rebrand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all "Plane PMO" branding with "Atur" across the frontend app — title, favicon, landing page, auth pages, sidebar, and mobile config.

**Architecture:** Simple find-and-replace across frontend files. Create a new minimal SVG favicon (signal nodes logo). No backend changes.

**Tech Stack:** React, TypeScript, SVG, Vite, Capacitor

---

### Task 1: Replace favicon with Atur signal nodes logo

**Files:**
- Overwrite: `frontend/public/favicon.svg`

- [ ] **Step 1: Write the new favicon SVG**

Replace the entire contents of `frontend/public/favicon.svg` with a signal nodes logo — two circles connected by an arc path, in indigo (#4F46E5):

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none">
  <circle cx="8" cy="16" r="4" fill="#4F46E5"/>
  <circle cx="24" cy="16" r="4" fill="#06B6D4"/>
  <path d="M12 16 Q16 8 20 16" stroke="#4F46E5" stroke-width="2.5" stroke-linecap="round" fill="none"/>
</svg>
```

- [ ] **Step 2: Verify the SVG renders**

Open `frontend/public/favicon.svg` in a browser. Expected: two dots (left indigo, right cyan) connected by a curved arc above them.

- [ ] **Step 3: Commit**

```bash
git add frontend/public/favicon.svg
git commit -m "brand: replace Plane PMO favicon with Atur signal nodes logo"
```

---

### Task 2: Update index.html title

**Files:**
- Modify: `frontend/index.html`

- [ ] **Step 1: Replace the title**

In `frontend/index.html` line 10, change:

```
    <title>Plane PMO — Project Management, Refined</title>
```

to:

```
    <title>Atur — Organize Everything</title>
```

- [ ] **Step 2: Commit**

```bash
git add frontend/index.html
git commit -m "brand: update page title to Atur"
```

---

### Task 3: Update Sidebar brand mark

**Files:**
- Modify: `frontend/src/components/layout/Sidebar.tsx`

The sidebar workspace switcher shows a letter initial in a colored square. Keep the workspace initial logic but ensure the fallback shows "A" for Atur (instead of "W" for Workspace).

- [ ] **Step 1: Update the fallback letter**

In `Sidebar.tsx` line 78, the workspace switcher button shows:

```tsx
{(currentSlug ?? slug)?.[0]?.toUpperCase() ?? 'W'}
```

Change to:

```tsx
{(currentSlug ?? slug)?.[0]?.toUpperCase() ?? 'A'}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/layout/Sidebar.tsx
git commit -m "brand: update sidebar fallback initial to Atur"
```

---

### Task 4: Update Landing Page branding

**Files:**
- Modify: `frontend/src/pages/LandingPage.tsx`

Replace all occurrences of "Plane PMO" and related branding with "Atur".

- [ ] **Step 1: Update document title (line 71)**

Change:
```tsx
document.title = 'Plane PMO — Project Management, Refined';
```
to:
```tsx
document.title = 'Atur — Organize Everything';
```

- [ ] **Step 2: Update hero heading (line 138)**

Change `Plane PMO` to `Atur`.

- [ ] **Step 3: Update app URL reference (line 255)**

Change `app.plane-pmo.dev` to `atur.dev`.

- [ ] **Step 4: Update "Why Plane PMO" section (lines 440, 445)**

Change `Why Plane PMO` to `Why Atur`.

- [ ] **Step 5: Update footer brand name (line 620)**

Change `Plane PMO` to `Atur`.

- [ ] **Step 6: Update copyright (line 630)**

Change `2025 Plane PMO` to `2026 Atur`.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/LandingPage.tsx
git commit -m "brand: update landing page to Atur"
```

---

### Task 5: Update Auth pages branding

**Files:**
- Modify: `frontend/src/pages/auth/LoginPage.tsx`
- Modify: `frontend/src/pages/auth/RegisterPage.tsx`
- Modify: `frontend/src/pages/auth/OAuthCallbackPage.tsx`

- [ ] **Step 1: Update LoginPage.tsx**

Replace all occurrences of `Plane PMO` with `Atur` (line 110).
Also change the default redirect paths from `/plane-pmo` to `/{slug}` or `/` (lines 47, 61).

- [ ] **Step 2: Update RegisterPage.tsx**

Replace all occurrences of `Plane PMO` with `Atur` (line 131).
Also change the default redirect paths from `/plane-pmo` to `/{slug}` or `/` (line 63, 82).

- [ ] **Step 3: Update OAuthCallbackPage.tsx**

Change the default redirect path from `/plane-pmo` to `/{slug}` or `/` (line 45).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/auth/LoginPage.tsx frontend/src/pages/auth/RegisterPage.tsx frontend/src/pages/auth/OAuthCallbackPage.tsx
git commit -m "brand: update auth pages to Atur"
```

---

### Task 6: Update Settings page branding

**Files:**
- Modify: `frontend/src/pages/settings/ProfilePage.tsx`

- [ ] **Step 1: Update brand reference (line 172)**

Change:
```tsx
<CardDescription>Customize how Plane PMO looks</CardDescription>
```
to:
```tsx
<CardDescription>Customize how Atur looks</CardDescription>
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/pages/settings/ProfilePage.tsx
git commit -m "brand: update settings page to Atur"
```

---

### Task 7: Update Vite PWA config and Capacitor

**Files:**
- Modify: `frontend/vite.config.ts`
- Modify: `frontend/capacitor.config.ts`

- [ ] **Step 1: Update Vite PWA name (vite.config.ts line 16)**

Change `name: 'Plane PMO'` to `name: 'Atur'`.

- [ ] **Step 2: Update Capacitor app name (capacitor.config.ts line 5)**

Change `appName: 'Plane PMO'` to `appName: 'Atur'`.

- [ ] **Step 3: Commit**

```bash
git add frontend/vite.config.ts frontend/capacitor.config.ts
git commit -m "brand: update Vite and Capacitor config to Atur"
```

---

### Task 8: Final verification

- [ ] **Step 1: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 2: Grep for remaining "Plane PMO" references**

Run: `grep -ri "plane pmo" frontend/src/ frontend/index.html`
Expected: no matches (empty output)

- [ ] **Step 3: Build frontend**

Run: `cd frontend && npm run build`
Expected: successful build

- [ ] **Step 4: Verify visually**

Start the dev server (`npm run dev`), check:
- Browser tab title shows "Atur"
- Favicon shows the signal nodes logo
- Landing page says "Atur"
- Login page says "Atur"
