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
    sortOrder: r.sort_order ?? 0,
  };
}
function rowToIdPass(r: DbRow): Entry {
  return {
    id: r.id, game: r.game || '', shortName: r.short_name || '',
    username: r.username || '', password: r.password || '', description: r.description || '',
    assignees: r.assignees || [],
    createdAt: Number(r.created_at),
    updatedAt: r.updated_at ? Number(r.updated_at) : null,
    sortOrder: r.sort_order ?? 0,
  };
}
function rowToNotice(r: DbRow): Entry {
  return {
    id: r.id, title: r.title || '', body: r.body || '', link: r.link || '',
    recipients: r.recipients || [],
    createdAt: Number(r.created_at),
    updatedAt: r.updated_at ? Number(r.updated_at) : null,
    sortOrder: r.sort_order ?? 0,
  };
}
function rowToSub(r: DbRow): Entry {
  return {
    id: r.id, username: r.username || '', password: r.password || '',
    role: r.role || 'sub',  // 'sub' or 'co'
    createdAt: Number(r.created_at),
    updatedAt: r.updated_at ? Number(r.updated_at) : null,
    sortOrder: r.sort_order ?? 0,
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
export async function addSub(sub: { id: string; username: string; password: string; role: 'sub' | 'co'; createdAt: number; sortOrder: number }) {
  const sb = getSupabase();
  const { error } = await sb.from('sub_admins').insert({
    id: sub.id, username: sub.username, password: sub.password, role: sub.role,
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

// ---------------- Backend / Games ----------------
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
  const { error } = await sb.from(table).delete().in('id', ids);
  if (error) throw error;
}
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
export async function updateIdPass(id: string, patch: Partial<Entry>) {
  const sb = getSupabase();
  const updates: any = { updated_at: Date.now() };
  if (patch.game !== undefined) updates.game = patch.game;
  if (patch.shortName !== undefined) updates.short_name = patch.shortName;
  if (patch.username !== undefined) updates.username = patch.username;
  if (patch.password !== undefined) updates.password = patch.password;
  if (patch.description !== undefined) updates.description = patch.description;
  if (patch.assignees !== undefined) updates.assignees = patch.assignees;
  const { error } = await sb.from('idpass_entries').update(updates).eq('id', id);
  if (error) throw error;
}
export async function deleteIdPass(id: string) { await deleteRow('idpass_entries', id); }
export async function bulkDeleteIdPass(ids: string[]) {
  if (ids.length === 0) return;
  const sb = getSupabase();
  const { error } = await sb.from('idpass_entries').delete().in('id', ids);
  if (error) throw error;
}
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
export async function updateNotice(id: string, patch: Partial<Entry>) {
  const sb = getSupabase();
  const updates: any = { updated_at: Date.now() };
  if (patch.title !== undefined) updates.title = patch.title;
  if (patch.body !== undefined) updates.body = patch.body;
  if (patch.link !== undefined) updates.link = patch.link;
  if (patch.recipients !== undefined) updates.recipients = patch.recipients;
  const { error } = await sb.from('notices').update(updates).eq('id', id);
  if (error) throw error;
}
export async function deleteNotice(id: string) { await deleteRow('notices', id); }
export async function bulkDeleteNotices(ids: string[]) {
  if (ids.length === 0) return;
  const sb = getSupabase();
  const { error } = await sb.from('notices').delete().in('id', ids);
  if (error) throw error;
}
export async function reorderNotices(ids: string[]) { await reorderTable('notices', ids); }
export async function updateNoticeRecipients(id: string, recipients: string[]) {
  await updateAssignees('notices', id, 'recipients', recipients);
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
  version: 'v18.1',
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
