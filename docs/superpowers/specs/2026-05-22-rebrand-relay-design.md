# Rebrand: Atur

## Name

**Atur** — 4 letters, 2 syllables. Universally spelled and pronounced.

**Tagline:** _Atur semuanya._ (Arrange everything.) / English variant: _Organize everything._

**Domain:** atur.dev

**Why:** Sanskrit *ācāra* → Old Javanese/Indonesian *atur* = "to arrange, organize." Deeply embedded in Indonesian daily language (*mengatur*, *aturan*, *pengaturan*). No competing tech products in the PM space. Short, sharp, technical feel.

## Logo

**Signal nodes** — Two dots connected by an arc, suggesting arrangement/handoff.

- Monochrome primary (indigo on white, white on dark)
- Geometric, minimal, works at 16px favicon and full-size
- Single-color version for status bars and monochrome contexts

## Color Palette

| Role    | Hex       | Usage                         |
|---------|-----------|-------------------------------|
| Primary | `#4F46E5` | Indigo — buttons, links, logo |
| Accent  | `#06B6D4` | Cyan — highlights, signals    |
| Dark    | `#0F172A` | Near-black — dark mode base   |
| Light   | `#F8FAFC` | Off-white — backgrounds       |

## Files to Change

1. **`frontend/index.html`** — title to "Atur"
2. **`frontend/public/favicon.svg`** — atur signal nodes icon
3. **`frontend/src/components/layout/Sidebar.tsx`** — brand mark in sidebar header
4. **`frontend/src/components/layout/TopBar.tsx`** — mobile header brand
5. **Landing page** — title, hero, meta tags
6. **Mobile app (Capacitor)** — app name, icon assets

## Out of Scope (Future)

- Cargo.toml / binary rename
- Domain purchase / DNS setup
- Email, social handles
- Marketing site (separate from app)
