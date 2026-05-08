// Supabase-backed storage for shared data. Session info (who's logged in)
// still uses localStorage since it's per-device.

import { getSupabase } from './supabase';

export const DEFAULT_ZEUS = { username: 'Zeus', password: 'Hello@123' };
export const ALL_SENTINEL = '__ALL__';

export const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export const accKey = (u: any) =>
  u.role === 'zeus' ? 'zeus' : `sub:${u.id}`;

export const isVisibleToSub = (arr: string[] | undefined, subId: string) =>
  (arr || []).includes(ALL_SENTINEL) || (arr || []).includes(subId);

export const isAssignedAll = (arr: string[] | undefined) =>
  (arr || []).includes(ALL_SENTINEL);

// ---------- Session (localStorage) ----------
const SESSION_KEYS = {
  ACCOUNTS: 'infos:accounts',
  ACTIVE: 'infos:active_account',
  THEME: 'infos:theme',
};

export function loadSession<T>(key: keyof typeof SESSION_KEYS, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const v = window.localStorage.getItem(SESSION_KEYS[key]);
    if (v === null) return fallback;
    try {
      const parsed = JSON.parse(v);
      // Type-guard: if fallback was an array but parsed isn't, fall back
      if (Array.isArray(fallback) && !Array.isArray(parsed)) return fallback;
      return parsed as T;
    } catch {
      // Not valid JSON. If fallback is a string, return the raw value; otherwise fallback.
      if (typeof fallback === 'string') return v as unknown as T;
      return fallback;
    }
  } catch { return fallback; }
}
export function saveSession(key: keyof typeof SESSION_KEYS, value: any): void {
  if (typeof window === 'undefined') return;
  try {
    const toStore = typeof value === 'string' ? value : JSON.stringify(value);
    window.localStorage.setItem(SESSION_KEYS[key], toStore);
  } catch {}
}
export function clearSession(key: keyof typeof SESSION_KEYS): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.removeItem(SESSION_KEYS[key]); } catch {}
}

// ---------- Row mappers ----------
type DbRow = any;
type Entry = any;

function rowToGameEntry(r: DbRow): Entry {
  return {
    id: r.id, gameName: r.game_name || '', shortName: r.short_name || '',
    link: r.link || '', description: r.description || '', assignees: r.assignees || [],
    createdAt: Number(r.created_at),
    updatedAt: r.updated_at ? Number(r.updated_at) : null,
    deletedAt: r.deleted_at ? Number(r.deleted_at) : null,    // v21.4
    sortOrder: r.sort_order ?? 0,
    ownerId: r.owner_id || 'zeus',
  };
}
function rowToIdPass(r: DbRow): Entry {
  return {
    id: r.id, game: r.game || '', shortName: r.short_name || '',
    username: r.username || '', password: r.password || '', description: r.description || '',
    assignees: r.assignees || [],
    section: r.section || 'games',
    createdAt: Number(r.created_at),
    updatedAt: r.updated_at ? Number(r.updated_at) : null,
    deletedAt: r.deleted_at ? Number(r.deleted_at) : null,    // v21.4
    sortOrder: r.sort_order ?? 0,
    ownerId: r.owner_id || 'zeus',
  };
}
function rowToNotice(r: DbRow): Entry {
  return {
    id: r.id, title: r.title || '', body: r.body || '', link: r.link || '',
    recipients: r.recipients || [],
    pinned: !!r.pinned,
    createdAt: Number(r.created_at),
    updatedAt: r.updated_at ? Number(r.updated_at) : null,
    deletedAt: r.deleted_at ? Number(r.deleted_at) : null,    // v21.4
    sortOrder: r.sort_order ?? 0,
    ownerId: r.owner_id || 'zeus',
  };
}
function rowToSub(r: DbRow): Entry {
  return {
    id: r.id, username: r.username || '', password: r.password || '',
    role: r.role || 'sub',  // 'sub' or 'co'
    profilePicUrl: r.profile_pic_url || null,        // v22.0
    createdAt: Number(r.created_at),
    updatedAt: r.updated_at ? Number(r.updated_at) : null,
    sortOrder: r.sort_order ?? 0,
    ownerId: r.owner_id || 'zeus',
  };
}

// ---------- v19: Workspace resolution ----------
// Determine which workspace a user "sees" when they log in.
//   Zeus         → 'zeus' (their own workspace)
//   Co-admin     → their own user id (they ARE a workspace owner)
//   Sub-admin    → the owner_id stored on their own sub_admins row
//     (which points to whichever admin created them)
export function workspaceIdForUser(user: any): string {
  if (!user) return 'zeus';
  if (user.role === 'zeus') return 'zeus';
  if (user.role === 'co') return user.id;   // co-admin is workspace owner
  // sub-admin: their workspace is determined by their row's owner_id,
  // which should have been loaded when login happened
  return user.ownerId || 'zeus';
}

// ---------- Zeus creds ----------
export async function loadZeus(): Promise<{ username: string; password: string; profilePicUrl?: string | null }> {
  const sb = getSupabase();
  const { data, error } = await sb.from('zeus_creds').select('username, password, profile_pic_url').eq('id', 1).single();
  if (error || !data) return DEFAULT_ZEUS;
  return { username: data.username, password: data.password, profilePicUrl: data.profile_pic_url || null };
}
export async function saveZeus(creds: { username: string; password: string }) {
  const sb = getSupabase();
  const { error } = await sb.from('zeus_creds').update({ username: creds.username, password: creds.password }).eq('id', 1);
  if (error) throw error;
}

/**
 * v19: Find a sub-admin or co-admin by username + password across ALL workspaces.
 * Used only at login time (before we know which workspace the user belongs to).
 * Returns the matched sub_admin row (with owner_id) or null.
 */
export async function findSubByCredentials(username: string, password: string): Promise<any | null> {
  const sb = getSupabase();
  const { data, error } = await sb.from('sub_admins')
    .select('*')
    .eq('username', username)
    .eq('password', password)
    .maybeSingle();
  if (error || !data) return null;
  return rowToSub(data);
}

