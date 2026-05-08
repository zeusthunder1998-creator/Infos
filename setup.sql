-- ============================================================
-- Infos app — complete database setup (v24.0)
--
-- IDEMPOTENT: safe to run on fresh project OR existing schema.
-- Adds columns/tables/buckets only if missing. Does NOT drop data.
-- ============================================================

-- ==============================================================
-- SECTION 1 — Tables
-- ==============================================================

-- Zeus admin credentials (always exactly 1 row)
create table if not exists zeus_creds (
  id int primary key default 1,
  username text not null,
  password text not null,
  constraint single_row check (id = 1)
);
insert into zeus_creds (username, password)
  select 'Zeus', 'Hello@123'
  where not exists (select 1 from zeus_creds);

-- Sub-admin / co-admin accounts (both live here; role column differentiates)
create table if not exists sub_admins (
  id text primary key,
  username text unique not null,
  password text not null,
  created_at bigint not null,
  sort_order int not null default 0
);

-- Backend entries
create table if not exists backend_entries (
  id text primary key,
  game_name text not null,
  short_name text not null,
  link text not null,
  description text default '',
  assignees jsonb not null default '[]'::jsonb,
  created_at bigint not null,
  sort_order int not null default 0
);

-- Games entries
create table if not exists game_entries (
  id text primary key,
  game_name text not null,
  short_name text not null,
  link text not null,
  description text default '',
  assignees jsonb not null default '[]'::jsonb,
  created_at bigint not null,
  sort_order int not null default 0
);

-- Id & Pass entries
create table if not exists idpass_entries (
  id text primary key,
  game text not null,
  short_name text default '',
  username text not null,
  password text not null,
  description text default '',
  assignees jsonb not null default '[]'::jsonb,
  created_at bigint not null,
  sort_order int not null default 0
);

-- Notices
create table if not exists notices (
  id text primary key,
  title text not null,
  body text not null,
  link text default '',
  recipients jsonb not null default '[]'::jsonb,
  created_at bigint not null,
  sort_order int not null default 0
);

-- Add updated_at columns (no-op if already there)
alter table sub_admins       add column if not exists updated_at bigint;
alter table backend_entries  add column if not exists updated_at bigint;
alter table game_entries     add column if not exists updated_at bigint;
alter table idpass_entries   add column if not exists updated_at bigint;
alter table notices          add column if not exists updated_at bigint;

-- Role column on sub_admins ('sub' = sub-admin, 'co' = co-admin)
alter table sub_admins       add column if not exists role text not null default 'sub';

-- ==============================================================
-- v19: Multi-tenant workspaces
-- owner_id identifies which workspace each row belongs to.
--   'zeus'        = Zeus's own workspace
--   'sub:<id>'    = a co-admin's workspace (the co-admin's sub_admins.id)
-- Zeus only creates co-admins; co-admins create their own sub-admins in
-- their isolated workspace. Migration default of 'zeus' means all existing
-- data is preserved in Zeus's workspace.
-- ==============================================================
alter table sub_admins       add column if not exists owner_id text not null default 'zeus';
alter table backend_entries  add column if not exists owner_id text not null default 'zeus';
alter table game_entries     add column if not exists owner_id text not null default 'zeus';
alter table idpass_entries   add column if not exists owner_id text not null default 'zeus';
alter table notices          add column if not exists owner_id text not null default 'zeus';

-- Indexes on owner_id for query performance (most queries filter by owner)
create index if not exists sub_admins_owner_idx      on sub_admins(owner_id);
create index if not exists backend_entries_owner_idx on backend_entries(owner_id);
create index if not exists game_entries_owner_idx    on game_entries(owner_id);
create index if not exists idpass_entries_owner_idx  on idpass_entries(owner_id);
create index if not exists notices_owner_idx         on notices(owner_id);

-- ==============================================================
-- v20: Id & Pass sub-sections (Games | Accounts)
-- 'section' partitions idpass_entries into two sub-tabs inside the
-- Id & Pass tab. Existing rows default to 'games' (preserves all v19
-- data as game credentials). New entries can be 'games' or 'accounts'.
-- ==============================================================
alter table idpass_entries add column if not exists section text not null default 'games';
create index if not exists idpass_entries_section_idx on idpass_entries(section);

