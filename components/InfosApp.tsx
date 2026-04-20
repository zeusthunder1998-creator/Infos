'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import Image from 'next/image';
import {
  DEFAULT_ZEUS, ALL_SENTINEL, uid, accKey,
  isVisibleToSub, isAssignedAll,
  loadSession, saveSession,
  loadZeus, saveZeus,
  loadSubs, addSub, deleteSub,
  loadBackend, loadGames, addGameEntry, deleteGameEntry, reorderGames, updateGameAssignees,
  loadIdPass, addIdPass, deleteIdPass, reorderIdPass, updateIdPassAssignees,
  loadNotices, addNotice, deleteNotice, reorderNotices, updateNoticeRecipients,
  subscribeAll, exportAll, bulkInsert,
} from '@/lib/storage';
import { C, S, tabStyle } from './styles';
import { Timestamp, ConfirmDialog, useConfirm, useTheme, SearchBar, Theme } from './ui';
import { BulkAssignModal, BulkEntry } from './BulkAssign';

// ---------------- Splash ----------------
function Splash({ ms, onDone, subtitle, small }: any) {
  useEffect(() => {
    const t = setTimeout(onDone, ms);
    return () => clearTimeout(t);
  }, [ms, onDone]);
  const size = small ? 110 : 140;
  return (
    <div style={{ minHeight: small ? '360px' : '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2rem 1rem', animation: 'infosFadeIn 0.5s ease-out' }}>
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

// ---------------- Reorderable list (drag + arrows) ----------------
function ReorderList({ items, canReorder, onReorder, renderItem, keyFn }: any) {
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
        const isDraggingOver = overId === id && dragId && dragId !== id;
        const style = {
          ...S.item,
          ...(dragId === id ? { opacity: 0.4 } : {}),
          ...(isDraggingOver ? { borderColor: C.accent, boxShadow: `0 0 0 2px ${C.accentSoft}` } : {}),
        };
        return (
          <div key={id} className="infos-item" style={style}
            onDragOver={canReorder ? (e) => over(e, id) : undefined}
            onDrop={canReorder ? (e) => drop(e, id) : undefined}
            onDragEnd={() => { setDragId(null); setOverId(null); }}>
            {canReorder && (
              <div style={{ flexShrink: 0, width: '32px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', paddingTop: '2px' }}>
                <button onClick={(e) => { e.stopPropagation(); move(idx, -1); }} disabled={idx === 0} className="infos-arrow-btn" title="Move up" type="button">▲</button>
                <div
                  draggable
                  onDragStart={(e) => start(e, id)}
                  style={{ ...S.dragHandle, width: 'auto', padding: '2px 0' }}
                  title="Drag to reorder"
                >⋮⋮</div>
                <button onClick={(e) => { e.stopPropagation(); move(idx, 1); }} disabled={idx === items.length - 1} className="infos-arrow-btn" title="Move down" type="button">▼</button>
              </div>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>{renderItem(item)}</div>
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
        matched = { role: 'zeus', username: zeus.username };
      } else {
        const subs = await loadSubs();
        const f = subs.find((s) => s.username === username.trim() && s.password === password);
        if (f) matched = { role: 'sub', username: f.username, id: f.id };
      }
      if (!matched) return setError('Invalid username or password');
      setLoggingIn(matched);
    } catch {
      setError('Could not reach server. Check your connection.');
    } finally { setBusy(false); }
  };

  if (loggingIn) {
    return <Splash ms={2000} subtitle={`Welcome, ${loggingIn.username}`} small
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

function AccountSwitcher({ accounts, activeKey, onSwitch, onAddAccount, onSignOut, onSignOutAll, theme, setTheme }: any) {
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
  const avatarBg = (u: any) => (u.role === 'zeus' ? C.accent : '#888780');
  const avatar = (u: any, size = 28) => (
    <span style={{ width: size, height: size, borderRadius: '50%', background: avatarBg(u), color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size >= 28 ? '12px' : '10.5px', fontWeight: 600, flexShrink: 0 }}>
      {u.username.charAt(0).toUpperCase()}
    </span>
  );
  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button onClick={() => setOpen(!open)} className="infos-btn" style={{ ...S.btn, display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 10px 6px 6px' }}>
        {avatar(active, 26)}
        <span style={{ fontSize: '13px', fontWeight: 500 }}>{active.username}</span>
        <span style={{ fontSize: '10px', color: C.textTertiary, marginLeft: '-2px' }}>▾</span>
      </button>
      {open && (
        <div className="infos-dropdown" style={{ position: 'absolute', right: 0, top: 'calc(100% + 8px)', minWidth: '280px', background: C.cardBg, border: `1px solid ${C.borderStrong}`, borderRadius: '12px', boxShadow: 'var(--shadow-pop)', zIndex: 1000, overflow: 'hidden' }}>
          <div style={{ padding: '6px 4px', borderBottom: `1px solid ${C.border}`, background: C.cardBg }}>
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
                      <div style={{ fontSize: '11px', color: C.textTertiary, marginTop: '1px', fontWeight: 500 }}>{a.role === 'zeus' ? 'Main admin' : 'Sub-admin'}</div>
                    </div>
                    {isActive && <span style={{ fontSize: '11px', color: C.accent, fontWeight: 600 }}>●</span>}
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); onSignOut(accKey(a)); setOpen(false); }} title="Sign out" style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px 8px', fontSize: '16px', color: C.textTertiary, lineHeight: 1, borderRadius: '4px' }}>×</button>
                </div>
              );
            })}
          </div>
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
          <div style={{ padding: '6px 4px', background: C.cardBg }}>
            <button onClick={() => { onAddAccount(); setOpen(false); }}
              style={{ width: 'calc(100% - 8px)', margin: '0 4px', textAlign: 'left', padding: '9px 12px', fontSize: '13px', background: 'transparent', border: 'none', cursor: 'pointer', color: C.textPrimary, borderRadius: '8px', fontWeight: 500 }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = C.softBg)}
              onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = 'transparent')}>+ Add another account</button>
            <button onClick={() => { onSignOutAll(); setOpen(false); }}
              style={{ width: 'calc(100% - 8px)', margin: '0 4px', textAlign: 'left', padding: '9px 12px', fontSize: '13px', background: 'transparent', border: 'none', cursor: 'pointer', color: C.danger, borderRadius: '8px', fontWeight: 500 }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = C.dangerSoft)}
              onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = 'transparent')}>Sign out of all accounts</button>
          </div>
        </div>
      )}
    </div>
  );
}

