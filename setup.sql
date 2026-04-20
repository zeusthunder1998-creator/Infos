-- ============================================================
-- Infos app — complete database setup (v15)
--
-- This file is IDEMPOTENT: safe to run on a fresh project OR
-- on a project that already has the older schema. It will:
--   - Create tables that don't exist
--   - Add "updated_at" column if missing
--   - (Re)create RLS policies
-- It does NOT drop your existing data.
-- ============================================================

-- Zeus admin credentials (always exactly 1 row)
create table if not exists zeus_creds (
  id int primary key default 1,
  username text not null,
  password text not null,
  constraint single_row check (id = 1)
);

-- Only insert the default row if the table is empty
insert into zeus_creds (username, password)
  select 'Zeus', 'Hello@123'
  where not exists (select 1 from zeus_creds);

-- Sub-admin accounts
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

-- Add updated_at to existing tables (no-op if already there)
alter table sub_admins       add column if not exists updated_at bigint;
alter table backend_entries  add column if not exists updated_at bigint;
alter table game_entries     add column if not exists updated_at bigint;
alter table idpass_entries   add column if not exists updated_at bigint;
alter table notices          add column if not exists updated_at bigint;

-- Enable Row Level Security
alter table zeus_creds       enable row level security;
alter table sub_admins       enable row level security;
alter table backend_entries  enable row level security;
alter table game_entries     enable row level security;
alter table idpass_entries   enable row level security;
alter table notices          enable row level security;

-- Replace any old policies with fresh ones (safe for re-runs)
drop policy if exists "public read"   on zeus_creds;
drop policy if exists "public update" on zeus_creds;
drop policy if exists "public all"    on sub_admins;
drop policy if exists "public all"    on backend_entries;
drop policy if exists "public all"    on game_entries;
drop policy if exists "public all"    on idpass_entries;
drop policy if exists "public all"    on notices;

create policy "public read"   on zeus_creds       for select using (true);
create policy "public update" on zeus_creds       for update using (true);
create policy "public all"    on sub_admins       for all    using (true) with check (true);
create policy "public all"    on backend_entries  for all    using (true) with check (true);
create policy "public all"    on game_entries     for all    using (true) with check (true);
create policy "public all"    on idpass_entries   for all    using (true) with check (true);
create policy "public all"    on notices          for all    using (true) with check (true);
