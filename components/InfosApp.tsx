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
  loadPasteBuffer, addPaste, deletePaste, purgeExpiredPaste, PASTE_TTL_MS,
  subscribeAll, exportAll, bulkInsert,
  loadAbout, DEFAULT_ABOUT, AboutContent,
} from '@/lib/storage';
import { C, S, tabStyle } from './styles';
import { Timestamp, useConfirm, useTheme, SearchBar, Theme, timeAgo, fullDateTime } from './ui';
import { BulkAssignModal, BulkEntry } from './BulkAssign';
import { EditGameModal, EditIdPassModal, EditNoticeModal, EditSubAdminModal } from './EditModals';
import { AboutModal } from './AboutModal';

// Role helpers
const isAdminRole = (role: string) => role === 'zeus' || role === 'co';
const isZeus = (role: string) => role === 'zeus';

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

  const handle = async () => {
    setError(''); setBusy(true);
    try {
      if (!username.trim() || !password) return setError('Enter username and password');
      const zeus = await loadZeus();
      let matched: any = null;
      if (username.trim() === zeus.username && password === zeus.password) {
        // Zeus's workspace is always 'zeus'
        matched = { role: 'zeus', username: zeus.username, ownerId: 'zeus' };
      } else {
        // Search ALL workspaces for a matching sub_admin (single global lookup)
        const f = await findSubByCredentials(username.trim(), password);
        if (f) {
          // Co-admin: their workspace IS their own user id (they own a workspace)
          // Sub-admin: their workspace is whichever admin created them (f.ownerId)
          const role = f.role === 'co' ? 'co' : 'sub';
          const userWorkspace = role === 'co' ? f.id : f.ownerId;
          matched = { role, username: f.username, id: f.id, ownerId: userWorkspace };
        }
      }
      if (!matched) return setError('Invalid username or password');
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
        <div style={{ marginBottom: '14px' }}>
          <label style={S.label}>Password</label>
          <TextInput type="password" value={password} onChange={(e: any) => setPassword(e.target.value)} placeholder="Enter password" onKeyDown={(e: any) => e.key === 'Enter' && handle()} />
        </div>
        {error && <div style={{ fontSize: '13px', color: C.danger, marginBottom: '12px', padding: '8px 12px', background: C.dangerSoft, borderRadius: '6px', fontWeight: 500 }}>{error}</div>}
        <div style={{ display: 'flex', gap: '10px', marginTop: '4px' }}>
          {onCancel && <Btn onClick={onCancel} style={{ flex: 1 }}>{cancelLabel || 'Cancel'}</Btn>}
          <Btn primary onClick={handle} disabled={busy} style={{ flex: onCancel ? 1 : undefined, width: onCancel ? undefined : '100%', opacity: busy ? 0.7 : 1 }}>{busy ? 'Signing in…' : 'Sign in'}</Btn>
        </div>
      </div>
    </div>
  );
}

