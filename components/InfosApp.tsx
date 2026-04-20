'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import {
  K, DEFAULT_ZEUS, ALL_SENTINEL, uid, accKey,
  isVisibleToSub, isAssignedAll, loadKey, saveKey,
} from '@/lib/storage';
import { C, S, tabStyle } from './styles';

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
        <Image src="/logo.png" alt="Infos" fill style={{ borderRadius: `${size * 0.22}px`, objectFit: 'contain' }} priority />
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

// ---------------- Tiny primitives ----------------
function TextInput(props: any) {
  return <input {...props} className={'infos-input ' + (props.className || '')} style={{ ...S.input, ...(props.style || {}) }} />;
}
function TextArea(props: any) {
  return <textarea {...props} className={'infos-input ' + (props.className || '')} style={{ ...S.textarea, ...(props.style || {}) }} />;
}
function Btn(props: any) {
  const { primary, danger, ...rest } = props;
  const base = primary ? S.btnPrimary : danger ? S.btnDanger : S.btn;
  const cls = primary ? 'infos-btn-primary' : 'infos-btn';
  return <button {...rest} className={cls + ' ' + (props.className || '')} style={{ ...base, ...(props.style || {}) }} />;
}

// ---------------- Draggable list ----------------
function DraggableList({ items, canDrag, onReorder, renderItem, keyFn }: any) {
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
  return (
    <div>
      {items.map((item: any) => {
        const id = keyFn(item);
        const style = {
          ...S.item,
          ...(dragId === id ? { opacity: 0.4 } : {}),
          ...(overId === id && dragId && dragId !== id ? { borderColor: C.accent, boxShadow: `0 0 0 2px ${C.accentSoft}` } : {}),
        };
        return (
          <div key={id} className="infos-item" style={style}
            draggable={canDrag}
            onDragStart={canDrag ? (e) => start(e, id) : undefined}
            onDragOver={canDrag ? (e) => over(e, id) : undefined}
            onDrop={canDrag ? (e) => drop(e, id) : undefined}
            onDragEnd={() => { setDragId(null); setOverId(null); }}>
            {canDrag && <div style={S.dragHandle} title="Drag to reorder">⋮⋮</div>}
            <div style={{ flex: 1, minWidth: 0 }}>{renderItem(item)}</div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------- Login ----------------
function LoginForm({ onLogin, onCancel, cancelLabel, subtitle }: any) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loggingIn, setLoggingIn] = useState<any>(null);

  const handle = () => {
    setError('');
    if (!username.trim() || !password) return setError('Enter username and password');
    const zeus = loadKey<any>(K.ZEUS, DEFAULT_ZEUS);
    let matched: any = null;
    if (username.trim() === zeus.username && password === zeus.password) {
      matched = { role: 'zeus', username: zeus.username };
    } else {
      const subs = loadKey<any[]>(K.SUBS, []);
      const f = subs.find((s) => s.username === username.trim() && s.password === password);
      if (f) matched = { role: 'sub', username: f.username, id: f.id };
    }
    if (!matched) return setError('Invalid username or password');
    setLoggingIn(matched);
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
          <Image src="/logo.png" alt="" width={72} height={72} style={{ borderRadius: '16px' }} priority />
          <div style={{ fontSize: '28px', fontWeight: 700, letterSpacing: '-0.03em', marginTop: '14px' }}>Infos</div>
          <div style={{ fontSize: '14px', color: C.textSecondary, marginTop: '4px', fontWeight: 500 }}>
            {subtitle || 'Sign in to your account'}
          </div>
        </div>
        <div style={{ marginBottom: '14px' }}>
          <label style={S.label}>Username</label>
          <TextInput value={username} onChange={(e: any) => setUsername(e.target.value)} placeholder="Enter username" autoFocus
            onKeyDown={(e: any) => e.key === 'Enter' && handle()} />
        </div>
        <div style={{ marginBottom: '14px' }}>
          <label style={S.label}>Password</label>
          <TextInput type="password" value={password} onChange={(e: any) => setPassword(e.target.value)} placeholder="Enter password"
            onKeyDown={(e: any) => e.key === 'Enter' && handle()} />
        </div>
        {error && <div style={{ fontSize: '13px', color: C.danger, marginBottom: '12px', padding: '8px 12px', background: C.dangerSoft, borderRadius: '6px', fontWeight: 500 }}>{error}</div>}
        <div style={{ display: 'flex', gap: '10px', marginTop: '4px' }}>
          {onCancel && <Btn onClick={onCancel} style={{ flex: 1 }}>{cancelLabel || 'Cancel'}</Btn>}
          <Btn primary onClick={handle} style={{ flex: onCancel ? 1 : undefined, width: onCancel ? undefined : '100%' }}>Sign in</Btn>
        </div>
      </div>
    </div>
  );
}

// ---------------- Account switcher ----------------
function AccountSwitcher({ accounts, activeKey, onSwitch, onAddAccount, onSignOut, onSignOutAll }: any) {
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
        <div className="infos-dropdown" style={{ position: 'absolute', right: 0, top: 'calc(100% + 8px)', minWidth: '260px', background: C.cardBg, border: `1px solid ${C.borderStrong}`, borderRadius: '12px', boxShadow: '0 12px 32px rgba(0,0,0,0.15), 0 2px 6px rgba(0,0,0,0.08)', zIndex: 1000, overflow: 'hidden' }}>
          <div style={{ padding: '6px 4px', borderBottom: `1px solid ${C.border}`, background: C.cardBg }}>
            <div style={{ fontSize: '10.5px', color: C.textTertiary, padding: '8px 14px 6px', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>Signed in</div>
            {accounts.map((a: any) => {
              const isActive = accKey(a) === activeKey;
              return (
                <div key={accKey(a)}
                  style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 12px', cursor: isActive ? 'default' : 'pointer', background: isActive ? C.accentSoft : C.cardBg, transition: 'background 0.1s', margin: '0 4px', borderRadius: '8px' }}
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
                  <button onClick={(e) => { e.stopPropagation(); onSignOut(accKey(a)); setOpen(false); }} title="Sign out this account" style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px 8px', fontSize: '16px', color: C.textTertiary, lineHeight: 1, borderRadius: '4px' }}>×</button>
                </div>
              );
            })}
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

// ---------------- Assignee picker ----------------
function AssigneePicker({ subs, selected, onChange }: any) {
  if (subs.length === 0) {
    return <div style={{ fontSize: '12.5px', color: 'var(--warn-text)', padding: '10px 12px', background: 'var(--warn-soft)', borderRadius: '8px', border: '1px solid var(--warn-border)' }}>
      No sub-admins exist yet. Create them in the Sub-admins tab first.
    </div>;
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
  if (isAssignedAll(assignees)) {
    return <div style={{ marginTop: '8px' }}><span style={S.allPill}>All sub-admins</span></div>;
  }
  const names = (assignees || []).filter((id: string) => id !== ALL_SENTINEL).map((id: string) => subs.find((s: any) => s.id === id)?.username).filter(Boolean);
  if (names.length === 0) return <span style={{ fontSize: '11px', color: C.textTertiary, fontStyle: 'italic', marginTop: '6px', display: 'inline-block' }}>no assignees</span>;
  return <div style={{ marginTop: '8px' }}>{names.map((n: string, i: number) => <span key={i} style={S.assigneePill}>{n}</span>)}</div>;
}

function DragHint({ canDrag }: any) {
  if (!canDrag) return null;
  return <div style={{ fontSize: '12px', color: C.textTertiary, marginBottom: '10px', fontWeight: 500 }}>Drag ⋮⋮ to reorder.</div>;
}

// ---------------- Entry form (Backend / Games) ----------------
function EntryForm({ fields, subs, onSubmit, submitLabel = 'Add' }: any) {
  const init = () => ({ ...Object.fromEntries(fields.map((f: any) => [f.key, ''])), description: '', assignees: [] as string[] });
  const [v, setV] = useState<any>(init);
  const handle = () => {
    if (fields.some((f: any) => !v[f.key].trim())) return;
    if (v.assignees.length === 0) return;
    onSubmit(v); setV(init());
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
        <Btn primary onClick={handle}>{submitLabel}</Btn>
      </div>
    </div>
  );
}

// ---------------- Id & Pass form (4 fields) ----------------
function IdPassEntryForm({ subs, onSubmit }: any) {
  const init = () => ({ game: '', shortName: '', username: '', password: '', description: '', assignees: [] as string[] });
  const [v, setV] = useState<any>(init);
  const handle = () => {
    if (!v.game.trim() || !v.username.trim() || !v.password.trim()) return;
    if (v.assignees.length === 0) return;
    onSubmit(v); setV(init());
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
        <Btn primary onClick={handle}>Add</Btn>
      </div>
    </div>
  );
}

// ---------------- Game/Backend list tab ----------------
function GameListTab({ storageKey, role, user, subs, entries, setEntries, emptyMsg }: any) {
  const visible = useMemo(() => (role === 'zeus' ? entries : entries.filter((e: any) => isVisibleToSub(e.assignees, user.id))), [role, entries, user]);
  const add = (vals: any) => { const next = [{ id: uid(), ...vals, createdAt: Date.now() }, ...entries]; setEntries(next); saveKey(storageKey, next); };
  const del = (id: string) => { const next = entries.filter((e: any) => e.id !== id); setEntries(next); saveKey(storageKey, next); };
  const reorder = (no: any[]) => { setEntries(no); saveKey(storageKey, no); };
  const renderItem = (e: any) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: '15px', letterSpacing: '-0.01em' }}>{e.gameName}<span style={S.badge}>{e.shortName}</span></div>
        <div style={{ marginTop: '6px' }}><a href={e.link} target="_blank" rel="noopener noreferrer" style={S.linkPill}>{e.link}</a></div>
        {e.description && <div style={S.descBox}>{e.description}</div>}
        {role === 'zeus' && <AssigneeList assignees={e.assignees || []} subs={subs} />}
      </div>
      {role === 'zeus' && <Btn danger onClick={() => del(e.id)}>Delete</Btn>}
    </div>
  );
  return (
    <div>
      {role === 'zeus' && <EntryForm fields={[{ key: 'gameName', label: 'Game name' }, { key: 'shortName', label: 'Short name' }, { key: 'link', label: 'Link', placeholder: 'https://...' }]} subs={subs} onSubmit={add} />}
      {visible.length === 0 ? <div style={S.empty}>{emptyMsg}</div> : (
        <div><DragHint canDrag={role === 'zeus'} /><DraggableList items={visible} canDrag={role === 'zeus'} onReorder={reorder} renderItem={renderItem} keyFn={(e: any) => e.id} /></div>
      )}
    </div>
  );
}

// ---------------- Id & Pass tab ----------------
function IdPassTab({ role, user, subs, entries, setEntries }: any) {
  const [reveal, setReveal] = useState<any>({});
  const visible = useMemo(() => (role === 'zeus' ? entries : entries.filter((e: any) => isVisibleToSub(e.assignees, user.id))), [role, entries, user]);
  const add = (vals: any) => { const next = [{ id: uid(), ...vals, createdAt: Date.now() }, ...entries]; setEntries(next); saveKey(K.IDPASS, next); };
  const del = (id: string) => { const next = entries.filter((e: any) => e.id !== id); setEntries(next); saveKey(K.IDPASS, next); };
  const reorder = (no: any[]) => { setEntries(no); saveKey(K.IDPASS, no); };
  const renderItem = (e: any) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: '15px', marginBottom: '8px', letterSpacing: '-0.01em' }}>{e.game}{e.shortName && <span style={S.badge}>{e.shortName}</span>}</div>
        <div style={{ fontSize: '13px', color: C.textSecondary, marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ minWidth: '72px', fontWeight: 500 }}>Username</span>
          <span style={{ color: C.textPrimary, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '12.5px', padding: '2px 6px', background: C.softBg, borderRadius: '4px' }}>{e.username}</span>
        </div>
        <div style={{ fontSize: '13px', color: C.textSecondary, display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          <span style={{ minWidth: '72px', fontWeight: 500 }}>Password</span>
          <span style={{ color: C.textPrimary, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '12.5px', padding: '2px 6px', background: C.softBg, borderRadius: '4px' }}>
            {reveal[e.id] ? e.password : '•'.repeat(Math.min(e.password.length, 10))}
          </span>
          <button onClick={() => setReveal({ ...reveal, [e.id]: !reveal[e.id] })} style={{ padding: '3px 10px', fontSize: '11.5px', border: `1px solid ${C.borderStrong}`, background: C.cardBg, borderRadius: '5px', cursor: 'pointer', color: C.textSecondary, fontWeight: 500 }}>
            {reveal[e.id] ? 'Hide' : 'Show'}
          </button>
        </div>
        {e.description && <div style={S.descBox}>{e.description}</div>}
        {role === 'zeus' && <AssigneeList assignees={e.assignees || []} subs={subs} />}
      </div>
      {role === 'zeus' && <Btn danger onClick={() => del(e.id)}>Delete</Btn>}
    </div>
  );
  return (
    <div>
      {role === 'zeus' && <IdPassEntryForm subs={subs} onSubmit={add} />}
      {visible.length === 0 ? <div style={S.empty}>No credentials yet.</div> : (
        <div><DragHint canDrag={role === 'zeus'} /><DraggableList items={visible} canDrag={role === 'zeus'} onReorder={reorder} renderItem={renderItem} keyFn={(e: any) => e.id} /></div>
      )}
    </div>
  );
}

// ---------------- Message tab (Announcements / Notes) ----------------
function MessageTab({ role, user, subs, items, setItems, storageKey, labels }: any) {
  const visible = useMemo(() => (role === 'zeus' ? items : items.filter((x: any) => isVisibleToSub(x.recipients, user.id))), [role, items, user]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [recipients, setRecipients] = useState<string[]>([]);
  const [err, setErr] = useState('');
  const add = () => {
    setErr('');
    if (!title.trim() || !body.trim()) return setErr(labels.errBoth);
    if (recipients.length === 0) return setErr(labels.errRec);
    const next = [{ id: uid(), title: title.trim(), body: body.trim(), recipients, createdAt: Date.now() }, ...items];
    setItems(next); saveKey(storageKey, next); setTitle(''); setBody(''); setRecipients([]);
  };
  const del = (id: string) => { const next = items.filter((x: any) => x.id !== id); setItems(next); saveKey(storageKey, next); };
  const reorder = (no: any[]) => { setItems(no); saveKey(storageKey, no); };
  const renderItem = (x: any) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: '15px', letterSpacing: '-0.01em' }}>{x.title}</div>
        <div style={{ fontSize: '13.5px', marginTop: '8px', whiteSpace: 'pre-wrap', color: C.textPrimary, lineHeight: '1.5' }}>{x.body}</div>
        <div style={{ fontSize: '11px', color: C.textTertiary, marginTop: '8px', fontWeight: 500 }}>{new Date(x.createdAt).toLocaleString()}</div>
        {role === 'zeus' && <AssigneeList assignees={x.recipients || []} subs={subs} />}
      </div>
      {role === 'zeus' && <Btn danger onClick={() => del(x.id)}>Delete</Btn>}
    </div>
  );
  return (
    <div>
      {role === 'zeus' && (subs.length === 0 ? (
        <div style={{ ...S.empty, marginBottom: '1.25rem' }}>{labels.emptySubs}</div>
      ) : (
        <div style={{ ...S.softCard, marginBottom: '1.25rem' }}>
          <div style={{ marginBottom: '12px' }}><label style={S.label}>Title</label><TextInput value={title} onChange={(e: any) => setTitle(e.target.value)} placeholder={labels.titlePh} /></div>
          <div style={{ marginBottom: '12px' }}><label style={S.label}>{labels.bodyLabel}</label><TextArea value={body} onChange={(e: any) => setBody(e.target.value)} placeholder={labels.bodyPh} /></div>
          <div style={{ marginBottom: '12px' }}>
            <label style={S.label}>{labels.recLabel}</label>
            <AssigneePicker subs={subs} selected={recipients} onChange={setRecipients} />
          </div>
          {err && <div style={{ fontSize: '13px', color: C.danger, marginBottom: '10px', padding: '8px 12px', background: C.dangerSoft, borderRadius: '6px', fontWeight: 500 }}>{err}</div>}
          <div style={{ textAlign: 'right' }}><Btn primary onClick={add}>{labels.submit}</Btn></div>
        </div>
      ))}
      {visible.length === 0 ? <div style={S.empty}>{role === 'zeus' ? labels.emptyZeus : labels.emptySub}</div> : (
        <div><DragHint canDrag={role === 'zeus'} /><DraggableList items={visible} canDrag={role === 'zeus'} onReorder={reorder} renderItem={renderItem} keyFn={(x: any) => x.id} /></div>
      )}
    </div>
  );
}

// ---------------- Sub-admins ----------------
function SubAdminsPanel({ subs, setSubs }: any) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const add = () => {
    setError('');
    if (!username.trim() || !password.trim()) return setError('Username and password required');
    const zeus = loadKey<any>(K.ZEUS, DEFAULT_ZEUS);
    if (username.trim() === zeus.username) return setError('That username is reserved');
    if (subs.some((s: any) => s.username === username.trim())) return setError('Username already taken');
    const next = [{ id: uid(), username: username.trim(), password, createdAt: Date.now() }, ...subs];
    setSubs(next); saveKey(K.SUBS, next); setUsername(''); setPassword('');
  };
  const remove = (id: string) => { const next = subs.filter((s: any) => s.id !== id); setSubs(next); saveKey(K.SUBS, next); };
  return (
    <div>
      <div style={{ ...S.softCard, marginBottom: '1.25rem' }}>
        <div className="infos-grid2" style={S.grid2}>
          <div><label style={S.label}>Username</label><TextInput value={username} onChange={(e: any) => setUsername(e.target.value)} placeholder="new_sub_admin" /></div>
          <div><label style={S.label}>Password</label><TextInput value={password} onChange={(e: any) => setPassword(e.target.value)} placeholder="Set a password" /></div>
        </div>
        {error && <div style={{ fontSize: '13px', color: C.danger, marginTop: '10px', padding: '8px 12px', background: C.dangerSoft, borderRadius: '6px', fontWeight: 500 }}>{error}</div>}
        <div style={{ marginTop: '14px', textAlign: 'right' }}><Btn primary onClick={add}>Create sub-admin</Btn></div>
      </div>
      {subs.length === 0 ? <div style={S.empty}>No sub-admins yet.</div> : (
        <div>
          {subs.map((s: any) => (
            <div key={s.id} style={S.item}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span style={{ width: '36px', height: '36px', borderRadius: '50%', background: '#888780', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', fontWeight: 600 }}>{s.username.charAt(0).toUpperCase()}</span>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '14px', letterSpacing: '-0.01em' }}>{s.username}</div>
                    <div style={{ fontSize: '12px', color: C.textSecondary, fontFamily: 'ui-monospace, monospace', marginTop: '3px' }}>password: {s.password}</div>
                  </div>
                </div>
                <Btn danger onClick={() => remove(s.id)}>Remove</Btn>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------- Settings ----------------
function SettingsPanel({ onForceLogout }: any) {
  const [current, setCurrent] = useState<any>(null);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPass, setConfirmPass] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => { const c = loadKey<any>(K.ZEUS, DEFAULT_ZEUS); setCurrent(c); setNewUsername(c.username); }, []);
  const save = () => {
    setMsg(''); setErr('');
    if (!newUsername.trim()) return setErr('Username cannot be empty');
    if (!newPassword) return setErr('Enter a new password');
    if (newPassword.length < 4) return setErr('Password must be at least 4 characters');
    if (newPassword !== confirmPass) return setErr('Passwords do not match');
    saveKey(K.ZEUS, { username: newUsername.trim(), password: newPassword });
    setMsg('Credentials updated. Logging you out…');
    setTimeout(() => onForceLogout(), 1500);
  };
  if (!current) return <div style={S.empty}>Loading…</div>;
  return (
    <div style={S.softCard}>
      <div style={{ fontSize: '15px', fontWeight: 600, marginBottom: '4px', letterSpacing: '-0.01em' }}>Change admin credentials</div>
      <div style={{ fontSize: '13px', color: C.textSecondary, marginBottom: '16px' }}>Current username: <span style={{ fontFamily: 'ui-monospace, monospace', color: C.textPrimary, fontWeight: 500 }}>{current.username}</span></div>
      <div style={{ marginBottom: '12px' }}><label style={S.label}>New username</label><TextInput value={newUsername} onChange={(e: any) => setNewUsername(e.target.value)} /></div>
      <div style={{ marginBottom: '12px' }}><label style={S.label}>New password</label><TextInput type="password" value={newPassword} onChange={(e: any) => setNewPassword(e.target.value)} /></div>
      <div style={{ marginBottom: '12px' }}><label style={S.label}>Confirm new password</label><TextInput type="password" value={confirmPass} onChange={(e: any) => setConfirmPass(e.target.value)} /></div>
      {err && <div style={{ fontSize: '13px', color: C.danger, marginBottom: '10px', padding: '8px 12px', background: C.dangerSoft, borderRadius: '6px', fontWeight: 500 }}>{err}</div>}
      {msg && <div style={{ fontSize: '13px', color: C.success, marginBottom: '10px', padding: '8px 12px', background: C.successSoft, borderRadius: '6px', fontWeight: 500 }}>{msg}</div>}
      <div style={{ textAlign: 'right' }}><Btn primary onClick={save}>Save changes</Btn></div>
    </div>
  );
}

// ---------------- Portal ----------------
function Portal({ user, accounts, activeKey, onSwitch, onAddAccount, onSignOut, onSignOutAll }: any) {
  const [tab, setTab] = useState('announce');
  const [subs, setSubs] = useState<any[]>([]);
  const [backend, setBackend] = useState<any[]>([]);
  const [games, setGames] = useState<any[]>([]);
  const [idpass, setIdpass] = useState<any[]>([]);
  const [notes, setNotes] = useState<any[]>([]);
  const [announce, setAnnounce] = useState<any[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setSubs(loadKey<any[]>(K.SUBS, []));
    setBackend(loadKey<any[]>(K.BACKEND, []));
    setGames(loadKey<any[]>(K.GAMES, []));
    setIdpass(loadKey<any[]>(K.IDPASS, []));
    setNotes(loadKey<any[]>(K.NOTES, []));
    setAnnounce(loadKey<any[]>(K.ANNOUNCE, []));
    setLoaded(true);
  }, [activeKey]);

  const tabs = [
    { id: 'announce', label: 'Announcements' },
    { id: 'notes', label: 'Notes' },
    { id: 'backend', label: 'Backend' },
    { id: 'games', label: 'Games' },
    { id: 'idpass', label: 'Id & Pass' },
    ...(user.role === 'zeus' ? [{ id: 'subs', label: 'Sub-admins' }, { id: 'settings', label: 'Settings' }] : []),
  ];
  const announceLabels = { titlePh: 'Announcement title', bodyLabel: 'Message', bodyPh: 'What do you want to announce?', recLabel: 'Post to', submit: 'Post announcement', errBoth: 'Title and message required', errRec: 'Pick at least one recipient', emptySubs: 'Create sub-admins first to post announcements.', emptyZeus: 'No announcements posted yet.', emptySub: 'No announcements for you yet.' };
  const notesLabels = { titlePh: 'Short title', bodyLabel: 'Note', bodyPh: 'Private note', recLabel: 'Send to', submit: 'Send note', errBoth: 'Title and note required', errRec: 'Pick at least one sub-admin', emptySubs: 'Create sub-admins first to send private notes.', emptyZeus: 'No notes sent yet.', emptySub: 'No notes for you yet.' };

  return (
    <div style={S.shell}>
      <div style={S.card}>
        <div style={S.headerBar}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
            <Image src="/logo.png" alt="" width={38} height={38} style={{ borderRadius: '9px', flexShrink: 0 }} />
            <div style={{ minWidth: 0 }}>
              <div style={S.brand}>Infos</div>
              <div style={S.sub}>{user.role === 'zeus' ? `${user.username} — main admin` : `${user.username} — sub-admin`}</div>
            </div>
          </div>
          <AccountSwitcher accounts={accounts} activeKey={activeKey} onSwitch={onSwitch} onAddAccount={onAddAccount} onSignOut={onSignOut} onSignOutAll={onSignOutAll} />
        </div>
        <div className="infos-tabs" style={S.tabs}>
          {tabs.map((t) => <button key={t.id} onClick={() => setTab(t.id)} className="infos-tab" style={tabStyle(tab === t.id)}>{t.label}</button>)}
        </div>
        {!loaded ? <div style={S.empty}>Loading…</div> :
          tab === 'announce' ? <MessageTab role={user.role} user={user} subs={subs} items={announce} setItems={setAnnounce} storageKey={K.ANNOUNCE} labels={announceLabels} /> :
          tab === 'notes' ? <MessageTab role={user.role} user={user} subs={subs} items={notes} setItems={setNotes} storageKey={K.NOTES} labels={notesLabels} /> :
          tab === 'backend' ? <GameListTab storageKey={K.BACKEND} role={user.role} user={user} subs={subs} entries={backend} setEntries={setBackend} emptyMsg="No backend entries yet." /> :
          tab === 'games' ? <GameListTab storageKey={K.GAMES} role={user.role} user={user} subs={subs} entries={games} setEntries={setGames} emptyMsg="No games yet." /> :
          tab === 'idpass' ? <IdPassTab role={user.role} user={user} subs={subs} entries={idpass} setEntries={setIdpass} /> :
          tab === 'subs' ? <SubAdminsPanel subs={subs} setSubs={setSubs} /> :
          tab === 'settings' ? <SettingsPanel onForceLogout={onSignOutAll} /> : null}
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

  useEffect(() => {
    const existing = loadKey<any>(K.ZEUS, null);
    if (!existing) saveKey(K.ZEUS, DEFAULT_ZEUS);
    const accs = loadKey<any[]>(K.ACCOUNTS, []);
    const act = loadKey<string | null>(K.ACTIVE, null);
    setAccounts(accs);
    if (accs.length > 0) setActiveKey(act && accs.find((a) => accKey(a) === act) ? act : accKey(accs[0]));
    setHydrated(true);
  }, []);

  const persist = (accs: any[], act: string | null) => {
    saveKey(K.ACCOUNTS, accs);
    saveKey(K.ACTIVE, act);
  };
  const addAccount = (u: any) => {
    const k = accKey(u);
    if (accounts.some((a) => accKey(a) === k)) return false;
    const next = [...accounts, u];
    setAccounts(next); setActiveKey(k); setAddingAccount(false);
    persist(next, k); return true;
  };
  const switchTo = (k: string) => { if (accounts.some((a) => accKey(a) === k)) { setActiveKey(k); saveKey(K.ACTIVE, k); } };
  const signOut = (k: string) => {
    const next = accounts.filter((a) => accKey(a) !== k);
    setAccounts(next);
    if (next.length === 0) { setActiveKey(null); persist(next, null); }
    else { const na = activeKey === k ? accKey(next[0]) : activeKey; setActiveKey(na); persist(next, na); }
  };
  const signOutAll = () => { setAccounts([]); setActiveKey(null); setAddingAccount(false); persist([], null); };

  if (!hydrated) return null;
  if (showOpenSplash) return <Splash ms={3000} subtitle="Loading…" onDone={() => setShowOpenSplash(false)} />;
  if (accounts.length === 0) return <LoginForm onLogin={addAccount} />;
  if (addingAccount) return <LoginForm onLogin={addAccount} onCancel={() => setAddingAccount(false)} cancelLabel="Back" subtitle="Add another account" />;
  const activeUser = accounts.find((a) => accKey(a) === activeKey);
  if (!activeUser) return <LoginForm onLogin={addAccount} />;
  return <Portal user={activeUser} accounts={accounts} activeKey={activeKey} onSwitch={switchTo} onAddAccount={() => setAddingAccount(true)} onSignOut={signOut} onSignOutAll={signOutAll} />;
}
