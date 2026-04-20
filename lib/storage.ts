// LocalStorage-backed persistence. Server-safe (returns null / no-ops on server).

export const K = {
  ZEUS: 'infos:zeus_creds',
  SUBS: 'infos:sub_admins',
  BACKEND: 'infos:backend_entries',
  GAMES: 'infos:game_entries',
  IDPASS: 'infos:idpass_entries',
  NOTES: 'infos:private_notes',
  ANNOUNCE: 'infos:announcements',
  ACCOUNTS: 'infos:accounts',
  ACTIVE: 'infos:active_account',
};

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

export function loadKey<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const v = window.localStorage.getItem(key);
    if (v === null) return fallback;
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
}

export function saveKey(key: string, value: any): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.error('saveKey failed', err);
  }
}
