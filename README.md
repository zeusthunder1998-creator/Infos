# Infos

Admin portal app with main admin (Zeus), sub-admin accounts, and tabs for Announcements, Notes, Backend, Games, and Id & Pass credentials.

## Features

- **Unified login** — one form, auto-detects Zeus vs sub-admin
- **Default Zeus credentials**: `Zeus` / `Hello@123` (change in Settings after first login)
- **Multi-account sign-in** — stay logged into several accounts, switch via the avatar dropdown
- **3-second app-open splash** + **2-second login splash**
- **Assignments** — every entry (Backend / Games / Id & Pass / Notes / Announcements) can be assigned to specific sub-admins or toggled to "All sub-admins"
- **Short name field** on Backend, Games, and Id & Pass
- **Description / note field** on every entry
- **Drag to reorder** — Zeus drags `⋮⋮` handles; sub-admins see items in that order
- **Reveal/hide** for Id & Pass passwords
- **Custom sub-admins** — Zeus creates their username + password
- **Settings** — Zeus can change their own username/password
- **PWA ready** — manifest + all icon sizes bundled

## Tech Stack

- Next.js 14 (App Router)
- React 18
- TypeScript
- `localStorage` for persistence (no backend needed)

## Run Locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Deploy to Vercel

### Option 1 — via Vercel CLI

```bash
npm install -g vercel
vercel
```

Follow prompts; defaults are fine. Hit "Production" deploy when asked.

### Option 2 — via GitHub + Vercel dashboard

1. Push this folder to a new GitHub repo:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/infos.git
   git push -u origin main
   ```
2. Go to [vercel.com/new](https://vercel.com/new) and import the repo.
3. Framework preset: **Next.js** (auto-detected).
4. Click **Deploy**. Done.

### Option 3 — drag and drop

On [vercel.com/new](https://vercel.com/new), scroll to **"Deploy without Git"** and drag this project folder in.

## First-time setup after deploy

1. Open your Vercel URL.
2. After the splash, log in with `Zeus` / `Hello@123`.
3. Go to **Settings** → change the Zeus password immediately.
4. Go to **Sub-admins** → create sub-admin accounts.
5. Start creating Announcements / Notes / Backend / Games / Id & Pass entries.

## Notes

- **Storage is per-browser**: the app uses `localStorage`. Data is stored in the user's browser, not on a server. Different devices / browsers see different data. If you need real multi-device sync, wire in a backend (Vercel KV, Supabase, Firebase etc.) and replace `lib/storage.ts` with your API calls.
- **Passwords are stored in plain text** inside localStorage. This is fine for personal/internal use but not for production-grade security.

## License

Private / internal use.