// ---------------- Account switcher (with About, Settings, Appearance) ----------------
function AccountSwitcher({ accounts, activeKey, user, onSwitch, onAddAccount, onSignOut, onSignOutAll, onOpenAbout, onOpenSettings, theme, setTheme }: any) {
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
  const avatar = (u: any, size = 28) => (
    <span style={{ width: size, height: size, borderRadius: '50%', background: avatarBg(u), color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size >= 28 ? '12px' : '10.5px', fontWeight: 600, flexShrink: 0 }}>
      {u.username.charAt(0).toUpperCase()}
    </span>
  );

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
        <div className="infos-dropdown" style={{ position: 'absolute', right: 0, top: 'calc(100% + 8px)', minWidth: '280px', background: C.cardBg, border: `1px solid ${C.borderStrong}`, borderRadius: '12px', boxShadow: 'var(--shadow-pop)', zIndex: 1000, overflow: 'hidden' }}>
          {/* 1. About Us */}
          <div style={{ padding: '6px 4px', borderBottom: `1px solid ${C.border}` }}>
            <button onClick={() => { onOpenAbout(); setOpen(false); }} style={menuBtnStyle}
              onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = C.softBg)}
              onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = 'transparent')}>
              <span>ℹ️</span> <span>About Us</span>
            </button>
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
  const handle = async () => {
    setErr('');
    if (fields.some((f: any) => !v[f.key].trim())) { setErr('All fields are required'); return; }
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
            <label style={S.label}>{f.label}</label>
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
      alert(friendlyError(err));
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
      alert(friendlyError(err));
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
      alert(friendlyError(err));
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
        {isAdmin && <AssigneeList assignees={e.assignees || []} subs={subs} />}
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
      {isAdmin && <EntryForm fields={[{ key: 'gameName', label: 'Game name' }, { key: 'shortName', label: 'Short name' }, { key: 'link', label: 'Link', placeholder: 'https://...' }]} subs={subs} onSubmit={add} />}
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
      {visible.length === 0 ? <div style={S.empty}>{q.trim() || filterSub !== 'all' ? 'No matches found.' : emptyMsg}</div> : (
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
      alert(friendlyError(err));
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
      alert(friendlyError(err));
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
      alert(friendlyError(err));
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
        {isAdmin && <AssigneeList assignees={e.assignees || []} subs={subs} />}
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
      {visible.length === 0 ? <div style={S.empty}>{q.trim() || filterSub !== 'all' ? 'No matches found.' : emptyMsg}</div> : (
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
      alert(friendlyError(err));
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
        <div style={S.empty}>Nothing here yet. Publish a credential and it&apos;ll show on your other phones instantly.</div>
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
    if (!q.trim()) return base;
    const s = q.toLowerCase();
    return base.filter((x: any) =>
      (x.title || '').toLowerCase().includes(s) ||
      (x.body || '').toLowerCase().includes(s) ||
      (x.link || '').toLowerCase().includes(s)
    );
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
      alert(friendlyError(err));
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
      alert(friendlyError(err));
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
      alert(friendlyError(err));
    }
  };
  const toggleSelect = (id: string) => setSelected(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id]);
  const isNewish = (createdAt: number) => (Date.now() - createdAt) < (24 * 60 * 60 * 1000);
  const renderItem = (x: any) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: '15px', letterSpacing: '-0.01em', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
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
        {isAdmin && <AssigneeList assignees={x.recipients || []} subs={subs} />}
        <Timestamp createdAt={x.createdAt} updatedAt={x.updatedAt} />
      </div>
      {isAdmin && !selectMode && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <Btn onClick={() => setEditing(x)} style={{ fontSize: '12px', padding: '5px 10px' }}>Edit</Btn>
          <Btn danger onClick={() => del(x)}>Delete</Btn>
        </div>
      )}
    </div>
  );
  const canReorder = isAdmin && !q.trim() && !selectMode;

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
      {visible.length === 0 ? <div style={S.empty}>{q.trim() ? 'No matches found.' : isAdmin ? 'No notices posted yet.' : 'No notices for you yet.'}</div> : (
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
      alert('Only Zeus can remove co-admins.');
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
        alert(friendlyError(err));
      }
      return;
    }
    // For CO-ADMINS: cascade delete with detailed confirm showing what will be wiped
    let counts;
    try {
      counts = await countWorkspaceContents(s.id);
    } catch (err: any) {
      alert(friendlyError(err, 'Could not count this co-admin\u2019s data. Try again.'));
      return;
    }
    const lines: string[] = [];
    if (counts.subAdmins) lines.push(`\u2022 ${counts.subAdmins} sub-admin${counts.subAdmins === 1 ? '' : 's'}`);
    if (counts.notices)   lines.push(`\u2022 ${counts.notices} notice${counts.notices === 1 ? '' : 's'}`);
    if (counts.backend)   lines.push(`\u2022 ${counts.backend} backend entr${counts.backend === 1 ? 'y' : 'ies'}`);
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
      alert(friendlyError(err, 'Could not delete co-admin workspace. Some data may have been removed; try again or refresh.'));
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

      {filteredSubs.length === 0 ? <div style={S.empty}>{viewFilter === 'all' ? 'No admins yet.' : viewFilter === 'co' ? 'No co-admins yet.' : 'No sub-admins yet.'}</div> : (
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
function SettingsModal({ open, onClose, user, onForceLogout }: any) {
  const isZeusUser = isZeus(user.role);
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
    } catch (e: any) { alert(friendlyError(e)); }
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
        recipients: n.recipients || [], created_at: n.createdAt, sort_order: n.sortOrder ?? 0,
        owner_id: targetWorkspace,
      })));
      setImportStatus('✓ Import complete. Refresh the page to see imported data.');
    } catch (e: any) { setImportStatus('Import failed: ' + friendlyError(e)); }
    ev.target.value = '';
  };

  if (!open) return null;

  return (
    <div className="infos-modal-backdrop" onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'var(--modal-backdrop)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <div className="infos-modal" onClick={(e) => e.stopPropagation()}
        style={{ background: C.cardBg, border: `1px solid ${C.borderStrong}`, borderRadius: '14px', maxWidth: '520px', width: '100%', maxHeight: '90vh', boxShadow: 'var(--shadow-pop)', display: 'flex', flexDirection: 'column' }}>
        {confirmEl}
        <div style={{ padding: '18px 20px 14px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: '16px', fontWeight: 600, letterSpacing: '-0.01em' }}>Settings</div>
          <button onClick={onClose} type="button" style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '20px', color: C.textTertiary, lineHeight: 1, padding: '4px 8px', borderRadius: '4px' }}>×</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
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

          {/* Backup & restore — admins only (sub-admins are read-only and must not be able to dump/modify workspace data) */}
          {isAdminRole(user.role) && (
            <div style={S.softCard}>
              <div style={{ fontSize: '15px', fontWeight: 600, marginBottom: '4px', letterSpacing: '-0.01em' }}>Backup &amp; restore</div>
              <div style={{ fontSize: '13px', color: C.textSecondary, marginBottom: '16px' }}>Export all data from your workspace as a JSON file, or restore from a previous backup.</div>
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                <Btn onClick={doExportAll} disabled={exporting}>{exporting ? 'Exporting…' : '↓ Export all data'}</Btn>
                <Btn onClick={() => fileRef.current?.click()}>↑ Import from backup</Btn>
                <input ref={fileRef} type="file" accept="application/json,.json" onChange={doImport} style={{ display: 'none' }} />
              </div>
              {importStatus && <div style={{ fontSize: '13px', marginTop: '12px', padding: '8px 12px', background: C.softBg, borderRadius: '6px', fontWeight: 500 }}>{importStatus}</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------- Portal ----------------
function Portal({ user, accounts, activeKey, onSwitch, onAddAccount, onSignOut, onSignOutAll, theme, setTheme }: any) {
  const isAdmin = isAdminRole(user.role);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

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
    // Debounce 80ms to coalesce rapid bulk operations
    clearTimeout(debounceTimers.current[table]);
    debounceTimers.current[table] = setTimeout(() => fn(), 80);
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
    (async () => {
      // v20: Best-effort cleanup of expired paste rows on every load.
      // Failures are silent — the loader retrieves the rows anyway, and
      // CopyPasteSection filters expired ones client-side.
      try { await purgeExpiredPaste(workspaceId); } catch {}
      await reloadAll();
      if (alive) setLoaded(true);
    })();
    const unsub = subscribeAll(
      ['sub_admins', 'backend_entries', 'game_entries', 'idpass_entries', 'notices', 'paste_buffer', 'about_content'],
      (table: string) => { if (alive) reloadTable(table); }
    );
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

  // If on admins tab but not admin, fallback
  useEffect(() => {
    if (!isAdmin && tab === 'admins') setTab('notice');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  const tabs = [
    { id: 'notice', label: 'Notice' },
    { id: 'backend', label: 'Backend' },
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
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} user={user} onForceLogout={onSignOutAll} />
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
          <AccountSwitcher accounts={accounts} activeKey={activeKey} user={user}
            onSwitch={onSwitch} onAddAccount={onAddAccount} onSignOut={onSignOut} onSignOutAll={onSignOutAll}
            onOpenAbout={() => setAboutOpen(true)}
            onOpenSettings={() => setSettingsOpen(true)}
            theme={theme} setTheme={setTheme} />
        </div>
        <div className="infos-tabs" style={S.tabs}>
          {tabs.map((t) => <button key={t.id} onClick={() => setTab(t.id)} className="infos-tab" style={tabStyle(tab === t.id)}>{t.label}</button>)}
        </div>
        {!loaded ? <div style={S.empty}>Loading…</div> :
          tab === 'notice' ? <NoticeTab user={user} subs={subs} items={notices} setItems={setNotices} reload={reloaders.notices} pastes={pastes} setPastes={setPastes} reloadPastes={reloaders.paste_buffer} /> :
          tab === 'backend' ? <GameListTab table="backend_entries" user={user} subs={subs} entries={backend} setEntries={setBackend} reload={reloaders.backend_entries} emptyMsg="No backend entries yet." /> :
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
    const next = accounts.filter((a) => accKey(a) !== k);
    setAccounts(next);
    if (next.length === 0) { setActiveKey(null); persist(next, null); }
    else { const na = activeKey === k ? accKey(next[0]) : activeKey; setActiveKey(na); persist(next, na); }
  };
  const signOutAll = () => { setAccounts([]); setActiveKey(null); setAddingAccount(false); persist([], null); };

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
  return <Portal user={activeUser} accounts={accounts} activeKey={activeKey} onSwitch={switchTo} onAddAccount={() => setAddingAccount(true)} onSignOut={signOut} onSignOutAll={signOutAll} theme={theme} setTheme={setTheme} />;
}
