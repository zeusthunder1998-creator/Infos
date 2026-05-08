# Infos (v23.1)

Multi-tenant admin portal. Each co-admin runs their own isolated workspace with their own sub-admins and content. Zeus oversees the platform and creates new co-admins. Backed by Supabase with real-time sync. Progressive Web App installable on mobile + desktop.

## v23.1 — Settings polish

- **Sidebar refined**: left-border accent on active section, hover states, divider before "Sign out"
- **Section headings polished**: bigger title with subtle bottom divider
- **Theme picker now in Settings → Appearance** (light / dark / auto cards) instead of placeholder
- **Refined app icon**: connected glyph (dot merged with bar), softer top highlight, inner border accent
- No DB schema change — pure UX work

## v23.0 — Settings redesign + new app icon

- **Full-screen Settings page** with sidebar navigation (like macOS Settings / Discord)
- **Sections organized by purpose**: Profile, Account, Appearance, Backup & Data, Trash, Devices, User Guide, About, Privacy, Sign out
- **Mobile responsive** — sidebar collapses to horizontal pills on small screens
- **New app icon** — clean purple-gradient design

## v22.2 — Devices & sessions (Zeus-only)

- **📱 Devices & sessions panel** — Zeus can now see EVERY active session across the platform: which user, which device, when they signed in, when they were last seen.
- **Force-logout** — Zeus can revoke any session. The target device signs out within ~30 seconds (next poll).
- **Device naming** — Users see auto-detected platform ("Chrome on Windows", "Safari on iPhone"). Zeus can also rename any device for clarity ("Office laptop", "Boss's phone").
- **Session lifecycle**:
  - Login → registers a session row with device fingerprint
  - Heartbeat every 60 seconds while app is open → updates last_seen
  - Self-poll every 30 seconds → if revoked, signs out automatically
  - Sign out → deletes the session row cleanly
  - 30-day auto-prune of stale rows on app load

**Limitations:**
- "Soft auth" — clears localStorage = bypass. Not bulletproof against determined attackers.
- Idle/offline devices show as "active" until heartbeat times out.

Schema change required (small, additive): see `v22.2-migration.sql`.

## v22.1 — What changed this week

📅 Activity feed in the user menu showing last 7 days, grouped by day.

## v22.0 — Profile pictures, search relocation, role-specific guides, cleanup

- **👤 Profile pictures (all roles)** — Settings → "Profile picture" card. Zeus, co-admins, and sub-admins can each upload a custom avatar (PNG / JPG / WEBP, max 2 MB). Shown in the user menu and account switcher.
- **🔍 Search moved to main page** — The "Search everything" bar now sits prominently above the tabs (was hidden in the user menu). Much more discoverable.
- **📖 Role-specific User Guide** — Each role now sees ONLY their own content. Zeus sees Zeus stuff. Co-admins see co-admin stuff. Sub-admins see sub-admin stuff. No more unnecessary noise.
- **🍞 Toast position fixed for mobile** — Toasts now respect the phone's safe-area inset (no longer hidden behind the status bar / notch) and stack horizontally centered on small screens.
- **❌ Workspace branding removed** — Reverted to default Infos look.
- **❌ CSV import removed** — Backup/restore JSON covers the same need.

Schema change required (small, additive): see `v22.0-migration.sql`.

## v21.4 — Trash, notification preferences

- **🗑 Trash bin (soft delete)** — Deleted entries (Backend, Games, Id&Pass, Notices) move to a Trash modal in Settings. Restore or permanently delete. Auto-purges items older than 30 days.
- **🔔 Notification preferences** — Gear icon inside the notification bell opens a preferences panel. Toggle which categories you want to be notified about.

## v21.3 — Polish

🍞 Toast notifications · ⏳ Loading skeletons · 📭 Empty state illustrations · 📖 User Guide card in Settings.

## v21.2 — Notification bell

🔔 In-app notification bell with unread badge.

