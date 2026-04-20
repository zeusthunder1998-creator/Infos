'use client';

import { useMemo, useState } from 'react';
import { isAssignedAll } from '@/lib/storage';
import { C, S } from './styles';

// ---------------- Bulk Assign Modal ----------------
// Shows for a single sub-admin: toggles across ALL entries in all tables.
// Caller provides current entry lists and a save callback.

export type BulkEntry = {
  id: string;
  label: string;
  subLabel?: string;
  table: 'notices' | 'backend' | 'games' | 'idpass';
  assignees: string[];
};

export function BulkAssignModal({
  open, subAdmin, entries, onClose, onSave,
}: {
  open: boolean;
  subAdmin: any;
  entries: BulkEntry[];
  onClose: () => void;
  onSave: (changes: { entry: BulkEntry; grant: boolean }[]) => Promise<void>;
}) {
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('');

  // Current access: either "all" or explicit inclusion
  const hasAccess = (e: BulkEntry) => {
    if (pending[e.id] !== undefined) return pending[e.id];
    if (isAssignedAll(e.assignees)) return true;
    return (e.assignees || []).includes(subAdmin?.id);
  };

  const toggle = (e: BulkEntry) => {
    const current = hasAccess(e);
    setPending({ ...pending, [e.id]: !current });
  };

  const filtered = useMemo(() => {
    if (!filter.trim()) return entries;
    const q = filter.toLowerCase();
    return entries.filter(e =>
      e.label.toLowerCase().includes(q) ||
      (e.subLabel || '').toLowerCase().includes(q) ||
      e.table.includes(q)
    );
  }, [entries, filter]);

  const changesCount = Object.keys(pending).filter(id => {
    const e = entries.find(x => x.id === id);
    if (!e) return false;
    const current = isAssignedAll(e.assignees) || (e.assignees || []).includes(subAdmin?.id);
    return pending[id] !== current;
  }).length;

  const handleSave = async () => {
    setBusy(true);
    try {
      const changes: { entry: BulkEntry; grant: boolean }[] = [];
      for (const [id, grant] of Object.entries(pending)) {
        const entry = entries.find(e => e.id === id);
        if (!entry) continue;
        const current = isAssignedAll(entry.assignees) || (entry.assignees || []).includes(subAdmin?.id);
        if (grant !== current) changes.push({ entry, grant });
      }
      await onSave(changes);
      setPending({});
      onClose();
    } catch (e) {
      console.error(e);
      alert('Could not save changes. See console for details.');
    } finally { setBusy(false); }
  };

  const handleCancel = () => { setPending({}); onClose(); };

  if (!open || !subAdmin) return null;

  const byTable = {
    notices: filtered.filter(e => e.table === 'notices'),
    backend: filtered.filter(e => e.table === 'backend'),
    games: filtered.filter(e => e.table === 'games'),
    idpass: filtered.filter(e => e.table === 'idpass'),
  };

  return (
    <div className="infos-modal-backdrop" onClick={handleCancel}
      style={{ position: 'fixed', inset: 0, background: 'var(--modal-backdrop)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <div className="infos-modal" onClick={(e) => e.stopPropagation()}
        style={{ background: C.cardBg, border: `1px solid ${C.borderStrong}`, borderRadius: '14px', padding: 0, maxWidth: '560px', width: '100%', maxHeight: '85vh', boxShadow: 'var(--shadow-pop)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '18px 20px 14px', borderBottom: `1px solid ${C.border}` }}>
          <div style={{ fontSize: '16px', fontWeight: 600, letterSpacing: '-0.01em' }}>Manage access for {subAdmin.username}</div>
          <div style={{ fontSize: '13px', color: C.textSecondary, marginTop: '4px' }}>Toggle items to grant or revoke access. "All sub-admins" entries are always on.</div>
          <input type="text" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter items…"
            className="infos-input"
            style={{ ...S.input, marginTop: '12px' }} />
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '10px 14px' }}>
          {entries.length === 0 && (
            <div style={{ ...S.empty, margin: '1rem 0' }}>No entries yet. Create some in Notice, Backend, Games, or Id & Pass first.</div>
          )}
          {(['notices', 'backend', 'games', 'idpass'] as const).map((t) => {
            const items = byTable[t];
            if (items.length === 0) return null;
            const labels: Record<typeof t, string> = { notices: 'Notices', backend: 'Backend', games: 'Games', idpass: 'Id & Pass' };
            return (
              <div key={t} style={{ marginBottom: '12px' }}>
                <div style={{ fontSize: '11px', color: C.textTertiary, padding: '8px 6px 4px', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>{labels[t]}</div>
                {items.map(e => {
                  const checked = hasAccess(e);
                  const forcedAll = isAssignedAll(e.assignees);
                  return (
                    <label key={e.id}
                      style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 12px', cursor: forcedAll ? 'not-allowed' : 'pointer', borderRadius: '8px', opacity: forcedAll ? 0.6 : 1 }}
                      onMouseEnter={(ev) => { if (!forcedAll) (ev.currentTarget as HTMLElement).style.background = C.softBg; }}
                      onMouseLeave={(ev) => (ev.currentTarget as HTMLElement).style.background = 'transparent'}>
                      <input type="checkbox" checked={checked} disabled={forcedAll}
                        onChange={() => !forcedAll && toggle(e)}
                        style={{ width: '18px', height: '18px', cursor: forcedAll ? 'not-allowed' : 'pointer', accentColor: C.accent }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '13.5px', fontWeight: 500, color: C.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {e.label}
                          {forcedAll && <span style={{ ...S.allPill, fontSize: '10px', padding: '2px 6px', marginLeft: '8px' }}>All</span>}
                        </div>
                        {e.subLabel && <div style={{ fontSize: '11.5px', color: C.textTertiary, marginTop: '2px' }}>{e.subLabel}</div>}
                      </div>
                    </label>
                  );
                })}
              </div>
            );
          })}
        </div>
        <div style={{ padding: '14px 20px', borderTop: `1px solid ${C.border}`, display: 'flex', gap: '10px', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: '12.5px', color: C.textSecondary, fontWeight: 500 }}>
            {changesCount === 0 ? 'No changes' : `${changesCount} change${changesCount === 1 ? '' : 's'} pending`}
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button onClick={handleCancel} className="infos-btn" style={S.btn}>Cancel</button>
            <button onClick={handleSave} disabled={busy || changesCount === 0} className="infos-btn-primary"
              style={{ ...S.btnPrimary, opacity: (busy || changesCount === 0) ? 0.6 : 1 }}>
              {busy ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
