# Infos

Admin portal app with main admin (Zeus), sub-admin accounts, and tabs for Notice, Backend, Games, and Id & Pass credentials.

Backed by **Supabase** — all data syncs across devices in real-time.

## Features

- **Unified login** — auto-detects Zeus vs sub-admin
- **Default Zeus credentials**: `Zeus` / `Hello@123` (change in Settings after first login)
- **Multi-account sign-in** — stay logged into several accounts, switch via the avatar dropdown
- **Dark mode** — auto-match system, or manually toggle light/dark from the avatar menu
- **Search bar** on every tab — filter instantly by name, link, or description
- **Notice tab** — post announcements with title, message, and optional link
- **Assignments** — assign entries to specific sub-admins or toggle "All sub-admins"
- **Bulk manage access** — per sub-admin, check/uncheck which entries they can see from one modal
- **Description / note field** on every entry
- **Drag OR arrow buttons (▲▼) to reorder** — works great on mobile
- **One-click copy** on every link, username, and password
- **Confirmation dialog on delete** — no more accidental data loss
- **Created / last-updated timestamps** — "2h ago" with full date on hover
- **New entries append to bottom** — preserves existing order
- **Reveal/hide** for Id & Pass passwords
- **Import / Export** — full JSON backup + restore from Settings tab
- **Real-time sync** — changes appear instantly on every device

## Tech Stack

- Next.js 14 (App Router) + React 18 + TypeScript
- Supabase (Postgres + realtime)

## Local development

1. Copy `.env.example` to `.env.local` and fill in your Supabase URL and publishable key.
2. `npm install && npm run dev`
3. Open http://localhost:3000

## Deploy to Vercel

Set these two environment variables in the Vercel project settings:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Then push to GitHub, import in Vercel, deploy.

## Database schema

First-time setup: run the `schema.sql` and `migration.sql` (the latter only if you already ran the original schema).

Tables:
- `zeus_creds` — admin credentials (1 row)
- `sub_admins` — sub-admin accounts
- `backend_entries`, `game_entries`, `idpass_entries` — content tables
- `notices` — notice board

All tables have `created_at`, `sort_order`, and `updated_at` columns. RLS is enabled with public-access policies; app login logic controls visibility per role.

## Security notes

Passwords are stored as plain text in Supabase for simplicity. For sensitive production use, add server-side password hashing (e.g. Supabase Edge Functions + bcrypt).

The `anon` / `publishable` key is safe to ship in frontend code. Never commit the `service_role` key.