-- ==============================================================
-- v20.7: Pinned notices
-- 'pinned' lets admins float important notices to the top of the list.
-- Per-workspace (already enforced by owner_id). Existing rows default to
-- false (unpinned), so no v19/v20 data is altered.
-- ==============================================================
alter table notices add column if not exists pinned boolean not null default false;
create index if not exists notices_pinned_idx on notices(pinned) where pinned = true;

-- ==============================================================
-- v20: Copy & Paste buffer (sub-admin self-only, 5-min TTL)
-- Stores temporary credential snippets each sub-admin can share between
-- their own multiple phones. user_id pins ownership (only the creating
-- sub-admin sees their entries). expires_at enforces 5-minute TTL via
-- client-side filter + lazy DB cleanup on app open.
-- ==============================================================
create table if not exists paste_buffer (
  id text primary key,
  game text not null,
  username text not null,
  password text not null,
  user_id text not null,
  owner_id text not null default 'zeus',
  created_at bigint not null,
  expires_at bigint not null
);
create index if not exists paste_buffer_owner_idx   on paste_buffer(owner_id);
create index if not exists paste_buffer_user_idx    on paste_buffer(user_id);
create index if not exists paste_buffer_expires_idx on paste_buffer(expires_at);

-- ==============================================================
-- v21.4: Soft delete (Trash bin)
-- 'deleted_at' lets users move entries to a Trash tab without losing them.
-- Items can be restored, permanently deleted, or auto-purged after 30 days.
-- Default loaders filter for deleted_at IS NULL.
-- ==============================================================
alter table backend_entries add column if not exists deleted_at bigint;
alter table game_entries    add column if not exists deleted_at bigint;
alter table idpass_entries  add column if not exists deleted_at bigint;
alter table notices         add column if not exists deleted_at bigint;
create index if not exists backend_entries_deleted_idx on backend_entries(deleted_at) where deleted_at is not null;
create index if not exists game_entries_deleted_idx    on game_entries(deleted_at)    where deleted_at is not null;
create index if not exists idpass_entries_deleted_idx  on idpass_entries(deleted_at)  where deleted_at is not null;
create index if not exists notices_deleted_idx         on notices(deleted_at)         where deleted_at is not null;

-- ==============================================================
-- v22.0: Profile pictures
-- Adds 'profile_pic_url' to zeus_creds and sub_admins so each user
-- (Zeus, co-admins, sub-admins) can upload a custom avatar.
-- Picture itself lives in the new 'profile-pics' Storage bucket.
-- ==============================================================
alter table zeus_creds add column if not exists profile_pic_url text;
alter table sub_admins add column if not exists profile_pic_url text;

-- ==============================================================
-- v22.2: Device session tracking
-- Lets Zeus see who's logged in on which devices and force-logout
-- specific sessions. "Soft auth" — supplements the existing app
-- without replacing it. See lib/storage.ts for limitations.
-- ==============================================================
create table if not exists sessions (
  id text primary key,
  device_id text not null,
  user_id text not null,
  username text not null,
  role text not null default 'sub',
  owner_id text not null default 'zeus',
  device_label text,
  user_agent text,
  platform text,
  created_at bigint not null,
  last_seen_at bigint not null,
  revoked_at bigint
);
create index if not exists sessions_user_idx        on sessions(user_id);
create index if not exists sessions_owner_idx       on sessions(owner_id);
create index if not exists sessions_last_seen_idx   on sessions(last_seen_at desc);
create index if not exists sessions_revoked_idx     on sessions(revoked_at) where revoked_at is not null;
create index if not exists sessions_device_user_idx on sessions(device_id, user_id);

-- ==============================================================
-- v24.0: Web Push subscriptions
-- One row per (user_id, endpoint). The endpoint URL uniquely identifies a
-- browser's push subscription. Users may have multiple devices = multiple rows.
-- p256dh and auth are encryption keys that the push service uses to sign payloads.
-- ==============================================================
create table if not exists push_subscriptions (
  id text primary key,
  user_id text not null,
  username text not null,
  role text not null default 'sub',
  owner_id text not null default 'zeus',
  endpoint text not null unique,           -- URL the push service gives us
  p256dh text not null,                    -- public encryption key
  auth text not null,                      -- auth secret
  device_label text,
  user_agent text,
  created_at bigint not null,
  last_seen_at bigint not null,
  failed_count int not null default 0      -- consecutive failed sends; high count = stale subscription
);
create index if not exists push_subs_user_idx     on push_subscriptions(user_id);
create index if not exists push_subs_owner_idx    on push_subscriptions(owner_id);
create index if not exists push_subs_endpoint_idx on push_subscriptions(endpoint);