// ---------- Sub-admins (v19: scoped to workspace) ----------
// ownerId = 'zeus' for Zeus's sub-admins, or a co-admin's user id for their sub-admins.
// Also returns co-admins (which Zeus creates at owner_id='zeus') — caller can filter by role.
export async function loadSubs(ownerId: string = 'zeus'): Promise<any[]> {
  const sb = getSupabase();
  const { data, error } = await sb.from('sub_admins')
    .select('*')
    .eq('owner_id', ownerId)
    .order('sort_order');
  if (error) { console.error(error); return []; }
  return (data || []).map(rowToSub);
}
/**
 * Load a single sub-admin row by id.
 * Returns null ONLY if the row doesn't exist (confirmed deleted).
 * Throws on network/DB errors so callers can distinguish "user gone" from "can't reach server".
 * Used during login to resolve which workspace a sub-admin belongs to,
 * and by session validation on app load.
 */
export async function loadSubById(id: string): Promise<any | null> {
  const sb = getSupabase();
  const { data, error } = await sb.from('sub_admins')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;       // network/DB problem — caller should NOT treat as deletion
  if (!data) return null;       // confirmed not-found — caller can sign user out
  return rowToSub(data);
}
export async function addSub(sub: { id: string; username: string; password: string; role: 'sub' | 'co'; createdAt: number; sortOrder: number; ownerId: string }) {
  const sb = getSupabase();
  const { error } = await sb.from('sub_admins').insert({
    id: sub.id, username: sub.username, password: sub.password, role: sub.role,
    created_at: sub.createdAt, sort_order: sub.sortOrder,
    owner_id: sub.ownerId,
  });
  if (error) throw error;
}
export async function deleteSub(id: string) {
  const sb = getSupabase();
  // v20: Cascade-clean any paste_buffer rows owned by this sub-admin so they
  // don't linger after the account is removed. Best-effort — failure here
  // doesn't block the account deletion (TTL would clean them up anyway).
  try { await sb.from('paste_buffer').delete().eq('user_id', id); } catch {}
  const { error } = await sb.from('sub_admins').delete().eq('id', id);
  if (error) throw error;
}

/**
 * v19: Cascade delete a co-admin's entire workspace.
 * Removes:
 *   1. all sub-admins owned by this co-admin
 *   2. all content (notices, backend, games, idpass) owned by this co-admin
 *   3. v20: all paste_buffer rows in this workspace
 *   4. the co-admin themselves
 * Called only from the Create Admin tab when Zeus removes a co-admin.
 */
export async function deleteCoAdminWorkspace(coAdminId: string) {
  const sb = getSupabase();
  const workspaceId = coAdminId; // co-admin's id is their workspace owner_id
  // Delete all content in this workspace (parallel, best-effort)
  const [s1, s2, s3, s4, s5, s6, s7] = await Promise.all([
    sb.from('sub_admins').delete().eq('owner_id', workspaceId),
    sb.from('backend_entries').delete().eq('owner_id', workspaceId),
    sb.from('game_entries').delete().eq('owner_id', workspaceId),
    sb.from('idpass_entries').delete().eq('owner_id', workspaceId),
    sb.from('notices').delete().eq('owner_id', workspaceId),
    sb.from('paste_buffer').delete().eq('owner_id', workspaceId),
    sb.from('workspace_branding').delete().eq('owner_id', workspaceId), // v21.1
  ]);
  // Check for errors on any of the content deletions
  const firstErr = [s1, s2, s3, s4, s5, s6, s7].find(r => r.error);
  if (firstErr?.error) throw firstErr.error;
  // Finally, delete the co-admin account itself
  const { error } = await sb.from('sub_admins').delete().eq('id', coAdminId);
  if (error) throw error;
}

/**
 * v19: Count how many items a co-admin's workspace contains.
 * Used to show an informative confirmation dialog before cascade delete.
 */
export async function countWorkspaceContents(coAdminId: string): Promise<{ subAdmins: number; notices: number; backend: number; games: number; idpass: number }> {
  const sb = getSupabase();
  const ws = coAdminId;
  const [s, n, b, g, i] = await Promise.all([
    sb.from('sub_admins').select('id', { count: 'exact', head: true }).eq('owner_id', ws),
    sb.from('notices').select('id', { count: 'exact', head: true }).eq('owner_id', ws),
    sb.from('backend_entries').select('id', { count: 'exact', head: true }).eq('owner_id', ws),
    sb.from('game_entries').select('id', { count: 'exact', head: true }).eq('owner_id', ws),
    sb.from('idpass_entries').select('id', { count: 'exact', head: true }).eq('owner_id', ws),
  ]);
  return {
    subAdmins: s.count || 0,
    notices: n.count || 0,
    backend: b.count || 0,
    games: g.count || 0,
    idpass: i.count || 0,
  };
}

// ---------- Generic helpers (v19: scoped to workspace) ----------
// v21.4: Soft-delete support.
// By default, lists exclude rows where deleted_at is non-null. Pass
// includeDeleted=true to fetch only the trashed rows (used by the Trash tab).
async function loadList(table: string, mapper: (r: DbRow) => Entry, ownerId: string = 'zeus', includeDeleted = false): Promise<Entry[]> {
  const sb = getSupabase();
  let q = sb.from(table)
    .select('*')
    .eq('owner_id', ownerId);
  q = includeDeleted ? q.not('deleted_at', 'is', null) : q.is('deleted_at', null);
  q = includeDeleted ? q.order('deleted_at', { ascending: false }) : q.order('sort_order');
  const { data, error } = await q;
  if (error) { console.error(error); return []; }
  return (data || []).map(mapper);
}
async function insertRow(table: string, row: any) {
  const sb = getSupabase();
  const { error } = await sb.from(table).insert(row);
  if (error) throw error;
}
// v21.4: Soft delete — sets deleted_at = now. The row stays in the table
// but is filtered from default loaders. Visible only via the Trash tab.
async function deleteRow(table: string, id: string) {
  const sb = getSupabase();
  const { error } = await sb.from(table).update({ deleted_at: Date.now() }).eq('id', id);
  if (error) throw error;
}
// v21.4: Hard delete — actual removal from the database. Used by the
// Trash tab's "Permanently delete" action and by auto-purge of old items.
async function hardDeleteRow(table: string, id: string) {
  const sb = getSupabase();
  const { error } = await sb.from(table).delete().eq('id', id);
  if (error) throw error;
}
// v21.4: Restore a soft-deleted row by clearing deleted_at.
async function restoreRow(table: string, id: string) {
  const sb = getSupabase();
  const { error } = await sb.from(table).update({ deleted_at: null }).eq('id', id);
  if (error) throw error;
}
async function reorderTable(table: string, ids: string[]) {
  const sb = getSupabase();
  const updates = ids.map((id, i) => sb.from(table).update({ sort_order: i }).eq('id', id));
  const results = await Promise.all(updates);
  const err = results.find(r => r.error);
  if (err?.error) throw err.error;
}
async function updateAssignees(table: string, id: string, field: 'assignees' | 'recipients', list: string[]) {
  const sb = getSupabase();
  const { error } = await sb.from(table).update({ [field]: list, updated_at: Date.now() }).eq('id', id);
  if (error) throw error;
}

