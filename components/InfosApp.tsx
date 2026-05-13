'use client';

import { useEffect, useMemo, useRef, useState, useCallback, memo } from 'react';
import Image from 'next/image';
import {
  DEFAULT_ZEUS, ALL_SENTINEL, uid, accKey,
  isVisibleToSub, isAssignedAll, friendlyError,
  loadSession, saveSession,
  loadZeus, saveZeus,
  loadSubs, loadSubById, findSubByCredentials, addSub, deleteSub, updateSub,
  deleteCoAdminWorkspace, countWorkspaceContents, workspaceIdForUser,
  loadBackend, loadGames, addGameEntry, updateGameEntry, deleteGameEntry, bulkDeleteGameEntries, reorderGames, updateGameAssignees,
  loadIdPass, addIdPass, updateIdPass, deleteIdPass, bulkDeleteIdPass, reorderIdPass, updateIdPassAssignees,
  loadNotices, addNotice, updateNotice, deleteNotice, bulkDeleteNotices, reorderNotices, updateNoticeRecipients,
  toggleNoticePin,
  loadPasteBuffer, addPaste, deletePaste, purgeExpiredPaste, PASTE_TTL_MS,
  subscribeAll, exportAll, bulkInsert,
  loadAbout, DEFAULT_ABOUT, AboutContent,
  upsertSession, pingSession, isSessionRevoked, deleteSession,
  loadAllSessions, revokeSession, renameSession, pruneStaleSessions,
  DeviceSession,
  savePushSubscription, deletePushSubscription,
  loadTrashedBackend, loadTrashedGames, loadTrashedIdPass, loadTrashedNotices,
  restoreEntry, purgeEntry, emptyTrash, purgeOldTrash, TRASH_TTL_MS,
} from '@/lib/storage';
import { C, S, tabStyle } from './styles';
import { Timestamp, useConfirm, useTheme, SearchBar, Theme, timeAgo, fullDateTime, useToast, Skeleton, EmptyState } from './ui';
import { BulkAssignModal, BulkEntry } from './BulkAssign';
import { EditGameModal, EditIdPassModal, EditNoticeModal, EditSubAdminModal } from './EditModals';
import { AboutModal } from './AboutModal';