-- ==============================================================
-- v24.0: Web Push subscriptions
-- Each device that opts into push notifications gets a row here.
-- The Edge Function reads this to know where to send notifications.
-- ==============================================================
create table if not exists push_subscriptions (
  id text primary key,
  user_id text not null,           -- 'zeus' or sub_admins.id
  device_id text not null,         -- matches sessions.device_id
  owner_id text not null default 'zeus',
  endpoint text not null,          -- the push service URL (Mozilla, Apple, Google FCM, etc)
  p256dh_key text not null,        -- subscription public key (from PushSubscription)
  auth_key text not null,          -- subscription auth secret
  created_at bigint not null,
  last_used_at bigint not null,
  user_agent text                  -- for debugging which devices are subscribed
);
create unique index if not exists push_sub_endpoint_idx on push_subscriptions(endpoint);
create index if not exists push_sub_user_idx on push_subscriptions(user_id);
create index if not exists push_sub_owner_idx on push_subscriptions(owner_id);
create index if not exists push_sub_device_idx on push_subscriptions(device_id, user_id);


-- ==============================================================
-- v21.1: Workspace branding
-- Per-workspace customization (workspace name, logo URL, accent color).
-- One row per workspace, keyed by owner_id. Sub-admins inherit read-only.
-- ==============================================================
create table if not exists workspace_branding (
  owner_id text primary key,
  workspace_name text,
  logo_url text,
  accent_color text,
  updated_at bigint
);

-- Editable About Us content (always exactly 1 row — SHARED across all workspaces)
create table if not exists about_content (
  id int primary key default 1,
  developer_name text,
  company_name text,
  version text,
  contact_email text,
  donation_intro text,
  crypto_name text,
  crypto_network text,
  wallet_address text,
  qr_image_url text,
  warning_text text,
  updated_at bigint,
  constraint about_single_row check (id = 1)
);

-- ==============================================================
-- SECTION 2 — Row Level Security
-- ==============================================================

alter table zeus_creds       enable row level security;
alter table sub_admins       enable row level security;
alter table backend_entries  enable row level security;
alter table game_entries     enable row level security;
alter table idpass_entries   enable row level security;
alter table notices          enable row level security;
alter table paste_buffer     enable row level security;
alter table about_content    enable row level security;
alter table workspace_branding enable row level security;
alter table sessions           enable row level security;
alter table push_subscriptions enable row level security;

-- Replace any old policies with fresh ones (safe for re-runs)
drop policy if exists "public read"   on zeus_creds;
drop policy if exists "public update" on zeus_creds;
drop policy if exists "public all"    on sub_admins;
drop policy if exists "public all"    on backend_entries;
drop policy if exists "public all"    on game_entries;
drop policy if exists "public all"    on idpass_entries;
drop policy if exists "public all"    on notices;
drop policy if exists "public all"    on paste_buffer;
drop policy if exists "public all"    on about_content;
drop policy if exists "public all"    on workspace_branding;
drop policy if exists "public all"    on sessions;
drop policy if exists "public all"    on push_subscriptions;

create policy "public read"   on zeus_creds       for select using (true);
create policy "public update" on zeus_creds       for update using (true);
create policy "public all"    on sub_admins       for all    using (true) with check (true);
create policy "public all"    on backend_entries  for all    using (true) with check (true);
create policy "public all"    on game_entries     for all    using (true) with check (true);
create policy "public all"    on idpass_entries   for all    using (true) with check (true);
create policy "public all"    on notices          for all    using (true) with check (true);
create policy "public all"    on paste_buffer     for all    using (true) with check (true);
create policy "public all"    on about_content    for all    using (true) with check (true);
create policy "public all"    on workspace_branding for all  using (true) with check (true);
create policy "public all"    on sessions         for all    using (true) with check (true);
create policy "public all"    on push_subscriptions for all  using (true) with check (true);

-- ==============================================================
-- SECTION 3 — Realtime publication (needed for live sync)
-- ==============================================================