## v21.0 — Search, guide, onboarding, install prompt

🔍 Global search · 📖 Role-aware User Guide · 👋 Welcome modal · 📱 Install prompt banner.

## v20.7 — Pinned notices

📌 Admins can pin important notices to the top.

## v20.x baseline

Filter pills, sub-tabs (🎮 Games | 🔐 Accounts), 📋 Copy & Paste section, privacy page, performance optimizations.

After v20 was first built, the entire codebase was audited end-to-end for bugs, performance regressions, and sync reliability. The following fixes shipped:

**Realtime sync (high-impact):**
- Realtime `eventsPerSecond` bumped from 10 → 50 so cross-device updates feel snappier without overwhelming the WebSocket on bulk operations.
- Resilient sync added: when the app comes back from background (visibility change → visible) or the network reconnects (`online` event), all data is refetched. Mobile browsers (especially TWA) suspend WebSockets when the app sleeps, so without this fix the user could see stale data on resume. Throttled to once per 2 seconds to prevent storms when both events fire simultaneously.
- Copy & Paste table bypasses the 80ms realtime debounce — fires the reload immediately so an entry published on Phone A appears on Phone B with no perceptible lag.

**Copy & Paste UX (medium-impact):**
- Replaced live second-by-second countdown with a small static hint above each entry: `Auto-deletes in ~Xm`. The number rounds up and refreshes once per minute — no jittery numbers, no battery drain. Visibility-aware: pauses when the tab is hidden.
- Password is shown in plaintext at all times — Copy & Paste is a copy/share feature by design, so masking would defeat the purpose.
- Each entry has a Delete button so the user can remove it manually before the 5-minute TTL expires.
- Periodic background purge added: every 60 seconds while the Copy & Paste tab is mounted, expired rows are deleted from the DB. Combined with the existing on-mount and on-load purges, this ensures the `paste_buffer` table never accumulates stale rows even on devices left open.

**Cascade cleanup (data hygiene):**
- `deleteSub` now cascade-deletes the sub-admin's `paste_buffer` rows. Best-effort — failure here doesn't block account deletion (TTL would clean them up anyway).
- `deleteCoAdminWorkspace` now includes `paste_buffer` in the cascade so removing a co-admin wipes all paste entries from sub-admins in that workspace.

**Service worker:** bumped to `v20.3` so users get all the fixes without a manual cache clear.

## v20 — UX improvements

This v20 release adds inventory-management ergonomics to the list tabs and splits Id & Pass into two sub-sections.

**New on Backend & Games tabs:**
- **Filter pills** (admin-only) — filter the list by sub-admin assignment, identical to the existing Id & Pass filter. "All" pill plus one per sub-admin. Reordering is disabled while a filter is active to prevent accidental sort-order writes against a partial view.
- **Entry count label** at the top of the list — e.g., `12 entries`. When a filter is active, label reads `5 entries (filtered)`.
- **Serial number badge** on every entry — `#1`, `#2`, `#3`… as a small pill at the top-left of each entry. Numbers reflect the entry's current position in the visible list, so they update live when you drag-reorder, search, or filter.

**New on Id & Pass tab — Games | Accounts sub-sections:**
- Two sub-tabs at the top of the Id & Pass tab: 🎮 Games and 🔐 Accounts.
- **Games** holds game-credential entries (PUBG, LoL, etc.) — same as the v19 Id & Pass tab.
- **Accounts** holds general account credentials (Facebook, Gmail, VPN, Oslink, etc.). Same three required fields (account name, username, password), so it stays simple and consistent.
- Form labels adapt to the active sub-section (`Game` vs `Account`, with relevant placeholders).
- Each sub-section has its own count, search, filter, and reorder context. Switching sections resets selection/filter/search to avoid cross-section state bleed.
- Sub-tab pills show per-section counts (e.g., `🎮 Games 12` / `🔐 Accounts 5`).
- **Existing v19 data auto-migrated:** all existing Id & Pass entries become Games-section entries automatically (column default `'games'`). No manual migration needed.
- Same entry count label and serial number badges as Backend / Games. Filter pills already existed in v19.