// v22.2: Device fingerprint helpers.
// Each browser gets a stable random ID stored in localStorage. This is NOT
// a cryptographic identity — it's a "this browser" tag that persists across
// app loads. Cleared if the user wipes localStorage / private browsing.
function getDeviceId(): string {
  if (typeof window === 'undefined') return 'ssr';
  const KEY = 'infos:device_id';
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : `dev-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return `dev-fallback-${Date.now()}`;
  }
}

// Best-effort detection of the browser/OS combo. Used as a fallback label
// when the user hasn't named their device. Output examples:
//   "Chrome on Windows", "Safari on iPhone", "Firefox on Android".
function detectPlatform(): string {
  if (typeof navigator === 'undefined') return 'Unknown';
  const ua = navigator.userAgent || '';
  let browser = 'Browser';
  if (/Edg\//.test(ua)) browser = 'Edge';
  else if (/OPR\//.test(ua) || /Opera/.test(ua)) browser = 'Opera';
  else if (/Chrome\//.test(ua) && !/Edg\//.test(ua)) browser = 'Chrome';
  else if (/Firefox\//.test(ua)) browser = 'Firefox';
  else if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) browser = 'Safari';
  let os = 'Device';
  if (/Windows/.test(ua)) os = 'Windows';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/iPhone|iPad|iPod/.test(ua)) os = /iPad/.test(ua) ? 'iPad' : 'iPhone';
  else if (/Mac OS X|Macintosh/.test(ua)) os = 'Mac';
  else if (/Linux/.test(ua)) os = 'Linux';
  return `${browser} on ${os}`;
}

// v24.3: Phone-style chime synth. Plays a 2-note descending chime using
// Web Audio API — no audio file download needed. Honors user's prefs and
// silently no-ops if the page is muted, browser doesn't support, or the
// user hasn't interacted with the page yet (browsers block audio until then).
//
// Implementation details:
//   - Two short sine-wave notes (E5 → C5) with envelope decay
//   - Total duration ~600ms
//   - Volume capped at 0.15 so it's not jarring
//   - AudioContext is created lazily on first call
let _audioCtx: AudioContext | null = null;
function playChime() {
  if (typeof window === 'undefined') return;
  try {
    if (!_audioCtx) {
      const Ctor = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!Ctor) return;
      _audioCtx = new Ctor();
    }
    const ctx = _audioCtx!;
    // Some browsers suspend the context until a user gesture happens
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    const now = ctx.currentTime;
    // Two notes — phone-style descending chime
    const notes = [
      { freq: 659.25, start: 0,    dur: 0.32 },  // E5
      { freq: 523.25, start: 0.18, dur: 0.45 },  // C5
    ];
    notes.forEach((n) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = n.freq;
      // Envelope: fast attack, slower decay
      gain.gain.setValueAtTime(0, now + n.start);
      gain.gain.linearRampToValueAtTime(0.15, now + n.start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + n.start + n.dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + n.start);
      osc.stop(now + n.start + n.dur + 0.05);
    });
  } catch {
    // Audio failures are non-critical
  }
}

// v24.3: Show a browser notification (works while app is open / minimized in
// another tab). Returns true if the notification was shown, false if blocked
// or permission denied. Caller should check permission first via
// requestNotificationPermission below.
function showBrowserNotification(title: string, body: string, tag?: string) {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') return false;
  if (Notification.permission !== 'granted') return false;
  try {
    const n = new Notification(title, {
      body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: tag || 'infos-' + Date.now(),
      // Browsers vary in support for these but they don't error if unknown
      silent: false,
      requireInteraction: false,
    } as any);
    // Auto-dismiss after 5s (some browsers ignore but it's a nice default)
    setTimeout(() => { try { n.close(); } catch {} }, 5000);
    // Focus the tab when user clicks
    n.onclick = () => {
      try { window.focus(); n.close(); } catch {}
    };
    return true;
  } catch {
    return false;
  }
}

// v24.3: Ask the user for browser notification permission. Returns the
// resulting permission state ('granted', 'denied', or 'default').
// Should only be called from a user gesture (click) — browsers block silent
// permission requests.
async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') return 'denied';
  if (Notification.permission === 'granted' || Notification.permission === 'denied') {
    return Notification.permission;
  }
  try {
    return await Notification.requestPermission();
  } catch {
    return 'denied';
  }
}

// Role helpers
const isAdminRole = (role: string) => role === 'zeus' || role === 'co';
const isZeus = (role: string) => role === 'zeus';

// v21.3: Friendly notify helper — replaces alert() throughout the app.
// Uses the toast system if mounted (Portal level), falls back to native alert
// during early init / login screen / error in toast mount itself.
function notify(message: string, type: 'success' | 'error' | 'info' = 'error') {
  if (typeof window !== 'undefined') {
    const t = (window as any).__infosToast;
    if (typeof t === 'function') {
      try { t({ message, type }); return; } catch {}
    }
  }
  // Fallback for environments where toast isn't ready
  if (typeof window !== 'undefined') alert(message);
}

// v21.1: Convert a hex color (#rgb or #rrggbb) to an rgba() string with the
// given alpha. Used for deriving the accent-soft variable from a custom
// accent color. Returns the original hex string on parse failure (fail-safe).
function hexToRgba(hex: string, alpha: number): string {
  if (!hex || hex[0] !== '#') return hex;
  let h = hex.slice(1);
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  if (h.length !== 6) return hex;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return hex;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ---------------- Splash (tap anywhere to skip for instant feel) ----------------
function Splash({ ms, onDone, subtitle, small }: any) {
  // Use a ref to guarantee onDone fires EXACTLY once, even if click + timer race.
  const firedRef = useRef(false);
  const fire = useCallback(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    onDone();
  }, [onDone]);
  useEffect(() => {
    const t = setTimeout(fire, ms);
    return () => clearTimeout(t);
  }, [ms, fire]);
  const size = small ? 110 : 140;
  return (
    <div onClick={fire} style={{ minHeight: small ? '360px' : '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2rem 1rem', animation: 'infosFadeIn 0.4s ease-out', cursor: 'pointer', userSelect: 'none' }}>
      <div style={{ width: size, height: size, position: 'relative', animation: 'infosPulse 2s ease-in-out infinite' }}>
        <Image src="/logo.png" alt="Infos" fill style={{ objectFit: 'contain' }} priority />
      </div>
      <div style={{ marginTop: '1.25rem', fontSize: small ? '22px' : '28px', fontWeight: 700, letterSpacing: '-0.03em' }}>Infos</div>
      {subtitle && <div style={{ marginTop: '6px', fontSize: '13.5px', color: C.textSecondary, fontWeight: 500 }}>{subtitle}</div>}
      <div style={{ marginTop: '1.5rem', display: 'flex', gap: '7px' }}>
        <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: C.accent, animation: 'infosDot 1.2s ease-in-out infinite' }} />
        <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: C.accent, animation: 'infosDot 1.2s ease-in-out infinite 0.15s' }} />
        <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: C.accent, animation: 'infosDot 1.2s ease-in-out infinite 0.3s' }} />
      </div>
      <div style={{ marginTop: '1rem', fontSize: '10.5px', color: C.textTertiary, fontWeight: 500, letterSpacing: '0.05em' }}>Tap to continue</div>
    </div>
  );
}

function TextInput(props: any) { return <input {...props} className={'infos-input ' + (props.className || '')} style={{ ...S.input, ...(props.style || {}) }} />; }
function TextArea(props: any) { return <textarea {...props} className={'infos-input ' + (props.className || '')} style={{ ...S.textarea, ...(props.style || {}) }} />; }
function Btn(props: any) {
  const { primary, danger, ...rest } = props;
  const base = primary ? S.btnPrimary : danger ? S.btnDanger : S.btn;
  const cls = primary ? 'infos-btn-primary' : 'infos-btn';
  return <button {...rest} className={cls + ' ' + (props.className || '')} style={{ ...base, ...(props.style || {}) }} />;
}

function CopyButton({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(value);
      else {
        const ta = document.createElement('textarea');
        ta.value = value; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
      }
      setCopied(true); setTimeout(() => setCopied(false), 1500);
    } catch { setCopied(false); }
  };
  return (
    <button onClick={copy} type="button"
      style={{ padding: '3px 10px', fontSize: '11.5px', border: `1px solid ${copied ? C.accent : C.borderStrong}`, background: copied ? C.accentSoft : C.cardBg, borderRadius: '5px', cursor: 'pointer', color: copied ? C.accentText : C.textSecondary, fontWeight: 500, transition: 'all 0.15s', whiteSpace: 'nowrap' }}
      title={label ? `Copy ${label}` : 'Copy'}>
      {copied ? '✓ Copied' : `Copy${label ? ' ' + label : ''}`}
    </button>
  );
}

function ReorderList({ items, canReorder, canSelect, selectedIds, onToggleSelect, onReorder, renderItem, keyFn }: any) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const start = (e: any, id: string) => { setDragId(id); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', id); } catch {} };
  const over = (e: any, id: string) => { e.preventDefault(); if (id !== overId) setOverId(id); };
  const drop = (e: any, id: string) => {
    e.preventDefault();
    if (dragId && dragId !== id) {
      const f = items.findIndex((x: any) => keyFn(x) === dragId);
      const t = items.findIndex((x: any) => keyFn(x) === id);
      if (f >= 0 && t >= 0) { const next = [...items]; const [m] = next.splice(f, 1); next.splice(t, 0, m); onReorder(next); }
    }
    setDragId(null); setOverId(null);
  };
  const move = (i: number, dir: -1 | 1) => {
    const newIdx = i + dir;
    if (newIdx < 0 || newIdx >= items.length) return;
    const next = [...items]; const [m] = next.splice(i, 1); next.splice(newIdx, 0, m);
    onReorder(next);
  };

  return (
    <div>
      {items.map((item: any, idx: number) => {
        const id = keyFn(item);
        const isSelected = canSelect && selectedIds?.includes(id);
        const isDraggingOver = overId === id && dragId && dragId !== id;
        const style = {
          ...S.item,
          ...(dragId === id ? { opacity: 0.4 } : {}),
          ...(isDraggingOver ? { borderColor: C.accent, boxShadow: `0 0 0 2px ${C.accentSoft}` } : {}),
          ...(isSelected ? { borderColor: C.accent, background: C.accentSoft } : {}),
        };
        return (
          <div key={id} className="infos-item infos-item-enter" style={style}
            onDragOver={canReorder ? (e) => over(e, id) : undefined}
            onDrop={canReorder ? (e) => drop(e, id) : undefined}
            onDragEnd={() => { setDragId(null); setOverId(null); }}>
            {canSelect && (
              <div style={{ flexShrink: 0, width: '28px', display: 'flex', alignItems: 'flex-start', paddingTop: '2px' }}>
                <input type="checkbox" checked={!!isSelected} onChange={() => onToggleSelect(id)}
                  style={{ width: '18px', height: '18px', cursor: 'pointer', accentColor: C.accent }} />
              </div>
            )}
            {canReorder && (
              <div style={{ flexShrink: 0, width: '32px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', paddingTop: '2px' }}>
                <button onClick={(e) => { e.stopPropagation(); move(idx, -1); }} disabled={idx === 0} className="infos-arrow-btn" title="Move up" type="button">▲</button>
                <div draggable onDragStart={(e) => start(e, id)} style={{ ...S.dragHandle, width: 'auto', padding: '2px 0' }} title="Drag to reorder">⋮⋮</div>
                <button onClick={(e) => { e.stopPropagation(); move(idx, 1); }} disabled={idx === items.length - 1} className="infos-arrow-btn" title="Move down" type="button">▼</button>
              </div>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>{renderItem(item, idx)}</div>
          </div>
        );
      })}
    </div>
  );
}

function LoginForm({ onLogin, onCancel, cancelLabel, subtitle }: any) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loggingIn, setLoggingIn] = useState<any>(null);
  // v25.3: Show password toggle + forgot password modal
  const [showPassword, setShowPassword] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);

  const handle = async () => {
    setError(''); setBusy(true);
    try {
      if (!username.trim() || !password) return setError('Enter username and password');
      const zeus = await loadZeus();
      let matched: any = null;
      if (username.trim() === zeus.username && password === zeus.password) {
        // Zeus's workspace is always 'zeus'
        matched = { role: 'zeus', username: zeus.username, ownerId: 'zeus', profilePicUrl: zeus.profilePicUrl || null };
      } else {
        // Search ALL workspaces for a matching sub_admin (single global lookup)
        const f = await findSubByCredentials(username.trim(), password);
        if (f) {
          // Co-admin: their workspace IS their own user id (they own a workspace)
          // Sub-admin: their workspace is whichever admin created them (f.ownerId)
          const role = f.role === 'co' ? 'co' : 'sub';
          const userWorkspace = role === 'co' ? f.id : f.ownerId;
          matched = { role, username: f.username, id: f.id, ownerId: userWorkspace, profilePicUrl: f.profilePicUrl || null };
        }
      }
      if (!matched) return setError('Invalid username or password');
      // v22.2: Register session so admin can see this device + revoke it later.
      // Best-effort — failure to register doesn't block login.
      try {
        const deviceId = getDeviceId();
        const userIdForSession = matched.role === 'zeus' ? 'zeus' : matched.id;
        const ownerForSession = matched.ownerId || 'zeus';
        const sessId = await upsertSession({
          deviceId,
          userId: userIdForSession,
          username: matched.username,
          role: matched.role,
          ownerId: ownerForSession,
          deviceLabel: null,
          userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
          platform: detectPlatform(),
        });
        matched.sessionId = sessId;
      } catch (err) {
        console.error('[session register]', err);
        // Allow login anyway — session tracking is non-critical.
      }
      setLoggingIn(matched);
    } catch (err: any) {
      setError(friendlyError(err, 'Could not reach server. Check your connection.'));
    } finally { setBusy(false); }
  };

  if (loggingIn) {
    return <Splash ms={900} subtitle={`Welcome, ${loggingIn.username}`} small
      onDone={() => {
        const ok = onLogin(loggingIn);
        if (ok === false) { setLoggingIn(null); setError('This account is already signed in'); }
      }} />;
  }

  return (
    <div style={S.shell}>
      <div style={S.card}>
        <div style={{ textAlign: 'center', marginBottom: '1.75rem' }}>
          <Image src="/logo.png" alt="" width={72} height={72} priority />
          <div style={{ fontSize: '28px', fontWeight: 700, letterSpacing: '-0.03em', marginTop: '14px' }}>Infos</div>
          <div style={{ fontSize: '14px', color: C.textSecondary, marginTop: '4px', fontWeight: 500 }}>{subtitle || 'Sign in to your account'}</div>
        </div>
        <div style={{ marginBottom: '14px' }}>
          <label style={S.label}>Username</label>
          <TextInput value={username} onChange={(e: any) => setUsername(e.target.value)} placeholder="Enter username" autoFocus onKeyDown={(e: any) => e.key === 'Enter' && handle()} />
        </div>
        <div style={{ marginBottom: '6px' }}>
          <label style={S.label}>Password</label>
          {/* v25.3: Show/hide password toggle. The eye icon is positioned
              absolutely inside a relative wrapper, with right-padding on the
              input so the typed password doesn't sit underneath the icon. */}
          <div style={{ position: 'relative' }}>
            <TextInput
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e: any) => setPassword(e.target.value)}
              placeholder="Enter password"
              onKeyDown={(e: any) => e.key === 'Enter' && handle()}
              style={{ paddingRight: '44px' }}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              title={showPassword ? 'Hide password' : 'Show password'}
              style={{
                position: 'absolute',
                right: '4px',
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                padding: '6px 10px',
                fontSize: '17px',
                color: C.textSecondary,
                lineHeight: 1,
              }}
            >
              {showPassword ? '🙈' : '👁'}
            </button>
          </div>
        </div>
        {/* v25.3: Forgot password link — opens an info modal explaining the
            current contact-Zeus flow. Real reset request flow is planned but
            requires hashed-password migration first. */}
        <div style={{ textAlign: 'right', marginBottom: '14px' }}>
          <button
            type="button"
            onClick={() => setForgotOpen(true)}
            style={{
              background: 'transparent',
              border: 'none',
              color: C.accent,
              fontSize: '12.5px',
              cursor: 'pointer',
              padding: '4px 0',
              fontWeight: 500,
              textDecoration: 'underline',
              fontFamily: 'inherit',
            }}
          >
            Forgot password?
          </button>
        </div>
        {error && <div style={{ fontSize: '13px', color: C.danger, marginBottom: '12px', padding: '8px 12px', background: C.dangerSoft, borderRadius: '6px', fontWeight: 500 }}>{error}</div>}
        <div style={{ display: 'flex', gap: '10px', marginTop: '4px' }}>
          {onCancel && <Btn onClick={onCancel} style={{ flex: 1 }}>{cancelLabel || 'Cancel'}</Btn>}
          <Btn primary onClick={handle} disabled={busy} style={{ flex: onCancel ? 1 : undefined, width: onCancel ? undefined : '100%', opacity: busy ? 0.7 : 1 }}>{busy ? 'Signing in…' : 'Sign in'}</Btn>
        </div>
      </div>

      {/* v25.3: Forgot password info modal. Shown when user clicks the link.
          For now this is informational only — explains how to recover access.
          Future: when password hashing is added, this becomes a request form
          that creates a row in password_reset_requests for Zeus to approve. */}
      {forgotOpen && (
        <div onClick={() => setForgotOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'var(--modal-backdrop)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ background: C.cardBg, border: `1px solid ${C.borderStrong}`, borderRadius: '14px', maxWidth: '440px', width: '100%', boxShadow: 'var(--shadow-pop)', padding: '20px 22px' }}>
            <div style={{ fontSize: '17px', fontWeight: 700, marginBottom: '10px', letterSpacing: '-0.01em' }}>
              🔑 Forgot your password?
            </div>
            <div style={{ fontSize: '13.5px', color: C.textSecondary, lineHeight: 1.6, marginBottom: '16px' }}>
              <p style={{ margin: '0 0 10px' }}>
                Password recovery is handled by your workspace admin. Contact <strong>Zeus</strong> (the main admin) and ask them to reset your password.
              </p>
              <p style={{ margin: '0 0 10px' }}>
                <strong>If you are a co-admin:</strong> only Zeus can reset co-admin passwords. Send Zeus a message with your username, and they&apos;ll set a new password for you.
              </p>
              <p style={{ margin: 0 }}>
                <strong>If you are a sub-admin:</strong> contact your workspace co-admin or Zeus to reset it.
              </p>
            </div>
            <div style={{ textAlign: 'right' }}>
              <Btn primary onClick={() => setForgotOpen(false)} style={{ fontSize: '13px' }}>Got it</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------- User Guide modal (v21.0) ----------------
// In-app documentation. Sections written in plain language so even non-technical
// testers/sub-admins can understand. Visible to everyone via the user menu.
function UserGuideModal({ open, onClose, user }: any) {
  const isZeusUser = user?.role === 'zeus';
  const isCoAdmin = user?.role === 'co';
  const isSub = user?.role === 'sub';
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);
  if (!open) return null;

  // Style helpers — keep visual consistency with rest of the app.
  const sectionTitle = { fontSize: '15px', fontWeight: 600, marginTop: '20px', marginBottom: '8px', letterSpacing: '-0.01em', color: C.textPrimary } as const;
  const para = { fontSize: '13.5px', lineHeight: 1.6, color: C.textSecondary, marginBottom: '8px' } as const;
  const list = { fontSize: '13.5px', lineHeight: 1.7, color: C.textSecondary, marginLeft: '1.25rem', marginBottom: '8px', paddingLeft: 0 } as const;
  const tip = { fontSize: '12.5px', padding: '10px 12px', background: C.accentSoft, color: C.accentText, borderRadius: '8px', border: `1px solid ${C.accent}`, marginBottom: '12px', lineHeight: 1.5 } as const;

  // v22.0: Three completely separate role-specific guides.
  // Each role sees ONLY their relevant content, no toggling between roles.

  const ZeusGuide = () => (
    <>
      <div style={para}>Welcome, main admin. You oversee the entire Infos platform — managing your own workspace and creating co-admins who run their own isolated workspaces.</div>

      <div style={sectionTitle}>🌐 Your platform-level powers</div>
      <ul style={list}>
        <li>You manage your own workspace just like a co-admin (create entries, assign to sub-admins, etc.).</li>
        <li>You create <strong>co-admins</strong> who run their own isolated workspaces. You cannot see inside their workspaces.</li>
        <li>You edit the shared <strong>About Us</strong> content (visible to everyone on the platform).</li>
        <li>You can delete co-admin workspaces, which cascade-deletes all their content.</li>
      </ul>

      <div style={sectionTitle}>📢 Notice tab</div>
      <div style={para}>Post announcements for your sub-admins. Assign to specific sub-admins or broadcast to all.</div>
      <div style={tip}>💡 <strong>Pin important notices</strong> using the 📌 button. Pinned notices stay at the top regardless of date.</div>

      <div style={sectionTitle}>⚙️ System &amp; 🎮 Games tabs</div>
      <div style={para}>Manage links and resources for your sub-admins.</div>
      <ul style={list}>
        <li>Tap <strong>+ Add</strong> to create entries.</li>
        <li>Use <strong>filter pills</strong> to view entries assigned to a specific sub-admin.</li>
        <li>Drag-reorder entries by long-pressing (when no filter or search is active).</li>
        <li>Use <strong>select mode</strong> to bulk-delete or bulk-reassign.</li>
      </ul>

      <div style={sectionTitle}>🔐 Id &amp; Pass tab</div>
      <div style={para}>Two sub-sections: <strong>🎮 Games</strong> for game credentials, <strong>🔐 Accounts</strong> for general accounts.</div>
      <ul style={list}>
        <li>The active sub-tab determines where new entries go.</li>
        <li>Use <strong>Show / Hide</strong> to reveal the password.</li>
        <li><strong>Copy</strong> copies username or password to clipboard.</li>
      </ul>

      <div style={sectionTitle}>👤 Create Admin tab</div>
      <ul style={list}>
        <li>Create <strong>co-admins</strong> — they manage their own isolated workspaces with their own sub-admins.</li>
        <li>Create <strong>sub-admins</strong> for YOUR own workspace.</li>
        <li>Delete co-admins to remove their entire workspace and all its data (cascade).</li>
      </ul>

      <div style={sectionTitle}>🔍 Search</div>
      <div style={para}>The search bar above the tabs searches Notices, System, Games, and Id&amp;Pass simultaneously across your workspace.</div>

      <div style={sectionTitle}>🔔 Notification bell</div>
      <div style={para}>Click the bell to see new content in your workspace. Click ⚙ to choose which categories to be notified about.</div>

      <div style={sectionTitle}>🗑 Trash</div>
      <div style={para}>Settings → Trash. Deleted entries from System, Games, Id&amp;Pass, and Notices are kept here for 30 days. Restore or permanently delete.</div>

      <div style={sectionTitle}>⚙️ Settings</div>
      <div style={para}>Change your password, switch theme, import/export workspace data, edit About Us.</div>

      <div style={sectionTitle}>🔄 Real-time sync</div>
      <div style={para}>Changes appear instantly on every signed-in device. No refresh needed.</div>
    </>
  );

  const CoAdminGuide = () => (
    <>
      <div style={para}>Welcome, co-admin. You run your own isolated workspace inside Infos. You have your own sub-admins, content, and notices — none of which are visible to other co-admins.</div>

      <div style={sectionTitle}>🌐 Your workspace</div>
      <ul style={list}>
        <li>You manage your own sub-admins.</li>
        <li>Your content (notices, entries, credentials) is visible only inside your workspace.</li>
        <li>You cannot see other co-admins&apos; workspaces, and they cannot see yours.</li>
        <li>The main admin (Zeus) created your account but cannot see your workspace content.</li>
      </ul>

      <div style={sectionTitle}>📢 Notice tab</div>
      <div style={para}>Post announcements for your sub-admins. Assign to specific sub-admins or broadcast to all.</div>
      <div style={tip}>💡 <strong>Pin important notices</strong> using the 📌 button. Pinned notices stay at the top regardless of date.</div>

      <div style={sectionTitle}>⚙️ System &amp; 🎮 Games tabs</div>
      <div style={para}>Manage links and resources for your sub-admins.</div>
      <ul style={list}>
        <li>Tap <strong>+ Add</strong> to create entries.</li>
        <li>Use <strong>filter pills</strong> to view entries assigned to a specific sub-admin.</li>
        <li>Drag-reorder entries by long-pressing (when no filter or search is active).</li>
        <li>Use <strong>select mode</strong> to bulk-delete or bulk-reassign.</li>
      </ul>

      <div style={sectionTitle}>🔐 Id &amp; Pass tab</div>
      <div style={para}>Two sub-sections: <strong>🎮 Games</strong> for game credentials, <strong>🔐 Accounts</strong> for general accounts.</div>
      <ul style={list}>
        <li>The active sub-tab determines where new entries go.</li>
        <li>Use <strong>Show / Hide</strong> to reveal the password.</li>
        <li><strong>Copy</strong> copies username or password to clipboard.</li>
      </ul>

      <div style={sectionTitle}>👤 Create Admin tab</div>
      <div style={para}>Create sub-admins who can view entries assigned to them in your workspace.</div>

      <div style={sectionTitle}>🔍 Search</div>
      <div style={para}>The search bar above the tabs searches Notices, System, Games, and Id&amp;Pass simultaneously inside your workspace.</div>

      <div style={sectionTitle}>🔔 Notification bell</div>
      <div style={para}>Click the bell to see new content. Click ⚙ to choose which categories to be notified about.</div>

      <div style={sectionTitle}>🗑 Trash</div>
      <div style={para}>Settings → Trash. Deleted entries are kept for 30 days. Restore or permanently delete.</div>

      <div style={sectionTitle}>⚙️ Settings</div>
      <div style={para}>Change your password, switch theme, import/export your workspace data.</div>

      <div style={sectionTitle}>🔄 Real-time sync</div>
      <div style={para}>Changes appear instantly on every signed-in device. No refresh needed.</div>
    </>
  );

  const SubAdminGuide = () => (
    <>
      <div style={para}>Welcome. You&apos;re a sub-admin in this Infos workspace. You can view content assigned to you, share credentials between your own devices, and read notices from your admin.</div>

      <div style={sectionTitle}>👁 What you can see</div>
      <ul style={list}>
        <li>Notices that your admin posted to you (or to all sub-admins).</li>
        <li>System, Games, and Id&amp;Pass entries that your admin assigned to you.</li>
        <li>Your own Copy &amp; Paste entries (private, visible only to you).</li>
      </ul>
      <div style={para}>Anything not assigned to you stays hidden. You cannot see other sub-admins&apos; data.</div>

      <div style={sectionTitle}>📢 Notice tab</div>
      <div style={para}>Read announcements from your admin. The Notice tab has two sub-tabs:</div>
      <ul style={list}>
        <li><strong>📢 Notices</strong> — read-only announcements from your admin</li>
        <li><strong>📋 Copy &amp; Paste</strong> — your private credential-sharing space</li>
      </ul>

      <div style={sectionTitle}>📋 Copy &amp; Paste</div>
      <div style={para}>Quickly share a credential between your own multiple devices. Type the game name, username, password — click <strong>Publish</strong>. The entry appears instantly on every device where you&apos;re signed in. Auto-deletes after 5 minutes.</div>
      <div style={tip}>💡 The <strong>Copy</strong> button on each entry copies all 3 fields formatted as plain text, ready to paste anywhere.</div>

      <div style={sectionTitle}>⚙️ System &amp; 🎮 Games tabs</div>
      <div style={para}>View links and resources your admin has assigned to you. Click links to open them. Read-only — only your admin can edit.</div>

      <div style={sectionTitle}>🔐 Id &amp; Pass tab</div>
      <ul style={list}>
        <li>You see only credentials assigned to you.</li>
        <li>Use <strong>Show</strong> to reveal a password, <strong>Copy</strong> to copy it.</li>
        <li>Two sub-sections: 🎮 Games and 🔐 Accounts.</li>
      </ul>

      <div style={sectionTitle}>🔍 Search</div>
      <div style={para}>The search bar above the tabs searches all your assigned content at once.</div>

      <div style={sectionTitle}>🔔 Notification bell</div>
      <div style={para}>Click the bell to see new content assigned to you. Click ⚙ to choose which categories to be notified about.</div>

      <div style={sectionTitle}>📱 Multiple accounts on one device</div>
      <div style={para}>You can sign into multiple Infos accounts on the same device. Tap your name in the top-right and use <strong>Add another account</strong>. Switch between them anytime.</div>

      <div style={sectionTitle}>🔄 Real-time sync</div>
      <div style={para}>New notices and entries appear instantly on every signed-in device. No refresh needed.</div>

      <div style={sectionTitle}>❓ Need help?</div>
      <div style={para}>Check <strong>About Us</strong> in the same menu where you found this guide for contact info.</div>
    </>
  );

  return (
    <div className="infos-modal-backdrop" onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'var(--modal-backdrop)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <div className="infos-modal" onClick={(e) => e.stopPropagation()}
        style={{ background: C.cardBg, border: `1px solid ${C.borderStrong}`, borderRadius: '14px', maxWidth: '620px', width: '100%', maxHeight: '90vh', boxShadow: 'var(--shadow-pop)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '18px 20px 14px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: '16px', fontWeight: 600, letterSpacing: '-0.01em' }}>
            📖 User Guide{isZeusUser ? ' — Main Admin' : isCoAdmin ? ' — Co-admin' : ' — Sub-admin'}
          </div>
          <button onClick={onClose} type="button" style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '20px', color: C.textTertiary, lineHeight: 1, padding: '4px 8px', borderRadius: '4px' }}>×</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 20px 24px' }}>
          {isZeusUser ? <ZeusGuide /> : isCoAdmin ? <CoAdminGuide /> : isSub ? <SubAdminGuide /> : null}
        </div>
      </div>
    </div>
  );
}

// ---------------- Welcome modal for first-time sub-admins (v21.0) ----------------
// Shown ONCE per device per sub-admin (tracked via localStorage). Quick orientation.
// Uses localStorage rather than a DB column so we don't need a schema change.
function WelcomeModal({ open, onClose, user, onOpenGuide }: any) {
  if (!open) return null;
  return (
    <div className="infos-modal-backdrop" onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'var(--modal-backdrop)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <div className="infos-modal" onClick={(e) => e.stopPropagation()}
        style={{ background: C.cardBg, border: `1px solid ${C.borderStrong}`, borderRadius: '14px', maxWidth: '440px', width: '100%', boxShadow: 'var(--shadow-pop)', padding: '28px 24px 22px', textAlign: 'center' }}>
        <div style={{ fontSize: '38px', marginBottom: '12px' }}>👋</div>
        <div style={{ fontSize: '20px', fontWeight: 700, letterSpacing: '-0.02em', marginBottom: '6px' }}>Welcome, {user?.username}!</div>
        <div style={{ fontSize: '14px', color: C.textSecondary, lineHeight: 1.55, marginBottom: '20px' }}>
          You&apos;re signed in to Infos. Here&apos;s a quick orientation:
        </div>
        <div style={{ textAlign: 'left', fontSize: '13.5px', color: C.textSecondary, lineHeight: 1.7, marginBottom: '20px', padding: '12px 14px', background: C.softBg, borderRadius: '10px' }}>
          <div>📢 <strong>Notice</strong> — announcements for you</div>
          <div>⚙️ <strong>System</strong> &amp; 🎮 <strong>Games</strong> — links assigned to you</div>
          <div>🔐 <strong>Id &amp; Pass</strong> — account credentials</div>
          {user?.role === 'sub' && <div style={{ marginTop: '8px' }}>📋 <strong>Copy &amp; Paste</strong> (in Notice tab) — share credentials between your own devices</div>}
        </div>
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
          <Btn onClick={() => { onOpenGuide(); onClose(); }} style={{ fontSize: '13px' }}>📖 Open User Guide</Btn>
          <Btn primary onClick={onClose} style={{ fontSize: '13px' }}>Got it, let&apos;s start</Btn>
        </div>
      </div>
    </div>
  );
}

// ---------------- Global search modal (v21.0) ----------------
// Searches across Notices, Backend, Games, Id&Pass simultaneously and shows
// grouped results. Click a result to navigate to that tab. Enforces visibility:
// admins see everything in their workspace, sub-admins see only entries
// assigned to them.
function GlobalSearchModal({ open, onClose, user, notices, backend, games, idpass, subs, onNavigate }: any) {
  const [q, setQ] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQ('');                                                      // reset on open
    const t = setTimeout(() => inputRef.current?.focus(), 50);     // autofocus
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => { clearTimeout(t); document.removeEventListener('keydown', handler); };
  }, [open, onClose]);

  // Build results — filtered by visibility for sub-admins, then by search text.
  const results = useMemo(() => {
    if (!open || !q.trim()) return null;
    const isAdmin = isAdminRole(user.role);
    const search = q.trim().toLowerCase();
    const matches = (text: string | undefined) => (text || '').toLowerCase().includes(search);

    const visibleNotices = (isAdmin ? notices : (notices || []).filter((n: any) => isVisibleToSub(n.recipients, user.id)))
      .filter((n: any) => matches(n.title) || matches(n.body) || matches(n.link));

    const filterEntries = (arr: any[]) => (isAdmin ? arr : arr.filter((e: any) => isVisibleToSub(e.assignees, user.id)));
    const visibleBackend = filterEntries(backend || []).filter((e: any) => matches(e.gameName) || matches(e.shortName) || matches(e.link) || matches(e.description));
    const visibleGames = filterEntries(games || []).filter((e: any) => matches(e.gameName) || matches(e.shortName) || matches(e.link) || matches(e.description));
    const visibleIdpass = filterEntries(idpass || []).filter((e: any) => matches(e.game) || matches(e.shortName) || matches(e.username) || matches(e.description));

    return { notices: visibleNotices, backend: visibleBackend, games: visibleGames, idpass: visibleIdpass };
  }, [open, q, user, notices, backend, games, idpass]);

  if (!open) return null;
  const totalCount = results ? (results.notices.length + results.backend.length + results.games.length + results.idpass.length) : 0;

  const Section = ({ title, items, tabId, renderText }: any) => {
    if (!items || items.length === 0) return null;
    return (
      <div style={{ marginBottom: '16px' }}>
        <div style={{ fontSize: '11px', fontWeight: 700, color: C.textTertiary, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px', padding: '0 4px' }}>
          {title} ({items.length})
        </div>
        {items.slice(0, 8).map((item: any) => (
          <button key={item.id} onClick={() => { onNavigate(tabId); onClose(); }} type="button"
            style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 12px', marginBottom: '4px', border: `1px solid ${C.border}`, background: C.cardBg, borderRadius: '8px', cursor: 'pointer', fontSize: '13px', color: C.textPrimary }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = C.softBg)}
            onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = C.cardBg)}>
            <div style={{ fontWeight: 600, marginBottom: '2px' }}>{renderText(item).primary}</div>
            {renderText(item).secondary && <div style={{ fontSize: '12px', color: C.textTertiary }}>{renderText(item).secondary}</div>}
          </button>
        ))}
        {items.length > 8 && (
          <div style={{ fontSize: '11.5px', color: C.textTertiary, textAlign: 'center', padding: '4px', fontStyle: 'italic' }}>
            +{items.length - 8} more — open the {title.replace(/[^A-Za-z &]/g, '').trim()} tab to see all
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="infos-modal-backdrop" onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'var(--modal-backdrop)', zIndex: 9999, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '5vh 1rem 1rem' }}>
      <div className="infos-modal" onClick={(e) => e.stopPropagation()}
        style={{ background: C.cardBg, border: `1px solid ${C.borderStrong}`, borderRadius: '14px', maxWidth: '600px', width: '100%', maxHeight: '85vh', boxShadow: 'var(--shadow-pop)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '14px 16px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '18px', color: C.textTertiary }}>🔍</span>
          <input ref={inputRef} type="text" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Search across all tabs…"
            style={{ flex: 1, fontSize: '15px', border: 'none', outline: 'none', background: 'transparent', color: C.textPrimary, fontFamily: 'inherit' }} />
          <button onClick={onClose} type="button" style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '18px', color: C.textTertiary, padding: '4px 8px' }}>×</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px 20px' }}>
          {!q.trim() ? (
            <div style={{ textAlign: 'center', padding: '40px 16px', color: C.textTertiary, fontSize: '13.5px' }}>
              Start typing to search Notices, System, Games, and Id &amp; Pass at the same time.
            </div>
          ) : totalCount === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 16px', color: C.textTertiary, fontSize: '13.5px' }}>
              No matches for &ldquo;<strong>{q}</strong>&rdquo;.
            </div>
          ) : (
            <>
              <div style={{ fontSize: '11.5px', color: C.textTertiary, marginBottom: '12px', fontWeight: 600 }}>
                {totalCount} match{totalCount === 1 ? '' : 'es'}
              </div>
              <Section title="📢 Notices" items={results!.notices} tabId="notice"
                renderText={(x: any) => ({ primary: x.title, secondary: (x.body || '').slice(0, 80) + ((x.body || '').length > 80 ? '…' : '') })} />
              <Section title="⚙️ System" items={results!.backend} tabId="backend"
                renderText={(x: any) => ({ primary: x.gameName + (x.shortName ? ` (${x.shortName})` : ''), secondary: x.link })} />
              <Section title="🎮 Games" items={results!.games} tabId="games"
                renderText={(x: any) => ({ primary: x.gameName + (x.shortName ? ` (${x.shortName})` : ''), secondary: x.link })} />
              <Section title="🔐 Id & Pass" items={results!.idpass} tabId="idpass"
                renderText={(x: any) => ({ primary: x.game + (x.shortName ? ` (${x.shortName})` : ''), secondary: `${x.username} • ${x.section === 'accounts' ? 'Account' : 'Game'}` })} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------- PWA Install Prompt Banner (v21.0) ----------------
// Shows a dismissible "Install on your phone" banner once per session for users
// who can install. Uses the standard `beforeinstallprompt` event. Won't show
// on already-installed devices, on iOS Safari (which doesn't fire the event),
// or after user dismisses it (remembered in localStorage).
function InstallPromptBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    // Skip if user previously dismissed
    try {
      if (localStorage.getItem('infos:install_dismissed') === '1') return;
    } catch {}

    // Skip if already installed (running in standalone/TWA mode)
    if (typeof window !== 'undefined') {
      const isStandalone =
        window.matchMedia?.('(display-mode: standalone)').matches ||
        (window.navigator as any).standalone === true ||
        document.referrer.startsWith('android-app://');
      if (isStandalone) return;
    }

    const handler = (e: any) => {
      e.preventDefault();        // suppress browser's default mini-infobar
      setDeferredPrompt(e);
      setShow(true);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const install = async () => {
    if (!deferredPrompt) return;
    try {
      deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      // Either way, hide the banner — accepted means installing, dismissed means user chose no
      setShow(false);
      setDeferredPrompt(null);
      if (choice?.outcome === 'dismissed') {
        try { localStorage.setItem('infos:install_dismissed', '1'); } catch {}
      }
    } catch {
      setShow(false);
    }
  };

  const dismiss = () => {
    setShow(false);
    try { localStorage.setItem('infos:install_dismissed', '1'); } catch {}
  };

  if (!show) return null;

  return (
    <div style={{
      position: 'fixed', bottom: '12px', left: '12px', right: '12px',
      maxWidth: '440px', margin: '0 auto',
      background: C.cardBg, border: `1px solid ${C.accent}`, borderRadius: '12px',
      padding: '12px 14px', boxShadow: 'var(--shadow-pop)',
      zIndex: 5000, display: 'flex', alignItems: 'center', gap: '12px',
      animation: 'infosSlideUp 0.25s ease-out',
    }}>
      <span style={{ fontSize: '24px', flexShrink: 0 }}>📱</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: C.textPrimary, marginBottom: '2px' }}>Install Infos</div>
        <div style={{ fontSize: '11.5px', color: C.textSecondary, lineHeight: 1.4 }}>Quick access from your home screen — works offline too.</div>
      </div>
      <button onClick={install} type="button"
        style={{ padding: '7px 14px', fontSize: '12.5px', background: C.accent, color: 'white', border: 'none', borderRadius: '7px', cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0 }}>
        Install
      </button>
      <button onClick={dismiss} type="button" title="Dismiss"
        style={{ padding: '4px 8px', fontSize: '16px', background: 'transparent', color: C.textTertiary, border: 'none', cursor: 'pointer', flexShrink: 0 }}>×</button>
    </div>
  );
}

// ---------------- Trash modal (v21.4) ----------------
// Shows soft-deleted entries from backend, games, idpass, notices.
// Admin-only. Each item: Restore or Permanently delete.
// Empties auto-purge items older than 30 days on open.
// Real-time: refreshes via realtime subscription on the same tables (deleted_at change).
function TrashModal({ open, onClose, workspaceId, onAfterChange }: any) {
  const [tab, setTab] = useState<'backend' | 'games' | 'idpass' | 'notices'>('notices');
  const [loading, setLoading] = useState(false);
  const [bk, setBk] = useState<any[]>([]);
  const [gm, setGm] = useState<any[]>([]);
  const [ip, setIp] = useState<any[]>([]);
  const [nt, setNt] = useState<any[]>([]);
  const [confirmEl, confirm] = useConfirm();

  const reload = useCallback(async () => {
    if (!open) return;
    setLoading(true);
    try {
      // Auto-purge items older than 30 days first (best-effort)
      purgeOldTrash(workspaceId).catch(() => {});
      const [b, g, i, n] = await Promise.all([
        loadTrashedBackend(workspaceId),
        loadTrashedGames(workspaceId),
        loadTrashedIdPass(workspaceId),
        loadTrashedNotices(workspaceId),
      ]);
      setBk(b); setGm(g); setIp(i); setNt(n);
    } finally { setLoading(false); }
  }, [open, workspaceId]);

  useEffect(() => { reload(); }, [reload]);

  // Esc to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  const handleRestore = async (table: 'backend_entries' | 'game_entries' | 'idpass_entries' | 'notices', id: string) => {
    try {
      await restoreEntry(table, id);
      notify('Restored', 'success');
      reload();
      onAfterChange && onAfterChange();
    } catch (e: any) { notify(friendlyError(e)); }
  };

  const handlePurge = async (table: 'backend_entries' | 'game_entries' | 'idpass_entries' | 'notices', id: string, label: string) => {
    const ok = await confirm({
      title: 'Permanently delete?',
      message: `"${label}" will be permanently removed. This cannot be undone.`,
      confirmLabel: 'Delete forever',
      danger: true,
    });
    if (!ok) return;
    try {
      await purgeEntry(table, id);
      notify('Permanently deleted', 'success');
      reload();
    } catch (e: any) { notify(friendlyError(e)); }
  };

  const handleEmptyAll = async () => {
    const total = bk.length + gm.length + ip.length + nt.length;
    if (total === 0) return;
    const ok = await confirm({
      title: 'Empty trash?',
      message: `${total} ${total === 1 ? 'item' : 'items'} will be permanently deleted. This cannot be undone.`,
      confirmLabel: 'Empty trash',
      danger: true,
    });
    if (!ok) return;
    try {
      await emptyTrash(workspaceId, 0);
      notify('Trash emptied', 'success');
      reload();
    } catch (e: any) { notify(friendlyError(e)); }
  };

  const counts = { notices: nt.length, backend: bk.length, games: gm.length, idpass: ip.length };
  const tabs: Array<{ key: typeof tab; label: string; count: number }> = [
    { key: 'notices', label: '📢 Notices', count: counts.notices },
    { key: 'backend', label: '⚙️ System', count: counts.backend },
    { key: 'games', label: '🎮 Games', count: counts.games },
    { key: 'idpass', label: '🔐 Id & Pass', count: counts.idpass },
  ];

  const renderItem = (table: 'backend_entries' | 'game_entries' | 'idpass_entries' | 'notices', it: any) => {
    const label = table === 'notices' ? (it.title || '(untitled)') : (it.gameName || it.game || '(unnamed)');
    const sub = table === 'notices' ? (it.body || '').slice(0, 80) : (it.username ? `${it.username}` : it.shortName || '');
    return (
      <div key={it.id} style={{ padding: '10px 12px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '13.5px', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</div>
          {sub && <div style={{ fontSize: '11.5px', color: C.textTertiary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: '2px' }}>{sub}</div>}
          <div style={{ fontSize: '11px', color: C.textTertiary, marginTop: '2px' }}>Deleted {timeAgo(it.deletedAt || 0)}</div>
        </div>
        <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
          <Btn onClick={() => handleRestore(table, it.id)} style={{ fontSize: '11.5px', padding: '4px 8px' }}>Restore</Btn>
          <Btn danger onClick={() => handlePurge(table, it.id, label)} style={{ fontSize: '11.5px', padding: '4px 8px' }}>Delete</Btn>
        </div>
      </div>
    );
  };

  const currentList = tab === 'notices' ? nt : tab === 'backend' ? bk : tab === 'games' ? gm : ip;
  const currentTable: any = tab === 'notices' ? 'notices' : tab === 'backend' ? 'backend_entries' : tab === 'games' ? 'game_entries' : 'idpass_entries';
  const totalCount = bk.length + gm.length + ip.length + nt.length;

  return (
    <div className="infos-modal-backdrop" onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'var(--modal-backdrop)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      {confirmEl}
      <div className="infos-modal" onClick={(e) => e.stopPropagation()}
        style={{ background: C.cardBg, border: `1px solid ${C.borderStrong}`, borderRadius: '14px', maxWidth: '560px', width: '100%', maxHeight: '85vh', boxShadow: 'var(--shadow-pop)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '14px 18px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: '16px', fontWeight: 600, letterSpacing: '-0.01em' }}>🗑 Trash</div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {totalCount > 0 && <Btn danger onClick={handleEmptyAll} style={{ fontSize: '12px', padding: '4px 10px' }}>Empty all</Btn>}
            <button onClick={onClose} type="button" style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '20px', color: C.textTertiary, padding: '4px 8px' }}>×</button>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: `1px solid ${C.border}`, gap: '4px', padding: '6px 12px', overflowX: 'auto' }}>
          {tabs.map(({ key, label, count }) => (
            <button key={key} onClick={() => setTab(key)} type="button"
              style={{
                padding: '6px 10px', fontSize: '12.5px', whiteSpace: 'nowrap',
                background: tab === key ? C.accentSoft : 'transparent',
                color: tab === key ? C.accentText : C.textSecondary,
                fontWeight: tab === key ? 600 : 500,
                border: 'none', borderRadius: '6px', cursor: 'pointer',
              }}>
              {label} {count > 0 && <span style={{ marginLeft: '4px', fontSize: '11px', opacity: 0.8 }}>({count})</span>}
            </button>
          ))}
        </div>

        <div style={{ padding: '6px 14px', borderBottom: `1px solid ${C.border}`, fontSize: '11.5px', color: C.textTertiary }}>
          Items in trash are auto-deleted after 30 days. Restore or permanently delete here.
        </div>

        {/* List */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading ? (
            <div style={{ padding: '14px' }}><Skeleton lines={3} /></div>
          ) : currentList.length === 0 ? (
            <div style={{ padding: '32px 16px', textAlign: 'center', fontSize: '13px', color: C.textTertiary }}>
              No items in this trash section.
            </div>
          ) : (
            currentList.map((it) => renderItem(currentTable, it))
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------- Devices manager modal (v22.2 — Zeus only) ----------------
// Lists every active session across the platform and lets Zeus revoke any
// individual session. Auto-refreshes via realtime + manual reload button.
//
// Display:
//   - Grouped by user (Zeus, then co-admins, then sub-admins)
//   - Each session shows: device label OR auto-detected platform, last seen
//     time, current-device tag if it's THIS browser, revoke button
//   - Search filter across username and device label/platform
function DevicesModal({ open, onClose, currentSessionId }: any) {
  const [sessions, setSessions] = useState<DeviceSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [confirmEl, confirm] = useConfirm();

  const reload = useCallback(async () => {
    if (!open) return;
    setLoading(true);
    try {
      const list = await loadAllSessions(false); // active only
      setSessions(list);
    } finally { setLoading(false); }
  }, [open]);

  useEffect(() => { reload(); }, [reload]);

  // Realtime: auto-refresh when sessions table changes (new login, revoke, ping)
  useEffect(() => {
    if (!open) return;
    let alive = true;
    const unsub = subscribeAll(['sessions'], () => { if (alive) reload(); });
    return () => { alive = false; unsub(); };
  }, [open, reload]);

  // Esc to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // Filter
  const filtered = useMemo(() => {
    if (!q.trim()) return sessions;
    const search = q.trim().toLowerCase();
    return sessions.filter((s) =>
      s.username.toLowerCase().includes(search) ||
      (s.deviceLabel || '').toLowerCase().includes(search) ||
      (s.platform || '').toLowerCase().includes(search)
    );
  }, [sessions, q]);

  // Group by user (then sort within group by last_seen desc)
  const grouped = useMemo(() => {
    const map = new Map<string, { username: string; role: string; ownerId: string; sessions: DeviceSession[] }>();
    for (const s of filtered) {
      const key = `${s.role}:${s.userId}`;
      if (!map.has(key)) map.set(key, { username: s.username, role: s.role, ownerId: s.ownerId, sessions: [] });
      map.get(key)!.sessions.push(s);
    }
    // Order: Zeus first, then co-admins, then sub-admins, alpha within
    const order = (r: string) => r === 'zeus' ? 0 : r === 'co' ? 1 : 2;
    return Array.from(map.values()).sort((a, b) => {
      const d = order(a.role) - order(b.role);
      if (d !== 0) return d;
      return a.username.localeCompare(b.username);
    });
  }, [filtered]);

  if (!open) return null;

  const handleRevoke = async (s: DeviceSession) => {
    const isCurrent = s.id === currentSessionId;
    const ok = await confirm({
      title: isCurrent ? 'Sign yourself out from this device?' : `Sign ${s.username} out?`,
      message: isCurrent
        ? 'You will be logged out of THIS device. You can sign back in afterward.'
        : `${s.username}'s session on "${s.deviceLabel || s.platform || 'this device'}" will be terminated. They\u2019ll be signed out within ~30 seconds.`,
      confirmLabel: 'Sign out',
      danger: true,
    });
    if (!ok) return;
    setBusy((prev) => ({ ...prev, [s.id]: true }));
    try {
      await revokeSession(s.id);
      notify(isCurrent ? 'Signing out…' : `${s.username} will be signed out shortly.`, 'success');
      reload();
    } catch (e: any) { notify(friendlyError(e)); }
    finally { setBusy((prev) => ({ ...prev, [s.id]: false })); }
  };

  const startRename = (s: DeviceSession) => {
    setRenameId(s.id);
    setRenameValue(s.deviceLabel || '');
  };

  const saveRename = async (s: DeviceSession) => {
    setBusy((prev) => ({ ...prev, [s.id]: true }));
    try {
      await renameSession(s.id, renameValue);
      setRenameId(null); setRenameValue('');
      notify('Device renamed.', 'success');
      reload();
    } catch (e: any) { notify(friendlyError(e)); }
    finally { setBusy((prev) => ({ ...prev, [s.id]: false })); }
  };

  const totalUsers = grouped.length;
  const totalDevices = filtered.length;

  return (
    <div className="infos-modal-backdrop" onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'var(--modal-backdrop)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      {confirmEl}
      <div className="infos-modal" onClick={(e) => e.stopPropagation()}
        style={{ background: C.cardBg, border: `1px solid ${C.borderStrong}`, borderRadius: '14px', maxWidth: '700px', width: '100%', maxHeight: '90vh', boxShadow: 'var(--shadow-pop)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '14px 18px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
          <div style={{ fontSize: '16px', fontWeight: 600, letterSpacing: '-0.01em' }}>📱 Devices &amp; sessions</div>
          <button onClick={onClose} type="button"
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '20px', color: C.textTertiary, padding: '4px 8px' }}>×</button>
        </div>

        <div style={{ padding: '10px 18px 8px', borderBottom: `1px solid ${C.border}` }}>
          <div style={{ fontSize: '11.5px', color: C.textTertiary, marginBottom: '8px' }}>
            {loading ? 'Loading…' : `${totalDevices} active ${totalDevices === 1 ? 'device' : 'devices'} across ${totalUsers} ${totalUsers === 1 ? 'user' : 'users'}`}
            <span style={{ marginLeft: '6px' }}>· Force-logout takes effect within ~30 seconds.</span>
          </div>
          <input
            type="text" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Search by username or device…"
            style={{ width: '100%', padding: '8px 12px', fontSize: '13px', border: `1px solid ${C.border}`, borderRadius: '8px', background: C.softBg, color: C.textPrimary, fontFamily: 'inherit' }}
          />
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading && sessions.length === 0 ? (
            <div style={{ padding: '14px' }}><Skeleton lines={4} /></div>
          ) : grouped.length === 0 ? (
            <div style={{ padding: '40px 20px' }}>
              <EmptyState icon="📱" title={q.trim() ? 'No matches' : 'No active sessions'} hint={q.trim() ? 'Try a different search.' : 'When users sign in, their devices appear here.'} />
            </div>
          ) : (
            grouped.map((group) => (
              <div key={`${group.role}:${group.ownerId}:${group.username}`}>
                <div style={{
                  fontSize: '11px', fontWeight: 700, color: C.textTertiary,
                  textTransform: 'uppercase', letterSpacing: '0.05em',
                  padding: '12px 18px 6px',
                  background: C.softBg,
                  borderTop: `1px solid ${C.border}`,
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px',
                }}>
                  <span>
                    {group.username}
                    <span style={{ marginLeft: '6px', fontWeight: 500, color: C.textTertiary, textTransform: 'none', letterSpacing: 0 }}>
                      ({group.role === 'zeus' ? 'main admin' : group.role === 'co' ? 'co-admin' : 'sub-admin'})
                    </span>
                  </span>
                  <span style={{ fontWeight: 500, fontSize: '10px' }}>
                    {group.sessions.length} {group.sessions.length === 1 ? 'device' : 'devices'}
                  </span>
                </div>
                {group.sessions.map((s) => {
                  const isCurrent = s.id === currentSessionId;
                  const isRenaming = renameId === s.id;
                  const itemBusy = !!busy[s.id];
                  return (
                    <div key={s.id} style={{
                      padding: '12px 18px',
                      borderTop: `1px solid ${C.border}`,
                      display: 'flex', alignItems: 'flex-start', gap: '10px',
                      flexWrap: 'wrap',
                    }}>
                      <div style={{ flex: 1, minWidth: '180px' }}>
                        {isRenaming ? (
                          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '4px' }}>
                            <input
                              type="text" value={renameValue} onChange={(e) => setRenameValue(e.target.value)}
                              placeholder="e.g. Office laptop"
                              style={{ flex: 1, minWidth: '140px', padding: '5px 8px', fontSize: '12.5px', border: `1px solid ${C.borderStrong}`, borderRadius: '6px', background: C.cardBg, color: C.textPrimary, fontFamily: 'inherit' }}
                              maxLength={40}
                              autoFocus
                            />
                            <Btn onClick={() => saveRename(s)} disabled={itemBusy} primary style={{ fontSize: '11.5px', padding: '4px 10px' }}>Save</Btn>
                            <Btn onClick={() => { setRenameId(null); setRenameValue(''); }} style={{ fontSize: '11.5px', padding: '4px 10px' }}>Cancel</Btn>
                          </div>
                        ) : (
                          <div style={{ fontSize: '13.5px', fontWeight: 600, marginBottom: '2px', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                            {s.deviceLabel || s.platform || 'Unknown device'}
                            {isCurrent && (
                              <span style={{ fontSize: '10px', fontWeight: 700, padding: '1px 7px', borderRadius: '8px', background: C.accentSoft, color: C.accentText, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                This device
                              </span>
                            )}
                          </div>
                        )}
                        {!isRenaming && s.deviceLabel && s.platform && (
                          <div style={{ fontSize: '11.5px', color: C.textTertiary }}>{s.platform}</div>
                        )}
                        <div style={{ fontSize: '11px', color: C.textTertiary, marginTop: '3px' }}>
                          Signed in {timeAgo(s.createdAt)} · Last seen {timeAgo(s.lastSeenAt)}
                        </div>
                      </div>
                      {!isRenaming && (
                        <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                          <Btn onClick={() => startRename(s)} disabled={itemBusy} style={{ fontSize: '11.5px', padding: '4px 10px' }}>Rename</Btn>
                          <Btn danger onClick={() => handleRevoke(s)} disabled={itemBusy} style={{ fontSize: '11.5px', padding: '4px 10px' }}>
                            {isCurrent ? 'Sign out' : 'Force out'}
                          </Btn>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------- What Changed This Week modal (v22.1) ----------------
// Activity feed showing the last 7 days of changes in the user's workspace,
// grouped by day. Useful for periodic reviews ("what did I miss?").
//
// Visibility:
//   - Admins (Zeus, co-admin): everything in their workspace
//   - Sub-admins: only items assigned/visible to them
// Items: notices, backend, games, idpass entries (no deleted items, no pastes)
// Each item shows: emoji icon, title, "created" or "updated" badge, time ago
// Tap an item → navigate to that tab + close modal
function WhatChangedModal({ open, onClose, user, notices, backend, games, idpass, onNavigate }: any) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // Build the activity list — filtered by user visibility, last 7 days,
  // sorted desc by touchedAt timestamp.
  const grouped = useMemo(() => {
    if (!open) return null;
    const isAdmin = isAdminRole(user.role);
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - sevenDaysMs;

    type Item = {
      id: string;
      type: 'notice' | 'backend' | 'games' | 'idpass';
      title: string;
      subtitle: string;
      touchedAt: number;
      isUpdate: boolean;
    };

    const out: Item[] = [];
    const touchedAt = (r: any) => Math.max(Number(r.updatedAt) || 0, Number(r.createdAt) || 0);
    // Treat as update if updatedAt is more than 2 seconds after createdAt
    // (small grace for round-trip timing on creation).
    const isUpdate = (r: any) => !!(r.updatedAt && r.updatedAt > (r.createdAt + 2000));

    // Notices
    (notices || []).forEach((n: any) => {
      if (!isAdmin && !isVisibleToSub(n.recipients, user.id)) return;
      const t = touchedAt(n);
      if (t < cutoff) return;
      out.push({
        id: `notice:${n.id}`, type: 'notice',
        title: n.title || '(untitled notice)',
        subtitle: '📢 Notice',
        touchedAt: t, isUpdate: isUpdate(n),
      });
    });

    const collectEntries = (arr: any[], type: 'backend' | 'games' | 'idpass', label: string, getName: (e: any) => string) => {
      (arr || []).forEach((e: any) => {
        if (!isAdmin && !isVisibleToSub(e.assignees, user.id)) return;
        const t = touchedAt(e);
        if (t < cutoff) return;
        out.push({
          id: `${type}:${e.id}`, type,
          title: getName(e),
          subtitle: label,
          touchedAt: t, isUpdate: isUpdate(e),
        });
      });
    };
    collectEntries(backend, 'backend', '⚙️ System entry', (e) => e.gameName || '(unnamed)');
    collectEntries(games, 'games', '🎮 Game entry', (e) => e.gameName || '(unnamed)');
    collectEntries(idpass, 'idpass', '🔐 Id & Pass entry', (e) => e.game || '(unnamed)');

    out.sort((a, b) => b.touchedAt - a.touchedAt);

    // Group by day bucket (Today, Yesterday, "X days ago"). Bucket key is days
    // ago calculated from local midnight so timezone is consistent.
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const todayMs = startOfToday.getTime();

    const buckets: Record<string, { label: string; items: Item[] }> = {};
    const order: string[] = [];

    for (const item of out) {
      const itemDate = new Date(item.touchedAt);
      itemDate.setHours(0, 0, 0, 0);
      const daysAgo = Math.floor((todayMs - itemDate.getTime()) / (24 * 60 * 60 * 1000));
      const key = `d${daysAgo}`;
      if (!buckets[key]) {
        const label = daysAgo === 0 ? 'Today'
                    : daysAgo === 1 ? 'Yesterday'
                    : `${daysAgo} days ago`;
        buckets[key] = { label, items: [] };
        order.push(key);
      }
      buckets[key].items.push(item);
    }

    return { groups: order.map((k) => buckets[k]), total: out.length };
  }, [open, user, notices, backend, games, idpass]);

  if (!open) return null;
  const totalCount = grouped?.total ?? 0;

  const itemIcon = (t: string) => t === 'notice' ? '📢' : t === 'backend' ? '🔧' : t === 'games' ? '🎮' : '🔐';

  const handleClick = (item: any) => {
    const tab = item.type === 'backend' ? 'backend' : item.type === 'games' ? 'games' : item.type === 'idpass' ? 'idpass' : 'notice';
    onNavigate(tab);
    onClose();
  };

  return (
    <div className="infos-modal-backdrop" onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'var(--modal-backdrop)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <div className="infos-modal" onClick={(e) => e.stopPropagation()}
        style={{ background: C.cardBg, border: `1px solid ${C.borderStrong}`, borderRadius: '14px', maxWidth: '600px', width: '100%', maxHeight: '85vh', boxShadow: 'var(--shadow-pop)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '14px 18px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: '16px', fontWeight: 600, letterSpacing: '-0.01em' }}>📅 What changed this week</div>
          <button onClick={onClose} type="button"
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '20px', color: C.textTertiary, padding: '4px 8px' }}>×</button>
        </div>

        <div style={{ padding: '8px 18px', borderBottom: `1px solid ${C.border}`, fontSize: '12px', color: C.textTertiary }}>
          {totalCount === 0
            ? 'No activity in the last 7 days.'
            : `${totalCount} ${totalCount === 1 ? 'change' : 'changes'} in the last 7 days`}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0 12px' }}>
          {totalCount === 0 ? (
            <div style={{ padding: '40px 20px' }}>
              <EmptyState icon="📅" title="Quiet week" hint="Nothing has been added or updated in the last 7 days." />
            </div>
          ) : (
            grouped!.groups.map((group, gi) => (
              <div key={gi}>
                <div style={{
                  fontSize: '11px', fontWeight: 700, color: C.textTertiary,
                  textTransform: 'uppercase', letterSpacing: '0.05em',
                  padding: '14px 18px 6px',
                  background: C.softBg,
                  borderTop: gi > 0 ? `1px solid ${C.border}` : 'none',
                }}>
                  {group.label} · {group.items.length} {group.items.length === 1 ? 'change' : 'changes'}
                </div>
                {group.items.map((item) => (
                  <button key={item.id} onClick={() => handleClick(item)} type="button"
                    style={{
                      display: 'flex', alignItems: 'flex-start', gap: '10px',
                      width: '100%', textAlign: 'left',
                      padding: '11px 18px',
                      borderTop: `1px solid ${C.border}`,
                      background: 'transparent',
                      border: 'none', borderBottom: 'none', borderLeft: 'none', borderRight: 'none',
                      cursor: 'pointer',
                      color: C.textPrimary,
                    }}
                    onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = C.softBg)}
                    onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = 'transparent')}>
                    <span style={{ fontSize: '15px', flexShrink: 0, marginTop: '1px' }}>{itemIcon(item.type)}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '13.5px', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {item.title}
                        </span>
                        <span style={{
                          fontSize: '10px', fontWeight: 700,
                          padding: '1px 7px', borderRadius: '8px',
                          background: item.isUpdate ? C.accentSoft : C.successSoft,
                          color: item.isUpdate ? C.accentText : C.success,
                          textTransform: 'uppercase', letterSpacing: '0.04em',
                          flexShrink: 0,
                        }}>
                          {item.isUpdate ? 'Updated' : 'New'}
                        </span>
                      </div>
                      <div style={{ fontSize: '11.5px', color: C.textTertiary, marginTop: '2px' }}>
                        {item.subtitle} · {timeAgo(item.touchedAt)}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------- Notification Bell (v21.2) ----------------
// In-app notification system. No backend infrastructure needed.
// Tracks "last seen" timestamp per (user, workspace) in localStorage.
// Anything created/updated after lastSeen = unread for this device.
//
// What counts as a notification:
//   - New notices visible to this user
//   - New backend/game/idpass entries assigned to this user
//   - For admins: notices/entries created in their workspace by anyone
//
// Click a notification → jumps to the relevant tab.
// "Mark all as read" updates lastSeen to now.
function NotificationBell({ user, workspaceId, notices, backend, games, idpass, onNavigate }: any) {
  const [open, setOpen] = useState(false);
  const [lastSeen, setLastSeen] = useState<number>(0);
  const [showPrefs, setShowPrefs] = useState(false);
  // v21.4: Notification preferences. Default: all categories enabled.
  // Stored per-user, per-workspace in localStorage so it follows the user
  // across devices only via local memory (privacy-friendly, no backend leak).
  const [prefs, setPrefs] = useState<{ notice: boolean; backend: boolean; games: boolean; idpass: boolean }>({ notice: true, backend: true, games: true, idpass: true });
  const ref = useRef<HTMLDivElement>(null);

  // Per-user, per-workspace key so multi-account users have separate notification state
  const seenKey = useMemo(() => {
    const id = user.role === 'zeus' ? 'zeus' : user.id;
    return `infos:last_seen:${workspaceId}:${id}`;
  }, [user, workspaceId]);

  const prefsKey = useMemo(() => {
    const id = user.role === 'zeus' ? 'zeus' : user.id;
    return `infos:notif_prefs:${workspaceId}:${id}`;
  }, [user, workspaceId]);

  // Load last-seen timestamp on mount / user change
  useEffect(() => {
    try {
      const v = localStorage.getItem(seenKey);
      // First-time users: set baseline to NOW so they don't see a flood of historical "new" items
      if (!v) {
        const now = Date.now();
        localStorage.setItem(seenKey, String(now));
        setLastSeen(now);
      } else {
        setLastSeen(Number(v) || 0);
      }
    } catch {
      setLastSeen(Date.now());
    }
  }, [seenKey]);

  // Load notification prefs (or set defaults if none stored)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(prefsKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        setPrefs({
          notice: parsed.notice !== false,
          backend: parsed.backend !== false,
          games: parsed.games !== false,
          idpass: parsed.idpass !== false,
        });
      }
    } catch {}
  }, [prefsKey]);

  // Persist prefs whenever they change
  const updatePref = (key: keyof typeof prefs, value: boolean) => {
    setPrefs((prev) => {
      const next = { ...prev, [key]: value };
      try { localStorage.setItem(prefsKey, JSON.stringify(next)); } catch {}
      return next;
    });
  };

  // v24.0: Web Push subscription state.
  //   - 'unsupported' = browser/device doesn't support web push (or running in TWA)
  //   - 'denied'      = user explicitly blocked notifications in browser
  //   - 'unsubscribed' = supported, permitted, but no active subscription
  //   - 'subscribed'   = active push subscription registered with server
  //   - 'busy'        = mid-operation
  type PushState = 'unsupported' | 'denied' | 'unsubscribed' | 'subscribed' | 'busy';
  const [pushState, setPushState] = useState<PushState>('unsupported');
  const [pushMsg, setPushMsg] = useState<string>('');

  // v24.3: Sound + browser notification state.
  // soundEnabled is mirrored from localStorage (default 'on').
  // browserNotifState reflects the current Notification.permission value.
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => {
    if (typeof localStorage === 'undefined') return true;
    return localStorage.getItem('infos:sound_enabled') !== 'off';
  });
  type BrowserNotifState = 'unsupported' | 'denied' | 'default' | 'granted';
  const [browserNotifState, setBrowserNotifState] = useState<BrowserNotifState>(() => {
    if (typeof Notification === 'undefined') return 'unsupported';
    return Notification.permission as BrowserNotifState;
  });

  // Detect support + current subscription on mount.
  useEffect(() => {
    let cancelled = false;
    const detect = async () => {
      if (typeof window === 'undefined') return;
      // Web Push needs Service Workers + PushManager + Notification API
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
        if (!cancelled) setPushState('unsupported');
        return;
      }
      // Detect explicit denial
      if (Notification.permission === 'denied') {
        if (!cancelled) setPushState('denied');
        return;
      }
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (!cancelled) setPushState(sub ? 'subscribed' : 'unsubscribed');
      } catch {
        if (!cancelled) setPushState('unsupported');
      }
    };
    detect();
    return () => { cancelled = true; };
  }, [user?.id]);

  // Helper to convert base64url → Uint8Array (required by PushManager)
  const urlBase64ToUint8Array = (b64: string): Uint8Array => {
    const padding = '='.repeat((4 - b64.length % 4) % 4);
    const base64 = (b64 + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    const arr = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return arr;
  };

  const subscribePush = async () => {
    setPushMsg('');
    setPushState('busy');
    try {
      const vapidPublic = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!vapidPublic) {
        setPushMsg('Server not configured for push (no VAPID key).');
        setPushState('unsubscribed');
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setPushMsg(permission === 'denied' ? 'Notifications blocked by browser.' : 'Permission not granted.');
        setPushState(permission === 'denied' ? 'denied' : 'unsubscribed');
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublic),
      });
      // Extract keys
      const json: any = sub.toJSON();
      const p256dh = json.keys?.p256dh || '';
      const authK = json.keys?.auth || '';
      if (!p256dh || !authK) throw new Error('Subscription missing keys');

      const userId = user.role === 'zeus' ? 'zeus' : user.id;
      await savePushSubscription({
        userId,
        username: user.username || '',
        role: user.role,
        ownerId: workspaceId,
        endpoint: sub.endpoint,
        p256dh: p256dh,
        auth: authK,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
      });
      setPushState('subscribed');
      setPushMsg('');
      notify('Push notifications enabled on this device.', 'success');
    } catch (err: any) {
      console.error('[push subscribe]', err);
      setPushMsg(err?.message || 'Could not enable push notifications.');
      setPushState('unsubscribed');
    }
  };

  const unsubscribePush = async () => {
    setPushMsg('');
    setPushState('busy');
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        const endpoint = sub.endpoint;
        await sub.unsubscribe();
        await deletePushSubscription(endpoint);
      }
      setPushState('unsubscribed');
      notify('Push notifications disabled on this device.', 'success');
    } catch (err: any) {
      console.error('[push unsubscribe]', err);
      setPushMsg(err?.message || 'Could not disable push notifications.');
      setPushState('subscribed');
    }
  };

  // Click outside to close dropdown
  useEffect(() => {
    if (!open) return;
    const handler = (e: any) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Build the notifications list — newest items visible to this user, sorted desc by createdAt
  // v21.4: only types enabled in user prefs are included
  const items = useMemo(() => {
    const isAdmin = isAdminRole(user.role);
    const out: Array<{ id: string; type: 'notice' | 'backend' | 'games' | 'idpass'; title: string; subtitle: string; createdAt: number; isUpdate: boolean }> = [];

    // Helper: timestamp a row was last "touched" (updated or created)
    const touchedAt = (r: any) => Math.max(Number(r.updatedAt) || 0, Number(r.createdAt) || 0);
    const isUpdate = (r: any) => !!(r.updatedAt && r.updatedAt > (r.createdAt + 2000));

    // Notices visible to this user (only if Notice category is enabled)
    if (prefs.notice) {
      (notices || []).forEach((n: any) => {
        if (!isAdmin && !isVisibleToSub(n.recipients, user.id)) return;
        out.push({
          id: `notice:${n.id}`, type: 'notice',
          title: n.title || '(untitled notice)',
          subtitle: (n.body || '').slice(0, 70) + (((n.body || '').length > 70) ? '…' : ''),
          createdAt: touchedAt(n), isUpdate: isUpdate(n),
        });
      });
    }

    const collect = (arr: any[], type: 'backend' | 'games' | 'idpass', getLabel: (e: any) => string, getName: (e: any) => string) => {
      (arr || []).forEach((e: any) => {
        if (!isAdmin && !isVisibleToSub(e.assignees, user.id)) return;
        out.push({
          id: `${type}:${e.id}`, type,
          title: getName(e),
          subtitle: getLabel(e),
          createdAt: touchedAt(e), isUpdate: isUpdate(e),
        });
      });
    };
    if (prefs.backend) collect(backend, 'backend', () => '⚙️ System entry', (e) => e.gameName || '(unnamed)');
    if (prefs.games)   collect(games, 'games', () => '🎮 Game entry', (e) => e.gameName || '(unnamed)');
    if (prefs.idpass)  collect(idpass, 'idpass', (e: any) => e.section === 'accounts' ? '🔐 Account credential' : '🎮 Game credential', (e: any) => e.game || '(unnamed)');

    // Sort newest first
    out.sort((a, b) => b.createdAt - a.createdAt);
    return out;
  }, [user, notices, backend, games, idpass, prefs]);

  // Unread = touched after lastSeen. Capped to 50 to keep dropdown fast.
  const unreadItems = useMemo(() => items.filter(i => i.createdAt > lastSeen).slice(0, 50), [items, lastSeen]);
  const recentRead = useMemo(() => items.filter(i => i.createdAt <= lastSeen).slice(0, 10), [items, lastSeen]);
  const unreadCount = unreadItems.length;

  const markAllRead = () => {
    const now = Date.now();
    setLastSeen(now);
    try { localStorage.setItem(seenKey, String(now)); } catch {}
  };

  const handleClick = (item: any) => {
    onNavigate(item.type === 'backend' ? 'backend' : item.type === 'games' ? 'games' : item.type === 'idpass' ? 'idpass' : 'notice');
    setOpen(false);
    // Also mark as read so the user doesn't see the same badge after returning
    markAllRead();
  };

  const itemIcon = (t: string) => t === 'notice' ? '📢' : t === 'backend' ? '🔧' : t === 'games' ? '🎮' : '🔐';

  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button onClick={() => setOpen(!open)} type="button" className="infos-btn" title="Notifications"
        style={{ ...S.btn, padding: '6px 10px', display: 'flex', alignItems: 'center', gap: '4px', position: 'relative' }}>
        <span style={{ fontSize: '15px', lineHeight: 1 }}>🔔</span>
        {unreadCount > 0 && (
          <span style={{
            position: 'absolute', top: '-4px', right: '-4px',
            minWidth: '16px', height: '16px', padding: '0 4px',
            background: C.danger, color: 'white',
            borderRadius: '8px', fontSize: '10px', fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: `2px solid ${C.cardBg}`, lineHeight: 1,
          }}>
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>
      {open && (
        <div className="infos-dropdown infos-bell-dropdown" style={{
          // v25.1: Mobile-bulletproof anchor. On wide screens, anchors to bell
          // (right:0). On narrow screens, the CSS class overrides to position
          // fixed and span (almost) full viewport width to prevent off-screen.
          position: 'absolute', right: 0, top: 'calc(100% + 8px)',
          width: '320px', maxWidth: 'calc(100vw - 24px)',
          background: C.cardBg, border: `1px solid ${C.borderStrong}`,
          borderRadius: '12px', boxShadow: 'var(--shadow-pop)',
          zIndex: 1000, overflow: 'hidden',
          maxHeight: '70vh', display: 'flex', flexDirection: 'column',
        }}>
          {/* Header. v25.3: 'X' close button shows the dropdown is dismissable
              when displayed fullscreen on phone. On desktop it's still useful
              as an explicit close affordance. */}
          <div style={{ padding: '12px 14px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
            <div style={{ fontSize: '14px', fontWeight: 600 }}>Notifications</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              {unreadCount > 0 && (
                <button onClick={markAllRead} type="button"
                  style={{ background: 'transparent', border: 'none', color: C.accent, fontSize: '12px', fontWeight: 500, cursor: 'pointer', padding: '4px 6px', borderRadius: '4px' }}>
                  Mark all read
                </button>
              )}
              <button onClick={() => setShowPrefs((p) => !p)} type="button" title="Notification preferences" aria-label="Notification preferences"
                style={{ background: showPrefs ? C.accentSoft : 'transparent', border: 'none', color: C.textSecondary, fontSize: '14px', cursor: 'pointer', padding: '4px 6px', borderRadius: '4px' }}>
                ⚙
              </button>
              <button onClick={() => setOpen(false)} type="button" title="Close" aria-label="Close"
                style={{ background: 'transparent', border: 'none', color: C.textTertiary, fontSize: '20px', cursor: 'pointer', padding: '4px 8px', borderRadius: '4px', lineHeight: 1 }}>
                ×
              </button>
            </div>
          </div>

          {/* v21.4: Notification preferences panel — collapsible.
              v24.0: Push notifications toggle at the top. */}
          {showPrefs && (
            <div style={{ padding: '10px 14px 12px', borderBottom: `1px solid ${C.border}`, background: C.softBg }}>
              {/* v24.0: Web Push toggle */}
              <div style={{ marginBottom: '12px', paddingBottom: '12px', borderBottom: `1px solid ${C.border}` }}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: C.textTertiary, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>Push notifications</div>
                {pushState === 'unsupported' && (
                  <div style={{ fontSize: '12px', color: C.textTertiary, lineHeight: 1.5 }}>
                    Not supported on this device or app install. Web Push works on Chrome/Edge/Firefox and on installed PWAs (iOS 16.4+).
                  </div>
                )}
                {pushState === 'denied' && (
                  <div style={{ fontSize: '12px', color: C.danger, lineHeight: 1.5 }}>
                    Notifications blocked by your browser. Allow them in your browser settings to enable.
                  </div>
                )}
                {pushState === 'unsubscribed' && (
                  <div>
                    <div style={{ fontSize: '12.5px', color: C.textSecondary, marginBottom: '8px', lineHeight: 1.4 }}>
                      Get notified when something new is added — even when the app is closed.
                    </div>
                    <Btn primary onClick={subscribePush} style={{ fontSize: '12px', padding: '6px 12px' }}>Enable push notifications</Btn>
                  </div>
                )}
                {pushState === 'subscribed' && (
                  <div>
                    <div style={{ fontSize: '12.5px', color: C.success, marginBottom: '8px', lineHeight: 1.4, display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span>✓</span> <span>Push enabled on this device</span>
                    </div>
                    <Btn onClick={unsubscribePush} style={{ fontSize: '12px', padding: '6px 12px' }}>Disable</Btn>
                  </div>
                )}
                {pushState === 'busy' && (
                  <div style={{ fontSize: '12px', color: C.textTertiary }}>Working…</div>
                )}
                {pushMsg && <div style={{ fontSize: '11.5px', color: C.danger, marginTop: '8px' }}>{pushMsg}</div>}
              </div>

              {/* v24.3: Sound + browser notifications when app is OPEN.
                  These work without VAPID keys / Edge Functions because they
                  fire from the realtime data update inside the running app. */}
              <div style={{ marginBottom: '12px', paddingBottom: '12px', borderBottom: `1px solid ${C.border}` }}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: C.textTertiary, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>Sound &amp; alerts</div>

                {/* Sound toggle */}
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 0', fontSize: '13px', color: C.textPrimary, cursor: 'pointer' }}>
                  <input type="checkbox" checked={soundEnabled} onChange={(e) => {
                    const v = e.target.checked;
                    setSoundEnabled(v);
                    try { localStorage.setItem('infos:sound_enabled', v ? 'on' : 'off'); } catch {}
                    if (v) { try { playChime(); } catch {} }   // preview
                  }}
                    style={{ width: '15px', height: '15px', accentColor: C.accent, cursor: 'pointer' }} />
                  <span>🔔 Play sound on new items</span>
                </label>

                {/* Browser notification permission button */}
                <div style={{ marginTop: '8px' }}>
                  {browserNotifState === 'unsupported' && (
                    <div style={{ fontSize: '12px', color: C.textTertiary, lineHeight: 1.5 }}>
                      Browser notifications not supported here.
                    </div>
                  )}
                  {browserNotifState === 'denied' && (
                    <div style={{ fontSize: '12px', color: C.danger, lineHeight: 1.5 }}>
                      Notifications blocked. Allow them in your browser settings.
                    </div>
                  )}
                  {browserNotifState === 'default' && (
                    <Btn primary onClick={async () => {
                      const result = await requestNotificationPermission();
                      setBrowserNotifState(result === 'default' ? 'default' : result);
                    }} style={{ fontSize: '12px', padding: '6px 12px' }}>
                      Allow browser notifications
                    </Btn>
                  )}
                  {browserNotifState === 'granted' && (
                    <div style={{ fontSize: '12.5px', color: C.success, lineHeight: 1.4, display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span>✓</span> <span>Browser notifications enabled</span>
                    </div>
                  )}
                </div>

                <div style={{ fontSize: '11px', color: C.textTertiary, marginTop: '8px', lineHeight: 1.4 }}>
                  These fire only while the app is open in a tab.
                </div>
              </div>

              <div style={{ fontSize: '11px', fontWeight: 700, color: C.textTertiary, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>In-app notifications</div>
              {[
                { key: 'notice' as const, label: '📢 Notices' },
                { key: 'backend' as const, label: '⚙️ System entries' },
                { key: 'games' as const, label: '🎮 Game entries' },
                { key: 'idpass' as const, label: '🔐 Id & Pass entries' },
              ].map(({ key, label }) => (
                <label key={key} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 0', fontSize: '13px', color: C.textPrimary, cursor: 'pointer' }}>
                  <input type="checkbox" checked={prefs[key]} onChange={(e) => updatePref(key, e.target.checked)}
                    style={{ width: '15px', height: '15px', accentColor: C.accent, cursor: 'pointer' }} />
                  <span>{label}</span>
                </label>
              ))}
              <div style={{ fontSize: '11px', color: C.textTertiary, marginTop: '6px', lineHeight: 1.4 }}>
                Settings saved on this device. Other devices keep their own preferences.
              </div>
            </div>
          )}

          {/* Scrollable list */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {unreadCount === 0 && recentRead.length === 0 ? (
              <div style={{ padding: '32px 16px', textAlign: 'center', fontSize: '13px', color: C.textTertiary }}>
                No notifications yet. New items will appear here.
              </div>
            ) : (
              <>
                {unreadItems.length > 0 && (
                  <>
                    <div style={{ fontSize: '10.5px', fontWeight: 700, color: C.textTertiary, textTransform: 'uppercase', letterSpacing: '0.05em', padding: '10px 14px 6px' }}>
                      Unread ({unreadCount})
                    </div>
                    {unreadItems.map((item) => (
                      <button key={item.id} onClick={() => handleClick(item)} type="button"
                        style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px', border: 'none', borderBottom: `1px solid ${C.border}`, background: C.accentSoft, cursor: 'pointer', color: C.textPrimary }}
                        onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = C.softBg)}
                        onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = C.accentSoft)}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                          <span style={{ fontSize: '15px', flexShrink: 0, marginTop: '1px' }}>{itemIcon(item.type)}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {item.isUpdate ? '✎ ' : ''}{item.title}
                            </div>
                            <div style={{ fontSize: '11.5px', color: C.textTertiary }}>
                              {item.subtitle} · {timeAgo(item.createdAt)}
                            </div>
                          </div>
                        </div>
                      </button>
                    ))}
                  </>
                )}
                {recentRead.length > 0 && (
                  <>
                    <div style={{ fontSize: '10.5px', fontWeight: 700, color: C.textTertiary, textTransform: 'uppercase', letterSpacing: '0.05em', padding: '10px 14px 6px' }}>
                      Earlier
                    </div>
                    {recentRead.map((item) => (
                      <button key={item.id} onClick={() => handleClick(item)} type="button"
                        style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px', border: 'none', borderBottom: `1px solid ${C.border}`, background: 'transparent', cursor: 'pointer', color: C.textSecondary }}
                        onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = C.softBg)}
                        onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = 'transparent')}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                          <span style={{ fontSize: '15px', flexShrink: 0, marginTop: '1px', opacity: 0.7 }}>{itemIcon(item.type)}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: '13px', fontWeight: 500, marginBottom: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {item.title}
                            </div>
                            <div style={{ fontSize: '11.5px', color: C.textTertiary }}>
                              {item.subtitle} · {timeAgo(item.createdAt)}
                            </div>
                          </div>
                        </div>
                      </button>
                    ))}
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------- Account switcher (with About, Settings, Appearance) ----------------
function AccountSwitcher({ accounts, activeKey, user, onSwitch, onAddAccount, onSignOut, onSignOutAll, onOpenAbout, onOpenSettings, onOpenGuide, onOpenSearch, onOpenWhatChanged, onOpenDevices, theme, setTheme }: any) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const handler = (e: any) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);
  const active = accounts.find((a: any) => accKey(a) === activeKey);
  if (!active) return null;
  const avatarBg = (u: any) => u.role === 'zeus' ? C.accent : u.role === 'co' ? '#e17b4a' : '#888780';
  const roleLabel = (u: any) => u.role === 'zeus' ? 'Main admin' : u.role === 'co' ? 'Co-admin' : 'Sub-admin';
  // v22.0: Avatar shows profile picture if set, otherwise the colored initial.
  const avatar = (u: any, size = 28) => {
    if (u.profilePicUrl) {
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={u.profilePicUrl}
          alt=""
          style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, border: `1px solid ${C.border}` }}
        />
      );
    }
    return (
      <span style={{ width: size, height: size, borderRadius: '50%', background: avatarBg(u), color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size >= 28 ? '12px' : '10.5px', fontWeight: 600, flexShrink: 0 }}>
        {u.username.charAt(0).toUpperCase()}
      </span>
    );
  };

  const showSettings = isAdminRole(user.role);

  const menuBtnStyle = { width: 'calc(100% - 8px)', margin: '0 4px', textAlign: 'left' as const, padding: '9px 12px', fontSize: '13px', background: 'transparent', border: 'none', cursor: 'pointer', color: C.textPrimary, borderRadius: '8px', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '8px' };

  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button onClick={() => setOpen(!open)} className="infos-btn" style={{ ...S.btn, display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 10px 6px 6px' }}>
        {avatar(active, 26)}
        <span style={{ fontSize: '13px', fontWeight: 500 }}>{active.username}</span>
        <span style={{ fontSize: '10px', color: C.textTertiary, marginLeft: '-2px' }}>▾</span>
      </button>
      {open && (
        <div className="infos-dropdown infos-user-dropdown" style={{ position: 'absolute', right: 0, top: 'calc(100% + 8px)', minWidth: '280px', maxWidth: 'calc(100vw - 24px)', background: C.cardBg, border: `1px solid ${C.borderStrong}`, borderRadius: '12px', boxShadow: 'var(--shadow-pop)', zIndex: 1000, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {/* v25.4: Header bar with close button. On phone the dropdown is
              fullscreen, so the close button is essential. On desktop it's
              still a useful explicit close affordance. */}
          <div style={{ padding: '12px 14px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
            <div style={{ fontSize: '14px', fontWeight: 600 }}>Account</div>
            <button onClick={() => setOpen(false)} type="button" title="Close" aria-label="Close"
              style={{ background: 'transparent', border: 'none', color: C.textTertiary, fontSize: '20px', cursor: 'pointer', padding: '4px 8px', borderRadius: '4px', lineHeight: 1 }}>
              ×
            </button>
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
          {/* 1. About Us / User Guide / Settings — v22.0: Search moved to main page above tabs */}
          <div style={{ padding: '6px 4px', borderBottom: `1px solid ${C.border}` }}>
            <button onClick={() => { onOpenAbout(); setOpen(false); }} style={menuBtnStyle}
              onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = C.softBg)}
              onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = 'transparent')}>
              <span>ℹ️</span> <span>About Us</span>
            </button>
            <button onClick={() => { onOpenGuide(); setOpen(false); }} style={menuBtnStyle}
              onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = C.softBg)}
              onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = 'transparent')}>
              <span>📖</span> <span>User Guide</span>
            </button>
            {/* v22.1: What changed this week */}
            <button onClick={() => { onOpenWhatChanged && onOpenWhatChanged(); setOpen(false); }} style={menuBtnStyle}
              onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = C.softBg)}
              onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = 'transparent')}>
              <span>📅</span> <span>What changed this week</span>
            </button>
            {/* v24.2: Devices & sessions removed from user menu — accessible only via Settings */}
            {showSettings && (
              <button onClick={() => { onOpenSettings(); setOpen(false); }} style={menuBtnStyle}
                onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = C.softBg)}
                onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = 'transparent')}>
                <span>⚙️</span> <span>Settings</span>
              </button>
            )}
          </div>

          {/* 2. Appearance */}
          <div style={{ padding: '8px 8px 4px', borderBottom: `1px solid ${C.border}` }}>
            <div style={{ fontSize: '10.5px', color: C.textTertiary, padding: '4px 10px 6px', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>Appearance</div>
            <div style={{ display: 'flex', gap: '4px', padding: '0 4px 4px' }}>
              {(['system', 'light', 'dark'] as Theme[]).map((t) => (
                <button key={t} onClick={() => setTheme(t)}
                  style={{
                    flex: 1, padding: '6px 8px', fontSize: '12px', border: `1px solid ${theme === t ? C.accent : C.border}`,
                    background: theme === t ? C.accentSoft : 'transparent', color: theme === t ? C.accentText : C.textSecondary,
                    borderRadius: '6px', cursor: 'pointer', fontWeight: theme === t ? 600 : 500, textTransform: 'capitalize',
                  }}>
                  {t === 'system' ? 'Auto' : t}
                </button>
              ))}
            </div>
          </div>

          {/* 3. Signed-in accounts */}
          <div style={{ padding: '6px 4px', borderBottom: `1px solid ${C.border}` }}>
            <div style={{ fontSize: '10.5px', color: C.textTertiary, padding: '8px 14px 6px', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>Signed in</div>
            {accounts.map((a: any) => {
              const isActive = accKey(a) === activeKey;
              return (
                <div key={accKey(a)}
                  style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 12px', cursor: isActive ? 'default' : 'pointer', background: isActive ? C.accentSoft : C.cardBg, margin: '0 4px', borderRadius: '8px' }}
                  onMouseEnter={(e) => { if (!isActive) (e.currentTarget as HTMLDivElement).style.background = C.softBg; }}
                  onMouseLeave={(e) => { if (!isActive) (e.currentTarget as HTMLDivElement).style.background = C.cardBg; }}>
                  <div onClick={() => { if (!isActive) onSwitch(accKey(a)); setOpen(false); }} style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, minWidth: 0 }}>
                    {avatar(a, 30)}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '13.5px', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: isActive ? C.accentText : C.textPrimary }}>{a.username}</div>
                      <div style={{ fontSize: '11px', color: C.textTertiary, marginTop: '1px', fontWeight: 500 }}>{roleLabel(a)}</div>
                    </div>
                    {isActive && <span style={{ fontSize: '11px', color: C.accent, fontWeight: 600 }}>●</span>}
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); onSignOut(accKey(a)); setOpen(false); }} title="Sign out" style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px 8px', fontSize: '16px', color: C.textTertiary, lineHeight: 1, borderRadius: '4px' }}>×</button>
                </div>
              );
            })}
          </div>

          {/* 4. Add / sign out */}
          <div style={{ padding: '6px 4px', background: C.cardBg }}>
            <button onClick={() => { onAddAccount(); setOpen(false); }} style={menuBtnStyle}
              onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = C.softBg)}
              onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = 'transparent')}>+ Add another account</button>
            <button onClick={() => { onSignOutAll(); setOpen(false); }} style={{ ...menuBtnStyle, color: C.danger }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = C.dangerSoft)}
              onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = 'transparent')}>Sign out of all accounts</button>
          </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AssigneePicker({ subs, selected, onChange }: any) {
  // Only sub-admins (not co-admins) get assignments for content visibility
  const subOnly = subs.filter((s: any) => s.role !== 'co');
  if (subOnly.length === 0) {
    return <div style={{ fontSize: '12.5px', color: 'var(--warn-text)', padding: '10px 12px', background: 'var(--warn-soft)', borderRadius: '8px', border: '1px solid var(--warn-border)' }}>No sub-admins exist yet. Create some in the Create Admin tab first.</div>;
  }
  const allOn = selected.includes(ALL_SENTINEL);
  const toggleAll = () => { if (allOn) onChange([]); else onChange([ALL_SENTINEL]); };
  const toggleOne = (id: string) => {
    if (allOn) return;
    if (selected.includes(id)) onChange(selected.filter((x: string) => x !== id));
    else onChange([...selected, id]);
  };
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
      <button type="button" onClick={toggleAll} className="infos-pill"
        style={{ padding: '5px 12px', fontSize: '12.5px', border: allOn ? `1px solid ${C.accent}` : `1px solid ${C.borderStrong}`, borderRadius: '16px', background: allOn ? C.accent : C.cardBg, color: allOn ? 'white' : C.textPrimary, cursor: 'pointer', fontWeight: 600, transition: 'all 0.15s' }}>
        {allOn ? '✓ All sub-admins' : '◎ Assign to all'}
      </button>
      {subOnly.map((s: any) => {
        const on = !allOn && selected.includes(s.id);
        const disabled = allOn;
        return (
          <button key={s.id} type="button" onClick={() => toggleOne(s.id)} disabled={disabled} className="infos-pill"
            style={{ padding: '5px 12px', fontSize: '12.5px', border: on ? `1px solid ${C.accent}` : `1px solid ${C.borderStrong}`, borderRadius: '16px', background: on ? C.accent : C.cardBg, color: on ? 'white' : C.textPrimary, cursor: disabled ? 'not-allowed' : 'pointer', fontWeight: on ? 600 : 500, transition: 'all 0.15s', opacity: disabled ? 0.45 : 1 }}>
            {s.username}
          </button>
        );
      })}
    </div>
  );
}

