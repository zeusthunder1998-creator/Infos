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
    try { return JSON.parse(v) as T; } catch { return v as unknown as T; }
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
    id: r.id, gameName: r.game_name, shortName: r.short_name,
    link: r.link, description: r.description, assignees: r.assignees || [],
    createdAt: Number(r.created_at),
    updatedAt: r.updated_at ? Number(r.updated_at) : null,
    sortOrder: r.sort_order,
  };
}
function rowToIdPass(r: DbRow): Entry {
  return {
    id: r.id, game: r.game, shortName: r.short_name,
    username: r.username, password: r.password, description: r.description,
    assignees: r.assignees || [],
    createdAt: Number(r.created_at),
    updatedAt: r.updated_at ? Number(r.updated_at) : null,
    sortOrder: r.sort_order,
  };
}
function rowToNotice(r: DbRow): Entry {
  return {
    id: r.id, title: r.title, body: r.body, link: r.link,
    recipients: r.recipients || [],
    createdAt: Number(r.created_at),
    updatedAt: r.updated_at ? Number(r.updated_at) : null,
    sortOrder: r.sort_order,
  };
}
function rowToSub(r: DbRow): Entry {
  return {
    id: r.id, username: r.username, password: r.password,
    createdAt: Number(r.created_at),
    updatedAt: r.updated_at ? Number(r.updated_at) : null,
    sortOrder: r.sort_order,
  };
}

// ---------- Zeus creds ----------
export async function loadZeus(): Promise<{ username: string; password: string }> {
  const sb = getSupabase();
  const { data, error } = await sb.from('zeus_creds').select('username, password').eq('id', 1).single();
  if (error || !data) return DEFAULT_ZEUS;
  return { username: data.username, password: data.password };
}
export async function saveZeus(creds: { username: string; password: string }) {
  const sb = getSupabase();
  const { error } = await sb.from('zeus_creds').update({ username: creds.username, password: creds.password }).eq('id', 1);
  if (error) throw error;
}

// ---------- Sub-admins ----------
export async function loadSubs(): Promise<any[]> {
  const sb = getSupabase();
  const { data, error } = await sb.from('sub_admins').select('*').order('sort_order');
  if (error) { console.error(error); return []; }
  return (data || []).map(rowToSub);
}
export async function addSub(sub: { id: string; username: string; password: string; createdAt: number; sortOrder: number }) {
  const sb = getSupabase();
  const { error } = await sb.from('sub_admins').insert({
    id: sub.id, username: sub.username, password: sub.password,
    created_at: sub.createdAt, sort_order: sub.sortOrder,
  });
  if (error) throw error;
}
export async function deleteSub(id: string) {
  const sb = getSupabase();
  const { error } = await sb.from('sub_admins').delete().eq('id', id);
  if (error) throw error;
}

// ---------- Generic helpers ----------
async function loadList(table: string, mapper: (r: DbRow) => Entry): Promise<Entry[]> {
  const sb = getSupabase();
  const { data, error } = await sb.from(table).select('*').order('sort_order');
  if (error) { console.error(error); return []; }
  return (data || []).map(mapper);
}
async function insertRow(table: string, row: any) {
  const sb = getSupabase();
  const { error } = await sb.from(table).insert(row);
  if (error) throw error;
}
async function deleteRow(table: string, id: string) {
  const sb = getSupabase();
  const { error } = await sb.from(table).delete().eq('id', id);
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

// ---------- Backend / Games ----------
export async function loadBackend() { return loadList('backend_entries', rowToGameEntry); }
export async function loadGames() { return loadList('game_entries', rowToGameEntry); }

export async function addGameEntry(table: 'backend_entries' | 'game_entries', e: Entry) {
  await insertRow(table, {
    id: e.id, game_name: e.gameName, short_name: e.shortName,
    link: e.link, description: e.description || '',
    assignees: e.assignees || [],
    created_at: e.createdAt, sort_order: e.sortOrder,
  });
}
export async function deleteGameEntry(table: 'backend_entries' | 'game_entries', id: string) { await deleteRow(table, id); }
export async function reorderGames(table: 'backend_entries' | 'game_entries', ids: string[]) { await reorderTable(table, ids); }
export async function updateGameAssignees(table: 'backend_entries' | 'game_entries', id: string, assignees: string[]) {
  await updateAssignees(table, id, 'assignees', assignees);
}

// ---------- Id & Pass ----------
export async function loadIdPass() { return loadList('idpass_entries', rowToIdPass); }
export async function addIdPass(e: Entry) {
  await insertRow('idpass_entries', {
    id: e.id, game: e.game, short_name: e.shortName || '',
    username: e.username, password: e.password,
    description: e.description || '', assignees: e.assignees || [],
    created_at: e.createdAt, sort_order: e.sortOrder,
  });
}
export async function deleteIdPass(id: string) { await deleteRow('idpass_entries', id); }
export async function reorderIdPass(ids: string[]) { await reorderTable('idpass_entries', ids); }
export async function updateIdPassAssignees(id: string, assignees: string[]) {
  await updateAssignees('idpass_entries', id, 'assignees', assignees);
}

// ---------- Notices ----------
export async function loadNotices() { return loadList('notices', rowToNotice); }
export async function addNotice(n: Entry) {
  await insertRow('notices', {
    id: n.id, title: n.title, body: n.body, link: n.link || '',
    recipients: n.recipients || [], created_at: n.createdAt, sort_order: n.sortOrder,
  });
}
export async function deleteNotice(id: string) { await deleteRow('notices', id); }
export async function reorderNotices(ids: string[]) { await reorderTable('notices', ids); }
export async function updateNoticeRecipients(id: string, recipients: string[]) {
  await updateAssignees('notices', id, 'recipients', recipients);
}

// ---------- Bulk import (used by Import feature) ----------
export async function bulkInsert(table: string, rows: any[]) {
  if (rows.length === 0) return;
  const sb = getSupabase();
  // Upsert to avoid errors on duplicate IDs
  const { error } = await sb.from(table).upsert(rows);
  if (error) throw error;
}

// ---------- Full export / import ----------
export async function exportAll() {
  const [subs, backend, games, idpass, notices, zeus] = await Promise.all([
    loadSubs(), loadBackend(), loadGames(), loadIdPass(), loadNotices(), loadZeus(),
  ]);
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    zeus_creds: zeus,
    sub_admins: subs,
    backend_entries: backend,
    game_entries: games,
    idpass_entries: idpass,
    notices,
  };
}

// ---------- Realtime subscriptions ----------
export function subscribeAll(tables: string[], onChange: () => void) {
  const sb = getSupabase();
  const channels = tables.map(t =>
    sb.channel(`realtime:${t}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: t }, () => onChange())
      .subscribe()
  );
  return () => { channels.forEach(c => sb.removeChannel(c)); };
}