-- Add each table to supabase_realtime publication if not already present.
-- Wrapped in DO blocks so re-running doesn't error on "already member" warnings.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sub_admins'
  ) then
    alter publication supabase_realtime add table sub_admins;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'backend_entries'
  ) then
    alter publication supabase_realtime add table backend_entries;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'game_entries'
  ) then
    alter publication supabase_realtime add table game_entries;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'idpass_entries'
  ) then
    alter publication supabase_realtime add table idpass_entries;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notices'
  ) then
    alter publication supabase_realtime add table notices;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'about_content'
  ) then
    alter publication supabase_realtime add table about_content;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'paste_buffer'
  ) then
    alter publication supabase_realtime add table paste_buffer;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'workspace_branding'
  ) then
    alter publication supabase_realtime add table workspace_branding;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sessions'
  ) then
    alter publication supabase_realtime add table sessions;
  end if;
end $$;

-- ==============================================================
-- SECTION 4 — Storage bucket for editable QR image
-- ==============================================================

-- Create the public bucket if it doesn't exist
insert into storage.buckets (id, name, public)
  select 'about-assets', 'about-assets', true
  where not exists (select 1 from storage.buckets where id = 'about-assets');

-- Drop old policies on the about-assets bucket (safe if absent)
drop policy if exists "about-assets public read"   on storage.objects;
drop policy if exists "about-assets public write"  on storage.objects;
drop policy if exists "about-assets public update" on storage.objects;
drop policy if exists "about-assets public delete" on storage.objects;

-- Create fresh policies: anyone can read/write the about-assets bucket
create policy "about-assets public read"
  on storage.objects for select
  using (bucket_id = 'about-assets');

create policy "about-assets public write"
  on storage.objects for insert
  with check (bucket_id = 'about-assets');

create policy "about-assets public update"
  on storage.objects for update
  using (bucket_id = 'about-assets')
  with check (bucket_id = 'about-assets');

create policy "about-assets public delete"
  on storage.objects for delete
  using (bucket_id = 'about-assets');

-- ==============================================================
-- SECTION 5 — Storage bucket for workspace logos (v21.1)
-- ==============================================================

-- Create the public bucket if it doesn't exist
insert into storage.buckets (id, name, public)
  select 'workspace-logos', 'workspace-logos', true
  where not exists (select 1 from storage.buckets where id = 'workspace-logos');

-- Drop old policies on the workspace-logos bucket (safe if absent)
drop policy if exists "workspace-logos public read"   on storage.objects;
drop policy if exists "workspace-logos public write"  on storage.objects;
drop policy if exists "workspace-logos public update" on storage.objects;
drop policy if exists "workspace-logos public delete" on storage.objects;

-- Public read so logos can be displayed; write/update/delete also public to
-- match the rest of the app's pattern. Real auth would scope these, but the
-- app's general security model is "open per design with no real auth yet."
create policy "workspace-logos public read"
  on storage.objects for select
  using (bucket_id = 'workspace-logos');

create policy "workspace-logos public write"
  on storage.objects for insert
  with check (bucket_id = 'workspace-logos');

create policy "workspace-logos public update"
  on storage.objects for update
  using (bucket_id = 'workspace-logos')
  with check (bucket_id = 'workspace-logos');

create policy "workspace-logos public delete"
  on storage.objects for delete
  using (bucket_id = 'workspace-logos');

-- ==============================================================
-- SECTION 6 — Storage bucket for profile pictures (v22.0)
-- ==============================================================

insert into storage.buckets (id, name, public)
  select 'profile-pics', 'profile-pics', true
  where not exists (select 1 from storage.buckets where id = 'profile-pics');

drop policy if exists "profile-pics public read"   on storage.objects;
drop policy if exists "profile-pics public write"  on storage.objects;
drop policy if exists "profile-pics public update" on storage.objects;
drop policy if exists "profile-pics public delete" on storage.objects;

create policy "profile-pics public read"
  on storage.objects for select
  using (bucket_id = 'profile-pics');

create policy "profile-pics public write"
  on storage.objects for insert
  with check (bucket_id = 'profile-pics');

create policy "profile-pics public update"
  on storage.objects for update
  using (bucket_id = 'profile-pics')
  with check (bucket_id = 'profile-pics');

create policy "profile-pics public delete"
  on storage.objects for delete
  using (bucket_id = 'profile-pics');
