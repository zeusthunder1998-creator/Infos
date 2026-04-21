'use client';

import { useEffect, useState } from 'react';
import { ALL_SENTINEL, friendlyError } from '@/lib/storage';
import { C, S } from './styles';

// ---------------- Shared primitives ----------------
function TextInput(props: any) { return <input {...props} className={'infos-input ' + (props.className || '')} style={{ ...S.input, ...(props.style || {}) }} />; }
function TextArea(props: any) { return <textarea {...props} className={'infos-input ' + (props.className || '')} style={{ ...S.textarea, ...(props.style || {}) }} />; }

function AssigneePicker({ subs, selected, onChange }: any) {
  if (subs.length === 0) {
    return <div style={{ fontSize: '12.5px', color: 'var(--warn-text)', padding: '10px 12px', background: 'var(--warn-soft)', borderRadius: '8px', border: '1px solid var(--warn-border)' }}>
      No sub-admins exist yet.
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
        return (
          <button key={s.id} type="button" onClick={() => toggleOne(s.id)} disabled={allOn} className="infos-pill"
            style={{ padding: '5px 12px', fontSize: '12.5px', border: on ? `1px solid ${C.accent}` : `1px solid ${C.borderStrong}`, borderRadius: '16px', background: on ? C.accent : C.cardBg, color: on ? 'white' : C.textPrimary, cursor: allOn ? 'not-allowed' : 'pointer', fontWeight: on ? 600 : 500, transition: 'all 0.15s', opacity: allOn ? 0.45 : 1 }}>
            {s.username}
          </button>
        );
      })}
    </div>
  );
}

// ---------------- Modal shell ----------------
function ModalShell({ title, onClose, children, footer }: any) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);
  return (
    <div className="infos-modal-backdrop" onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'var(--modal-backdrop)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <div className="infos-modal" onClick={(e) => e.stopPropagation()}
        style={{ background: C.cardBg, border: `1px solid ${C.borderStrong}`, borderRadius: '14px', maxWidth: '520px', width: '100%', maxHeight: '90vh', boxShadow: 'var(--shadow-pop)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '18px 20px 14px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: '16px', fontWeight: 600, letterSpacing: '-0.01em' }}>{title}</div>
          <button onClick={onClose} type="button" style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '20px', color: C.textTertiary, lineHeight: 1, padding: '4px 8px', borderRadius: '4px' }}>×</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>{children}</div>
        {footer && <div style={{ padding: '14px 20px', borderTop: `1px solid ${C.border}` }}>{footer}</div>}
      </div>
    </div>
  );
}

// ---------------- Edit: Game / Backend ----------------
export function EditGameModal({ open, entry, subs, onClose, onSave }: any) {
  const [gameName, setGameName] = useState('');
  const [shortName, setShortName] = useState('');
  const [link, setLink] = useState('');
  const [description, setDescription] = useState('');
  const [assignees, setAssignees] = useState<string[]>([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (entry) {
      setGameName(entry.gameName || '');
      setShortName(entry.shortName || '');
      setLink(entry.link || '');
      setDescription(entry.description || '');
      setAssignees(entry.assignees || []);
      setErr('');
    }
  }, [entry]);

  if (!open || !entry) return null;

  const save = async () => {
    setErr('');
    if (!gameName.trim() || !shortName.trim() || !link.trim()) return setErr('Game name, short name, and link are required');
    if (assignees.length === 0) return setErr('Pick at least one sub-admin or "Assign to all"');
    setBusy(true);
    try {
      await onSave({ gameName: gameName.trim(), shortName: shortName.trim(), link: link.trim(), description: description.trim(), assignees });
      onClose();
    } catch (e: any) {
      setErr(friendlyError(e));
    } finally { setBusy(false); }
  };

  return (
    <ModalShell title="Edit entry" onClose={onClose}
      footer={
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button onClick={onClose} className="infos-btn" style={S.btn}>Cancel</button>
          <button onClick={save} disabled={busy} className="infos-btn-primary" style={{ ...S.btnPrimary, opacity: busy ? 0.7 : 1 }}>{busy ? 'Saving…' : 'Save changes'}</button>
        </div>
      }>
      <div style={{ display: 'grid', gap: '12px' }}>
        <div><label style={S.label}>Game name</label><TextInput value={gameName} onChange={(e: any) => setGameName(e.target.value)} /></div>
        <div><label style={S.label}>Short name</label><TextInput value={shortName} onChange={(e: any) => setShortName(e.target.value)} /></div>
        <div><label style={S.label}>Link</label><TextInput value={link} onChange={(e: any) => setLink(e.target.value)} placeholder="https://..." /></div>
        <div><label style={S.label}>Description / note</label><TextArea value={description} onChange={(e: any) => setDescription(e.target.value)} /></div>
        <div><label style={S.label}>Assign to sub-admin(s)</label><AssigneePicker subs={subs} selected={assignees} onChange={setAssignees} /></div>
        {err && <div style={{ fontSize: '13px', color: C.danger, padding: '8px 12px', background: C.dangerSoft, borderRadius: '6px', fontWeight: 500 }}>{err}</div>}
      </div>
    </ModalShell>
  );
}