function AssigneeList({ assignees, subs }: any) {
  if (isAssignedAll(assignees)) return <div style={{ marginTop: '8px' }}><span style={S.allPill}>All sub-admins</span></div>;
  const names = (assignees || []).filter((id: string) => id !== ALL_SENTINEL).map((id: string) => subs.find((s: any) => s.id === id)?.username).filter(Boolean);
  if (names.length === 0) return <span style={{ fontSize: '11px', color: C.textTertiary, fontStyle: 'italic', marginTop: '6px', display: 'inline-block' }}>no assignees</span>;
  return <div style={{ marginTop: '8px' }}>{names.map((n: string, i: number) => <span key={i} style={S.assigneePill}>{n}</span>)}</div>;
}

function ReorderHint({ canReorder }: any) {
  if (!canReorder) return null;
  return <div style={{ fontSize: '12px', color: C.textTertiary, marginBottom: '10px', fontWeight: 500 }}>Use ▲/▼ buttons or drag ⋮⋮ to reorder.</div>;
}

function SelectionToolbar({ isAdmin, inSelectMode, onEnter, onExit, selectedCount, onBulkDelete, onSelectAll, onDeselectAll, totalVisible }: any) {
  if (!isAdmin) return null;
  if (!inSelectMode) {
    return (
      <div style={{ marginBottom: '10px' }}>
        <button onClick={onEnter} className="infos-btn" style={{ ...S.btn, fontSize: '12.5px', padding: '6px 12px' }}>☐ Select multiple</button>
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', padding: '10px 12px', background: C.accentSoft, border: `1px solid ${C.accent}`, borderRadius: '8px', marginBottom: '10px' }}>
      <span style={{ fontSize: '13px', fontWeight: 600, color: C.accentText }}>{selectedCount} selected</span>
      <button onClick={onSelectAll} className="infos-btn" style={{ ...S.btn, fontSize: '11.5px', padding: '4px 10px' }}>Select all ({totalVisible})</button>
      {selectedCount > 0 && <button onClick={onDeselectAll} className="infos-btn" style={{ ...S.btn, fontSize: '11.5px', padding: '4px 10px' }}>Deselect</button>}
      <div style={{ flex: 1 }} />
      {selectedCount > 0 && (
        <button onClick={onBulkDelete} style={{ ...S.btnDanger, fontSize: '12px', padding: '6px 12px', fontWeight: 600 }}>Delete {selectedCount}</button>
      )}
      <button onClick={onExit} className="infos-btn" style={{ ...S.btn, fontSize: '11.5px', padding: '4px 10px' }}>Done</button>
    </div>
  );
}

function EntryForm({ fields, subs, onSubmit, submitLabel = 'Add' }: any) {
  const init = () => ({ ...Object.fromEntries(fields.map((f: any) => [f.key, ''])), description: '', assignees: [] as string[] });
  const [v, setV] = useState<any>(init);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  // v25.5: Honor field.optional flag for shortName and similar non-essential fields.
  // Only fields without optional=true must be filled.
  const handle = async () => {
    setErr('');
    const requiredFields = fields.filter((f: any) => !f.optional);
    if (requiredFields.some((f: any) => !v[f.key].trim())) {
      setErr('Please fill in all required fields');
      return;
    }
    if (v.assignees.length === 0) { setErr('Assign to at least one sub-admin or "Assign to all"'); return; }
    setBusy(true);
    try { await onSubmit(v); setV(init()); }
    catch (e: any) { setErr(friendlyError(e)); }
    finally { setBusy(false); }
  };
  return (
    <div style={{ ...S.softCard, marginBottom: '1.25rem' }}>
      <div className="infos-grid3" style={S.grid3}>
        {fields.map((f: any) => (
          <div key={f.key}>
            <label style={S.label}>{f.label}{f.optional && <span style={{ fontWeight: 400, color: C.textTertiary, marginLeft: '4px' }}>(optional)</span>}</label>
            <TextInput value={v[f.key]} onChange={(e: any) => setV({ ...v, [f.key]: e.target.value })} placeholder={f.placeholder || f.label} />
          </div>
        ))}
      </div>
      <div style={{ marginTop: '12px' }}>
        <label style={S.label}>Description / note (optional)</label>
        <TextArea value={v.description} onChange={(e: any) => setV({ ...v, description: e.target.value })} placeholder="Shown to assigned sub-admins along with this entry" />
      </div>
      <div style={{ marginTop: '12px' }}>
        <label style={S.label}>Assign to sub-admin(s)</label>
        <AssigneePicker subs={subs} selected={v.assignees} onChange={(a: any) => setV({ ...v, assignees: a })} />
      </div>
      {err && <div style={{ fontSize: '13px', color: C.danger, marginTop: '10px', padding: '8px 12px', background: C.dangerSoft, borderRadius: '6px', fontWeight: 500 }}>{err}</div>}
      <div style={{ marginTop: '14px', textAlign: 'right' }}>
        <Btn primary onClick={handle} disabled={busy} style={{ opacity: busy ? 0.7 : 1 }}>{busy ? 'Saving…' : submitLabel}</Btn>
      </div>
    </div>
  );
}

function IdPassEntryForm({ subs, onSubmit, section = 'games' }: any) {
  const init = () => ({ game: '', shortName: '', username: '', password: '', description: '', assignees: [] as string[] });
  const [v, setV] = useState<any>(init);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [showPass, setShowPass] = useState(false);
  const isAccounts = section === 'accounts';
  const primaryLabel = isAccounts ? 'Account' : 'Game';
  const primaryPlaceholder = isAccounts ? 'e.g. Facebook, Gmail, VPN, Oslink' : 'Game name';
  const shortPlaceholder = isAccounts ? 'e.g. FB, GM' : 'e.g. LoL';
  const handle = async () => {
    setErr('');
    if (!v.game.trim() || !v.username.trim() || !v.password.trim()) { setErr(`${primaryLabel}, username, and password are required`); return; }
    if (v.assignees.length === 0) { setErr('Assign to at least one sub-admin or "Assign to all"'); return; }
    setBusy(true);
    try { await onSubmit(v); setV(init()); setShowPass(false); }
    catch (e: any) { setErr(friendlyError(e)); }
    finally { setBusy(false); }
  };
  return (
    <div style={{ ...S.softCard, marginBottom: '1.25rem' }}>
      <div className="infos-grid2" style={S.grid2}>
        <div><label style={S.label}>{primaryLabel}</label><TextInput value={v.game} onChange={(e: any) => setV({ ...v, game: e.target.value })} placeholder={primaryPlaceholder} /></div>
        <div><label style={S.label}>Short name (optional)</label><TextInput value={v.shortName} onChange={(e: any) => setV({ ...v, shortName: e.target.value })} placeholder={shortPlaceholder} /></div>
      </div>
      <div className="infos-grid2" style={{ ...S.grid2, marginTop: '10px' }}>
        <div><label style={S.label}>Username</label><TextInput value={v.username} onChange={(e: any) => setV({ ...v, username: e.target.value })} placeholder={isAccounts ? 'Username or email' : 'Login username'} /></div>
        <div>
          <label style={S.label}>Password</label>
          <div style={{ position: 'relative' }}>
            <TextInput type={showPass ? 'text' : 'password'} value={v.password} onChange={(e: any) => setV({ ...v, password: e.target.value })} placeholder="Login password" style={{ paddingRight: '60px' }} />
            <button type="button" onClick={() => setShowPass(!showPass)}
              style={{ position: 'absolute', right: '6px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', fontSize: '11.5px', color: C.textSecondary, cursor: 'pointer', padding: '4px 8px', fontWeight: 500 }}>
              {showPass ? 'Hide' : 'Show'}
            </button>
          </div>
        </div>
      </div>
      <div style={{ marginTop: '12px' }}>
        <label style={S.label}>Description / note (optional)</label>
        <TextArea value={v.description} onChange={(e: any) => setV({ ...v, description: e.target.value })} placeholder="Shown to assigned sub-admins along with this entry" />
      </div>
      <div style={{ marginTop: '12px' }}>
        <label style={S.label}>Assign to sub-admin(s)</label>
        <AssigneePicker subs={subs} selected={v.assignees} onChange={(a: any) => setV({ ...v, assignees: a })} />
      </div>
      {err && <div style={{ fontSize: '13px', color: C.danger, marginTop: '10px', padding: '8px 12px', background: C.dangerSoft, borderRadius: '6px', fontWeight: 500 }}>{err}</div>}
      <div style={{ marginTop: '14px', textAlign: 'right' }}>
        <Btn primary onClick={handle} disabled={busy} style={{ opacity: busy ? 0.7 : 1 }}>{busy ? 'Saving…' : 'Add'}</Btn>
      </div>
    </div>
  );
}

function NoticeEntryForm({ subs, onSubmit }: any) {
  const init = () => ({ title: '', body: '', link: '', assignees: [] as string[] });
  const [v, setV] = useState<any>(init);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const handle = async () => {
    setErr('');
    if (!v.title.trim() || !v.body.trim()) return setErr('Title and message are required');
    if (v.assignees.length === 0) return setErr('Pick at least one recipient');
    setBusy(true);
    try { await onSubmit(v); setV(init()); }
    catch (e: any) { setErr(friendlyError(e)); }
    finally { setBusy(false); }
  };
  return (
    <div style={{ ...S.softCard, marginBottom: '1.25rem' }}>
      <div style={{ marginBottom: '12px' }}>
        <label style={S.label}>Title</label>
        <TextInput value={v.title} onChange={(e: any) => setV({ ...v, title: e.target.value })} placeholder="Notice title" />
      </div>
      <div style={{ marginBottom: '12px' }}>
        <label style={S.label}>Message</label>
        <TextArea value={v.body} onChange={(e: any) => setV({ ...v, body: e.target.value })} placeholder="What do you want to notify?" />
      </div>
      <div style={{ marginBottom: '12px' }}>
        <label style={S.label}>Link (optional)</label>
        <TextInput value={v.link} onChange={(e: any) => setV({ ...v, link: e.target.value })} placeholder="https://..." />
      </div>
      <div style={{ marginBottom: '12px' }}>
        <label style={S.label}>Post to</label>
        <AssigneePicker subs={subs} selected={v.assignees} onChange={(a: any) => setV({ ...v, assignees: a })} />
      </div>
      {err && <div style={{ fontSize: '13px', color: C.danger, marginBottom: '10px', padding: '8px 12px', background: C.dangerSoft, borderRadius: '6px', fontWeight: 500 }}>{err}</div>}
      <div style={{ textAlign: 'right' }}><Btn primary onClick={handle} disabled={busy} style={{ opacity: busy ? 0.7 : 1 }}>{busy ? 'Posting…' : 'Post notice'}</Btn></div>
    </div>
  );
}

// ---------------- Tab: Game list (Backend / Games) ----------------
function GameListTabInner({ table, user, subs, entries, setEntries, reload, emptyMsg }: any) {
  const isAdmin = isAdminRole(user.role);
  const [confirmEl, confirm] = useConfirm();
  const [q, setQ] = useState('');
  const [filterSub, setFilterSub] = useState<'all' | string>('all');
  const [editing, setEditing] = useState<any>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);

  const visible = useMemo(() => {
    let base = isAdmin ? entries : entries.filter((e: any) => isVisibleToSub(e.assignees, user.id));
    if (isAdmin && filterSub !== 'all') {
      base = base.filter((e: any) => isVisibleToSub(e.assignees, filterSub));
    }
    if (!q.trim()) return base;
    const s = q.toLowerCase();
    return base.filter((e: any) =>
      (e.gameName || '').toLowerCase().includes(s) ||
      (e.shortName || '').toLowerCase().includes(s) ||
      (e.link || '').toLowerCase().includes(s) ||
      (e.description || '').toLowerCase().includes(s)
    );
  }, [isAdmin, entries, user, q, filterSub]);
  const nextSortOrder = useMemo(() => (entries.length ? Math.max(...entries.map((e: any) => e.sortOrder || 0)) + 1 : 0), [entries]);
  const subOnlyForFilter = useMemo(() => subs.filter((s: any) => s.role !== 'co'), [subs]);

  // OPTIMISTIC UPDATES — UI changes instantly, DB saves in background.
  // On failure we apply the INVERSE operation (rather than restoring a stale snapshot)
  // so concurrent edits made during the request aren't lost.
  const add = async (vals: any) => {
    const newEntry = {
      ...vals,
      gameName: (vals.gameName || '').trim(),
      shortName: (vals.shortName || '').trim(),
      link: (vals.link || '').trim(),
      description: (vals.description || '').trim(),
      id: uid(),
      createdAt: Date.now(),
      sortOrder: nextSortOrder,
      ownerId: user.ownerId || 'zeus',
    };
    setEntries((prev: any[]) => [...prev, newEntry]);
    try { await addGameEntry(table, newEntry); }
    catch (e: any) { setEntries((prev: any[]) => prev.filter(x => x.id !== newEntry.id)); throw e; }
  };
  const del = async (e: any) => {
    const ok = await confirm({ title: `Delete "${e.gameName}"?`, message: 'This cannot be undone.', confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    // Remember the item we're deleting so we can re-insert on failure
    const deletedItem = e;
    setEntries((prev: any[]) => prev.filter(x => x.id !== e.id));
    try { await deleteGameEntry(table, e.id); }
    catch (err: any) {
      // Re-insert preserving position if possible
      setEntries((prev: any[]) => [...prev, deletedItem].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)));
      notify(friendlyError(err));
    }
  };
  const saveEdit = async (patch: any) => {
    const id = editing.id;
    // Capture the prior state of JUST this one item
    const originalItem = entries.find((x: any) => x.id === id);
    setEntries((prev: any[]) => prev.map((x: any) => x.id === id ? { ...x, ...patch, updatedAt: Date.now() } : x));
    try { await updateGameEntry(table, id, patch); }
    catch (e: any) {
      if (originalItem) setEntries((prev: any[]) => prev.map((x: any) => x.id === id ? originalItem : x));
      throw e;
    }
  };
  const reorder = async (no: any[]) => {
    // Capture only the original sort order of items being reordered
    const originalOrder = no.map((e: any) => {
      const orig = entries.find((x: any) => x.id === e.id);
      return orig ? { id: orig.id, sortOrder: orig.sortOrder } : null;
    }).filter(Boolean) as { id: string; sortOrder: number }[];

    const reordered = no.map((e: any, i: number) => ({ ...e, sortOrder: i }));
    const keptIds = new Set(reordered.map((e: any) => e.id));
    setEntries((prev: any[]) => [...reordered, ...prev.filter((e: any) => !keptIds.has(e.id))]);
    try { await reorderGames(table, no.map((e: any) => e.id)); }
    catch (err: any) {
      // Restore original sort orders
      setEntries((prev: any[]) => prev.map((x: any) => {
        const o = originalOrder.find(r => r.id === x.id);
        return o ? { ...x, sortOrder: o.sortOrder } : x;
      }).sort((a: any, b: any) => (a.sortOrder || 0) - (b.sortOrder || 0)));
      notify(friendlyError(err));
    }
  };
  const bulkDelete = async () => {
    const ok = await confirm({ title: `Delete ${selected.length} entries?`, message: 'This cannot be undone.', confirmLabel: `Delete ${selected.length}`, danger: true });
    if (!ok) return;
    // Remember the items we're deleting so we can re-insert on failure
    const toDelete = [...selected];
    const deletedItems = entries.filter((x: any) => toDelete.includes(x.id));
    setEntries((prev: any[]) => prev.filter(x => !toDelete.includes(x.id)));
    setSelected([]); setSelectMode(false);
    try { await bulkDeleteGameEntries(table, toDelete); }
    catch (err: any) {
      setEntries((prev: any[]) => [...prev, ...deletedItems].sort((a: any, b: any) => (a.sortOrder || 0) - (b.sortOrder || 0)));
      notify(friendlyError(err));
    }
  };
  const toggleSelect = (id: string) => setSelected(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id]);

  const renderItem = (e: any, idx: number) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: '15px', letterSpacing: '-0.01em', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '11px', padding: '2px 8px', background: C.softBg, color: C.textSecondary, borderRadius: '10px', fontWeight: 700, letterSpacing: '0.02em', flexShrink: 0 }}>#{idx + 1}</span>
          <span>{e.gameName}{e.shortName && <span style={S.badge}>{e.shortName}</span>}</span>
        </div>
        <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <a href={e.link} target="_blank" rel="noopener noreferrer" style={S.linkPill}>{e.link}</a>
          <CopyButton value={e.link} label="link" />
        </div>
        {e.description && <div style={S.descBox}>{e.description}</div>}
        <AssigneeList assignees={e.assignees || []} subs={subs} />
        <Timestamp createdAt={e.createdAt} updatedAt={e.updatedAt} />
      </div>
      {isAdmin && !selectMode && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <Btn onClick={() => setEditing(e)} style={{ fontSize: '12px', padding: '5px 10px' }}>Edit</Btn>
          <Btn danger onClick={() => del(e)}>Delete</Btn>
        </div>
      )}
    </div>
  );
  const canReorder = isAdmin && !q.trim() && filterSub === 'all' && !selectMode;
  return (
    <div>
      {confirmEl}
      <EditGameModal open={!!editing} entry={editing} subs={subs} onClose={() => setEditing(null)} onSave={saveEdit} />
      {isAdmin && <EntryForm fields={[{ key: 'gameName', label: 'Game name' }, { key: 'shortName', label: 'Short name', optional: true }, { key: 'link', label: 'Link', placeholder: 'https://...' }]} subs={subs} onSubmit={add} />}
      {entries.length > 0 && <SearchBar value={q} onChange={setQ} placeholder="Search games, links, descriptions…" />}
      {isAdmin && subOnlyForFilter.length > 0 && entries.length > 0 && (
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '1rem', alignItems: 'center' }}>
          <span style={{ fontSize: '12px', color: C.textTertiary, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginRight: '2px' }}>Filter:</span>
          <button onClick={() => setFilterSub('all')} className="infos-pill"
            style={{ padding: '5px 12px', fontSize: '12.5px', border: filterSub === 'all' ? `1px solid ${C.accent}` : `1px solid ${C.borderStrong}`, borderRadius: '16px', background: filterSub === 'all' ? C.accent : C.cardBg, color: filterSub === 'all' ? 'white' : C.textPrimary, cursor: 'pointer', fontWeight: filterSub === 'all' ? 600 : 500 }}>All</button>
          {subOnlyForFilter.map((s: any) => {
            const on = filterSub === s.id;
            return (
              <button key={s.id} onClick={() => setFilterSub(s.id)} className="infos-pill"
                style={{ padding: '5px 12px', fontSize: '12.5px', border: on ? `1px solid ${C.accent}` : `1px solid ${C.borderStrong}`, borderRadius: '16px', background: on ? C.accent : C.cardBg, color: on ? 'white' : C.textPrimary, cursor: 'pointer', fontWeight: on ? 600 : 500 }}>{s.username}</button>
            );
          })}
        </div>
      )}
      <SelectionToolbar isAdmin={isAdmin} inSelectMode={selectMode}
        onEnter={() => setSelectMode(true)} onExit={() => { setSelectMode(false); setSelected([]); }}
        selectedCount={selected.length} onBulkDelete={bulkDelete}
        onSelectAll={() => setSelected(visible.map((e: any) => e.id))}
        onDeselectAll={() => setSelected([])} totalVisible={visible.length} />
      {visible.length === 0 ? (
        q.trim() || filterSub !== 'all'
          ? <EmptyState icon="🔍" title="No matches found" hint="Try a different search term or clear the filter." />
          : <EmptyState icon="📦" title={emptyMsg} hint={isAdmin ? 'Tap + Add at the top to create your first entry.' : 'Your admin hasn\'t assigned anything to you yet.'} />
      ) : (
        <div>
          <div style={{ fontSize: '12px', color: C.textTertiary, marginBottom: '8px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {visible.length} {visible.length === 1 ? 'entry' : 'entries'}{filterSub !== 'all' && ` (filtered)`}
          </div>
          <ReorderHint canReorder={canReorder} />
          <ReorderList items={visible} canReorder={canReorder}
            canSelect={selectMode} selectedIds={selected} onToggleSelect={toggleSelect}
            onReorder={reorder} renderItem={renderItem} keyFn={(e: any) => e.id} />
        </div>
      )}
    </div>
  );
}
const GameListTab = memo(GameListTabInner);