// ---------------- Backend / Games (v19: workspace-scoped) ----------------
export async function loadBackend(ownerId: string = 'zeus') { return loadList('backend_entries', rowToGameEntry, ownerId); }
export async function loadGames(ownerId: string = 'zeus') { return loadList('game_entries', rowToGameEntry, ownerId); }

export async function addGameEntry(table: 'backend_entries' | 'game_entries', e: Entry) {
  await insertRow(table, {
    id: e.id, game_name: e.gameName, short_name: e.shortName,
    link: e.link, description: e.description || '',
    assignees: e.assignees || [],
    created_at: e.createdAt, sort_order: e.sortOrder,
    owner_id: e.ownerId || 'zeus',
  });
}
export async function updateGameEntry(table: 'backend_entries' | 'game_entries', id: string, patch: Partial<Entry>) {
  const sb = getSupabase();
  const updates: any = { updated_at: Date.now() };
  if (patch.gameName !== undefined) updates.game_name = patch.gameName;
  if (patch.shortName !== undefined) updates.short_name = patch.shortName;
  if (patch.link !== undefined) updates.link = patch.link;
  if (patch.description !== undefined) updates.description = patch.description;
  if (patch.assignees !== undefined) updates.assignees = patch.assignees;
  const { error } = await sb.from(table).update(updates).eq('id', id);
  if (error) throw error;
}
export async function deleteGameEntry(table: 'backend_entries' | 'game_entries', id: string) { await deleteRow(table, id); }
export async function bulkDeleteGameEntries(table: 'backend_entries' | 'game_entries', ids: string[]) {
  if (ids.length === 0) return;
  const sb = getSupabase();
  // v21.4: soft-delete (sets deleted_at) so users can restore from Trash
  const { error } = await sb.from(table).update({ deleted_at: Date.now() }).in('id', ids);
  if (error) throw error;
}
export async function reorderGames(table: 'backend_entries' | 'game_entries', ids: string[]) { await reorderTable(table, ids); }
export async function updateGameAssignees(table: 'backend_entries' | 'game_entries', id: string, assignees: string[]) {
  await updateAssignees(table, id, 'assignees', assignees);
}

// ---------- Id & Pass (v19: workspace-scoped) ----------
export async function loadIdPass(ownerId: string = 'zeus') { return loadList('idpass_entries', rowToIdPass, ownerId); }
export async function addIdPass(e: Entry) {
  await insertRow('idpass_entries', {
    id: e.id, game: e.game, short_name: e.shortName || '',
    username: e.username, password: e.password,
    description: e.description || '', assignees: e.assignees || [],
    section: e.section || 'games',
    created_at: e.createdAt, sort_order: e.sortOrder,
    owner_id: e.ownerId || 'zeus',
  });
}
export async function updateIdPass(id: string, patch: Partial<Entry>) {
  const sb = getSupabase();
  const updates: any = { updated_at: Date.now() };
  if (patch.game !== undefined) updates.game = patch.game;
  if (patch.shortName !== undefined) updates.short_name = patch.shortName;
  if (patch.username !== undefined) updates.username = patch.username;
  if (patch.password !== undefined) updates.password = patch.password;
  if (patch.description !== undefined) updates.description = patch.description;
  if (patch.assignees !== undefined) updates.assignees = patch.assignees;
  if (patch.section !== undefined) updates.section = patch.section;
  const { error } = await sb.from('idpass_entries').update(updates).eq('id', id);
  if (error) throw error;
}
export async function deleteIdPass(id: string) { await deleteRow('idpass_entries', id); }
export async function bulkDeleteIdPass(ids: string[]) {
  if (ids.length === 0) return;
  const sb = getSupabase();
  // v21.4: soft-delete
  const { error } = await sb.from('idpass_entries').update({ deleted_at: Date.now() }).in('id', ids);
  if (error) throw error;
}
export async function reorderIdPass(ids: string[]) { await reorderTable('idpass_entries', ids); }
export async function updateIdPassAssignees(id: string, assignees: string[]) {
  await updateAssignees('idpass_entries', id, 'assignees', assignees);
}

// ---------- Notices (v19: workspace-scoped) ----------
export async function loadNotices(ownerId: string = 'zeus') { return loadList('notices', rowToNotice, ownerId); }
export async function addNotice(n: Entry) {
  await insertRow('notices', {
    id: n.id, title: n.title, body: n.body, link: n.link || '',
    recipients: n.recipients || [],
    pinned: !!n.pinned,                                // v20.7
    created_at: n.createdAt, sort_order: n.sortOrder,
    owner_id: n.ownerId || 'zeus',
  });
}
export async function updateNotice(id: string, patch: Partial<Entry>) {
  const sb = getSupabase();
  const updates: any = { updated_at: Date.now() };
  if (patch.title !== undefined) updates.title = patch.title;
  if (patch.body !== undefined) updates.body = patch.body;
  if (patch.link !== undefined) updates.link = patch.link;
  if (patch.recipients !== undefined) updates.recipients = patch.recipients;
  if (patch.pinned !== undefined) updates.pinned = !!patch.pinned;  // v20.7
  const { error } = await sb.from('notices').update(updates).eq('id', id);
  if (error) throw error;
}