// ---------------- Edit: Id & Pass ----------------
export function EditIdPassModal({ open, entry, subs, onClose, onSave }: any) {
  const [game, setGame] = useState('');
  const [shortName, setShortName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [description, setDescription] = useState('');
  const [assignees, setAssignees] = useState<string[]>([]);
  const [showPass, setShowPass] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (entry) {
      setGame(entry.game || '');
      setShortName(entry.shortName || '');
      setUsername(entry.username || '');
      setPassword(entry.password || '');
      setDescription(entry.description || '');
      setAssignees(entry.assignees || []);
      setShowPass(false);
      setErr('');
    }
  }, [entry]);

  if (!open || !entry) return null;

  const save = async () => {
    setErr('');
    if (!game.trim() || !username.trim() || !password.trim()) return setErr('Game, username, and password are required');
    if (assignees.length === 0) return setErr('Pick at least one sub-admin or "Assign to all"');
    setBusy(true);
    try {
      await onSave({
        game: game.trim(), shortName: shortName.trim(),
        username: username.trim(), password,
        description: description.trim(), assignees,
      });
      onClose();
    } catch (e: any) { setErr(friendlyError(e)); } finally { setBusy(false); }
  };

  return (
    <ModalShell title="Edit credentials" onClose={onClose}
      footer={
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button onClick={onClose} className="infos-btn" style={S.btn}>Cancel</button>
          <button onClick={save} disabled={busy} className="infos-btn-primary" style={{ ...S.btnPrimary, opacity: busy ? 0.7 : 1 }}>{busy ? 'Saving…' : 'Save changes'}</button>
        </div>
      }>
      <div style={{ display: 'grid', gap: '12px' }}>
        <div><label style={S.label}>Game</label><TextInput value={game} onChange={(e: any) => setGame(e.target.value)} /></div>
        <div><label style={S.label}>Short name (optional)</label><TextInput value={shortName} onChange={(e: any) => setShortName(e.target.value)} /></div>
        <div><label style={S.label}>Username</label><TextInput value={username} onChange={(e: any) => setUsername(e.target.value)} /></div>
        <div>
          <label style={S.label}>Password</label>
          <div style={{ position: 'relative' }}>
            <TextInput type={showPass ? 'text' : 'password'} value={password} onChange={(e: any) => setPassword(e.target.value)} style={{ paddingRight: '70px' }} />
            <button type="button" onClick={() => setShowPass(!showPass)}
              style={{ position: 'absolute', right: '6px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', fontSize: '11.5px', color: C.textSecondary, cursor: 'pointer', padding: '4px 8px', fontWeight: 500 }}>
              {showPass ? 'Hide' : 'Show'}
            </button>
          </div>
        </div>
        <div><label style={S.label}>Description / note</label><TextArea value={description} onChange={(e: any) => setDescription(e.target.value)} /></div>
        <div><label style={S.label}>Assign to sub-admin(s)</label><AssigneePicker subs={subs} selected={assignees} onChange={setAssignees} /></div>
        {err && <div style={{ fontSize: '13px', color: C.danger, padding: '8px 12px', background: C.dangerSoft, borderRadius: '6px', fontWeight: 500 }}>{err}</div>}
      </div>
    </ModalShell>
  );
}