// ---------------- Tab: Id & Pass ----------------
function IdPassTabInner({ user, subs, entries, setEntries, reload }: any) {
  const isAdmin = isAdminRole(user.role);
  const [confirmEl, confirm] = useConfirm();
  const [reveal, setReveal] = useState<any>({});
  const [q, setQ] = useState('');
  const [filterSub, setFilterSub] = useState<'all' | string>('all');
  const [section, setSection] = useState<'games' | 'accounts'>('games');
  const [editing, setEditing] = useState<any>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);

  // Reset selection / filters when switching sections to avoid cross-section state bleed
  useEffect(() => {
    setSelected([]);
    setSelectMode(false);
    setFilterSub('all');
    setQ('');
  }, [section]);

  // Counts per section (used for sub-tab pill labels) — based on what THIS user can see,
  // independent of filter/search. We compute against the user-visible base, not the
  // current filtered visible list, so the counts on tabs stay stable.
  const userVisibleAll = useMemo(() => {
    return isAdmin ? entries : entries.filter((e: any) => isVisibleToSub(e.assignees, user.id));
  }, [isAdmin, entries, user]);
  const gamesCount = useMemo(() => userVisibleAll.filter((e: any) => (e.section || 'games') === 'games').length, [userVisibleAll]);
  const accountsCount = useMemo(() => userVisibleAll.filter((e: any) => (e.section || 'games') === 'accounts').length, [userVisibleAll]);

  const visible = useMemo(() => {
    let base = isAdmin ? entries : entries.filter((e: any) => isVisibleToSub(e.assignees, user.id));
    // Section split — entries default to 'games' for legacy data
    base = base.filter((e: any) => (e.section || 'games') === section);
    if (isAdmin && filterSub !== 'all') {
      base = base.filter((e: any) => isVisibleToSub(e.assignees, filterSub));
    }
    if (!q.trim()) return base;
    const s = q.toLowerCase();
    return base.filter((e: any) =>
      (e.game || '').toLowerCase().includes(s) ||
      (e.shortName || '').toLowerCase().includes(s) ||
      (e.username || '').toLowerCase().includes(s) ||
      (e.description || '').toLowerCase().includes(s)
    );
  }, [isAdmin, entries, user, q, filterSub, section]);
  const nextSortOrder = useMemo(() => (entries.length ? Math.max(...entries.map((e: any) => e.sortOrder || 0)) + 1 : 0), [entries]);
  const subOnlyForFilter = useMemo(() => subs.filter((s: any) => s.role !== 'co'), [subs]);

  const add = async (vals: any) => {
    const newEntry = {
      ...vals,
      game: (vals.game || '').trim(),
      shortName: (vals.shortName || '').trim(),
      username: (vals.username || '').trim(),
      // password is intentionally NOT trimmed — leading/trailing spaces may be intentional
      description: (vals.description || '').trim(),
      section, // tag the entry with the currently active sub-section
      id: uid(),
      createdAt: Date.now(),
      sortOrder: nextSortOrder,
      ownerId: user.ownerId || 'zeus',
    };
    setEntries((prev: any[]) => [...prev, newEntry]);
    try { await addIdPass(newEntry); }
    catch (e: any) { setEntries((prev: any[]) => prev.filter(x => x.id !== newEntry.id)); throw e; }
  };
  const del = async (e: any) => {
    const ok = await confirm({ title: `Delete credentials for "${e.game}"?`, message: 'This cannot be undone.', confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    const deletedItem = e;
    setEntries((prev: any[]) => prev.filter(x => x.id !== e.id));
    try { await deleteIdPass(e.id); }
    catch (err: any) {
      setEntries((prev: any[]) => [...prev, deletedItem].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)));
      notify(friendlyError(err));
    }
  };
  const saveEdit = async (patch: any) => {
    const id = editing.id;
    const originalItem = entries.find((x: any) => x.id === id);
    setEntries((prev: any[]) => prev.map((x: any) => x.id === id ? { ...x, ...patch, updatedAt: Date.now() } : x));
    try { await updateIdPass(id, patch); }
    catch (e: any) {
      if (originalItem) setEntries((prev: any[]) => prev.map((x: any) => x.id === id ? originalItem : x));
      throw e;
    }
  };
  const reorder = async (no: any[]) => {
    const originalOrder = no.map((e: any) => {
      const orig = entries.find((x: any) => x.id === e.id);
      return orig ? { id: orig.id, sortOrder: orig.sortOrder } : null;
    }).filter(Boolean) as { id: string; sortOrder: number }[];

    const reordered = no.map((e: any, i: number) => ({ ...e, sortOrder: i }));
    const keptIds = new Set(reordered.map((e: any) => e.id));
    setEntries((prev: any[]) => [...reordered, ...prev.filter((e: any) => !keptIds.has(e.id))]);
    try { await reorderIdPass(no.map((e: any) => e.id)); }
    catch (err: any) {
      setEntries((prev: any[]) => prev.map((x: any) => {
        const o = originalOrder.find(r => r.id === x.id);
        return o ? { ...x, sortOrder: o.sortOrder } : x;
      }).sort((a: any, b: any) => (a.sortOrder || 0) - (b.sortOrder || 0)));
      notify(friendlyError(err));
    }
  };
  const bulkDelete = async () => {
    const ok = await confirm({ title: `Delete ${selected.length} credentials?`, message: 'This cannot be undone.', confirmLabel: `Delete ${selected.length}`, danger: true });
    if (!ok) return;
    const toDelete = [...selected];
    const deletedItems = entries.filter((x: any) => toDelete.includes(x.id));
    setEntries((prev: any[]) => prev.filter(x => !toDelete.includes(x.id)));
    setSelected([]); setSelectMode(false);
    try { await bulkDeleteIdPass(toDelete); }
    catch (err: any) {
      setEntries((prev: any[]) => [...prev, ...deletedItems].sort((a: any, b: any) => (a.sortOrder || 0) - (b.sortOrder || 0)));
      notify(friendlyError(err));
    }
  };
  const toggleSelect = (id: string) => setSelected(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id]);

  const renderItem = (e: any, idx: number) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: '15px', marginBottom: '8px', letterSpacing: '-0.01em', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '11px', padding: '2px 8px', background: C.softBg, color: C.textSecondary, borderRadius: '10px', fontWeight: 700, letterSpacing: '0.02em', flexShrink: 0 }}>#{idx + 1}</span>
          <span>{e.game}{e.shortName && <span style={S.badge}>{e.shortName}</span>}</span>
        </div>
        <div style={{ fontSize: '13px', color: C.textSecondary, marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          <span style={{ minWidth: '72px', fontWeight: 500 }}>Username</span>
          <span style={{ color: C.textPrimary, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '12.5px', padding: '2px 6px', background: C.softBg, borderRadius: '4px' }}>{e.username}</span>
          <CopyButton value={e.username} />
        </div>
        <div style={{ fontSize: '13px', color: C.textSecondary, display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          <span style={{ minWidth: '72px', fontWeight: 500 }}>Password</span>
          <span style={{ color: C.textPrimary, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '12.5px', padding: '2px 6px', background: C.softBg, borderRadius: '4px' }}>
            {reveal[e.id] ? e.password : '•'.repeat(Math.min(e.password.length, 10))}
          </span>
          <button onClick={() => setReveal({ ...reveal, [e.id]: !reveal[e.id] })} style={{ padding: '3px 10px', fontSize: '11.5px', border: `1px solid ${C.borderStrong}`, background: C.cardBg, borderRadius: '5px', cursor: 'pointer', color: C.textSecondary, fontWeight: 500 }}>{reveal[e.id] ? 'Hide' : 'Show'}</button>
          <CopyButton value={e.password} />
        </div>
        {e.description && <div style={S.descBox}>{e.description}</div>}
        <AssigneeList assignees={e.assignees || []} subs={subs} />
        <Timestamp createdAt={e.createdAt} updatedAt={e.updatedAt} />
      </div>
      {isAdmin && !selectMode && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <Btn onClick={() => setEditing(e)} style={{ fontSize: '12px', padding: '5px 10px' }}>Edit</Btn>
          <Btn danger onClick={() => del(e)}>Delete</Btn>
        </div>
      )}
    </div>
  );
  const canReorder = isAdmin && !q.trim() && filterSub === 'all' && !selectMode;
  const sectionLabel = section === 'accounts' ? 'account' : 'game';
  const emptyMsg = section === 'accounts' ? 'No accounts yet.' : 'No game credentials yet.';
  return (
    <div>
      {confirmEl}
      <EditIdPassModal open={!!editing} entry={editing} subs={subs} onClose={() => setEditing(null)} onSave={saveEdit} />
      {/* Sub-tabs: Games | Accounts. Always visible (even when empty) so the user knows
          both sections exist and can switch to add their first entry. */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '1.25rem', borderBottom: `1px solid ${C.border}`, paddingBottom: '8px' }}>
        <button
          onClick={() => setSection('games')}
          className="infos-pill"
          style={{
            padding: '7px 16px', fontSize: '13px', borderRadius: '10px',
            border: section === 'games' ? `1px solid ${C.accent}` : `1px solid transparent`,
            background: section === 'games' ? C.accentSoft : 'transparent',
            color: section === 'games' ? C.accentText : C.textSecondary,
            cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px',
          }}>
          <span>🎮 Games</span>
          <span style={{ fontSize: '11px', padding: '1px 7px', background: section === 'games' ? C.accent : C.softBg, color: section === 'games' ? 'white' : C.textTertiary, borderRadius: '10px', fontWeight: 700 }}>{gamesCount}</span>
        </button>
        <button
          onClick={() => setSection('accounts')}
          className="infos-pill"
          style={{
            padding: '7px 16px', fontSize: '13px', borderRadius: '10px',
            border: section === 'accounts' ? `1px solid ${C.accent}` : `1px solid transparent`,
            background: section === 'accounts' ? C.accentSoft : 'transparent',
            color: section === 'accounts' ? C.accentText : C.textSecondary,
            cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px',
          }}>
          <span>🔐 Accounts</span>
          <span style={{ fontSize: '11px', padding: '1px 7px', background: section === 'accounts' ? C.accent : C.softBg, color: section === 'accounts' ? 'white' : C.textTertiary, borderRadius: '10px', fontWeight: 700 }}>{accountsCount}</span>
        </button>
      </div>

      {isAdmin && <IdPassEntryForm subs={subs} onSubmit={add} section={section} />}
      {visible.length > 0 || q.trim() ? <SearchBar value={q} onChange={setQ} placeholder={section === 'accounts' ? 'Search accounts by name or username…' : 'Search game credentials…'} /> : null}
      {isAdmin && subOnlyForFilter.length > 0 && visible.length + (q.trim() ? 1 : 0) > 0 && (
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '1rem', alignItems: 'center' }}>
          <span style={{ fontSize: '12px', color: C.textTertiary, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginRight: '2px' }}>Filter:</span>
          <button onClick={() => setFilterSub('all')} className="infos-pill"
            style={{ padding: '5px 12px', fontSize: '12.5px', border: filterSub === 'all' ? `1px solid ${C.accent}` : `1px solid ${C.borderStrong}`, borderRadius: '16px', background: filterSub === 'all' ? C.accent : C.cardBg, color: filterSub === 'all' ? 'white' : C.textPrimary, cursor: 'pointer', fontWeight: filterSub === 'all' ? 600 : 500 }}>All</button>
          {subOnlyForFilter.map((s: any) => {
            const on = filterSub === s.id;
            return (
              <button key={s.id} onClick={() => setFilterSub(s.id)} className="infos-pill"
                style={{ padding: '5px 12px', fontSize: '12.5px', border: on ? `1px solid ${C.accent}` : `1px solid ${C.borderStrong}`, borderRadius: '16px', background: on ? C.accent : C.cardBg, color: on ? 'white' : C.textPrimary, cursor: 'pointer', fontWeight: on ? 600 : 500 }}>{s.username}</button>
            );
          })}
        </div>
      )}
      <SelectionToolbar isAdmin={isAdmin} inSelectMode={selectMode}
        onEnter={() => setSelectMode(true)} onExit={() => { setSelectMode(false); setSelected([]); }}
        selectedCount={selected.length} onBulkDelete={bulkDelete}
        onSelectAll={() => setSelected(visible.map((e: any) => e.id))}
        onDeselectAll={() => setSelected([])} totalVisible={visible.length} />
      {visible.length === 0 ? (
        q.trim() || filterSub !== 'all'
          ? <EmptyState icon="🔍" title="No matches found" hint="Try a different search term or clear the filter." />
          : <EmptyState icon="📦" title={emptyMsg} hint={isAdmin ? 'Tap + Add at the top to create your first entry.' : 'Your admin hasn\'t assigned anything to you yet.'} />
      ) : (
        <div>
          <div style={{ fontSize: '12px', color: C.textTertiary, marginBottom: '8px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {visible.length} {sectionLabel}{visible.length === 1 ? '' : 's'}{filterSub !== 'all' && ` (filtered)`}
          </div>
          <ReorderHint canReorder={canReorder} />
          <ReorderList items={visible} canReorder={canReorder}
            canSelect={selectMode} selectedIds={selected} onToggleSelect={toggleSelect}
            onReorder={reorder} renderItem={renderItem} keyFn={(e: any) => e.id} />
        </div>
      )}
    </div>
  );
}
const IdPassTab = memo(IdPassTabInner);

