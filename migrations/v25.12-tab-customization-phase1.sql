-- ============================================================================
-- Tab Customization — Phase 1: Schema migration
-- ============================================================================
--
-- Adds two new tables to support workspace-configurable tabs:
--
--   tab_config       - defines what tabs exist in each workspace
--   dynamic_entries  - generic entry storage for custom tabs
--
-- This migration is ADDITIVE only:
--   - Does NOT modify existing notices/backend_entries/game_entries/idpass_entries
--   - Does NOT change any current app behavior
--   - Seeds default tabs for existing workspaces so the migration is reversible
--
-- The Phase 2-5 work later wires the UI to these tables. Until then, this
-- migration is harmless — tables exist but are not yet read by the app.
--
-- ============================================================================
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- ============================================================================

-- 1. tab_config: defines the tabs for each workspace
-- Each row represents one tab in one workspace.
create table if not exists tab_config (
  id           text primary key,
  owner_id     text not null,                          -- which workspace this tab belongs to
  label        text not null,                          -- display name (renameable)
  icon         text not null default '📋',             -- emoji icon
  template     text not null,                          -- 'notice' | 'entry' | 'credential'
  sort_order   int  not null default 0,                -- left-to-right or top-to-bottom order
  is_system    boolean not null default false,         -- if true, can't be deleted (default tabs)
  created_at   bigint not null,
  updated_at   bigint not null,
  deleted_at   bigint                                  -- soft delete; null = active
);

-- Indexes for the common query patterns
create index if not exists tab_config_owner_idx       on tab_config(owner_id);
create index if not exists tab_config_sort_idx        on tab_config(owner_id, sort_order)
  where deleted_at is null;
create index if not exists tab_config_deleted_at_idx  on tab_config(deleted_at);

-- 2. dynamic_entries: generic entry storage that supports custom tabs
-- Each entry belongs to a tab, has flexible JSON data, plus standard
-- assignees + soft-delete + sort_order.
create table if not exists dynamic_entries (
  id           text primary key,
  tab_id       text not null,                          -- FK to tab_config (logical; not enforced yet)
  owner_id     text not null,                          -- denormalized for fast workspace queries
  template     text not null,                          -- denormalized; matches tab_config.template
  data         jsonb not null default '{}'::jsonb,     -- the entry's fields, schema varies by template
  assignees    text[] not null default '{}',           -- user_ids of assigned sub-admins, or ['__ALL__']
  sort_order   int    not null default 0,
  created_at   bigint not null,
  updated_at   bigint not null,
  deleted_at   bigint                                  -- soft delete
);

create index if not exists dynamic_entries_tab_idx    on dynamic_entries(tab_id);
create index if not exists dynamic_entries_owner_idx  on dynamic_entries(owner_id);
create index if not exists dynamic_entries_sort_idx   on dynamic_entries(tab_id, sort_order)
  where deleted_at is null;
create index if not exists dynamic_entries_deleted_at_idx on dynamic_entries(deleted_at);
-- GIN index on data so future Phase 3 search can hit jsonb fields efficiently
create index if not exists dynamic_entries_data_gin   on dynamic_entries using gin(data);

-- 3. Seed default tabs for every existing workspace.
-- Uses ON CONFLICT DO NOTHING so this is safely re-runnable.
-- Each default tab is marked is_system = true to prevent deletion later.

-- Use a single timestamp value for all seeded rows so they're consistent
do $$
declare
  ts bigint := (extract(epoch from now()) * 1000)::bigint;
  workspace record;
begin
  -- Get every workspace: zeus + every co-admin
  -- (sub_admins uses hard delete, not soft delete — no deleted_at column)
  for workspace in
    (select 'zeus' as owner_id
     union
     select id as owner_id from sub_admins where role = 'co')
  loop
    -- Notice tab (template = 'notice')
    insert into tab_config (id, owner_id, label, icon, template, sort_order, is_system, created_at, updated_at)
    values (
      'tab-' || workspace.owner_id || '-notice',
      workspace.owner_id, 'Notice', '📢', 'notice', 0, true, ts, ts
    )
    on conflict (id) do nothing;

    -- System (formerly Backend) tab
    insert into tab_config (id, owner_id, label, icon, template, sort_order, is_system, created_at, updated_at)
    values (
      'tab-' || workspace.owner_id || '-system',
      workspace.owner_id, 'System', '⚙️', 'entry', 1, true, ts, ts
    )
    on conflict (id) do nothing;

    -- Games tab
    insert into tab_config (id, owner_id, label, icon, template, sort_order, is_system, created_at, updated_at)
    values (
      'tab-' || workspace.owner_id || '-games',
      workspace.owner_id, 'Games', '🎮', 'entry', 2, true, ts, ts
    )
    on conflict (id) do nothing;

    -- Id & Pass tab
    insert into tab_config (id, owner_id, label, icon, template, sort_order, is_system, created_at, updated_at)
    values (
      'tab-' || workspace.owner_id || '-idpass',
      workspace.owner_id, 'Id & Pass', '🔐', 'credential', 3, true, ts, ts
    )
    on conflict (id) do nothing;
  end loop;
end $$;

-- 4. RLS policies — same "public all" pattern as existing tables
-- (Will be tightened in the auth rebuild work later)
alter table tab_config       enable row level security;
alter table dynamic_entries  enable row level security;

drop policy if exists "Public all" on tab_config;
create policy "Public all" on tab_config       for all using (true) with check (true);

drop policy if exists "Public all" on dynamic_entries;
create policy "Public all" on dynamic_entries  for all using (true) with check (true);

-- 5. Enable Realtime so the app can subscribe to changes.
-- Wrapped in exception handler since publication adds fail if table is already a member.
do $$
begin
  begin
    alter publication supabase_realtime add table tab_config;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table dynamic_entries;
  exception when duplicate_object then null;
  end;
end $$;

-- ============================================================================
-- Verification queries (optional — run these to verify the migration worked)
-- ============================================================================
--
-- Count tabs per workspace:
--   select owner_id, count(*) from tab_config where deleted_at is null group by owner_id;
--
-- See all default tabs:
--   select owner_id, label, icon, template, sort_order from tab_config order by owner_id, sort_order;
--
-- Verify dynamic_entries table is empty (no data migrated yet — Phase 5 does that):
--   select count(*) from dynamic_entries;