**New on Notice tab — 📋 Copy & Paste sub-tab (sub-admins only):**
- Sub-admins now see two sub-tabs at the top of the Notice tab: 📢 Notices and 📋 Copy & Paste.
- Copy & Paste is a sub-admin-only feature for sharing credentials between their own multiple phones (self-only — even other sub-admins and the admin cannot see these entries).
- Form: Game name, Username, Password (3 required fields). Password is shown as plaintext while typing — this is a copy-paste tool, not a vault.
- Each entry **auto-deletes after 5 minutes**. A small static hint above each entry shows `Auto-deletes in ~Xm` (refreshes once per minute, not a live ticker).
- Each entry shows a Copy button that copies the formatted text:
  ```
  GameName
  ID : <username>
  PWD : <password>
  ```
- Each entry has a Delete button so the user can remove it manually before the 5-minute TTL expires.
- Entries appear instantly on every device the same sub-admin is signed in on, via realtime sync. Disappear from all devices when the 5-minute TTL expires.
- Cleanup is lazy: expired rows hide immediately client-side, and are deleted from the DB on next app open or whenever the Copy & Paste tab is opened. No cron jobs needed.
- Admins (Zeus, co-admin) do NOT see this sub-tab — they see the Notice tab the same as before.

**Notice tab unchanged for admins.**

**Schema changes (one-shot, idempotent):**
Run the updated `setup.sql` in Supabase. It:
- Adds a `section` column to `idpass_entries` with default `'games'` (Id & Pass sub-sections).
- Creates a new `paste_buffer` table for the Copy & Paste feature, with RLS enabled and added to the realtime publication.
Safe to re-run on the existing v19 database — existing rows are preserved and auto-tagged as Games entries.

**Other:**
- Service worker bumped to `v20` so users get the new UI without manual cache-clear.
- About modal default version string bumped to `v20`.
- `package.json` bumped to `20.0.0`.

## v19 audit pass — fixes

This v19 release went through two full code audit passes. Notable bug fixes:

**Security & data integrity (high-impact):**
- Sub-admins could export/import workspace data via Settings — Backup section is now gated to admins only.
- Pressing Enter in a destructive confirmation dialog auto-confirmed it — Enter is now ignored on `danger` dialogs; explicit click required. This prevents accidental cascade-delete of co-admin workspaces.
- Deleted sub-admins kept reading workspace data on their device until app reload — on app load, persisted accounts are now validated against the database. Deleted accounts are auto-signed-out. Network failures keep cached sessions intact for offline use.
- Service worker version was stale (`v18.1`) — bumped to `v19` so users actually receive the new code instead of seeing old cached chunks.

**Workspace isolation (medium-impact):**
- Account-switching briefly showed previous workspace's data — state cleared and loader shown during refetch.
- AssigneePicker showed co-admins as assignees — now filtered out (co-admins are workspace owners, not assignees).
- Confusing "Co-admins (0)" filter pill for non-Zeus users — hidden.

**Polish (low-impact):**
- Multi-line dialog messages rendered as one line (cascade-delete confirmation lost its formatting) — `whiteSpace: pre-line` added.
- `useConfirm` stale-state pattern → functional setState.
- `loadSubById` now distinguishes "not found" from "DB error" so revocation logic is safe against false positives.
- Splash `onDone` could fire twice on click+timer race — ref-guarded to fire exactly once.
- Game and Id&Pass forms now trim leading/trailing whitespace on submit (passwords intentionally NOT trimmed).
- Stale "v18.1" version string in About defaults bumped to v19.
- `package.json` version bumped to `19.0.0`.

## What's new in v19 — Multi-tenant workspaces 🏢