// ---------------- Edit: Notice ----------------
export function EditNoticeModal({ open, entry, subs, onClose, onSave }: any) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [link, setLink] = useState('');
  const [recipients, setRecipients] = useState<string[]>([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (entry) {
      setTitle(entry.title || '');
      setBody(entry.body || '');
      setLink(entry.link || '');
      setRecipients(entry.recipients || []);
      setErr('');
    }
  }, [entry]);

  if (!open || !entry) return null;

  const save = async () => {
    setErr('');
    if (!title.trim() || !body.trim()) return setErr('Title and message are required');
    if (recipients.length === 0) return setErr('Pick at least one recipient');
    setBusy(true);
    try {
      await onSave({ title: title.trim(), body: body.trim(), link: link.trim(), recipients });
      onClose();
    } catch (e: any) { setErr(friendlyError(e)); } finally { setBusy(false); }
  };

  return (
    <ModalShell title="Edit notice" onClose={onClose}
      footer={
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button onClick={onClose} className="infos-btn" style={S.btn}>Cancel</button>
          <button onClick={save} disabled={busy} className="infos-btn-primary" style={{ ...S.btnPrimary, opacity: busy ? 0.7 : 1 }}>{busy ? 'Saving…' : 'Save changes'}</button>
        </div>
      }>
      <div style={{ display: 'grid', gap: '12px' }}>
        <div><label style={S.label}>Title</label><TextInput value={title} onChange={(e: any) => setTitle(e.target.value)} /></div>
        <div><label style={S.label}>Message</label><TextArea value={body} onChange={(e: any) => setBody(e.target.value)} /></div>
        <div><label style={S.label}>Link (optional)</label><TextInput value={link} onChange={(e: any) => setLink(e.target.value)} placeholder="https://..." /></div>
        <div><label style={S.label}>Post to</label><AssigneePicker subs={subs} selected={recipients} onChange={setRecipients} /></div>
        {err && <div style={{ fontSize: '13px', color: C.danger, padding: '8px 12px', background: C.dangerSoft, borderRadius: '6px', fontWeight: 500 }}>{err}</div>}
      </div>
    </ModalShell>
  );
}

// ---------------- Edit: Sub-admin ----------------
export function EditSubAdminModal({ open, sub, existingUsernames, onClose, onSave }: any) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (sub) {
      setUsername(sub.username || '');
      setPassword(sub.password || '');
      setShowPass(false);
      setErr('');
    }
  }, [sub]);

  if (!open || !sub) return null;

  const save = async () => {
    setErr('');
    if (!username.trim()) return setErr('Username is required');
    if (!password) return setErr('Password is required');
    // Check duplicate username, excluding self
    if (existingUsernames?.some((u: { id: string; username: string }) => u.username === username.trim() && u.id !== sub.id)) {
      return setErr('That username is already taken');
    }
    setBusy(true);
    try {
      await onSave({ username: username.trim(), password });
      onClose();
    } catch (e: any) { setErr(friendlyError(e)); } finally { setBusy(false); }
  };

  return (
    <ModalShell title={`Edit ${sub.role === 'co' ? 'co-admin' : 'sub-admin'}: ${sub.username}`} onClose={onClose}
      footer={
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button onClick={onClose} className="infos-btn" style={S.btn}>Cancel</button>
          <button onClick={save} disabled={busy} className="infos-btn-primary" style={{ ...S.btnPrimary, opacity: busy ? 0.7 : 1 }}>{busy ? 'Saving…' : 'Save changes'}</button>
        </div>
      }>
      <div style={{ display: 'grid', gap: '12px' }}>
        <div><label style={S.label}>Username</label><TextInput value={username} onChange={(e: any) => setUsername(e.target.value)} /></div>
        <div>
          <label style={S.label}>Password</label>
          <div style={{ position: 'relative' }}>
            <TextInput type={showPass ? 'text' : 'password'} value={password} onChange={(e: any) => setPassword(e.target.value)} style={{ paddingRight: '70px' }} />
            <button type="button" onClick={() => setShowPass(!showPass)}
              style={{ position: 'absolute', right: '6px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', fontSize: '11.5px', color: C.textSecondary, cursor: 'pointer', padding: '4px 8px', fontWeight: 500 }}>
              {showPass ? 'Hide' : 'Show'}
            </button>
          </div>
        </div>
        <div style={{ fontSize: '12px', color: C.textTertiary, lineHeight: 1.5 }}>
          Note: the sub-admin will need to sign in again with the new credentials on any device they&apos;re currently signed in on.
        </div>
        {err && <div style={{ fontSize: '13px', color: C.danger, padding: '8px 12px', background: C.dangerSoft, borderRadius: '6px', fontWeight: 500 }}>{err}</div>}
      </div>
    </ModalShell>
  );
}
