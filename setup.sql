-- ============================================================
-- Infos app — complete database setup (v20)
--
-- IDEMPOTENT: safe to run on fresh project OR existing schema.
-- Will:
--   - Create tables if missing
--   - Add updated_at column if missing
--   - Add "role" column to sub_admins if missing (for co-admin support)
--   - Add "owner_id" column to all tenant tables (for multi-tenancy, v19)
--   - Add "section" column to idpass_entries (for Games | Accounts split, v20)
--   - Create about_content table for editable About Us (shared)
--   - (Re)create RLS policies
--   - Add all tables to realtime publication (for live sync)
--   - Create Storage bucket "about-assets" for editable QR
--   - Add Storage policies so app can upload/read QR
-- Does NOT drop existing data.
-- Migration note: existing rows automatically assigned to Zeus workspace
-- (owner_id defaults to 'zeus' via column default). Existing idpass entries
-- automatically become Games-section entries (section defaults to 'games').
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

create policy "public read"   on zeus_creds       for select using (true);
create policy "public update" on zeus_creds       for update using (true);
create policy "public all"    on sub_admins       for all    using (true) with check (true);
create policy "public all"    on backend_entries  for all    using (true) with check (true);
create policy "public all"    on game_entries     for all    using (true) with check (true);
create policy "public all"    on idpass_entries   for all    using (true) with check (true);
create policy "public all"    on notices          for all    using (true) with check (true);
create policy "public all"    on paste_buffer     for all    using (true) with check (true);
create policy "public all"    on about_content    for all    using (true) with check (true);

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