### Core change
Every workspace is now isolated. Each co-admin you create gets their own private space with their own sub-admins, notices, games, credentials, and backend entries — completely invisible to Zeus and to other co-admins.

### How it works
- **Zeus** runs their own workspace AND has the unique power to create co-admins
- **Each co-admin** is a workspace owner — they create their own sub-admins, manage their own content, see only their own data
- **Sub-admins** belong to one workspace (whoever created them) — read-only access to assigned content
- **About Us** stays shared across all workspaces (Zeus edits, everyone sees the same)

### Migration is automatic
- All existing data (notices, games, credentials, backend entries, sub-admins) is automatically assigned to Zeus's workspace
- Zero data loss
- The `setup.sql` script adds an `owner_id` column with default `'zeus'` to all tenant tables

### New behaviors
- **Login flow**: at sign-in, the app determines which workspace the user belongs to and only loads that workspace's data
- **Cascade delete**: when Zeus removes a co-admin, the app shows a detailed confirmation listing exactly what will be wiped (sub-admins + notices + games + credentials + backend entries) before any destructive action
- **Backup/export**: each workspace exports independently. The export filename includes the workspace tag so co-admin backups don't collide with Zeus's
- **Backup/import**: accepts both v1 (legacy single-workspace) and v2 (multi-tenant) backup formats. Imports always go into the importer's current workspace

### What hasn't changed
- All UI, animations, theme support, splash screens
- Optimistic updates, real-time sync, debouncing
- PWA install behavior, service worker, offline shell
- Editable About Us (still shared, Zeus-only edit)
- Bulk select / delete / reorder per tab
- Multi-account sign-in on the same device
- JSON backup format (now v2, but v1 still works on import)

## All features (v16–v19)

- Three-tier role hierarchy: Zeus / Co-admin / Sub-admin
- Multi-tenant workspaces (v19, new)
- Default Zeus: `Zeus` / `Hello@123` (change in Settings)
- Real-time sync across devices
- Optimistic updates everywhere
- Notice / Backend / Games / Id & Pass tabs
- Search on every tab
- Id & Pass filter pills (by sub-admin)
- Edit everything — entries, sub-admins, About Us content, QR image
- Bulk select & delete
- Drag or ▲▼ reorder
- Copy buttons on links, usernames, passwords, wallet addresses
- Show/hide password toggles
- Confirmation dialogs on destructive actions (cascade-aware for co-admin removal)
- Created/updated timestamps with "NEW" badge for recent items
- Tab persistence across refresh
- Friendly error messages
- JSON import / export backup (per workspace)
- About Us modal with editable donation info + QR code
- Dark mode (system / light / dark)
- Multi-account sign-in & switching
- PWA install (mobile + desktop)
- Service worker (app shell offline, fast subsequent loads)

## Tech Stack

- Next.js 14.2.35 + React 18 + TypeScript 5.4
- Supabase (Postgres + Realtime + Storage)
- Bundle: ~87 KB main page, ~174 KB first load

## Setup

1. Run `setup.sql` in Supabase SQL Editor — idempotent, safe on existing v18.1 schema (just adds owner_id columns + indexes)
2. Make sure the `about-assets` Storage bucket exists (created in v18 setup; check Supabase Storage)
3. Push to GitHub — Vercel auto-deploys
4. Required env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## Security & data

- Passwords stored as plain text (upgrade to bcrypt for production-grade security)
- Each workspace's data is filtered at the application layer using `owner_id`
- The Supabase publishable key is safe to ship in the frontend
- Never commit the `service_role` key

## Upgrade path from v18.1

The `setup.sql` script is idempotent and safely upgrades v18.1 → v19:
- Adds `owner_id text not null default 'zeus'` to: `sub_admins`, `backend_entries`, `game_entries`, `idpass_entries`, `notices`
- Adds indexes on `owner_id` for query performance
- All existing rows automatically get `owner_id = 'zeus'` (preserving them in Zeus's workspace)
- No data loss