// v20.7: Toggle a notice's pinned state. Helper used by the pin button so we
// don't have to construct a full patch every time.
export async function toggleNoticePin(id: string, pinned: boolean) {
  const sb = getSupabase();
  const { error } = await sb.from('notices')
    .update({ pinned: !!pinned, updated_at: Date.now() })
    .eq('id', id);
  if (error) throw error;
}
export async function deleteNotice(id: string) { await deleteRow('notices', id); }
export async function bulkDeleteNotices(ids: string[]) {
  if (ids.length === 0) return;
  const sb = getSupabase();
  // v21.4: soft-delete
  const { error } = await sb.from('notices').update({ deleted_at: Date.now() }).in('id', ids);
  if (error) throw error;
}
export async function reorderNotices(ids: string[]) { await reorderTable('notices', ids); }
export async function updateNoticeRecipients(id: string, recipients: string[]) {
  await updateAssignees('notices', id, 'recipients', recipients);
}

// ---------- Paste buffer (v20: sub-admin self-share between phones) ----------
// 5-minute auto-expiring credential snippets, scoped to a single sub-admin.
// Visibility model:
//   - owner_id  → workspace, used by realtime channel + RLS
//   - user_id   → the specific sub-admin who created this; ONLY they see it,
//                 even other sub-admins in the same workspace cannot see it
//   - expires_at → server-stored timestamp; rows past this are hidden in UI
//                  and lazily deleted on app open
export const PASTE_TTL_MS = 5 * 60 * 1000;

export function rowToPaste(r: DbRow): Entry {
  return {
    id: r.id,
    game: r.game || '',
    username: r.username || '',
    password: r.password || '',
    userId: r.user_id || '',
    ownerId: r.owner_id || 'zeus',
    createdAt: Number(r.created_at),
    expiresAt: Number(r.expires_at),
  };
}