// ---------------- Tab: Notice ----------------
// ---------------- Copy & Paste (sub-admin self-only credential snippets) ----------------
// Sub-admin shares credentials between their own multiple phones.
// 5-minute TTL, self-only visibility (other sub-admins / admins cannot see).
// Cleanup is lazy: expired rows hide instantly client-side and are deleted
// from the DB on next mount or whenever the in-tab heartbeat ticks.
function CopyPasteSection({ user, pastes, setPastes, reload }: any) {
  const [game, setGame] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const [confirmEl, confirm] = useConfirm();

  // Tick every 60s. We only use `now` to (1) hide expired entries from the
  // visible list and (2) compute a coarse "~Xm left" hint. No second-by-second
  // ticking — the hint is intentionally low-precision so the screen stays calm.
  // Visibility-aware: pauses when tab is hidden to save battery.
  useEffect(() => {
    let id: any;
    const start = () => {
      if (id) return;
      id = setInterval(() => setNow(Date.now()), 60 * 1000);
    };
    const stop = () => {
      if (id) { clearInterval(id); id = null; }
    };
    const onVis = () => {
      if (document.hidden) stop();
      else { setNow(Date.now()); start(); }
    };
    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVis);
    return () => { stop(); document.removeEventListener('visibilitychange', onVis); };
  }, []);

  // Periodic background purge of expired rows from the DB. Runs every 60s while
  // the Copy & Paste section is mounted. Cheap query (filter by expires_at < now).
  // Skips when tab is hidden to avoid unnecessary network calls on background tabs.
  useEffect(() => {
    const ws = user.ownerId || 'zeus';
    const t = setInterval(() => {
      if (document.hidden) return;
      purgeExpiredPaste(ws);
    }, 60 * 1000);
    return () => clearInterval(t);
  }, [user.ownerId]);

  // Self-only filter — even though the loader returns workspace-scoped rows,
  // the user only ever sees their OWN paste entries. Plus exclude expired.
  const myPastes = useMemo(() => {
    return pastes.filter((p: any) => p.userId === user.id && p.expiresAt > now);
  }, [pastes, user.id, now]);

  const submit = async () => {
    setErr('');
    if (!game.trim() || !username.trim() || !password.trim()) {
      setErr('All three fields are required'); return;
    }
    setBusy(true);
    const createdAt = Date.now();
    const newPaste = {
      id: uid(),
      game: game.trim(),
      username: username.trim(),
      password, // not trimmed — passwords can have leading/trailing spaces
      userId: user.id,
      ownerId: user.ownerId || 'zeus',
      createdAt,
      expiresAt: createdAt + PASTE_TTL_MS,
    };
    setPastes((prev: any[]) => [newPaste, ...prev]);
    try {
      await addPaste(newPaste);
      setGame(''); setUsername(''); setPassword('');
    } catch (e: any) {
      setPastes((prev: any[]) => prev.filter(x => x.id !== newPaste.id));
      setErr(friendlyError(e));
    } finally { setBusy(false); }
  };

  const remove = async (p: any) => {
    const ok = await confirm({ title: 'Delete this entry?', message: 'It will be removed from all your phones immediately.', confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    const deletedItem = p;
    setPastes((prev: any[]) => prev.filter(x => x.id !== p.id));
    try { await deletePaste(p.id); }
    catch (err: any) {
      setPastes((prev: any[]) => [...prev, deletedItem]);
      notify(friendlyError(err));
    }
  };

  // Format the copy payload exactly as specified:
  //   GameName
  //   ID : <username>
  //   PWD : <password>
  const buildCopyText = (p: any) => `${p.game}\nID : ${p.username}\nPWD : ${p.password}`;

  // Coarse "auto-deletes in ~Xm" hint shown on each entry. Rounds UP so users
  // never see "0 min" while the entry is still visible. Refreshed by the 60s
  // tick — no second-level countdown.
  const expiryHint = (p: any) => {
    const remaining = Math.max(0, p.expiresAt - now);
    const mins = Math.ceil(remaining / 60000);
    if (mins <= 1) return 'Auto-deletes in <1 min';
    return `Auto-deletes in ~${mins} min`;
  };

  return (
    <div>
      {confirmEl}
      {/* Form */}
      <div style={{ ...S.softCard, marginBottom: '1.25rem' }}>
        <div style={{ fontSize: '13px', color: C.textSecondary, marginBottom: '12px', lineHeight: 1.5 }}>
          Quickly share a credential between your own phones. The entry is visible <strong>only to you</strong> on every device you&apos;re signed in on, and <strong>auto-deletes after 5 minutes</strong>.
        </div>
        <div className="infos-grid2" style={S.grid2}>
          <div><label style={S.label}>Game name</label><TextInput value={game} onChange={(e: any) => setGame(e.target.value)} placeholder="e.g. PUBG" /></div>
          <div><label style={S.label}>Username</label><TextInput value={username} onChange={(e: any) => setUsername(e.target.value)} placeholder="Login username" /></div>
        </div>
        <div style={{ marginTop: '10px' }}>
          <label style={S.label}>Password</label>
          <TextInput type="text" value={password} onChange={(e: any) => setPassword(e.target.value)} placeholder="Login password" onKeyDown={(e: any) => { if (e.key === 'Enter') submit(); }} />
        </div>
        {err && <div style={{ fontSize: '13px', color: C.danger, marginTop: '10px', padding: '8px 12px', background: C.dangerSoft, borderRadius: '6px', fontWeight: 500 }}>{err}</div>}
        <div style={{ marginTop: '14px', textAlign: 'right' }}>
          <Btn primary onClick={submit} disabled={busy} style={{ opacity: busy ? 0.7 : 1 }}>{busy ? 'Publishing…' : 'Publish (5 min)'}</Btn>
        </div>
      </div>

      {/* Published list */}
      {myPastes.length === 0 ? (
        <EmptyState icon="📋" title="Nothing here yet" hint="Publish a credential and it'll show on your other phones instantly. Auto-deletes after 5 minutes." />
      ) : (
        <div>
          <div style={{ fontSize: '12px', color: C.textTertiary, marginBottom: '8px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {myPastes.length} active {myPastes.length === 1 ? 'entry' : 'entries'}
          </div>
          {myPastes.map((p: any, idx: number) => (
            <div key={p.id} style={S.item}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px', flex: 1 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {/* Tiny expiry hint above the entry — no live countdown, just a coarse note */}
                  <div style={{ fontSize: '11px', color: C.textTertiary, marginBottom: '6px', fontWeight: 500 }}>{expiryHint(p)}</div>
                  <div style={{ fontWeight: 600, fontSize: '15px', letterSpacing: '-0.01em', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '11px', padding: '2px 8px', background: C.softBg, color: C.textSecondary, borderRadius: '10px', fontWeight: 700, letterSpacing: '0.02em', flexShrink: 0 }}>#{idx + 1}</span>
                    <span>{p.game}</span>
                  </div>
                  {/* Always-visible plaintext block — used for copy/paste only,
                      so masking would defeat the purpose. */}
                  <div style={{ marginTop: '8px', fontSize: '13px', color: C.textPrimary, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', whiteSpace: 'pre-line', padding: '10px 12px', background: C.softBg, borderRadius: '8px', border: `1px solid ${C.border}`, wordBreak: 'break-all' }}>{buildCopyText(p)}</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <CopyButton value={buildCopyText(p)} label="all" />
                  <Btn danger onClick={() => remove(p)}>Delete</Btn>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


function NoticeTabInner({ user, subs, items, setItems, reload, pastes, setPastes, reloadPastes }: any) {
  const isAdmin = isAdminRole(user.role);
  const isSubOnly = !isAdmin; // 'sub' role only — admins (zeus, co) don't see Copy & Paste sub-tab
  const [subTab, setSubTab] = useState<'notice' | 'paste'>('notice');
  const [confirmEl, confirm] = useConfirm();
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<any>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);

  // When the user opens the Copy & Paste sub-tab, run a one-shot purge of
  // any expired rows for this workspace. Also re-fetch immediately to clear
  // local stale state. Cheap, idempotent.
  useEffect(() => {
    if (subTab === 'paste' && isSubOnly) {
      purgeExpiredPaste(user.ownerId || 'zeus').then(() => reloadPastes && reloadPastes());
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subTab]);

  const visible = useMemo(() => {
    const base = isAdmin ? items : items.filter((x: any) => isVisibleToSub(x.recipients, user.id));
    const search = q.trim().toLowerCase();
    const filtered = !search ? base : base.filter((x: any) =>
      (x.title || '').toLowerCase().includes(search) ||
      (x.body || '').toLowerCase().includes(search) ||
      (x.link || '').toLowerCase().includes(search)
    );
    // v20.7: pinned notices float to the top.
    // Stable sort: pinned items first (preserving their relative sort order),
    // then unpinned items (preserving theirs). Original sort_order is preserved
    // within each group so manual drag-reorder still works.
    return [...filtered].sort((a: any, b: any) => {
      const pinDiff = (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0);
      if (pinDiff !== 0) return pinDiff;
      return (a.sortOrder || 0) - (b.sortOrder || 0);
    });
  }, [isAdmin, items, user, q]);
  const nextSortOrder = useMemo(() => (items.length ? Math.max(...items.map((x: any) => x.sortOrder || 0)) + 1 : 0), [items]);

  const add = async (vals: any) => {
    const newItem = {
      id: uid(), title: vals.title.trim(), body: vals.body.trim(),
      link: (vals.link || '').trim(), recipients: vals.assignees,
      createdAt: Date.now(), sortOrder: nextSortOrder,
      ownerId: user.ownerId || 'zeus',
    };
    setItems((prev: any[]) => [...prev, newItem]);
    try { await addNotice(newItem); }
    catch (e: any) { setItems((prev: any[]) => prev.filter(x => x.id !== newItem.id)); throw e; }
  };
  const del = async (x: any) => {
    const ok = await confirm({ title: `Delete notice "${x.title}"?`, message: 'This cannot be undone.', confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    const deletedItem = x;
    setItems((prev: any[]) => prev.filter(y => y.id !== x.id));
    try { await deleteNotice(x.id); }
    catch (err: any) {
      setItems((prev: any[]) => [...prev, deletedItem].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)));
      notify(friendlyError(err));
    }
  };
  const saveEdit = async (patch: any) => {
    const id = editing.id;
    const originalItem = items.find((y: any) => y.id === id);
    setItems((prev: any[]) => prev.map((y: any) => y.id === id ? { ...y, ...patch, updatedAt: Date.now() } : y));
    try { await updateNotice(id, patch); }
    catch (e: any) {
      if (originalItem) setItems((prev: any[]) => prev.map((y: any) => y.id === id ? originalItem : y));
      throw e;
    }
  };
  const reorder = async (no: any[]) => {
    const originalOrder = no.map((x: any) => {
      const orig = items.find((y: any) => y.id === x.id);
      return orig ? { id: orig.id, sortOrder: orig.sortOrder } : null;
    }).filter(Boolean) as { id: string; sortOrder: number }[];

    const reordered = no.map((x: any, i: number) => ({ ...x, sortOrder: i }));
    const keptIds = new Set(reordered.map((x: any) => x.id));
    setItems((prev: any[]) => [...reordered, ...prev.filter((x: any) => !keptIds.has(x.id))]);
    try { await reorderNotices(no.map((x: any) => x.id)); }
    catch (err: any) {
      setItems((prev: any[]) => prev.map((y: any) => {
        const o = originalOrder.find(r => r.id === y.id);
        return o ? { ...y, sortOrder: o.sortOrder } : y;
      }).sort((a: any, b: any) => (a.sortOrder || 0) - (b.sortOrder || 0)));
      notify(friendlyError(err));
    }
  };
  const bulkDelete = async () => {
    const ok = await confirm({ title: `Delete ${selected.length} notices?`, message: 'This cannot be undone.', confirmLabel: `Delete ${selected.length}`, danger: true });
    if (!ok) return;
    const toDelete = [...selected];
    const deletedItems = items.filter((y: any) => toDelete.includes(y.id));
    setItems((prev: any[]) => prev.filter(y => !toDelete.includes(y.id)));
    setSelected([]); setSelectMode(false);
    try { await bulkDeleteNotices(toDelete); }
    catch (err: any) {
      setItems((prev: any[]) => [...prev, ...deletedItems].sort((a: any, b: any) => (a.sortOrder || 0) - (b.sortOrder || 0)));
      notify(friendlyError(err));
    }
  };
  const toggleSelect = (id: string) => setSelected(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id]);
  const isNewish = (createdAt: number) => (Date.now() - createdAt) < (24 * 60 * 60 * 1000);

  // v20.7: Toggle pin state with optimistic UI. Only admins can pin/unpin.
  // Pinning re-sorts the visible list (handled by `visible` memo above).
  const togglePin = async (x: any) => {
    const newPinned = !x.pinned;
    const prevItems = items;
    setItems((prev: any[]) => prev.map((y: any) => y.id === x.id ? { ...y, pinned: newPinned } : y));
    try { await toggleNoticePin(x.id, newPinned); }
    catch (err: any) {
      setItems(prevItems);          // rollback on failure
      notify(friendlyError(err));
    }
  };

  const renderItem = (x: any) => (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      gap: '10px',
      // v20.7: subtle accent tint + left border for pinned items so they stand out
      ...(x.pinned ? {
        background: C.accentSoft,
        marginLeft: '-12px', marginRight: '-12px',
        paddingLeft: '12px', paddingRight: '12px',
        paddingTop: '10px', paddingBottom: '10px',
        borderLeft: `3px solid ${C.accent}`,
        borderRadius: '6px',
      } : {}),
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: '15px', letterSpacing: '-0.01em', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {/* v20.7: pin badge — visible to all (admins + sub-admins) */}
          {x.pinned && <span title="Pinned" style={{ fontSize: '13px' }}>📌</span>}
          {x.title}
          {isNewish(x.createdAt) && <span className="infos-new-badge" style={{ fontSize: '10px', padding: '2px 7px', background: C.accent, color: 'white', borderRadius: '10px', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase' }}>New</span>}
        </div>
        <div style={{ fontSize: '13.5px', marginTop: '8px', whiteSpace: 'pre-wrap', color: C.textPrimary, lineHeight: '1.5' }}>{x.body}</div>
        {x.link && (
          <div style={{ marginTop: '10px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <a href={x.link} target="_blank" rel="noopener noreferrer" style={S.linkPill}>{x.link}</a>
            <CopyButton value={x.link} label="link" />
          </div>
        )}
        {/* v25.5: Show assignees to everyone (including sub-admins) so they
            can see who else this notice was sent to. */}
        <AssigneeList assignees={x.recipients || []} subs={subs} />
        <Timestamp createdAt={x.createdAt} updatedAt={x.updatedAt} />
      </div>
      {isAdmin && !selectMode && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {/* v20.7: pin button — admin-only action. Stays visible always so it's
              easy to unpin without entering edit mode. */}
          <button onClick={() => togglePin(x)} type="button" title={x.pinned ? 'Unpin notice' : 'Pin to top'}
            style={{ padding: '5px 10px', fontSize: '12px', border: `1px solid ${x.pinned ? C.accent : C.borderStrong}`, background: x.pinned ? C.accentSoft : C.cardBg, borderRadius: '5px', cursor: 'pointer', color: x.pinned ? C.accentText : C.textSecondary, fontWeight: 500, whiteSpace: 'nowrap' }}>
            {x.pinned ? '📌 Pinned' : '📌 Pin'}
          </button>
          <Btn onClick={() => setEditing(x)} style={{ fontSize: '12px', padding: '5px 10px' }}>Edit</Btn>
          <Btn danger onClick={() => del(x)}>Delete</Btn>
        </div>
      )}
    </div>
  );
  // v20.7: Drag-reorder is disabled when ANY notice is pinned. Mixing
  // drag-reorder with pin-floats-to-top creates a confusing UX (drag works
  // within the pinned group, then "jumps" across the boundary). Easier to
  // require unpinning first if you want to fully reorder.
  const hasPinned = items.some((x: any) => !!x.pinned);
  const canReorder = isAdmin && !q.trim() && !selectMode && !hasPinned;

  // Notice content (the "📢 Notice" sub-tab body, OR the full tab for admins)
  const noticeContent = (
    <>
      {isAdmin && (subs.filter((s: any) => s.role !== 'co').length === 0
        ? <div style={{ ...S.empty, marginBottom: '1.25rem' }}>Create sub-admins first to post notices.</div>
        : <NoticeEntryForm subs={subs} onSubmit={add} />)}
      {items.length > 0 && <SearchBar value={q} onChange={setQ} placeholder="Search notices…" />}
      <SelectionToolbar isAdmin={isAdmin} inSelectMode={selectMode}
        onEnter={() => setSelectMode(true)} onExit={() => { setSelectMode(false); setSelected([]); }}
        selectedCount={selected.length} onBulkDelete={bulkDelete}
        onSelectAll={() => setSelected(visible.map((x: any) => x.id))}
        onDeselectAll={() => setSelected([])} totalVisible={visible.length} />
      {visible.length === 0 ? (
        q.trim()
          ? <EmptyState icon="🔍" title="No matches found" hint="Try a different search term." />
          : isAdmin
            ? <EmptyState icon="📢" title="No notices posted yet" hint="Use the form above to send your first notice to your sub-admins." />
            : <EmptyState icon="📭" title="No notices for you yet" hint="When your admin posts a notice for you, it'll appear here." />
      ) : (
        <div>
          <div style={{ fontSize: '12px', color: C.textTertiary, marginBottom: '8px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {visible.length} {visible.length === 1 ? 'notice' : 'notices'}
          </div>
          <ReorderHint canReorder={canReorder} />
          <ReorderList items={visible} canReorder={canReorder}
            canSelect={selectMode} selectedIds={selected} onToggleSelect={toggleSelect}
            onReorder={reorder} renderItem={renderItem} keyFn={(x: any) => x.id} />
        </div>
      )}
    </>
  );

  return (
    <div>
      {confirmEl}
      <EditNoticeModal open={!!editing} entry={editing} subs={subs} onClose={() => setEditing(null)} onSave={saveEdit} />

      {/* Sub-tabs only for sub-admins (Copy & Paste is a sub-admin-only feature).
          Admins (Zeus, co-admin) see the Notice tab the same as before. */}
      {isSubOnly ? (
        <>
          <div style={{ display: 'flex', gap: '6px', marginBottom: '1.25rem', borderBottom: `1px solid ${C.border}`, paddingBottom: '8px' }}>
            <button
              onClick={() => setSubTab('notice')}
              className="infos-pill"
              style={{
                padding: '7px 16px', fontSize: '13px', borderRadius: '10px',
                border: subTab === 'notice' ? `1px solid ${C.accent}` : `1px solid transparent`,
                background: subTab === 'notice' ? C.accentSoft : 'transparent',
                color: subTab === 'notice' ? C.accentText : C.textSecondary,
                cursor: 'pointer', fontWeight: 600,
              }}>
              📢 Notices
            </button>
            <button
              onClick={() => setSubTab('paste')}
              className="infos-pill"
              style={{
                padding: '7px 16px', fontSize: '13px', borderRadius: '10px',
                border: subTab === 'paste' ? `1px solid ${C.accent}` : `1px solid transparent`,
                background: subTab === 'paste' ? C.accentSoft : 'transparent',
                color: subTab === 'paste' ? C.accentText : C.textSecondary,
                cursor: 'pointer', fontWeight: 600,
              }}>
              📋 Copy &amp; Paste
            </button>
          </div>
          {subTab === 'notice' ? noticeContent : (
            <>
              <div style={{ fontSize: '12px', color: C.textSecondary, marginBottom: '12px', fontWeight: 500, fontStyle: 'italic' }}>
                Easier for post and paste — share credentials between your own phones, auto-deletes in 5 minutes.
              </div>
              <CopyPasteSection user={user} pastes={pastes || []} setPastes={setPastes} reload={reloadPastes} />
            </>
          )}
        </>
      ) : noticeContent}
    </div>
  );
}
const NoticeTab = memo(NoticeTabInner);

// ---------------- Tab: Create Admin ----------------
function CreateAdminPanelInner({ user, subs, setSubs, backend, games, idpass, notices, reload, reloadSubs }: any) {
  const [confirmEl, confirm] = useConfirm();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'sub' | 'co'>('sub');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [managingSub, setManagingSub] = useState<any>(null);
  const [editingSub, setEditingSub] = useState<any>(null);
  const [showNewPass, setShowNewPass] = useState(false);
  const [viewFilter, setViewFilter] = useState<'all' | 'sub' | 'co'>('all');
  const nextSortOrder = useMemo(() => (subs.length ? Math.max(...subs.map((s: any) => s.sortOrder || 0)) + 1 : 0), [subs]);

  const isZeusUser = isZeus(user.role);
  // Co-admin can only create sub-admins, not other co-admins
  const canSelectRole = isZeusUser;

  const add = async () => {
    setError('');
    if (!username.trim() || !password.trim()) return setError('Username and password required');
    try {
      const zeus = await loadZeus();
      if (username.trim() === zeus.username) return setError('That username is reserved for the main admin');
      if (subs.some((s: any) => s.username === username.trim())) return setError('That username is already taken');
      const finalRole = canSelectRole ? role : 'sub';
      setBusy(true);
      // v19: ownerId determines which workspace this new admin lives in.
      //   If creating a co-admin → they live in Zeus's workspace (owner_id='zeus')
      //     and become workspace owners themselves (their workspace = their own id).
      //   If creating a sub-admin → they live in the creator's workspace.
      const ownerId = finalRole === 'co' ? 'zeus' : (user.ownerId || 'zeus');
      const newSub = {
        id: uid(),
        username: username.trim(),
        password,
        role: finalRole,
        createdAt: Date.now(),
        sortOrder: nextSortOrder,
        ownerId,
      };
      setSubs((prev: any[]) => [...prev, newSub]);
      try {
        await addSub(newSub);
        setUsername(''); setPassword(''); setShowNewPass(false); setRole('sub');
      } catch (dbErr: any) {
        setSubs((prev: any[]) => prev.filter(s => s.id !== newSub.id));
        throw dbErr;
      }
    } catch (e: any) { setError(friendlyError(e)); } finally { setBusy(false); }
  };

  const remove = async (s: any) => {
    if (s.role === 'co' && !isZeusUser) {
      notify('Only Zeus can remove co-admins.');
      return;
    }
    // For sub-admins: simple delete with one confirm
    if (s.role !== 'co') {
      const ok = await confirm({
        title: `Remove sub-admin "${s.username}"?`,
        message: 'They will no longer be able to sign in. Content they were assigned to will still exist.',
        confirmLabel: 'Remove',
        danger: true,
      });
      if (!ok) return;
      const deletedItem = s;
      setSubs((prev: any[]) => prev.filter(x => x.id !== s.id));
      try { await deleteSub(s.id); }
      catch (err: any) {
        setSubs((prev: any[]) => [...prev, deletedItem].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)));
        notify(friendlyError(err));
      }
      return;
    }
    // For CO-ADMINS: cascade delete with detailed confirm showing what will be wiped
    let counts;
    try {
      counts = await countWorkspaceContents(s.id);
    } catch (err: any) {
      notify(friendlyError(err, 'Could not count this co-admin\u2019s data. Try again.'));
      return;
    }
    const lines: string[] = [];
    if (counts.subAdmins) lines.push(`\u2022 ${counts.subAdmins} sub-admin${counts.subAdmins === 1 ? '' : 's'}`);
    if (counts.notices)   lines.push(`\u2022 ${counts.notices} notice${counts.notices === 1 ? '' : 's'}`);
    if (counts.backend)   lines.push(`\u2022 ${counts.backend} system entr${counts.backend === 1 ? 'y' : 'ies'}`);
    if (counts.games)     lines.push(`\u2022 ${counts.games} game entr${counts.games === 1 ? 'y' : 'ies'}`);
    if (counts.idpass)    lines.push(`\u2022 ${counts.idpass} credential${counts.idpass === 1 ? '' : 's'}`);
    const detailMsg = lines.length === 0
      ? `Their workspace is empty. Removing the co-admin will also delete the workspace itself. This cannot be undone.`
      : `This will also PERMANENTLY DELETE everything in their workspace:\n\n${lines.join('\n')}\n\nThis cannot be undone.`;
    const ok = await confirm({
      title: `Remove co-admin "${s.username}" and their entire workspace?`,
      message: detailMsg,
      confirmLabel: `Delete co-admin + ${lines.length || 'workspace'}`,
      danger: true,
    });
    if (!ok) return;
    // Optimistic: remove the co-admin immediately
    const deletedItem = s;
    setSubs((prev: any[]) => prev.filter(x => x.id !== s.id));
    try {
      await deleteCoAdminWorkspace(s.id);
    } catch (err: any) {
      // Restore on failure
      setSubs((prev: any[]) => [...prev, deletedItem].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)));
      notify(friendlyError(err, 'Could not delete co-admin workspace. Some data may have been removed; try again or refresh.'));
    }
  };

  const saveEditSub = async (patch: { username: string; password: string }) => {
    if (editingSub.role === 'co' && !isZeusUser) {
      throw new Error('Only Zeus can edit co-admins.');
    }
    const id = editingSub.id;
    const originalItem = subs.find((x: any) => x.id === id);
    setSubs((prev: any[]) => prev.map((x: any) => x.id === id ? { ...x, ...patch, updatedAt: Date.now() } : x));
    try { await updateSub(id, patch); }
    catch (e: any) {
      if (originalItem) setSubs((prev: any[]) => prev.map((x: any) => x.id === id ? originalItem : x));
      throw e;
    }
  };

  const bulkEntries: BulkEntry[] = useMemo(() => {
    if (!managingSub) return [];
    return [
      ...notices.map((n: any) => ({ id: n.id, label: n.title, subLabel: (n.body || '').slice(0, 80), table: 'notices' as const, assignees: n.recipients })),
      ...backend.map((b: any) => ({ id: b.id, label: b.gameName + (b.shortName ? ` — ${b.shortName}` : ''), subLabel: b.link, table: 'backend' as const, assignees: b.assignees })),
      ...games.map((g: any) => ({ id: g.id, label: g.gameName + (g.shortName ? ` — ${g.shortName}` : ''), subLabel: g.link, table: 'games' as const, assignees: g.assignees })),
      ...idpass.map((i: any) => ({ id: i.id, label: i.game + (i.shortName ? ` — ${i.shortName}` : ''), subLabel: `user: ${i.username}`, table: 'idpass' as const, assignees: i.assignees })),
    ];
  }, [managingSub, notices, backend, games, idpass]);

  const saveBulk = async (changes: { entry: BulkEntry; grant: boolean }[]) => {
    const subId = managingSub.id;
    for (const { entry, grant } of changes) {
      const currentAssignees = entry.assignees.filter((x: string) => x !== ALL_SENTINEL);
      let next: string[];
      if (grant) next = Array.from(new Set([...currentAssignees, subId]));
      else next = currentAssignees.filter(x => x !== subId);
      if (entry.table === 'backend') await updateGameAssignees('backend_entries', entry.id, next);
      else if (entry.table === 'games') await updateGameAssignees('game_entries', entry.id, next);
      else if (entry.table === 'idpass') await updateIdPassAssignees(entry.id, next);
      else if (entry.table === 'notices') await updateNoticeRecipients(entry.id, next);
    }
    await reload();
  };

  const existingUsernames = subs.map((s: any) => ({ id: s.id, username: s.username }));
  const filteredSubs = useMemo(() => {
    if (viewFilter === 'all') return subs;
    return subs.filter((s: any) => (s.role || 'sub') === viewFilter);
  }, [subs, viewFilter]);

  const coCount = subs.filter((s: any) => s.role === 'co').length;
  const subCount = subs.filter((s: any) => (s.role || 'sub') === 'sub').length;

  return (
    <div>
      {confirmEl}
      <BulkAssignModal open={!!managingSub} subAdmin={managingSub} entries={bulkEntries}
        onClose={() => setManagingSub(null)} onSave={saveBulk} />
      <EditSubAdminModal open={!!editingSub} sub={editingSub} existingUsernames={existingUsernames}
        onClose={() => setEditingSub(null)} onSave={saveEditSub} />

      {/* Create form */}
      <div style={{ ...S.softCard, marginBottom: '1.25rem' }}>
        <div className="infos-grid2" style={S.grid2}>
          <div><label style={S.label}>Username</label><TextInput value={username} onChange={(e: any) => setUsername(e.target.value)} placeholder="new_admin_username" /></div>
          <div>
            <label style={S.label}>Password</label>
            <div style={{ position: 'relative' }}>
              <TextInput type={showNewPass ? 'text' : 'password'} value={password} onChange={(e: any) => setPassword(e.target.value)} placeholder="Set a password" style={{ paddingRight: '60px' }} />
              <button type="button" onClick={() => setShowNewPass(!showNewPass)}
                style={{ position: 'absolute', right: '6px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', fontSize: '11.5px', color: C.textSecondary, cursor: 'pointer', padding: '4px 8px', fontWeight: 500 }}>
                {showNewPass ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>
        </div>
        {/* Role selector — only Zeus can pick */}
        {canSelectRole && (
          <div style={{ marginTop: '12px' }}>
            <label style={S.label}>Admin role</label>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button type="button" onClick={() => setRole('sub')}
                style={{ padding: '10px 14px', fontSize: '13px', border: `1px solid ${role === 'sub' ? C.accent : C.borderStrong}`, background: role === 'sub' ? C.accentSoft : C.cardBg, color: role === 'sub' ? C.accentText : C.textPrimary, borderRadius: '8px', cursor: 'pointer', fontWeight: role === 'sub' ? 600 : 500, textAlign: 'left', flex: 1, minWidth: '180px' }}>
                <div style={{ fontWeight: 600, marginBottom: '2px' }}>Sub-admin</div>
                <div style={{ fontSize: '11.5px', color: C.textSecondary, fontWeight: 500 }}>Sees only what&apos;s assigned to them. Cannot create or edit.</div>
              </button>
              <button type="button" onClick={() => setRole('co')}
                style={{ padding: '10px 14px', fontSize: '13px', border: `1px solid ${role === 'co' ? C.accent : C.borderStrong}`, background: role === 'co' ? C.accentSoft : C.cardBg, color: role === 'co' ? C.accentText : C.textPrimary, borderRadius: '8px', cursor: 'pointer', fontWeight: role === 'co' ? 600 : 500, textAlign: 'left', flex: 1, minWidth: '180px' }}>
                <div style={{ fontWeight: 600, marginBottom: '2px' }}>Co-admin</div>
                <div style={{ fontSize: '11.5px', color: C.textSecondary, fontWeight: 500 }}>Zeus-level access. Can create sub-admins and edit content. Only Zeus can remove them.</div>
              </button>
            </div>
          </div>
        )}
        {!canSelectRole && (
          <div style={{ fontSize: '12.5px', color: C.textTertiary, marginTop: '10px', fontStyle: 'italic' }}>
            Note: As a co-admin, you can only create sub-admins. Only Zeus can create other co-admins.
          </div>
        )}
        {error && <div style={{ fontSize: '13px', color: C.danger, marginTop: '10px', padding: '8px 12px', background: C.dangerSoft, borderRadius: '6px', fontWeight: 500 }}>{error}</div>}
        <div style={{ marginTop: '14px', textAlign: 'right' }}>
          <Btn primary onClick={add} disabled={busy} style={{ opacity: busy ? 0.7 : 1 }}>
            {busy ? 'Saving…' : `Create ${canSelectRole && role === 'co' ? 'co-admin' : 'sub-admin'}`}
          </Btn>
        </div>
      </div>

      {/* Filter pills */}
      {subs.length > 0 && (
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '1rem', alignItems: 'center' }}>
          <span style={{ fontSize: '12px', color: C.textTertiary, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginRight: '2px' }}>View:</span>
          <button onClick={() => setViewFilter('all')} className="infos-pill"
            style={{ padding: '5px 12px', fontSize: '12.5px', border: viewFilter === 'all' ? `1px solid ${C.accent}` : `1px solid ${C.borderStrong}`, borderRadius: '16px', background: viewFilter === 'all' ? C.accent : C.cardBg, color: viewFilter === 'all' ? 'white' : C.textPrimary, cursor: 'pointer', fontWeight: viewFilter === 'all' ? 600 : 500 }}>All ({subs.length})</button>
          <button onClick={() => setViewFilter('sub')} className="infos-pill"
            style={{ padding: '5px 12px', fontSize: '12.5px', border: viewFilter === 'sub' ? `1px solid ${C.accent}` : `1px solid ${C.borderStrong}`, borderRadius: '16px', background: viewFilter === 'sub' ? C.accent : C.cardBg, color: viewFilter === 'sub' ? 'white' : C.textPrimary, cursor: 'pointer', fontWeight: viewFilter === 'sub' ? 600 : 500 }}>Sub-admins ({subCount})</button>
          {/* v19: Co-admins pill is Zeus-only — co-admins never have co-admins of their own */}
          {isZeusUser && (
            <button onClick={() => setViewFilter('co')} className="infos-pill"
              style={{ padding: '5px 12px', fontSize: '12.5px', border: viewFilter === 'co' ? `1px solid ${C.accent}` : `1px solid ${C.borderStrong}`, borderRadius: '16px', background: viewFilter === 'co' ? C.accent : C.cardBg, color: viewFilter === 'co' ? 'white' : C.textPrimary, cursor: 'pointer', fontWeight: viewFilter === 'co' ? 600 : 500 }}>Co-admins ({coCount})</button>
          )}
        </div>
      )}

      {filteredSubs.length === 0 ? (
        <EmptyState
          icon={viewFilter === 'co' ? '👥' : '👤'}
          title={viewFilter === 'all' ? 'No admins yet' : viewFilter === 'co' ? 'No co-admins yet' : 'No sub-admins yet'}
          hint="Use the form above to create your first one."
        />
      ) : (
        <div>
          {filteredSubs.map((s: any) => {
            const sRole = s.role || 'sub';
            const isCo = sRole === 'co';
            const canManage = isZeusUser || !isCo; // co-admin can't edit/delete other co-admins
            const avatarColor = isCo ? '#e17b4a' : '#888780';
            return (
              <div key={s.id} style={S.item}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', gap: '8px', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span style={{ width: '36px', height: '36px', borderRadius: '50%', background: avatarColor, color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', fontWeight: 600 }}>{s.username.charAt(0).toUpperCase()}</span>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '14px', letterSpacing: '-0.01em', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {s.username}
                        {isCo && <span style={{ fontSize: '10px', padding: '2px 8px', background: 'rgba(225, 123, 74, 0.18)', color: '#e17b4a', borderRadius: '10px', fontWeight: 700, letterSpacing: '0.03em', textTransform: 'uppercase' }}>CO-ADMIN</span>}
                      </div>
                      <div style={{ fontSize: '12px', color: C.textSecondary, fontFamily: 'ui-monospace, monospace', marginTop: '3px' }}>password: {s.password}</div>
                      {s.createdAt && <div style={{ fontSize: '11px', color: C.textTertiary, marginTop: '3px', fontWeight: 500 }} title={fullDateTime(s.createdAt)}>Added {timeAgo(s.createdAt)}</div>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {canManage && <Btn onClick={() => setEditingSub(s)} style={{ fontSize: '12px', padding: '5px 10px' }}>Edit</Btn>}
                    {!isCo && <Btn onClick={() => setManagingSub(s)}>Manage access</Btn>}
                    {canManage && <Btn danger onClick={() => remove(s)}>Remove</Btn>}
                    {!canManage && <span style={{ fontSize: '11px', color: C.textTertiary, fontStyle: 'italic' }}>Zeus only</span>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
const CreateAdminPanel = memo(CreateAdminPanelInner);

// ---------------- Settings modal (Zeus: change creds + backup. Co-admin: change own password + backup) ----------------
function SettingsModal({ open, onClose, user, onForceLogout, onOpenTrash, onOpenDevices, theme, setTheme }: any) {
  const isZeusUser = isZeus(user.role);
  const isAdmin = isAdminRole(user.role);
  const workspaceId = workspaceIdForUser(user);
  const [currentZeus, setCurrentZeus] = useState<any>(null);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPass, setConfirmPass] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importStatus, setImportStatus] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const [confirmEl, confirm] = useConfirm();

  // v23.0: Sidebar navigation. Each option in the sidebar maps to a section
  // key. The right pane shows only the selected section. On mobile, the
  // sidebar collapses into a horizontal tab bar.
  // v24.4: Default to 'account' for admins, 'appearance' for sub-admins
  // (since profile section is removed).
  const [activeSection, setActiveSection] = useState<string>(isAdminRole(user.role) ? 'account' : 'appearance');


  useEffect(() => {
    if (!open) return;
    let alive = true;
    if (isZeusUser) {
      loadZeus().then(c => {
        if (!alive) return;
        setCurrentZeus(c);
        setNewUsername(c.username);
      }).catch(() => {
        if (alive) setCurrentZeus(DEFAULT_ZEUS);
      });
    } else {
      setCurrentZeus({ username: user.username });
    }
    setNewPassword(''); setConfirmPass(''); setMsg(''); setErr(''); setImportStatus('');
    return () => { alive = false; };
  }, [open, isZeusUser, user.username]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const saveZeusCreds = async () => {
    setMsg(''); setErr('');
    if (!newUsername.trim()) return setErr('Username cannot be empty');
    if (!newPassword) return setErr('Enter a new password');
    if (newPassword.length < 4) return setErr('Password must be at least 4 characters');
    if (newPassword !== confirmPass) return setErr('Passwords do not match');
    setBusy(true);
    try {
      await saveZeus({ username: newUsername.trim(), password: newPassword });
      setMsg('Credentials updated. Logging you out…');
      setTimeout(() => { onClose(); onForceLogout(); }, 1200);
    } catch (e: any) { setErr(friendlyError(e)); } finally { setBusy(false); }
  };

  const saveCoPassword = async () => {
    setMsg(''); setErr('');
    if (!newPassword) return setErr('Enter a new password');
    if (newPassword.length < 4) return setErr('Password must be at least 4 characters');
    if (newPassword !== confirmPass) return setErr('Passwords do not match');
    setBusy(true);
    try {
      await updateSub(user.id, { password: newPassword });
      setMsg('Password updated. Logging you out…');
      setTimeout(() => { onClose(); onForceLogout(); }, 1200);
    } catch (e: any) { setErr(friendlyError(e)); } finally { setBusy(false); }
  };

  const doExportAll = async () => {
    setExporting(true);
    try {
      // v19: export only the current workspace's data
      const workspaceId = workspaceIdForUser(user);
      const data = await exportAll(workspaceId);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      // Filename includes workspace tag so multiple co-admin exports don't collide
      const tag = workspaceId === 'zeus' ? 'zeus' : `co-${user.username}`;
      a.download = `infos-backup-${tag}-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) { notify(friendlyError(e)); }
    finally { setExporting(false); }
  };

  const doImport = async (ev: React.ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    setImportStatus('Reading file…');
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      // v19: accept v1 (legacy, single workspace) and v2 (multi-tenant) backups
      if (!data.version || (data.version !== 1 && data.version !== 2)) {
        setImportStatus('Unsupported backup file format.');
        return;
      }
      // Determine target workspace for the import:
      //   - v1 backup → goes to current workspace (legacy assumed Zeus)
      //   - v2 backup → goes to current workspace, regardless of original
      const targetWorkspace = workspaceIdForUser(user);
      const versionNote = data.version === 1
        ? 'This is a legacy v1 backup. All entries will go into your current workspace.'
        : `This is a v${data.version} backup originally from workspace "${data.workspace || 'unknown'}". Entries will go into YOUR current workspace.`;
      const ok = await confirm({
        title: 'Import and merge data?',
        message: `${versionNote}\n\nThis ADDS entries from the backup. Existing entries with the same IDs will be overwritten. Zeus credentials will NOT be changed.\n\nSubs: ${data.sub_admins?.length || 0}, backend: ${data.backend_entries?.length || 0}, games: ${data.game_entries?.length || 0}, credentials: ${data.idpass_entries?.length || 0}, notices: ${data.notices?.length || 0}.`,
        confirmLabel: 'Import',
      });
      if (!ok) { setImportStatus(''); ev.target.value = ''; return; }
      setImportStatus('Importing…');
      if (data.sub_admins?.length) await bulkInsert('sub_admins', data.sub_admins.map((s: any) => ({
        id: s.id, username: s.username, password: s.password,
        role: s.role || 'sub',
        created_at: s.createdAt, sort_order: s.sortOrder ?? 0,
        owner_id: targetWorkspace,
      })));
      if (data.backend_entries?.length) await bulkInsert('backend_entries', data.backend_entries.map((e: any) => ({
        id: e.id, game_name: e.gameName, short_name: e.shortName, link: e.link,
        description: e.description || '', assignees: e.assignees || [],
        created_at: e.createdAt, sort_order: e.sortOrder ?? 0,
        owner_id: targetWorkspace,
      })));
      if (data.game_entries?.length) await bulkInsert('game_entries', data.game_entries.map((e: any) => ({
        id: e.id, game_name: e.gameName, short_name: e.shortName, link: e.link,
        description: e.description || '', assignees: e.assignees || [],
        created_at: e.createdAt, sort_order: e.sortOrder ?? 0,
        owner_id: targetWorkspace,
      })));
      if (data.idpass_entries?.length) await bulkInsert('idpass_entries', data.idpass_entries.map((e: any) => ({
        id: e.id, game: e.game, short_name: e.shortName || '',
        username: e.username, password: e.password, description: e.description || '',
        assignees: e.assignees || [], section: e.section || 'games',
        created_at: e.createdAt, sort_order: e.sortOrder ?? 0,
        owner_id: targetWorkspace,
      })));
      if (data.notices?.length) await bulkInsert('notices', data.notices.map((n: any) => ({
        id: n.id, title: n.title, body: n.body, link: n.link || '',
        recipients: n.recipients || [],
        pinned: !!n.pinned,                            // v20.7
        created_at: n.createdAt, sort_order: n.sortOrder ?? 0,
        owner_id: targetWorkspace,
      })));
      setImportStatus('✓ Import complete. Refresh the page to see imported data.');
    } catch (e: any) { setImportStatus('Import failed: ' + friendlyError(e)); }
    ev.target.value = '';
  };

  if (!open) return null;

  // v23.0: Sidebar nav structure. Sections shown depend on user role.
  // Mobile: rendered as horizontal scrolling pills above content.
  const sections: Array<{ key: string; label: string; icon: string; show: boolean }> = [
    { key: 'account',     label: 'Account',          icon: '🔑', show: isAdmin },
    { key: 'appearance',  label: 'Appearance',       icon: '🎨', show: true },
    { key: 'data',        label: 'Backup & Data',    icon: '💾', show: isAdmin },
    { key: 'trash',       label: 'Trash',            icon: '🗑',  show: isAdmin },
    { key: 'devices',     label: 'Devices',          icon: '📱', show: isZeusUser },
    { key: 'privacy',     label: 'Privacy',          icon: '🔒', show: true },
  ];
  const visibleSections = sections.filter((s) => s.show);

  // Section pane heading helper — keeps the right pane consistent.
  // v23.1: bigger title, subtle bottom border for visual separation.
  const SectionHeading = ({ title, sub }: { title: string; sub?: string }) => (
    <div style={{ marginBottom: '24px', paddingBottom: '16px', borderBottom: `1px solid ${C.border}` }}>
      <h2 style={{ fontSize: '22px', fontWeight: 700, letterSpacing: '-0.025em', margin: '0 0 6px', color: C.textPrimary }}>{title}</h2>
      {sub && <div style={{ fontSize: '13.5px', color: C.textSecondary, lineHeight: 1.55, maxWidth: '520px' }}>{sub}</div>}
    </div>
  );

  return (
    <div className="infos-modal-backdrop"
      style={{ position: 'fixed', inset: 0, background: C.softBg, zIndex: 9999, display: 'flex', flexDirection: 'column' }}>
      {confirmEl}
      {/* Top bar — always visible. Shows app brand + close button. */}
      <div style={{
        flexShrink: 0,
        padding: '12px 18px',
        borderBottom: `1px solid ${C.border}`,
        background: C.cardBg,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: '12px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button onClick={onClose} type="button" aria-label="Back" title="Back to app"
            style={{
              background: C.softBg, border: `1px solid ${C.border}`, cursor: 'pointer',
              padding: '8px 14px', borderRadius: '8px',
              fontSize: '14px', fontWeight: 600, color: C.textPrimary, lineHeight: 1,
              display: 'flex', alignItems: 'center', gap: '6px',
              fontFamily: 'inherit',
            }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = C.border)}
            onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = C.softBg)}>
            <span style={{ fontSize: '17px', lineHeight: 1 }}>←</span>
            <span>Back</span>
          </button>
        </div>
        <div style={{ fontSize: '15px', fontWeight: 600, letterSpacing: '-0.01em' }}>Settings</div>
        <div style={{ width: '60px' }} />
      </div>

      {/* Layout: sidebar (desktop) | content. Mobile: pills + content. */}
      <div className="infos-settings-wrapper" style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>
        {/* Sidebar — visible on screens ≥720px via the .infos-settings-sidebar class.
            v23.1: Left-border accent on active item, slightly softer hover, divider before "Sign out". */}
        <nav className="infos-settings-sidebar" style={{
          flexShrink: 0,
          width: '224px',
          background: C.cardBg,
          borderRight: `1px solid ${C.border}`,
          padding: '14px 10px',
          overflowY: 'auto',
        }}>
          {visibleSections.map((s) => {
            const isActive = activeSection === s.key;
            return (
              <div key={s.key}>
                <button onClick={() => setActiveSection(s.key)} type="button"
                  style={{
                    position: 'relative',
                    display: 'flex', alignItems: 'center', gap: '11px',
                    width: '100%', textAlign: 'left',
                    padding: '9px 12px 9px 14px',
                    marginBottom: '1px',
                    fontSize: '13.5px',
                    fontWeight: isActive ? 600 : 500,
                    background: isActive ? C.accentSoft : 'transparent',
                    color: isActive ? C.accentText : C.textPrimary,
                    border: 'none',
                    borderLeft: `3px solid ${isActive ? C.accent : 'transparent'}`,
                    borderRadius: '6px',
                    cursor: 'pointer', fontFamily: 'inherit',
                    transition: 'background 0.12s, color 0.12s',
                  }}
                  onMouseEnter={(e) => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = C.softBg; }}
                  onMouseLeave={(e) => { if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}>
                  <span style={{ fontSize: '15px', lineHeight: 1, width: '18px', display: 'inline-block', textAlign: 'center' }}>{s.icon}</span>
                  <span>{s.label}</span>
                </button>
              </div>
            );
          })}
        </nav>

        {/* Mobile pills — only visible on narrow screens via .infos-settings-pills */}
        <div className="infos-settings-pills" style={{
          display: 'none', flexShrink: 0,
          padding: '10px 12px',
          borderBottom: `1px solid ${C.border}`,
          background: C.cardBg,
          overflowX: 'auto',
        }}>
          {visibleSections.map((s) => (
            <button key={s.key} onClick={() => setActiveSection(s.key)} type="button"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '6px',
                padding: '7px 12px', marginRight: '6px',
                fontSize: '12.5px', fontWeight: 500, whiteSpace: 'nowrap',
                background: activeSection === s.key ? C.accentSoft : C.softBg,
                color: activeSection === s.key ? C.accentText : C.textSecondary,
                border: 'none', borderRadius: '999px',
                cursor: 'pointer', fontFamily: 'inherit',
              }}>
              <span>{s.icon}</span>
              <span>{s.label}</span>
            </button>
          ))}
        </div>

        {/* Content pane */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px clamp(16px, 5vw, 36px)' }}>
          <div style={{ maxWidth: '640px' }}>


          {/* ============== ACCOUNT (CREDENTIALS) SECTION ============== */}
          {activeSection === 'account' && (
            <>
              <SectionHeading title="Account" sub={isZeusUser ? 'Change the main admin username and password.' : 'Change your password.'} />
          {/* Credentials section */}
          <div style={{ ...S.softCard, marginBottom: '1rem' }}>
            <div style={{ fontSize: '15px', fontWeight: 600, marginBottom: '4px', letterSpacing: '-0.01em' }}>
              {isZeusUser ? 'Change admin credentials' : 'Change your password'}
            </div>
            {currentZeus && (
              <div style={{ fontSize: '13px', color: C.textSecondary, marginBottom: '16px' }}>
                {isZeusUser ? 'Current username: ' : 'Signed in as: '}
                <span style={{ fontFamily: 'ui-monospace, monospace', color: C.textPrimary, fontWeight: 500 }}>{currentZeus.username}</span>
              </div>
            )}
            {isZeusUser && (
              <div style={{ marginBottom: '12px' }}><label style={S.label}>New username</label><TextInput value={newUsername} onChange={(e: any) => setNewUsername(e.target.value)} /></div>
            )}
            <div style={{ marginBottom: '12px' }}><label style={S.label}>New password</label><TextInput type="password" value={newPassword} onChange={(e: any) => setNewPassword(e.target.value)} /></div>
            <div style={{ marginBottom: '12px' }}><label style={S.label}>Confirm new password</label><TextInput type="password" value={confirmPass} onChange={(e: any) => setConfirmPass(e.target.value)} /></div>
            {err && <div style={{ fontSize: '13px', color: C.danger, marginBottom: '10px', padding: '8px 12px', background: C.dangerSoft, borderRadius: '6px', fontWeight: 500 }}>{err}</div>}
            {msg && <div style={{ fontSize: '13px', color: C.success, marginBottom: '10px', padding: '8px 12px', background: C.successSoft, borderRadius: '6px', fontWeight: 500 }}>{msg}</div>}
            <div style={{ textAlign: 'right' }}>
              <Btn primary onClick={isZeusUser ? saveZeusCreds : saveCoPassword} disabled={busy} style={{ opacity: busy ? 0.7 : 1 }}>{busy ? 'Saving…' : 'Save changes'}</Btn>
            </div>
          </div>
            </>
          )}

          {/* ============== TRASH SECTION ============== */}
          {activeSection === 'trash' && isAdminRole(user.role) && (
            <>
              <SectionHeading title="Trash" sub="Recently deleted items are kept here for 30 days. Restore or permanently delete." />
              <div style={{ ...S.softCard, marginBottom: '1rem' }}>
                <div style={{ fontSize: '15px', fontWeight: 600, marginBottom: '4px', letterSpacing: '-0.01em' }}>🗑 Open Trash bin</div>
                <div style={{ fontSize: '13px', color: C.textSecondary, marginBottom: '12px' }}>
                  Browse soft-deleted notices, backend, games, and Id &amp; Pass entries.
                </div>
                <Btn primary onClick={onOpenTrash} style={{ fontSize: '13px' }}>Open Trash</Btn>
              </div>
            </>
          )}

          {/* ============== APPEARANCE SECTION ============== */}
          {activeSection === 'appearance' && (
            <>
              <SectionHeading title="Appearance" sub="Choose how Infos looks. Auto follows your system preference and changes automatically." />
              <div style={{ ...S.softCard, marginBottom: '1rem' }}>
                <div style={{ fontSize: '15px', fontWeight: 600, marginBottom: '12px', letterSpacing: '-0.01em' }}>🎨 Theme</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
                  {[
                    { key: 'light', label: 'Light', icon: '☀️' },
                    { key: 'dark', label: 'Dark', icon: '🌙' },
                    { key: 'auto', label: 'Auto', icon: '✨' },
                  ].map((t) => {
                    const isActive = theme === t.key;
                    return (
                      <button key={t.key} type="button" onClick={() => setTheme(t.key)}
                        style={{
                          padding: '14px 10px',
                          background: isActive ? C.accentSoft : C.softBg,
                          color: isActive ? C.accentText : C.textPrimary,
                          border: `2px solid ${isActive ? C.accent : 'transparent'}`,
                          borderRadius: '10px',
                          cursor: 'pointer',
                          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px',
                          fontSize: '13px', fontWeight: isActive ? 600 : 500,
                          fontFamily: 'inherit',
                          transition: 'background 0.15s, border-color 0.15s',
                        }}>
                        <span style={{ fontSize: '22px' }}>{t.icon}</span>
                        <span>{t.label}</span>
                      </button>
                    );
                  })}
                </div>
                <div style={{ fontSize: '11.5px', color: C.textTertiary, marginTop: '12px', lineHeight: 1.5 }}>
                  Theme preference is saved on this device. Other devices keep their own preference.
                </div>
              </div>
            </>
          )}

          {/* ============== DATA / BACKUP SECTION ============== */}
          {activeSection === 'data' && isAdminRole(user.role) && (
            <>
              <SectionHeading title="Backup & Data" sub="Export everything in your workspace as JSON, or restore from a previous backup." />
              <div style={{ ...S.softCard, marginBottom: '1rem' }}>
                <div style={{ fontSize: '15px', fontWeight: 600, marginBottom: '4px', letterSpacing: '-0.01em' }}>💾 Export &amp; restore</div>
                <div style={{ fontSize: '13px', color: C.textSecondary, marginBottom: '14px' }}>
                  Backup contains all your notices, system entries, games, Id &amp; Pass entries, and sub-admins. Restore replaces existing data.
                </div>
                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                  <Btn onClick={doExportAll} disabled={exporting}>{exporting ? 'Exporting…' : '↓ Export all data'}</Btn>
                  <Btn onClick={() => fileRef.current?.click()}>↑ Import from backup</Btn>
                  <input ref={fileRef} type="file" accept="application/json,.json" onChange={doImport} style={{ display: 'none' }} />
                </div>
                {importStatus && <div style={{ fontSize: '13px', marginTop: '12px', padding: '8px 12px', background: C.softBg, borderRadius: '6px', fontWeight: 500 }}>{importStatus}</div>}
              </div>
            </>
          )}

          {/* ============== DEVICES SECTION (Zeus only) ============== */}
          {activeSection === 'devices' && isZeusUser && (
            <>
              <SectionHeading title="Devices & Sessions" sub="See every active session across the platform and force-logout specific devices." />
              <div style={{ ...S.softCard, marginBottom: '1rem' }}>
                <div style={{ fontSize: '15px', fontWeight: 600, marginBottom: '4px', letterSpacing: '-0.01em' }}>📱 Manage devices</div>
                <div style={{ fontSize: '13px', color: C.textSecondary, marginBottom: '14px' }}>
                  View who&apos;s logged in on which devices. Rename or revoke any session. Force-logout takes effect within ~30 seconds.
                </div>
                <Btn primary onClick={onOpenDevices} style={{ fontSize: '13px' }}>Open Devices manager</Btn>
              </div>
            </>
          )}

          {/* ============== PRIVACY SECTION ============== */}
          {activeSection === 'privacy' && (
            <>
              <SectionHeading title="Privacy" sub="How your data is handled in Infos." />
              <div style={{ ...S.softCard, marginBottom: '1rem' }}>
                <div style={{ fontSize: '15px', fontWeight: 600, marginBottom: '8px', letterSpacing: '-0.01em' }}>🔒 Privacy summary</div>
                <div style={{ fontSize: '13.5px', color: C.textSecondary, lineHeight: 1.7 }}>
                  Infos stores your username, password, profile picture, and the content you create (notices, entries, credentials) in a Supabase database. Data is scoped to your workspace and never shared with other workspaces.
                  <br/><br/>
                  We don&apos;t use third-party advertising or analytics. The app runs as a Progressive Web App and stores some preferences (theme, notification settings, last-seen timestamps) on your device.
                  <br/><br/>
                  For account deletion or data removal, contact your workspace admin or Zeus.
                </div>
                <div style={{ marginTop: '14px' }}>
                  <a href="/privacy" target="_blank" rel="noreferrer"
                    style={{ fontSize: '13px', color: C.accent, textDecoration: 'none', fontWeight: 500 }}>
                    View full privacy policy →
                  </a>
                </div>
              </div>
            </>
          )}

          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------- Portal ----------------
function Portal({ user, accounts, activeKey, onSwitch, onAddAccount, onSignOut, onSignOutAll, onUpdateUser, theme, setTheme }: any) {
  const isAdmin = isAdminRole(user.role);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);                  // v21.0
  const [searchOpen, setSearchOpen] = useState(false);                // v21.0
  const [welcomeOpen, setWelcomeOpen] = useState(false);              // v21.0
  const [trashOpen, setTrashOpen] = useState(false);                  // v21.4
  const [whatChangedOpen, setWhatChangedOpen] = useState(false);      // v22.1
  const [devicesOpen, setDevicesOpen] = useState(false);              // v22.2

  // v21.3: Toast system. Mounted at Portal level (always-on, top of z-stack).
  // Exposed via window.__infosToast so deeply-nested components can fire toasts
  // without prop drilling through every level.
  const [toastEl, toast] = useToast();
  useEffect(() => {
    (window as any).__infosToast = toast;
    return () => { try { delete (window as any).__infosToast; } catch {} };
  }, [toast]);

  // v19: Resolve which workspace this user "lives in".
  // Used by every loader to scope queries.
  //   Zeus      → 'zeus'
  //   Co-admin  → their own user id (they own a workspace)
  //   Sub-admin → their parent admin's id (whoever created them)
  const workspaceId = useMemo(() => workspaceIdForUser(user), [user]);

  const getInitialTab = () => {
    if (typeof window === 'undefined') return 'notice';
    try {
      const hash = window.location.hash.replace('#', '');
      const valid = ['notice', 'backend', 'games', 'idpass', 'admins'];
      if (valid.includes(hash)) return hash;
      const stored = window.localStorage.getItem('infos:active_tab');
      if (stored && valid.includes(stored)) return stored;
    } catch {}
    return 'notice';
  };
  const [tab, setTabState] = useState<string>(getInitialTab);
  const setTab = (t: string) => {
    setTabState(t);
    try {
      window.localStorage.setItem('infos:active_tab', t);
      window.history.replaceState(null, '', `#${t}`);
    } catch {}
  };

  const [subs, setSubs] = useState<any[]>([]);
  const [backend, setBackend] = useState<any[]>([]);
  const [games, setGames] = useState<any[]>([]);
  const [idpass, setIdpass] = useState<any[]>([]);
  const [notices, setNotices] = useState<any[]>([]);
  const [pastes, setPastes] = useState<any[]>([]);
  const [aboutContent, setAboutContent] = useState<AboutContent>(DEFAULT_ABOUT);
  const [loaded, setLoaded] = useState(false);

  // Per-table reloaders — scoped by current workspace.
  // about_content stays SHARED (no ownerId) per design decision.
  // paste_buffer is workspace-scoped at the loader level; sub-admin self-only
  // visibility is enforced client-side in the CopyPasteSection component.
  const reloaders = useMemo(() => ({
    sub_admins: async () => { try { setSubs(await loadSubs(workspaceId)); } catch (e) { console.error(e); } },
    backend_entries: async () => { try { setBackend(await loadBackend(workspaceId)); } catch (e) { console.error(e); } },
    game_entries: async () => { try { setGames(await loadGames(workspaceId)); } catch (e) { console.error(e); } },
    idpass_entries: async () => { try { setIdpass(await loadIdPass(workspaceId)); } catch (e) { console.error(e); } },
    notices: async () => { try { setNotices(await loadNotices(workspaceId)); } catch (e) { console.error(e); } },
    paste_buffer: async () => { try { setPastes(await loadPasteBuffer(workspaceId)); } catch (e) { console.error(e); } },
    about_content: async () => { try { setAboutContent(await loadAbout()); } catch (e) { console.error(e); } },
  }), [workspaceId]);

  // Full reload (used after bulk imports)
  const reloadAll = useCallback(async () => {
    await Promise.all(Object.values(reloaders).map(fn => fn()));
  }, [reloaders]);

  // Debounced realtime handler — coalesces multiple rapid events on the same table.
  // Exception: paste_buffer fires with NO debounce so cross-device sync of
  // copy-paste entries feels instant (the whole point of the feature).
  const debounceTimers = useRef<Record<string, any>>({});
  const reloadTable = useCallback((table: string) => {
    const fn = (reloaders as any)[table];
    if (!fn) return;
    if (table === 'paste_buffer') {
      // Instant fire — no debounce
      fn();
      return;
    }
    // Debounce 20ms — fast enough to feel instant, still coalesces rapid bulk events
    clearTimeout(debounceTimers.current[table]);
    debounceTimers.current[table] = setTimeout(() => fn(), 20);
  }, [reloaders]);

  useEffect(() => {
    let alive = true;
    const timersRef = debounceTimers.current;
    // v19: When switching accounts (activeKey changes) we MUST clear data first,
    // otherwise the previous workspace's content briefly flashes on screen
    // before the new workspace's data arrives. Reset loaded to false so the
    // splash/loader shows during the gap.
    setLoaded(false);
    setSubs([]); setBackend([]); setGames([]); setIdpass([]); setNotices([]); setPastes([]);
    // v20.5: Subscribe to realtime BEFORE the initial load. WebSocket setup
    // happens in parallel with the data fetch, shaving 100-300ms off perceived
    // startup. If a realtime event arrives during the load, it triggers an
    // extra (harmless) reload via the debounced handler.
    const unsub = subscribeAll(
      ['sub_admins', 'backend_entries', 'game_entries', 'idpass_entries', 'notices', 'paste_buffer', 'about_content'],
      (table: string) => { if (alive) reloadTable(table); }
    );
    (async () => {
      // v20.5: Run paste purge in parallel with the initial reload instead of
      // serializing them. Purge is fire-and-forget (its result doesn't gate
      // anything), so we don't await it.
      purgeExpiredPaste(workspaceId).catch(() => {});
      await reloadAll();
      if (alive) setLoaded(true);
    })();
    return () => {
      alive = false;
      unsub();
      // Clear any pending debounce timers (use captured ref to satisfy lint)
      Object.values(timersRef).forEach(t => clearTimeout(t));
    };
  }, [activeKey, reloadAll, reloadTable, workspaceId]);

  // v20: Resilient sync. Mobile browsers (especially TWA) suspend WebSockets
  // when the app goes to background. When the user comes back (visibility
  // change → visible) or the network reconnects, refetch all data so the UI
  // is current even if realtime missed events while we were asleep.
  useEffect(() => {
    let lastRefresh = Date.now();
    const refresh = () => {
      // Throttle to once per 2 seconds — prevents storm if multiple events fire
      // (visibilitychange + online can both arrive when waking from sleep).
      if (Date.now() - lastRefresh < 2000) return;
      lastRefresh = Date.now();
      // Best-effort cleanup of expired paste rows, then reload everything
      purgeExpiredPaste(workspaceId).finally(() => reloadAll());
    };
    const onVis = () => { if (!document.hidden) refresh(); };
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [reloadAll, workspaceId]);

  // v22.2: Session heartbeat + revoke check.
  // - Pings sessions.last_seen_at every 60s while app is open (so admin sees
  //   a fresh "last seen" stamp).
  // - Polls sessions.revoked_at every 30s. If the row is revoked, sign out
  //   immediately (force-logout from Zeus's Devices panel).
  // Both run only when sessionId is set, which happens after a successful login.

  // v24.2: Backfill session registration for users who logged in BEFORE v22.2
  // was deployed. Their stored user object has no sessionId, so they never
  // showed up in the Devices manager. Register them on app load.
  useEffect(() => {
    if (!user || user.sessionId) return;
    let alive = true;
    (async () => {
      try {
        const deviceId = getDeviceId();
        const userIdForSession = user.role === 'zeus' ? 'zeus' : user.id;
        const ownerForSession = user.ownerId || 'zeus';
        const sessId = await upsertSession({
          deviceId,
          userId: userIdForSession,
          username: user.username,
          role: user.role,
          ownerId: ownerForSession,
          deviceLabel: null,
          userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
          platform: detectPlatform(),
        });
        if (alive && onUpdateUser) onUpdateUser({ sessionId: sessId });
      } catch (e) {
        console.error('[session backfill]', e);
      }
    })();
    return () => { alive = false; };
  }, [user, onUpdateUser]);

  useEffect(() => {
    if (!user?.sessionId) return;
    const sessId: string = user.sessionId;
    let alive = true;

    const heartbeat = () => { if (alive) pingSession(sessId).catch(() => {}); };
    const checkRevoked = async () => {
      if (!alive) return;
      try {
        const revoked = await isSessionRevoked(sessId);
        if (revoked && alive) {
          // Wipe localStorage and force a hard reload — simplest way to
          // ensure the device is fully signed out.
          try { onSignOutAll(); } catch {}
          try { window.location.reload(); } catch {}
        }
      } catch { /* swallow */ }
    };

    // Fire once immediately so the timestamps update right after login
    heartbeat();
    const hbId = window.setInterval(heartbeat, 60_000);  // 60 seconds
    const rvId = window.setInterval(checkRevoked, 30_000); // 30 seconds

    // Also heartbeat when the user comes back to the tab (after long idle)
    const onVis = () => { if (!document.hidden) { heartbeat(); checkRevoked(); } };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      alive = false;
      window.clearInterval(hbId);
      window.clearInterval(rvId);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [user?.sessionId, onSignOutAll]);

  // v22.2: Best-effort prune of stale session rows on app load.
  // Removes sessions not seen in 30+ days. Runs once per Portal mount.
  useEffect(() => {
    pruneStaleSessions().catch(() => {});
  }, []);

  // v24.3: Detect NEW items as they arrive (via realtime sync) and fire a
  // chime + browser notification for each one — but only for items visible
  // to the current user.
  //
  // Strategy:
  //   - On first load (loaded=false → loaded=true), populate the seen set
  //     with everything currently present. Don't fire — these aren't new.
  //   - On every subsequent change to notices/backend/games/idpass, diff
  //     against the seen set. New IDs = fire notification.
  //   - Visibility: admins (zeus, co) get all; sub-admins only items where
  //     they are in recipients (notices) or assignees (entries).
  //
  // User preferences are stored in localStorage:
  //   - infos:sound_enabled   (default 'on')
  //   - browser permission is checked live via Notification.permission
  const seenIdsRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!loaded) return;
    const isAdmin = isAdminRole(user.role);

    // Read user prefs
    let soundOn = true;
    try { soundOn = localStorage.getItem('infos:sound_enabled') !== 'off'; } catch {}
    const canNotify = typeof Notification !== 'undefined' && Notification.permission === 'granted';

    // Build the current visible-to-user set
    const visibleNow = new Set<string>();
    const newItems: Array<{ kind: string; title: string; body: string; id: string }> = [];

    const addIfVisible = (item: any, kind: 'notice' | 'backend' | 'game' | 'idpass') => {
      if (!item || !item.id) return;
      // Skip soft-deleted items
      if (item.deletedAt) return;
      const key = `${kind}:${item.id}`;
      // Visibility: notices use recipients[], entries use assignees[]
      const targetList = kind === 'notice' ? item.recipients : item.assignees;
      if (!isAdmin && !isVisibleToSub(targetList, user.id)) return;
      visibleNow.add(key);
      // First load: just record what's visible, don't fire
      if (seenIdsRef.current === null) return;
      // Subsequent updates: anything not previously seen is NEW
      if (!seenIdsRef.current.has(key)) {
        if (kind === 'notice') {
          newItems.push({
            kind, id: key,
            title: 'New notice',
            body: item.title || item.body?.slice(0, 80) || 'A new notice was posted',
          });
        } else if (kind === 'backend') {
          newItems.push({
            kind, id: key,
            title: 'New system entry',
            body: item.title || item.username || 'A new system entry was assigned to you',
          });
        } else if (kind === 'game') {
          newItems.push({
            kind, id: key,
            title: 'New game entry',
            body: item.game || item.username || 'A new game entry was assigned to you',
          });
        } else if (kind === 'idpass') {
          newItems.push({
            kind, id: key,
            title: 'New Id & Pass entry',
            body: item.game || item.username || 'A new credential was assigned to you',
          });
        }
      }
    };

    notices.forEach((n: any) => addIfVisible(n, 'notice'));
    backend.forEach((b: any) => addIfVisible(b, 'backend'));
    games.forEach((g: any) => addIfVisible(g, 'game'));
    idpass.forEach((i: any) => addIfVisible(i, 'idpass'));

    // First load — seed the seen set, don't fire anything
    if (seenIdsRef.current === null) {
      seenIdsRef.current = visibleNow;
      return;
    }

    // Fire notifications for NEW items
    if (newItems.length > 0) {
      if (soundOn) {
        try { playChime(); } catch {}
      }
      if (canNotify) {
        // Coalesce many-at-once: if 3+ new items, show one summary instead of spam
        if (newItems.length >= 3) {
          showBrowserNotification(
            'Infos: New activity',
            `${newItems.length} new items`,
            'infos:summary',
          );
        } else {
          newItems.forEach((it) => {
            showBrowserNotification(it.title, it.body, it.id);
          });
        }
      }
    }

    // Update the seen set for next time
    seenIdsRef.current = visibleNow;
  }, [loaded, notices, backend, games, idpass, user.id, user.role]);

  // v21.0: Show the welcome modal ONCE per device for this user.
  // Tracked in localStorage with a per-user-id key so the modal doesn't reopen
  // every time, and doesn't appear at all once the user has seen it.
  // Skipped for the Zeus account (no need to onboard the platform owner).
  useEffect(() => {
    if (!loaded) return;
    if (user.role === 'zeus') return;
    if (!user.id) return;
    try {
      const seenKey = `infos:welcome_seen:${user.id}`;
      if (localStorage.getItem(seenKey) === '1') return;
      // Open after a short delay so it doesn't fight the splash/initial paint
      const t = setTimeout(() => setWelcomeOpen(true), 600);
      return () => clearTimeout(t);
    } catch {}
  }, [loaded, user.id, user.role]);

  const dismissWelcome = useCallback(() => {
    setWelcomeOpen(false);
    try { localStorage.setItem(`infos:welcome_seen:${user.id}`, '1'); } catch {}
  }, [user.id]);

  // If on admins tab but not admin, fallback
  useEffect(() => {
    if (!isAdmin && tab === 'admins') setTab('notice');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  const tabs = [
    { id: 'notice', label: 'Notice' },
    { id: 'backend', label: 'System' },
    { id: 'games', label: 'Games' },
    { id: 'idpass', label: 'Id & Pass' },
    ...(isAdmin ? [{ id: 'admins', label: 'Create Admin' }] : []),
  ];

  return (
    <div style={S.shell}>
      <AboutModal
        open={aboutOpen}
        onClose={() => setAboutOpen(false)}
        content={aboutContent}
        canEdit={user.role === 'zeus'}
        onSaved={() => { reloaders.about_content(); setAboutOpen(false); }}
      />
      <SettingsModal
        open={settingsOpen} onClose={() => setSettingsOpen(false)}
        user={user} onForceLogout={onSignOutAll}
        onOpenGuide={() => { setSettingsOpen(false); setGuideOpen(true); }}
        onOpenTrash={() => { setSettingsOpen(false); setTrashOpen(true); }}
        onOpenDevices={() => { setSettingsOpen(false); setDevicesOpen(true); }}
        onOpenAbout={() => { setSettingsOpen(false); setAboutOpen(true); }}
        theme={theme} setTheme={setTheme}
      />
      {/* v21.0: New modals + install prompt banner */}
      <UserGuideModal open={guideOpen} onClose={() => setGuideOpen(false)} user={user} />
      <WelcomeModal open={welcomeOpen} onClose={dismissWelcome} user={user} onOpenGuide={() => setGuideOpen(true)} />
      {/* v21.4: Trash modal — admin-only */}
      <TrashModal open={trashOpen} onClose={() => setTrashOpen(false)} workspaceId={workspaceId} onAfterChange={reloadAll} />
      {/* v22.1: What changed this week activity feed */}
      <WhatChangedModal
        open={whatChangedOpen}
        onClose={() => setWhatChangedOpen(false)}
        user={user}
        notices={notices} backend={backend} games={games} idpass={idpass}
        onNavigate={(t: string) => setTab(t)}
      />
      {/* v22.2: Devices manager — Zeus only */}
      <DevicesModal
        open={devicesOpen}
        onClose={() => setDevicesOpen(false)}
        currentSessionId={user?.sessionId || null}
      />
      <GlobalSearchModal
        open={searchOpen} onClose={() => setSearchOpen(false)}
        user={user} subs={subs}
        notices={notices} backend={backend} games={games} idpass={idpass}
        onNavigate={(t: string) => setTab(t)}
      />
      <InstallPromptBanner />
      {toastEl}
      <div style={S.card}>
        <div style={S.headerBar}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
            <Image src="/logo.png" alt="" width={38} height={38} style={{ flexShrink: 0 }} />
            <div style={{ minWidth: 0 }}>
              <div style={S.brand}>Infos</div>
              <div style={S.sub}>
                {user.username} — {user.role === 'zeus' ? 'main admin' : user.role === 'co' ? 'co-admin' : 'sub-admin'}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
            {/* v21.2: Notification bell — only shown when data is loaded */}
            {loaded && (
              <NotificationBell
                user={user} workspaceId={workspaceId}
                notices={notices} backend={backend} games={games} idpass={idpass}
                onNavigate={(t: string) => setTab(t)}
              />
            )}
            <AccountSwitcher accounts={accounts} activeKey={activeKey} user={user}
              onSwitch={onSwitch} onAddAccount={onAddAccount} onSignOut={onSignOut} onSignOutAll={onSignOutAll}
              onOpenAbout={() => setAboutOpen(true)}
              onOpenSettings={() => setSettingsOpen(true)}
              onOpenGuide={() => setGuideOpen(true)}
              onOpenSearch={() => setSearchOpen(true)}
              onOpenWhatChanged={() => setWhatChangedOpen(true)}
              onOpenDevices={() => setDevicesOpen(true)}
              theme={theme} setTheme={setTheme} />
          </div>
        </div>
        {/* v22.0: Search bar moved from user menu to main page (above tabs).
            Click to open the global search modal — searches Notices, System,
            Games, and Id&Pass simultaneously. */}
        <button
          onClick={() => setSearchOpen(true)}
          type="button"
          className="infos-btn"
          style={{
            display: 'flex', alignItems: 'center', gap: '10px',
            width: '100%',
            margin: '8px 0 12px',
            padding: '11px 14px',
            background: C.softBg,
            border: `1px solid ${C.border}`,
            borderRadius: '10px',
            cursor: 'pointer',
            color: C.textTertiary,
            fontSize: '13.5px',
            fontFamily: 'inherit',
            textAlign: 'left',
          }}>
          <span style={{ fontSize: '15px', flexShrink: 0 }}>🔍</span>
          <span style={{ flex: 1 }}>Search everything…</span>
          <span style={{ fontSize: '11px', color: C.textTertiary, opacity: 0.7, flexShrink: 0 }}>Notices · System · Games · Id&amp;Pass</span>
        </button>
        <div className="infos-tabs" style={S.tabs}>
          {tabs.map((t) => <button key={t.id} onClick={() => setTab(t.id)} className="infos-tab" style={tabStyle(tab === t.id)}>{t.label}</button>)}
        </div>
        {!loaded ? (
          <div style={{ paddingTop: '0.5rem' }}>
            <Skeleton lines={4} />
          </div>
        ) :
          tab === 'notice' ? <NoticeTab user={user} subs={subs} items={notices} setItems={setNotices} reload={reloaders.notices} pastes={pastes} setPastes={setPastes} reloadPastes={reloaders.paste_buffer} /> :
          tab === 'backend' ? <GameListTab table="backend_entries" user={user} subs={subs} entries={backend} setEntries={setBackend} reload={reloaders.backend_entries} emptyMsg="No system entries yet." /> :
          tab === 'games' ? <GameListTab table="game_entries" user={user} subs={subs} entries={games} setEntries={setGames} reload={reloaders.game_entries} emptyMsg="No games yet." /> :
          tab === 'idpass' ? <IdPassTab user={user} subs={subs} entries={idpass} setEntries={setIdpass} reload={reloaders.idpass_entries} /> :
          tab === 'admins' && isAdmin ? <CreateAdminPanel user={user} subs={subs} setSubs={setSubs} backend={backend} games={games} idpass={idpass} notices={notices} reload={reloadAll} reloadSubs={reloaders.sub_admins} /> : null}
      </div>
    </div>
  );
}

// ---------------- App root ----------------
export default function InfosApp() {
  const [hydrated, setHydrated] = useState(false);
  const [showOpenSplash, setShowOpenSplash] = useState(true);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [addingAccount, setAddingAccount] = useState(false);
  const [theme, setTheme] = useTheme();
  const [envMissing, setEnvMissing] = useState(false);

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) { setEnvMissing(true); setHydrated(true); return; }
    const accs = loadSession<any[]>('ACCOUNTS', []);
    const act = loadSession<string | null>('ACTIVE', null);
    setAccounts(accs);
    if (accs.length > 0) setActiveKey(act && accs.find((a) => accKey(a) === act) ? act : accKey(accs[0]));
    setHydrated(true);

    // v19: Validate persisted sub-admin / co-admin accounts against the DB.
    // If the user was deleted by an admin, sign them out of this device.
    // Zeus is always valid (zeus_creds is protected by single-row check).
    // Failures (offline, network) are silent — we keep the cached session for
    // offline use and re-validate next reload.
    if (accs.length > 0) {
      (async () => {
        const subAccs = accs.filter((a: any) => a.role !== 'zeus' && a.id);
        if (subAccs.length === 0) return;
        try {
          const validations = await Promise.all(
            subAccs.map(async (a: any) => {
              const row = await loadSubById(a.id).catch(() => undefined);
              // undefined = network failure (don't sign out); null = confirmed deleted
              return { acc: a, exists: row === undefined ? true : row !== null };
            })
          );
          const stillValid = accs.filter((a: any) => {
            if (a.role === 'zeus') return true;
            const v = validations.find(v => accKey(v.acc) === accKey(a));
            return v ? v.exists : true;
          });
          if (stillValid.length !== accs.length) {
            // Some accounts were revoked. Update state + storage.
            setAccounts(stillValid);
            const newActive = stillValid.length === 0
              ? null
              : (stillValid.find((a: any) => accKey(a) === act) ? act : accKey(stillValid[0]));
            setActiveKey(newActive);
            saveSession('ACCOUNTS', stillValid);
            saveSession('ACTIVE', newActive);
          }
        } catch {
          // Silent fail — keep cached sessions if validation can't run
        }
      })();
    }
  }, []);

  const persist = (accs: any[], act: string | null) => { saveSession('ACCOUNTS', accs); saveSession('ACTIVE', act); };
  const addAccount = (u: any) => {
    const k = accKey(u);
    if (accounts.some((a) => accKey(a) === k)) return false;
    const next = [...accounts, u];
    setAccounts(next); setActiveKey(k); setAddingAccount(false);
    persist(next, k); return true;
  };
  const switchTo = (k: string) => { if (accounts.some((a) => accKey(a) === k)) { setActiveKey(k); saveSession('ACTIVE', k); } };
  const signOut = (k: string) => {
    // v22.2: Best-effort delete the session row for the account being signed out.
    const target = accounts.find((a) => accKey(a) === k);
    if (target?.sessionId) deleteSession(target.sessionId).catch(() => {});
    const next = accounts.filter((a) => accKey(a) !== k);
    setAccounts(next);
    if (next.length === 0) { setActiveKey(null); persist(next, null); }
    else { const na = activeKey === k ? accKey(next[0]) : activeKey; setActiveKey(na); persist(next, na); }
  };
  const signOutAll = () => {
    // v22.2: Delete all session rows for accounts being cleared.
    accounts.forEach((a) => { if (a.sessionId) deleteSession(a.sessionId).catch(() => {}); });
    setAccounts([]); setActiveKey(null); setAddingAccount(false); persist([], null);
  };

  // v22.0: Update fields on the currently active user (e.g. profilePicUrl).
  // Patches the accounts array and persists to localStorage.
  const updateActiveUser = (patch: Partial<any>) => {
    if (!activeKey) return;
    const next = accounts.map((a) => accKey(a) === activeKey ? { ...a, ...patch } : a);
    setAccounts(next);
    persist(next, activeKey);
  };

  if (!hydrated) return null;
  if (envMissing) {
    return (
      <div style={S.shell}>
        <div style={S.card}>
          <div style={{ fontSize: '20px', fontWeight: 700, letterSpacing: '-0.02em', marginBottom: '8px' }}>⚠️ Configuration missing</div>
          <div style={{ fontSize: '14px', color: C.textSecondary, marginBottom: '16px', lineHeight: 1.6 }}>
            The app can&apos;t connect to the database because Supabase environment variables aren&apos;t set.
          </div>
          <div style={{ fontSize: '13px', color: C.textSecondary, background: C.softBg, padding: '12px 14px', borderRadius: '8px', lineHeight: 1.6 }}>
            <strong>If you&apos;re the admin:</strong> in Vercel, go to Project → Settings → Environment Variables and add:
            <ul style={{ margin: '8px 0 0', paddingLeft: '20px' }}>
              <li><code style={{ fontFamily: 'ui-monospace, monospace', fontSize: '12px' }}>NEXT_PUBLIC_SUPABASE_URL</code></li>
              <li><code style={{ fontFamily: 'ui-monospace, monospace', fontSize: '12px' }}>NEXT_PUBLIC_SUPABASE_ANON_KEY</code></li>
            </ul>
            Then redeploy from the Deployments tab.
          </div>
        </div>
      </div>
    );
  }
  if (showOpenSplash) return <Splash ms={1200} subtitle="Loading…" onDone={() => setShowOpenSplash(false)} />;
  if (accounts.length === 0) return <LoginForm onLogin={addAccount} />;
  if (addingAccount) return <LoginForm onLogin={addAccount} onCancel={() => setAddingAccount(false)} cancelLabel="Back" subtitle="Add another account" />;
  const activeUser = accounts.find((a) => accKey(a) === activeKey);
  if (!activeUser) return <LoginForm onLogin={addAccount} />;
  return <Portal user={activeUser} accounts={accounts} activeKey={activeKey} onSwitch={switchTo} onAddAccount={() => setAddingAccount(true)} onSignOut={signOut} onSignOutAll={signOutAll} onUpdateUser={updateActiveUser} theme={theme} setTheme={setTheme} />;
}