function AssigneePicker({ subs, selected, onChange }: any) {
  if (subs.length === 0) {
    return <div style={{ fontSize: '12.5px', color: 'var(--warn-text)', padding: '10px 12px', background: 'var(--warn-soft)', borderRadius: '8px', border: '1px solid var(--warn-border)' }}>No sub-admins exist yet. Create them in the Sub-admins tab first.</div>;
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
      {subs.map((s: any) => {
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

function EntryForm({ fields, subs, onSubmit, submitLabel = 'Add' }: any) {
  const init = () => ({ ...Object.fromEntries(fields.map((f: any) => [f.key, ''])), description: '', assignees: [] as string[] });
  const [v, setV] = useState<any>(init);
  const [busy, setBusy] = useState(false);
  const handle = async () => {
    if (fields.some((f: any) => !v[f.key].trim())) return;
    if (v.assignees.length === 0) return;
    setBusy(true); await onSubmit(v); setBusy(false); setV(init());
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
      <div style={{ marginTop: '14px', textAlign: 'right' }}>
        <Btn primary onClick={handle} disabled={busy} style={{ opacity: busy ? 0.7 : 1 }}>{busy ? 'Saving…' : submitLabel}</Btn>
      </div>
    </div>
  );
}

function IdPassEntryForm({ subs, onSubmit }: any) {
  const init = () => ({ game: '', shortName: '', username: '', password: '', description: '', assignees: [] as string[] });
  const [v, setV] = useState<any>(init);
  const [busy, setBusy] = useState(false);
  const handle = async () => {
    if (!v.game.trim() || !v.username.trim() || !v.password.trim()) return;
    if (v.assignees.length === 0) return;
    setBusy(true); await onSubmit(v); setBusy(false); setV(init());
  };
  return (
    <div style={{ ...S.softCard, marginBottom: '1.25rem' }}>
      <div className="infos-grid2" style={S.grid2}>
        <div><label style={S.label}>Game</label><TextInput value={v.game} onChange={(e: any) => setV({ ...v, game: e.target.value })} placeholder="Game name" /></div>
        <div><label style={S.label}>Short name (optional)</label><TextInput value={v.shortName} onChange={(e: any) => setV({ ...v, shortName: e.target.value })} placeholder="e.g. LoL" /></div>
      </div>
      <div className="infos-grid2" style={{ ...S.grid2, marginTop: '10px' }}>
        <div><label style={S.label}>Username</label><TextInput value={v.username} onChange={(e: any) => setV({ ...v, username: e.target.value })} placeholder="Login username" /></div>
        <div><label style={S.label}>Password</label><TextInput value={v.password} onChange={(e: any) => setV({ ...v, password: e.target.value })} placeholder="Login password" /></div>
      </div>
      <div style={{ marginTop: '12px' }}>
        <label style={S.label}>Description / note (optional)</label>
        <TextArea value={v.description} onChange={(e: any) => setV({ ...v, description: e.target.value })} placeholder="Shown to assigned sub-admins along with this entry" />
      </div>
      <div style={{ marginTop: '12px' }}>
        <label style={S.label}>Assign to sub-admin(s)</label>
        <AssigneePicker subs={subs} selected={v.assignees} onChange={(a: any) => setV({ ...v, assignees: a })} />
      </div>
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
    setBusy(true); await onSubmit(v); setBusy(false); setV(init());
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

function GameListTab({ table, role, user, subs, entries, reload, emptyMsg, searchPlaceholder }: any) {
  const [confirmEl, confirm] = useConfirm();
  const [q, setQ] = useState('');
  const visible = useMemo(() => {
    const base = role === 'zeus' ? entries : entries.filter((e: any) => isVisibleToSub(e.assignees, user.id));
    if (!q.trim()) return base;
    const s = q.toLowerCase();
    return base.filter((e: any) =>
      (e.gameName || '').toLowerCase().includes(s) ||
      (e.shortName || '').toLowerCase().includes(s) ||
      (e.link || '').toLowerCase().includes(s) ||
      (e.description || '').toLowerCase().includes(s)
    );
  }, [role, entries, user, q]);
  const nextSortOrder = useMemo(() => (entries.length ? Math.max(...entries.map((e: any) => e.sortOrder || 0)) + 1 : 0), [entries]);
  const add = async (vals: any) => {
    await addGameEntry(table, { ...vals, id: uid(), createdAt: Date.now(), sortOrder: nextSortOrder });
    await reload();
  };
  const del = async (e: any) => {
    const ok = await confirm({ title: `Delete "${e.gameName}"?`, message: 'This cannot be undone.', confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    await deleteGameEntry(table, e.id); await reload();
  };
  const reorder = async (no: any[]) => { await reorderGames(table, no.map((e: any) => e.id)); await reload(); };
  const renderItem = (e: any) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: '15px', letterSpacing: '-0.01em' }}>
          {e.gameName}{e.shortName && <span style={S.badge}>{e.shortName}</span>}
        </div>
        <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <a href={e.link} target="_blank" rel="noopener noreferrer" style={S.linkPill}>{e.link}</a>
          <CopyButton value={e.link} label="link" />
        </div>
        {e.description && <div style={S.descBox}>{e.description}</div>}
        {role === 'zeus' && <AssigneeList assignees={e.assignees || []} subs={subs} />}
        <Timestamp createdAt={e.createdAt} updatedAt={e.updatedAt} />
      </div>
      {role === 'zeus' && <Btn danger onClick={() => del(e)}>Delete</Btn>}
    </div>
  );
  return (
    <div>
      {confirmEl}
      {role === 'zeus' && <EntryForm fields={[{ key: 'gameName', label: 'Game name' }, { key: 'shortName', label: 'Short name' }, { key: 'link', label: 'Link', placeholder: 'https://...' }]} subs={subs} onSubmit={add} />}
      {entries.length > 0 && <SearchBar value={q} onChange={setQ} placeholder={searchPlaceholder || 'Search games, links, descriptions…'} />}
      {visible.length === 0 ? <div style={S.empty}>{q.trim() ? 'No matches found.' : emptyMsg}</div> : (
        <div>
          <ReorderHint canReorder={role === 'zeus' && !q.trim()} />
          <ReorderList items={visible} canReorder={role === 'zeus' && !q.trim()} onReorder={reorder} renderItem={renderItem} keyFn={(e: any) => e.id} />
        </div>
      )}
    </div>
  );
}

function IdPassTab({ role, user, subs, entries, reload }: any) {
  const [confirmEl, confirm] = useConfirm();
  const [reveal, setReveal] = useState<any>({});
  const [q, setQ] = useState('');
  const visible = useMemo(() => {
    const base = role === 'zeus' ? entries : entries.filter((e: any) => isVisibleToSub(e.assignees, user.id));
    if (!q.trim()) return base;
    const s = q.toLowerCase();
    return base.filter((e: any) =>
      (e.game || '').toLowerCase().includes(s) ||
      (e.shortName || '').toLowerCase().includes(s) ||
      (e.username || '').toLowerCase().includes(s) ||
      (e.description || '').toLowerCase().includes(s)
    );
  }, [role, entries, user, q]);
  const nextSortOrder = useMemo(() => (entries.length ? Math.max(...entries.map((e: any) => e.sortOrder || 0)) + 1 : 0), [entries]);
  const add = async (vals: any) => { await addIdPass({ ...vals, id: uid(), createdAt: Date.now(), sortOrder: nextSortOrder }); await reload(); };
  const del = async (e: any) => {
    const ok = await confirm({ title: `Delete credentials for "${e.game}"?`, message: 'This cannot be undone.', confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    await deleteIdPass(e.id); await reload();
  };
  const reorder = async (no: any[]) => { await reorderIdPass(no.map((e: any) => e.id)); await reload(); };
  const renderItem = (e: any) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: '15px', marginBottom: '8px', letterSpacing: '-0.01em' }}>
          {e.game}{e.shortName && <span style={S.badge}>{e.shortName}</span>}
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
        {role === 'zeus' && <AssigneeList assignees={e.assignees || []} subs={subs} />}
        <Timestamp createdAt={e.createdAt} updatedAt={e.updatedAt} />
      </div>
      {role === 'zeus' && <Btn danger onClick={() => del(e)}>Delete</Btn>}
    </div>
  );
  return (
    <div>
      {confirmEl}
      {role === 'zeus' && <IdPassEntryForm subs={subs} onSubmit={add} />}
      {entries.length > 0 && <SearchBar value={q} onChange={setQ} placeholder="Search credentials by game or username…" />}
      {visible.length === 0 ? <div style={S.empty}>{q.trim() ? 'No matches found.' : 'No credentials yet.'}</div> : (
        <div>
          <ReorderHint canReorder={role === 'zeus' && !q.trim()} />
          <ReorderList items={visible} canReorder={role === 'zeus' && !q.trim()} onReorder={reorder} renderItem={renderItem} keyFn={(e: any) => e.id} />
        </div>
      )}
    </div>
  );
}

function NoticeTab({ role, user, subs, items, reload }: any) {
  const [confirmEl, confirm] = useConfirm();
  const [q, setQ] = useState('');
  const visible = useMemo(() => {
    const base = role === 'zeus' ? items : items.filter((x: any) => isVisibleToSub(x.recipients, user.id));
    if (!q.trim()) return base;
    const s = q.toLowerCase();
    return base.filter((x: any) =>
      (x.title || '').toLowerCase().includes(s) ||
      (x.body || '').toLowerCase().includes(s) ||
      (x.link || '').toLowerCase().includes(s)
    );
  }, [role, items, user, q]);
  const nextSortOrder = useMemo(() => (items.length ? Math.max(...items.map((x: any) => x.sortOrder || 0)) + 1 : 0), [items]);
  const add = async (vals: any) => {
    await addNotice({
      id: uid(), title: vals.title.trim(), body: vals.body.trim(),
      link: (vals.link || '').trim(), recipients: vals.assignees,
      createdAt: Date.now(), sortOrder: nextSortOrder,
    });
    await reload();
  };
  const del = async (x: any) => {
    const ok = await confirm({ title: `Delete notice "${x.title}"?`, message: 'This cannot be undone.', confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    await deleteNotice(x.id); await reload();
  };
  const reorder = async (no: any[]) => { await reorderNotices(no.map((x: any) => x.id)); await reload(); };
  const renderItem = (x: any) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: '15px', letterSpacing: '-0.01em' }}>{x.title}</div>
        <div style={{ fontSize: '13.5px', marginTop: '8px', whiteSpace: 'pre-wrap', color: C.textPrimary, lineHeight: '1.5' }}>{x.body}</div>
        {x.link && (
          <div style={{ marginTop: '10px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <a href={x.link} target="_blank" rel="noopener noreferrer" style={S.linkPill}>{x.link}</a>
            <CopyButton value={x.link} label="link" />
          </div>
        )}
        {role === 'zeus' && <AssigneeList assignees={x.recipients || []} subs={subs} />}
        <Timestamp createdAt={x.createdAt} updatedAt={x.updatedAt} />
      </div>
      {role === 'zeus' && <Btn danger onClick={() => del(x)}>Delete</Btn>}
    </div>
  );
  return (
    <div>
      {confirmEl}
      {role === 'zeus' && (subs.length === 0
        ? <div style={{ ...S.empty, marginBottom: '1.25rem' }}>Create sub-admins first to post notices.</div>
        : <NoticeEntryForm subs={subs} onSubmit={add} />)}
      {items.length > 0 && <SearchBar value={q} onChange={setQ} placeholder="Search notices…" />}
      {visible.length === 0 ? <div style={S.empty}>{q.trim() ? 'No matches found.' : role === 'zeus' ? 'No notices posted yet.' : 'No notices for you yet.'}</div> : (
        <div>
          <ReorderHint canReorder={role === 'zeus' && !q.trim()} />
          <ReorderList items={visible} canReorder={role === 'zeus' && !q.trim()} onReorder={reorder} renderItem={renderItem} keyFn={(x: any) => x.id} />
        </div>
      )}
    </div>
  );
}

function SubAdminsPanel({ subs, backend, games, idpass, notices, reload }: any) {
  const [confirmEl, confirm] = useConfirm();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [managingSub, setManagingSub] = useState<any>(null);
  const nextSortOrder = useMemo(() => (subs.length ? Math.max(...subs.map((s: any) => s.sortOrder || 0)) + 1 : 0), [subs]);

  const add = async () => {
    setError('');
    if (!username.trim() || !password.trim()) return setError('Username and password required');
    const zeus = await loadZeus();
    if (username.trim() === zeus.username) return setError('That username is reserved');
    if (subs.some((s: any) => s.username === username.trim())) return setError('Username already taken');
    setBusy(true);
    try {
      await addSub({ id: uid(), username: username.trim(), password, createdAt: Date.now(), sortOrder: nextSortOrder });
      await reload();
      setUsername(''); setPassword('');
    } catch (e: any) { setError(e?.message || 'Could not save'); } finally { setBusy(false); }
  };
  const remove = async (s: any) => {
    const ok = await confirm({ title: `Remove sub-admin "${s.username}"?`, message: 'They will no longer be able to sign in. Content they were assigned to will still exist.', confirmLabel: 'Remove', danger: true });
    if (!ok) return;
    await deleteSub(s.id); await reload();
  };

  // Build bulk entries for the modal
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

  return (
    <div>
      {confirmEl}
      <BulkAssignModal
        open={!!managingSub}
        subAdmin={managingSub}
        entries={bulkEntries}
        onClose={() => setManagingSub(null)}
        onSave={saveBulk}
      />
      <div style={{ ...S.softCard, marginBottom: '1.25rem' }}>
        <div className="infos-grid2" style={S.grid2}>
          <div><label style={S.label}>Username</label><TextInput value={username} onChange={(e: any) => setUsername(e.target.value)} placeholder="new_sub_admin" /></div>
          <div><label style={S.label}>Password</label><TextInput value={password} onChange={(e: any) => setPassword(e.target.value)} placeholder="Set a password" /></div>
        </div>
        {error && <div style={{ fontSize: '13px', color: C.danger, marginTop: '10px', padding: '8px 12px', background: C.dangerSoft, borderRadius: '6px', fontWeight: 500 }}>{error}</div>}
        <div style={{ marginTop: '14px', textAlign: 'right' }}><Btn primary onClick={add} disabled={busy} style={{ opacity: busy ? 0.7 : 1 }}>{busy ? 'Saving…' : 'Create sub-admin'}</Btn></div>
      </div>
      {subs.length === 0 ? <div style={S.empty}>No sub-admins yet.</div> : (
        <div>
          {subs.map((s: any) => (
            <div key={s.id} style={S.item}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', gap: '8px', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span style={{ width: '36px', height: '36px', borderRadius: '50%', background: '#888780', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', fontWeight: 600 }}>{s.username.charAt(0).toUpperCase()}</span>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '14px', letterSpacing: '-0.01em' }}>{s.username}</div>
                    <div style={{ fontSize: '12px', color: C.textSecondary, fontFamily: 'ui-monospace, monospace', marginTop: '3px' }}>password: {s.password}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <Btn onClick={() => setManagingSub(s)}>Manage access</Btn>
                  <Btn danger onClick={() => remove(s)}>Remove</Btn>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SettingsPanel({ onForceLogout }: any) {
  const [current, setCurrent] = useState<any>(null);
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

  useEffect(() => { loadZeus().then(c => { setCurrent(c); setNewUsername(c.username); }); }, []);

  const save = async () => {
    setMsg(''); setErr('');
    if (!newUsername.trim()) return setErr('Username cannot be empty');
    if (!newPassword) return setErr('Enter a new password');
    if (newPassword.length < 4) return setErr('Password must be at least 4 characters');
    if (newPassword !== confirmPass) return setErr('Passwords do not match');
    setBusy(true);
    try {
      await saveZeus({ username: newUsername.trim(), password: newPassword });
      setMsg('Credentials updated. Logging you out…');
      setTimeout(() => onForceLogout(), 1500);
    } catch (e: any) { setErr(e?.message || 'Could not save'); } finally { setBusy(false); }
  };

  const doExportAll = async () => {
    setExporting(true);
    try {
      const data = await exportAll();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `infos-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } finally { setExporting(false); }
  };

  const doImport = async (ev: React.ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    setImportStatus('Reading file…');
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data.version || data.version !== 1) {
        setImportStatus('Unsupported backup file format.');
        return;
      }
      const ok = await confirm({
        title: 'Import and replace data?',
        message: `This will ADD entries from the backup (existing entries with same IDs will be overwritten). Your current Zeus login will NOT be changed. Items: ${data.sub_admins?.length || 0} sub-admins, ${data.backend_entries?.length || 0} backend, ${data.game_entries?.length || 0} games, ${data.idpass_entries?.length || 0} credentials, ${data.notices?.length || 0} notices.`,
        confirmLabel: 'Import',
      });
      if (!ok) { setImportStatus(''); ev.target.value = ''; return; }

      setImportStatus('Importing…');
      // Map app shape back to db shape
      if (data.sub_admins?.length) await bulkInsert('sub_admins', data.sub_admins.map((s: any) => ({
        id: s.id, username: s.username, password: s.password,
        created_at: s.createdAt, sort_order: s.sortOrder ?? 0,
      })));
      if (data.backend_entries?.length) await bulkInsert('backend_entries', data.backend_entries.map((e: any) => ({
        id: e.id, game_name: e.gameName, short_name: e.shortName, link: e.link,
        description: e.description || '', assignees: e.assignees || [],
        created_at: e.createdAt, sort_order: e.sortOrder ?? 0,
      })));
      if (data.game_entries?.length) await bulkInsert('game_entries', data.game_entries.map((e: any) => ({
        id: e.id, game_name: e.gameName, short_name: e.shortName, link: e.link,
        description: e.description || '', assignees: e.assignees || [],
        created_at: e.createdAt, sort_order: e.sortOrder ?? 0,
      })));
      if (data.idpass_entries?.length) await bulkInsert('idpass_entries', data.idpass_entries.map((e: any) => ({
        id: e.id, game: e.game, short_name: e.shortName || '',
        username: e.username, password: e.password, description: e.description || '',
        assignees: e.assignees || [], created_at: e.createdAt, sort_order: e.sortOrder ?? 0,
      })));
      if (data.notices?.length) await bulkInsert('notices', data.notices.map((n: any) => ({
        id: n.id, title: n.title, body: n.body, link: n.link || '',
        recipients: n.recipients || [], created_at: n.createdAt, sort_order: n.sortOrder ?? 0,
      })));
      setImportStatus('✓ Import complete. Data will appear in the tabs momentarily.');
    } catch (e: any) {
      setImportStatus('Import failed: ' + (e?.message || 'invalid file'));
    }
    ev.target.value = '';
  };

  if (!current) return <div style={S.empty}>Loading…</div>;
  return (
    <div>
      {confirmEl}
      <div style={{ ...S.softCard, marginBottom: '1.25rem' }}>
        <div style={{ fontSize: '15px', fontWeight: 600, marginBottom: '4px', letterSpacing: '-0.01em' }}>Change admin credentials</div>
        <div style={{ fontSize: '13px', color: C.textSecondary, marginBottom: '16px' }}>Current username: <span style={{ fontFamily: 'ui-monospace, monospace', color: C.textPrimary, fontWeight: 500 }}>{current.username}</span></div>
        <div style={{ marginBottom: '12px' }}><label style={S.label}>New username</label><TextInput value={newUsername} onChange={(e: any) => setNewUsername(e.target.value)} /></div>
        <div style={{ marginBottom: '12px' }}><label style={S.label}>New password</label><TextInput type="password" value={newPassword} onChange={(e: any) => setNewPassword(e.target.value)} /></div>
        <div style={{ marginBottom: '12px' }}><label style={S.label}>Confirm new password</label><TextInput type="password" value={confirmPass} onChange={(e: any) => setConfirmPass(e.target.value)} /></div>
        {err && <div style={{ fontSize: '13px', color: C.danger, marginBottom: '10px', padding: '8px 12px', background: C.dangerSoft, borderRadius: '6px', fontWeight: 500 }}>{err}</div>}
        {msg && <div style={{ fontSize: '13px', color: C.success, marginBottom: '10px', padding: '8px 12px', background: C.successSoft, borderRadius: '6px', fontWeight: 500 }}>{msg}</div>}
        <div style={{ textAlign: 'right' }}><Btn primary onClick={save} disabled={busy} style={{ opacity: busy ? 0.7 : 1 }}>{busy ? 'Saving…' : 'Save changes'}</Btn></div>
      </div>

      <div style={S.softCard}>
        <div style={{ fontSize: '15px', fontWeight: 600, marginBottom: '4px', letterSpacing: '-0.01em' }}>Backup &amp; restore</div>
        <div style={{ fontSize: '13px', color: C.textSecondary, marginBottom: '16px' }}>Export all data as a JSON file, or restore from a previous backup.</div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <Btn onClick={doExportAll} disabled={exporting}>{exporting ? 'Exporting…' : '↓ Export all data'}</Btn>
          <Btn onClick={() => fileRef.current?.click()}>↑ Import from backup</Btn>
          <input ref={fileRef} type="file" accept="application/json,.json" onChange={doImport} style={{ display: 'none' }} />
        </div>
        {importStatus && <div style={{ fontSize: '13px', marginTop: '12px', padding: '8px 12px', background: C.softBg, borderRadius: '6px', fontWeight: 500 }}>{importStatus}</div>}
      </div>
    </div>
  );
}

function Portal({ user, accounts, activeKey, onSwitch, onAddAccount, onSignOut, onSignOutAll, theme, setTheme }: any) {
  const [tab, setTab] = useState('notice');
  const [subs, setSubs] = useState<any[]>([]);
  const [backend, setBackend] = useState<any[]>([]);
  const [games, setGames] = useState<any[]>([]);
  const [idpass, setIdpass] = useState<any[]>([]);
  const [notices, setNotices] = useState<any[]>([]);
  const [loaded, setLoaded] = useState(false);

  const reloadAll = useCallback(async () => {
    const [s, b, g, i, n] = await Promise.all([loadSubs(), loadBackend(), loadGames(), loadIdPass(), loadNotices()]);
    setSubs(s); setBackend(b); setGames(g); setIdpass(i); setNotices(n);
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try { await reloadAll(); } catch (err) { console.error('Initial load failed', err); }
      if (alive) setLoaded(true);
    })();
    const unsub = subscribeAll(
      ['sub_admins', 'backend_entries', 'game_entries', 'idpass_entries', 'notices'],
      () => { if (alive) reloadAll().catch(() => {}); }
    );
    return () => { alive = false; unsub(); };
  }, [activeKey, reloadAll]);

  const tabs = [
    { id: 'notice', label: 'Notice' },
    { id: 'backend', label: 'Backend' },
    { id: 'games', label: 'Games' },
    { id: 'idpass', label: 'Id & Pass' },
    ...(user.role === 'zeus' ? [{ id: 'subs', label: 'Sub-admins' }, { id: 'settings', label: 'Settings' }] : []),
  ];

  return (
    <div style={S.shell}>
      <div style={S.card}>
        <div style={S.headerBar}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
            <Image src="/logo.png" alt="" width={38} height={38} style={{ flexShrink: 0 }} />
            <div style={{ minWidth: 0 }}>
              <div style={S.brand}>Infos</div>
              <div style={S.sub}>{user.role === 'zeus' ? `${user.username} — main admin` : `${user.username} — sub-admin`}</div>
            </div>
          </div>
          <AccountSwitcher accounts={accounts} activeKey={activeKey} onSwitch={onSwitch} onAddAccount={onAddAccount} onSignOut={onSignOut} onSignOutAll={onSignOutAll} theme={theme} setTheme={setTheme} />
        </div>
        <div className="infos-tabs" style={S.tabs}>
          {tabs.map((t) => <button key={t.id} onClick={() => setTab(t.id)} className="infos-tab" style={tabStyle(tab === t.id)}>{t.label}</button>)}
        </div>
        {!loaded ? <div style={S.empty}>Loading…</div> :
          tab === 'notice' ? <NoticeTab role={user.role} user={user} subs={subs} items={notices} reload={reloadAll} /> :
          tab === 'backend' ? <GameListTab table="backend_entries" role={user.role} user={user} subs={subs} entries={backend} reload={reloadAll} emptyMsg="No backend entries yet." /> :
          tab === 'games' ? <GameListTab table="game_entries" role={user.role} user={user} subs={subs} entries={games} reload={reloadAll} emptyMsg="No games yet." /> :
          tab === 'idpass' ? <IdPassTab role={user.role} user={user} subs={subs} entries={idpass} reload={reloadAll} /> :
          tab === 'subs' ? <SubAdminsPanel subs={subs} backend={backend} games={games} idpass={idpass} notices={notices} reload={reloadAll} /> :
          tab === 'settings' ? <SettingsPanel onForceLogout={onSignOutAll} /> : null}
      </div>
    </div>
  );
}

export default function InfosApp() {
  const [hydrated, setHydrated] = useState(false);
  const [showOpenSplash, setShowOpenSplash] = useState(true);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [addingAccount, setAddingAccount] = useState(false);
  const [theme, setTheme] = useTheme();
  const [envMissing, setEnvMissing] = useState(false);

  useEffect(() => {
    // Check Supabase env vars are set (these are bundled at build time in Next.js)
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) {
      setEnvMissing(true);
      setHydrated(true);
      return;
    }
    const accs = loadSession<any[]>('ACCOUNTS', []);
    const act = loadSession<string | null>('ACTIVE', null);
    setAccounts(accs);
    if (accs.length > 0) setActiveKey(act && accs.find((a) => accKey(a) === act) ? act : accKey(accs[0]));
    setHydrated(true);
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
          <div style={{ fontSize: '13px', color: C.textSecondary, background: C.softBg, padding: '12px 14px', borderRadius: '8px', marginBottom: '16px', lineHeight: 1.6 }}>
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
  if (showOpenSplash) return <Splash ms={3000} subtitle="Loading…" onDone={() => setShowOpenSplash(false)} />;
  if (accounts.length === 0) return <LoginForm onLogin={addAccount} />;
  if (addingAccount) return <LoginForm onLogin={addAccount} onCancel={() => setAddingAccount(false)} cancelLabel="Back" subtitle="Add another account" />;
  const activeUser = accounts.find((a) => accKey(a) === activeKey);
  if (!activeUser) return <LoginForm onLogin={addAccount} />;
  return <Portal user={activeUser} accounts={accounts} activeKey={activeKey} onSwitch={switchTo} onAddAccount={() => setAddingAccount(true)} onSignOut={signOut} onSignOutAll={signOutAll} theme={theme} setTheme={setTheme} />;
}
