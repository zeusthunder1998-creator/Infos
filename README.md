# Infos (v19)

Multi-tenant admin portal. Each co-admin runs their own isolated workspace with their own sub-admins and content. Zeus oversees the platform and creates new co-admins. Backed by Supabase with real-time sync. Progressive Web App installable on mobile + desktop.

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