// Loads ALL non-expired paste entries for a workspace. Self-only filtering
// is applied client-side (in InfosApp) using userId. We could push the
// user_id filter to the DB, but loading workspace-scoped rows keeps the
// query pattern consistent with every other table.
export async function loadPasteBuffer(ownerId: string = 'zeus') {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('paste_buffer')
    .select('*')
    .eq('owner_id', ownerId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(rowToPaste);
}

export async function addPaste(p: Entry) {
  await insertRow('paste_buffer', {
    id: p.id,
    game: p.game,
    username: p.username,
    password: p.password,
    user_id: p.userId,
    owner_id: p.ownerId || 'zeus',
    created_at: p.createdAt,
    expires_at: p.expiresAt,
  });
}

export async function deletePaste(id: string) { await deleteRow('paste_buffer', id); }

// Lazy cleanup — deletes ALL expired rows in this workspace. Run on app open
// and whenever the Copy & Paste tab loads. Best-effort; failures are silent
// because expired rows are already invisible in the UI (filtered out client-side).
export async function purgeExpiredPaste(ownerId: string = 'zeus') {
  try {
    const sb = getSupabase();
    await sb
      .from('paste_buffer')
      .delete()
      .eq('owner_id', ownerId)
      .lt('expires_at', Date.now());
  } catch {
    // silent — UI already hides expired rows
  }
}

// ---------- Friendly error messages ----------
/** Maps Supabase errors to user-readable messages. */
export function friendlyError(err: any, fallback = 'Something went wrong. Please try again.'): string {
  if (!err) return fallback;
  const raw = (err.message || err.toString() || '').toLowerCase();
  const code = err.code || '';

  // Unique constraint violation (e.g., sub-admin username)
  if (code === '23505' || raw.includes('duplicate key') || raw.includes('unique constraint')) {
    if (raw.includes('username')) return 'That username is already taken. Try a different one.';
    return 'That entry already exists.';
  }
  // Foreign key / not null
  if (code === '23502' || raw.includes('null value')) return 'A required field is missing.';
  if (code === '23503') return 'Can\'t do that — this item is still referenced elsewhere.';
  // Network / fetch issues
  if (raw.includes('failed to fetch') || raw.includes('network') || raw.includes('networkerror')) {
    return 'Can\'t reach the server. Check your internet connection.';
  }
  // Auth / permissions
  if (raw.includes('jwt') || raw.includes('permission denied') || raw.includes('new row violates')) {
    return 'Permission denied. Your session may have expired — try refreshing.';
  }
  // Missing table (schema not set up)
  if (raw.includes('relation') && raw.includes('does not exist')) {
    return 'The database isn\'t set up properly. Run setup.sql in Supabase.';
  }
  // Rate limit
  if (raw.includes('too many') || raw.includes('rate limit')) {
    return 'Too many requests. Wait a moment and try again.';
  }
  return err.message || fallback;
}

// ---------- Sub-admin updates ----------
export async function updateSub(id: string, patch: { username?: string; password?: string; role?: 'sub' | 'co' }) {
  const sb = getSupabase();
  const updates: any = { updated_at: Date.now() };
  if (patch.username !== undefined) updates.username = patch.username;
  if (patch.password !== undefined) updates.password = patch.password;
  if (patch.role !== undefined) updates.role = patch.role;
  const { error } = await sb.from('sub_admins').update(updates).eq('id', id);
  if (error) throw error;
}

// ---------- Bulk import (used by Import feature) ----------
export async function bulkInsert(table: string, rows: any[]) {
  if (rows.length === 0) return;
  const sb = getSupabase();
  // Upsert to avoid errors on duplicate IDs
  const { error } = await sb.from(table).upsert(rows);
  if (error) throw error;
}

// ---------- Full export / import (v19: workspace-scoped) ----------
/**
 * Export all data for a given workspace.
 *   ownerId === 'zeus' → Zeus exports their own workspace. Zeus creds included.
 *   ownerId !== 'zeus' → Co-admin exports their own workspace. Zeus creds NOT included.
 */
export async function exportAll(ownerId: string = 'zeus') {
  const promises: any[] = [
    loadSubs(ownerId), loadBackend(ownerId), loadGames(ownerId),
    loadIdPass(ownerId), loadNotices(ownerId),
  ];
  if (ownerId === 'zeus') promises.push(loadZeus());
  const results = await Promise.all(promises);
  const [subs, backend, games, idpass, notices, zeus] = results;
  const out: any = {
    version: 2,                 // bumped from 1 (multi-tenant format)
    exportedAt: new Date().toISOString(),
    workspace: ownerId,
    sub_admins: subs,
    backend_entries: backend,
    game_entries: games,
    idpass_entries: idpass,
    notices,
  };
  if (zeus) out.zeus_creds = zeus;
  return out;
}

// ---------- Realtime subscriptions ----------
/**
 * Subscribe to table changes with per-table callbacks (smart reload).
 * Pass either a single callback for all tables, OR a map of table → callback.
 */
export function subscribeAll(
  tables: string[],
  onChange: ((table: string) => void) | (() => void)
) {
  const sb = getSupabase();
  const channels = tables.map(t =>
    sb.channel(`realtime:${t}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: t }, () => {
        // Forward which table changed so the app can do a targeted reload
        (onChange as (table: string) => void)(t);
      })
      .subscribe()
  );
  return () => { channels.forEach(c => sb.removeChannel(c)); };
}

// ---------- About Us content ----------
export type AboutContent = {
  developerName: string;
  companyName: string;
  version: string;
  contactEmail: string;
  donationIntro: string;
  cryptoName: string;           // e.g. "USDT"
  cryptoNetwork: string;        // e.g. "TRC20"
  walletAddress: string;
  qrImageUrl: string;           // full URL (public) or empty for default
  warningText: string;
  updatedAt?: number;
};

export const DEFAULT_ABOUT: AboutContent = {
  developerName: 'Zeus Thunder',
  companyName: 'Thunder Anuprayog',
  version: 'v21',
  contactEmail: 'zeusthunder1998@gmail.com',
  donationIntro: 'Feel free to donate 💜 Your support keeps the project going.',
  cryptoName: 'USDT',
  cryptoNetwork: 'TRC20',
  walletAddress: 'TTq5WdRssGu5Pg1MyKku9Fj8K6hBcrav5F',
  qrImageUrl: '/donate-qr.png', // fallback default bundled with app
  warningText: 'Only send Tether (USDT) on TRC20 network to this address. Other assets or networks will be lost forever.',
};

/** Load About content from DB. Returns DEFAULT_ABOUT if not yet saved. */
export async function loadAbout(): Promise<AboutContent> {
  const sb = getSupabase();
  const { data, error } = await sb.from('about_content').select('*').eq('id', 1).maybeSingle();
  if (error) throw error;
  if (!data) return { ...DEFAULT_ABOUT };
  return {
    developerName: data.developer_name ?? DEFAULT_ABOUT.developerName,
    companyName: data.company_name ?? DEFAULT_ABOUT.companyName,
    version: data.version ?? DEFAULT_ABOUT.version,
    contactEmail: data.contact_email ?? DEFAULT_ABOUT.contactEmail,
    donationIntro: data.donation_intro ?? DEFAULT_ABOUT.donationIntro,
    cryptoName: data.crypto_name ?? DEFAULT_ABOUT.cryptoName,
    cryptoNetwork: data.crypto_network ?? DEFAULT_ABOUT.cryptoNetwork,
    walletAddress: data.wallet_address ?? DEFAULT_ABOUT.walletAddress,
    qrImageUrl: data.qr_image_url ?? DEFAULT_ABOUT.qrImageUrl,
    warningText: data.warning_text ?? DEFAULT_ABOUT.warningText,
    updatedAt: data.updated_at ? Number(data.updated_at) : undefined,
  };
}

/** Save About content (upsert on id=1). Only Zeus should call this. */
export async function saveAbout(content: AboutContent): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb.from('about_content').upsert({
    id: 1,
    developer_name: content.developerName,
    company_name: content.companyName,
    version: content.version,
    contact_email: content.contactEmail,
    donation_intro: content.donationIntro,
    crypto_name: content.cryptoName,
    crypto_network: content.cryptoNetwork,
    wallet_address: content.walletAddress,
    qr_image_url: content.qrImageUrl,
    warning_text: content.warningText,
    updated_at: Date.now(),
  });
  if (error) throw error;
}

// ---------- Supabase Storage for the QR image ----------
const QR_BUCKET = 'about-assets';

/**
 * Upload a QR image File to Supabase Storage.
 * Returns the public URL. Old file (if any) is deleted.
 */
export async function uploadQrImage(file: File, previousUrl?: string): Promise<string> {
  const sb = getSupabase();
  // Generate unique filename to bypass CDN caching when QR changes
  const ext = file.name.split('.').pop()?.toLowerCase() || 'png';
  const validExts = ['png', 'jpg', 'jpeg', 'webp'];
  const safeExt = validExts.includes(ext) ? ext : 'png';
  const fileName = `qr-${Date.now()}.${safeExt}`;

  const { error: upErr } = await sb.storage.from(QR_BUCKET).upload(fileName, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: file.type || `image/${safeExt}`,
  });
  if (upErr) throw upErr;

  // Delete the previous uploaded QR if it was ours (not the default bundled one)
  if (previousUrl && previousUrl.includes(`/${QR_BUCKET}/`) && previousUrl.includes('qr-')) {
    try {
      const prevName = previousUrl.split(`/${QR_BUCKET}/`)[1]?.split('?')[0];
      if (prevName) await sb.storage.from(QR_BUCKET).remove([prevName]);
    } catch { /* non-fatal */ }
  }

  const { data } = sb.storage.from(QR_BUCKET).getPublicUrl(fileName);
  return data.publicUrl;
}

// ---------- v21.1: Workspace branding ----------
// Per-workspace customization: name, logo, accent color. Each co-admin
// (and Zeus, who owns the 'zeus' workspace) can set these. Sub-admins
// inherit their workspace's branding read-only.
export type WorkspaceBranding = {
  ownerId: string;                  // matches owner_id (workspace key)
  workspaceName: string | null;     // null/empty = use default "Infos"
  logoUrl: string | null;           // null/empty = use default /logo.png
  accentColor: string | null;       // null/empty = use default purple
  updatedAt?: number;
};

export const DEFAULT_BRANDING: Omit<WorkspaceBranding, 'ownerId'> = {
  workspaceName: null,
  logoUrl: null,
  accentColor: null,
};

/** Load branding for a workspace. Returns nulls if no row exists yet (default branding). */
export async function loadBranding(ownerId: string): Promise<WorkspaceBranding> {
  const sb = getSupabase();
  const { data, error } = await sb.from('workspace_branding')
    .select('*')
    .eq('owner_id', ownerId)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    return { ownerId, ...DEFAULT_BRANDING };
  }
  return {
    ownerId: data.owner_id,
    workspaceName: data.workspace_name ?? null,
    logoUrl: data.logo_url ?? null,
    accentColor: data.accent_color ?? null,
    updatedAt: data.updated_at ? Number(data.updated_at) : undefined,
  };
}

/** Save branding for a workspace (upsert on owner_id). Only admins should call this. */
export async function saveBranding(branding: WorkspaceBranding): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb.from('workspace_branding').upsert({
    owner_id: branding.ownerId,
    workspace_name: branding.workspaceName,
    logo_url: branding.logoUrl,
    accent_color: branding.accentColor,
    updated_at: Date.now(),
  });
  if (error) throw error;
}

// ---------- Supabase Storage for workspace logos ----------
const LOGO_BUCKET = 'workspace-logos';

/**
 * Upload a workspace logo to Supabase Storage.
 * Returns the public URL. Old logo (if any) is best-effort deleted.
 * File should be a small image (< 1 MB recommended).
 */
export async function uploadWorkspaceLogo(file: File, ownerId: string, previousUrl?: string): Promise<string> {
  const sb = getSupabase();
  const ext = file.name.split('.').pop()?.toLowerCase() || 'png';
  const validExts = ['png', 'jpg', 'jpeg', 'webp', 'svg'];
  const safeExt = validExts.includes(ext) ? ext : 'png';
  // Workspace-scoped filename so two workspaces can't collide
  const fileName = `${ownerId}/logo-${Date.now()}.${safeExt}`;

  const { error: upErr } = await sb.storage.from(LOGO_BUCKET).upload(fileName, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: file.type || `image/${safeExt}`,
  });
  if (upErr) throw upErr;

  // Delete the previous uploaded logo for this workspace
  if (previousUrl && previousUrl.includes(`/${LOGO_BUCKET}/`)) {
    try {
      const prevName = previousUrl.split(`/${LOGO_BUCKET}/`)[1]?.split('?')[0];
      if (prevName) await sb.storage.from(LOGO_BUCKET).remove([prevName]);
    } catch { /* non-fatal */ }
  }

  const { data } = sb.storage.from(LOGO_BUCKET).getPublicUrl(fileName);
  return data.publicUrl;
}

// ---------- v21.4: Trash bin (soft delete) ----------
// Loaders for the Trash tab. Each returns workspace-scoped soft-deleted rows.
export async function loadTrashedBackend(ownerId: string = 'zeus') {
  return loadList('backend_entries', rowToGameEntry, ownerId, true);
}
export async function loadTrashedGames(ownerId: string = 'zeus') {
  return loadList('game_entries', rowToGameEntry, ownerId, true);
}
export async function loadTrashedIdPass(ownerId: string = 'zeus') {
  return loadList('idpass_entries', rowToIdPass, ownerId, true);
}
export async function loadTrashedNotices(ownerId: string = 'zeus') {
  return loadList('notices', rowToNotice, ownerId, true);
}

/**
 * Restore a soft-deleted row in any of the four trashable tables.
 * Sets deleted_at = null so default loaders see it again.
 */
export async function restoreEntry(table: 'backend_entries' | 'game_entries' | 'idpass_entries' | 'notices', id: string) {
  await restoreRow(table, id);
}

/**
 * Permanently delete a single row. Cannot be undone.
 */
export async function purgeEntry(table: 'backend_entries' | 'game_entries' | 'idpass_entries' | 'notices', id: string) {
  await hardDeleteRow(table, id);
}

/**
 * Empty the trash for a workspace: hard-delete all soft-deleted rows older
 * than `olderThanMs` ago across all 4 trashable tables. If olderThanMs is 0,
 * empties everything in trash.
 *
 * Used both by the "Empty trash" button (olderThanMs=0) and by the
 * automatic 30-day cleanup pass that runs on app load (olderThanMs=2_592_000_000).
 */
export async function emptyTrash(ownerId: string, olderThanMs: number = 0): Promise<void> {
  const sb = getSupabase();
  const cutoff = olderThanMs > 0 ? (Date.now() - olderThanMs) : Date.now();
  const tables = ['backend_entries', 'game_entries', 'idpass_entries', 'notices'] as const;
  await Promise.all(tables.map(async (t) => {
    let q = sb.from(t).delete().eq('owner_id', ownerId).not('deleted_at', 'is', null);
    if (olderThanMs > 0) q = q.lt('deleted_at', cutoff);
    const { error } = await q;
    if (error) console.error(`[emptyTrash:${t}]`, error);
  }));
}

/** Auto-purge trash items older than 30 days. Best-effort, errors are logged but not thrown. */
export const TRASH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export async function purgeOldTrash(ownerId: string) {
  try { await emptyTrash(ownerId, TRASH_TTL_MS); } catch (e) { console.error('[purgeOldTrash]', e); }
}

// ---------- v22.0: Profile pictures ----------
const PROFILE_PIC_BUCKET = 'profile-pics';

/**
 * Upload a profile picture to Supabase Storage and update the user's row.
 * For Zeus: writes to zeus_creds.profile_pic_url
 * For co-admins / sub-admins: writes to sub_admins.profile_pic_url
 */
export async function uploadProfilePicture(file: File, user: { id: string; role: string }, previousUrl?: string): Promise<string> {
  const sb = getSupabase();
  const ext = file.name.split('.').pop()?.toLowerCase() || 'png';
  const validExts = ['png', 'jpg', 'jpeg', 'webp'];
  const safeExt = validExts.includes(ext) ? ext : 'png';
  // Per-user folder so users can't collide
  const fileName = `${user.id}/avatar-${Date.now()}.${safeExt}`;

  const { error: upErr } = await sb.storage.from(PROFILE_PIC_BUCKET).upload(fileName, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: file.type || `image/${safeExt}`,
  });
  if (upErr) throw upErr;

  // Delete the previous uploaded picture for this user (best-effort)
  if (previousUrl && previousUrl.includes(`/${PROFILE_PIC_BUCKET}/`)) {
    try {
      const prevName = previousUrl.split(`/${PROFILE_PIC_BUCKET}/`)[1]?.split('?')[0];
      if (prevName) await sb.storage.from(PROFILE_PIC_BUCKET).remove([prevName]);
    } catch { /* non-fatal */ }
  }

  const { data } = sb.storage.from(PROFILE_PIC_BUCKET).getPublicUrl(fileName);
  const publicUrl = data.publicUrl;

  // Save URL to the appropriate user row
  if (user.role === 'zeus') {
    // zeus_creds is a single-row table with id=1
    const { error } = await sb.from('zeus_creds').update({ profile_pic_url: publicUrl }).eq('id', 1);
    if (error) throw error;
  } else {
    const { error } = await sb.from('sub_admins').update({ profile_pic_url: publicUrl }).eq('id', user.id);
    if (error) throw error;
  }

  return publicUrl;
}

/** Clear the user's profile picture (sets DB column to null; storage object cleanup is best-effort). */
export async function clearProfilePicture(user: { id: string; role: string }, previousUrl?: string): Promise<void> {
  const sb = getSupabase();
  if (user.role === 'zeus') {
    const { error } = await sb.from('zeus_creds').update({ profile_pic_url: null }).eq('id', 1);
    if (error) throw error;
  } else {
    const { error } = await sb.from('sub_admins').update({ profile_pic_url: null }).eq('id', user.id);
    if (error) throw error;
  }
  if (previousUrl && previousUrl.includes(`/${PROFILE_PIC_BUCKET}/`)) {
    try {
      const prevName = previousUrl.split(`/${PROFILE_PIC_BUCKET}/`)[1]?.split('?')[0];
      if (prevName) await sb.storage.from(PROFILE_PIC_BUCKET).remove([prevName]);
    } catch { /* non-fatal */ }
  }
}

/** Load fresh profile pic URL for the current user (used on app load to refresh stale localStorage URLs). */
export async function loadProfilePicture(user: { id: string; role: string }): Promise<string | null> {
  const sb = getSupabase();
  if (user.role === 'zeus') {
    const { data, error } = await sb.from('zeus_creds').select('profile_pic_url').eq('id', 1).maybeSingle();
    if (error) return null;
    return data?.profile_pic_url || null;
  } else {
    const { data, error } = await sb.from('sub_admins').select('profile_pic_url').eq('id', user.id).maybeSingle();
    if (error) return null;
    return data?.profile_pic_url || null;
  }
}

// ---------- v22.2: Device session tracking ----------
// Each browser/device gets a stable random ID stored in localStorage.
// On login + every 60s heartbeat, we upsert a row in the sessions table.
// Zeus can list all sessions across users and revoke any of them.
//
// Limitations to be aware of:
// - This is "soft auth" not real auth. A clever user could clear localStorage
//   to bypass revocation; revocation only affects the next time the device
//   pings or opens the app.
// - Idle/offline devices won't show up as revoked until they reconnect.
// - Device names are user-supplied or auto-detected from User-Agent.
export type DeviceSession = {
  id: string;                  // session row id (uuid)
  deviceId: string;            // stable per-browser id from localStorage
  userId: string;              // 'zeus' or sub_admins.id
  username: string;            // for display in admin list
  role: string;                // 'zeus' | 'co' | 'sub'
  ownerId: string;             // workspace this user belongs to
  deviceLabel: string | null;  // user-supplied name
  userAgent: string | null;    // raw UA for fingerprinting
  platform: string | null;     // detected platform string
  createdAt: number;           // first seen
  lastSeenAt: number;          // most recent ping
  revokedAt: number | null;    // null = active, set = forced logout
};

function rowToSession(r: any): DeviceSession {
  return {
    id: r.id,
    deviceId: r.device_id || '',
    userId: r.user_id || '',
    username: r.username || '',
    role: r.role || 'sub',
    ownerId: r.owner_id || 'zeus',
    deviceLabel: r.device_label || null,
    userAgent: r.user_agent || null,
    platform: r.platform || null,
    createdAt: Number(r.created_at) || 0,
    lastSeenAt: Number(r.last_seen_at) || 0,
    revokedAt: r.revoked_at ? Number(r.revoked_at) : null,
  };
}

/**
 * Register or refresh a session for the current device.
 * Creates the row on first login, updates last_seen_at on subsequent pings.
 * Returns the session row id (also stored in localStorage to identify the
 * session this device "owns" for self-revocation checks).
 */
export async function upsertSession(args: {
  deviceId: string;
  userId: string;
  username: string;
  role: string;
  ownerId: string;
  deviceLabel?: string | null;
  userAgent?: string | null;
  platform?: string | null;
}): Promise<string> {
  const sb = getSupabase();
  const now = Date.now();

  // First, try to find an existing row for this (device_id, user_id) pair.
  // If found, just bump last_seen_at and clear revoked_at (if user re-signs in).
  const { data: existing } = await sb.from('sessions')
    .select('id')
    .eq('device_id', args.deviceId)
    .eq('user_id', args.userId)
    .maybeSingle();

  if (existing?.id) {
    const updatePatch: any = { last_seen_at: now };
    // On a fresh login (or unrevoke), reset revoked_at to null
    updatePatch.revoked_at = null;
    if (args.deviceLabel !== undefined) updatePatch.device_label = args.deviceLabel;
    if (args.userAgent !== undefined) updatePatch.user_agent = args.userAgent;
    if (args.platform !== undefined) updatePatch.platform = args.platform;
    const { error } = await sb.from('sessions').update(updatePatch).eq('id', existing.id);
    if (error) throw error;
    return existing.id;
  }

  // New session row
  const sessionId = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `sess-${now}-${Math.random().toString(36).slice(2)}`;
  const { error } = await sb.from('sessions').insert({
    id: sessionId,
    device_id: args.deviceId,
    user_id: args.userId,
    username: args.username,
    role: args.role,
    owner_id: args.ownerId,
    device_label: args.deviceLabel || null,
    user_agent: args.userAgent || null,
    platform: args.platform || null,
    created_at: now,
    last_seen_at: now,
    revoked_at: null,
  });
  if (error) throw error;
  return sessionId;
}

/** Update only the last_seen_at timestamp (heartbeat ping). Lightweight. */
export async function pingSession(sessionId: string): Promise<void> {
  if (!sessionId) return;
  const sb = getSupabase();
  const { error } = await sb.from('sessions')
    .update({ last_seen_at: Date.now() })
    .eq('id', sessionId);
  if (error) console.error('[pingSession]', error);
  // Do not throw — heartbeat failures should never disrupt the user.
}

/**
 * Check if THIS device's session has been revoked.
 * Returns true if revoked (caller should sign out), false otherwise.
 * Network errors return false (fail-open) to avoid kicking users on
 * connectivity blips.
 */
export async function isSessionRevoked(sessionId: string): Promise<boolean> {
  if (!sessionId) return false;
  const sb = getSupabase();
  const { data, error } = await sb.from('sessions')
    .select('revoked_at')
    .eq('id', sessionId)
    .maybeSingle();
  if (error || !data) return false;
  return !!data.revoked_at;
}

/** Update the user-facing label for a session. Anyone can rename their own session. */
export async function renameSession(sessionId: string, label: string): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb.from('sessions')
    .update({ device_label: label.trim() || null })
    .eq('id', sessionId);
  if (error) throw error;
}

/**
 * Load ALL sessions across the platform. Zeus-only — this returns sessions
 * for every user in every workspace (Zeus, co-admins, sub-admins).
 * Active sessions only by default; pass includeRevoked=true to include
 * revoked rows for audit/debugging purposes.
 */
export async function loadAllSessions(includeRevoked = false): Promise<DeviceSession[]> {
  const sb = getSupabase();
  let q = sb.from('sessions').select('*').order('last_seen_at', { ascending: false });
  if (!includeRevoked) q = q.is('revoked_at', null);
  const { data, error } = await q;
  if (error) { console.error(error); return []; }
  return (data || []).map(rowToSession);
}

/**
 * Revoke a session (force-logout). Sets revoked_at to now.
 * The target device will detect this on its next poll (~30 seconds)
 * and sign itself out.
 */
export async function revokeSession(sessionId: string): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb.from('sessions')
    .update({ revoked_at: Date.now() })
    .eq('id', sessionId);
  if (error) throw error;
}

/**
 * Hard-delete a session row. Used on explicit sign-out so we don't accumulate
 * stale rows. (Revoke = "I'm kicking you off remotely"; delete = "I'm signing
 * out cleanly".)
 */
export async function deleteSession(sessionId: string): Promise<void> {
  if (!sessionId) return;
  const sb = getSupabase();
  const { error } = await sb.from('sessions').delete().eq('id', sessionId);
  if (error) console.error('[deleteSession]', error);
}

// Auto-prune sessions that haven't been seen in 30 days. Best-effort,
// runs on app load. Prevents the table from growing unbounded.
export const SESSION_STALE_MS = 30 * 24 * 60 * 60 * 1000;
export async function pruneStaleSessions(): Promise<void> {
  const sb = getSupabase();
  try {
    const cutoff = Date.now() - SESSION_STALE_MS;
    await sb.from('sessions').delete().lt('last_seen_at', cutoff);
  } catch (e) { console.error('[pruneStaleSessions]', e); }
}


// ---------- v24.0: Web Push subscriptions ----------
// Each browser-device pair gets one subscription row when the user opts in.
// The endpoint URL is unique per browser, so we use it as the conflict target.
export type PushSubscriptionRow = {
  id: string;
  userId: string;
  username: string;
  role: string;
  ownerId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  deviceLabel: string | null;
  userAgent: string | null;
  createdAt: number;
  lastSeenAt: number;
  failedCount: number;
};

function rowToPushSub(r: any): PushSubscriptionRow {
  return {
    id: r.id,
    userId: r.user_id || '',
    username: r.username || '',
    role: r.role || 'sub',
    ownerId: r.owner_id || 'zeus',
    endpoint: r.endpoint || '',
    p256dh: r.p256dh || '',
    auth: r.auth || '',
    deviceLabel: r.device_label || null,
    userAgent: r.user_agent || null,
    createdAt: Number(r.created_at) || 0,
    lastSeenAt: Number(r.last_seen_at) || 0,
    failedCount: Number(r.failed_count) || 0,
  };
}

/**
 * Save (or refresh) a push subscription for the current user/browser.
 * Uses endpoint as the unique key — re-subscribing on the same browser
 * just updates the row instead of creating a duplicate.
 */
export async function savePushSubscription(args: {
  userId: string;
  username: string;
  role: string;
  ownerId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string | null;
}): Promise<void> {
  const sb = getSupabase();
  const now = Date.now();

  // Look up existing row by endpoint (unique)
  const { data: existing } = await sb.from('push_subscriptions')
    .select('id')
    .eq('endpoint', args.endpoint)
    .maybeSingle();

  if (existing?.id) {
    // Refresh — endpoint already known, just bump last_seen + reset failed_count
    const { error } = await sb.from('push_subscriptions').update({
      user_id: args.userId,
      username: args.username,
      role: args.role,
      owner_id: args.ownerId,
      p256dh: args.p256dh,
      auth: args.auth,
      user_agent: args.userAgent || null,
      last_seen_at: now,
      failed_count: 0,
    }).eq('id', existing.id);
    if (error) throw error;
    return;
  }

  // New subscription
  const id = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `push-${now}-${Math.random().toString(36).slice(2)}`;
  const { error } = await sb.from('push_subscriptions').insert({
    id,
    user_id: args.userId,
    username: args.username,
    role: args.role,
    owner_id: args.ownerId,
    endpoint: args.endpoint,
    p256dh: args.p256dh,
    auth: args.auth,
    user_agent: args.userAgent || null,
    created_at: now,
    last_seen_at: now,
    failed_count: 0,
  });
  if (error) throw error;
}

/** Delete a subscription (user opted out, or browser unsubscribed). */
export async function deletePushSubscription(endpoint: string): Promise<void> {
  if (!endpoint) return;
  const sb = getSupabase();
  const { error } = await sb.from('push_subscriptions').delete().eq('endpoint', endpoint);
  if (error) console.error('[deletePushSubscription]', error);
}

/** Check if THIS browser has an active subscription. Used on app load to confirm state. */
export async function hasPushSubscription(endpoint: string): Promise<boolean> {
  if (!endpoint) return false;
  const sb = getSupabase();
  const { data, error } = await sb.from('push_subscriptions')
    .select('id')
    .eq('endpoint', endpoint)
    .maybeSingle();
  if (error) return false;
  return !!data?.id;
}
