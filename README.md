# Infos (v18.1)

Admin portal — Zeus (main admin), co-admins, and sub-admins. Notice / Backend / Games / Id & Pass tabs. Backed by Supabase with real-time sync. Progressive Web App installable on mobile + desktop.

## What's new in v18.1

### 📱 PWA (Progressive Web App) improvements
- **Service worker** registered at `/sw.js`. Caches app shell (HTML, JS, CSS, icons, logo, QR image) for near-instant subsequent loads. Supabase API calls are **never** cached — data stays live.
- **App shell works offline.** If connection drops, the UI still loads from cache. Attempted actions show friendly errors until back online.
- **Manifest additions for better PWA audit score:**
  - `id` field — lets the OS identify the app even if URL changes
  - `orientation: portrait` — locks to portrait on phones
  - 2 screenshots (mobile + desktop) — shown in install prompts and app stores
  - `categories` — helps categorize if listed in stores
  - Fixed maskable icon setup (separate entries for `any` and `maskable` purpose)

## What was in v18

### ⚡ Performance — feels dramatically faster
- **Optimistic updates** on every tab. Add / edit / delete / reorder / bulk delete update the UI instantly — no waiting for the DB round-trip. If the save fails, the UI reverts automatically with a friendly error.
- **Smart realtime sync.** When another device changes data, only the affected table reloads (not all 5 like before). Rapid changes are debounced (80ms window) to avoid re-renders during bulk operations.
- **Memoized tab components.** Switching tabs no longer re-renders unaffected ones.
- **Splash shortened.** Open splash cut from 3s → 1.2s. Welcome splash cut from 2s → 0.9s. Both now accept a tap to skip instantly.


### ✏️ Editable About Us (Zeus only)
- All About Us content now lives in the database. Zeus sees an **"✏️ Edit"** button in the About Us modal to change:
  - Developer name, company, app version
  - Contact email
  - Donation intro text
  - Crypto name (e.g. USDT), network (e.g. TRC20)
  - Wallet address
  - **QR code image** — Zeus uploads a new PNG/JPG/WebP (max 2 MB), with live preview before save
  - Warning text
- QR uploads go to **Supabase Storage** in a public bucket called `about-assets`, with unique filenames so CDN caching never serves stale images.
- Changes push to all devices in real-time via realtime subscription on `about_content` table.
- Co-admins and sub-admins see the same modal but in read-only mode (no Edit button).
- On first load (before any edits), the hardcoded defaults show. As soon as Zeus saves once, the saved version takes over.

## All features (v16–v18)

- Zeus / Co-admin / Sub-admin role hierarchy
- Default Zeus: `Zeus` / `Hello@123` (change in Settings)
- Multi-account sign-in, avatar switcher
- Dark mode (auto / light / dark)
- Notice / Backend / Games / Id & Pass with real-time sync
- Search on every tab
- Id & Pass filter pills (by sub-admin)
- Edit everything — entries, sub-admins, co-admins, About Us content, QR image
- Bulk select & delete
- Drag or ▲▼ reorder (mobile-friendly)
- Copy buttons on links, usernames, passwords, wallet addresses
- Show/hide password toggles
- Confirmation dialogs on destructive actions
- Timestamps with "Updated" indicator when edited
- Pulsing "NEW" badge on notices <24h old
- Tab persistence across refresh
- Friendly error messages
- JSON import / export backup
- About Us modal with donation info + editable QR

## Tech Stack

- Next.js 14.2.35 + React 18 + TypeScript
- Supabase (Postgres + Realtime + Storage)

## Setup

1. Run `setup.sql` in Supabase SQL Editor (idempotent — safe on fresh or existing projects)
2. Create `about-assets` Storage bucket in Supabase (detailed steps in deployment guide)
3. Push to GitHub — Vercel auto-deploys
4. Required env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## Security

Passwords stored as plain text (upgrade to bcrypt hashing for production-grade). The `publishable` Supabase key is safe to ship in the frontend. Never commit the `service_role` key.
