'use client';

import { useEffect, useState } from 'react';
import { C, S } from './styles';

// ---------------- Time helpers ----------------
export function timeAgo(ms: number): string {
  if (!ms) return '';
  const diff = Date.now() - ms;
  const sec = Math.floor(diff / 1000);
  if (sec < 10) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mon = Math.floor(day / 30);
  if (mon < 12) return `${mon}mo ago`;
  const yr = Math.floor(day / 365);
  return `${yr}y ago`;
}

export function fullDateTime(ms: number): string {
  if (!ms) return '';
  const d = new Date(ms);
  return d.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

/** Live-updating "2 min ago" text. Re-renders every 30s. */
export function useLiveTimeAgo(ms: number) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!ms) return;
    const id = setInterval(() => setTick(t => t + 1), 30000);
    return () => clearInterval(id);
  }, [ms]);
  return timeAgo(ms);
}

export function Timestamp({ createdAt, updatedAt }: { createdAt: number; updatedAt?: number | null }) {
  const created = useLiveTimeAgo(createdAt);
  const updated = useLiveTimeAgo(updatedAt || 0);
  const wasEdited = updatedAt && updatedAt > createdAt + 2000; // 2s grace
  return (
    <div style={{ fontSize: '11px', color: C.textTertiary, marginTop: '8px', fontWeight: 500, display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
      <span title={fullDateTime(createdAt)}>Created {created} · {fullDateTime(createdAt)}</span>
      {wasEdited && <span title={fullDateTime(updatedAt!)} style={{ color: C.accent }}>Updated {updated}</span>}
    </div>
  );
}

// ---------------- Confirm Dialog ----------------
export function ConfirmDialog({ open, title, message, confirmLabel = 'Delete', cancelLabel = 'Cancel', danger, onConfirm, onCancel }: any) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Enter') onConfirm();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onCancel, onConfirm]);

  if (!open) return null;
  return (
    <div className="infos-modal-backdrop" onClick={onCancel}
      style={{ position: 'fixed', inset: 0, background: 'var(--modal-backdrop)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <div className="infos-modal" onClick={(e) => e.stopPropagation()}
        style={{ background: C.cardBg, border: `1px solid ${C.borderStrong}`, borderRadius: '14px', padding: '1.5rem', maxWidth: '400px', width: '100%', boxShadow: 'var(--shadow-pop)' }}>
        <div style={{ fontSize: '16px', fontWeight: 600, marginBottom: '8px', letterSpacing: '-0.01em' }}>{title}</div>
        <div style={{ fontSize: '13.5px', color: C.textSecondary, marginBottom: '18px', lineHeight: 1.5 }}>{message}</div>
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button onClick={onCancel} className="infos-btn" style={S.btn}>{cancelLabel}</button>
          <button onClick={onConfirm} className="infos-btn-primary"
            style={{ ...S.btnPrimary, background: danger ? C.danger : C.accent }}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Hook that manages a confirm modal. Returns [element, confirm()].
 *  `confirm(opts)` returns a promise that resolves true/false. */
export function useConfirm() {
  const [state, setState] = useState<{
    open: boolean; title: string; message: string;
    confirmLabel?: string; danger?: boolean;
    resolve?: (v: boolean) => void;
  }>({ open: false, title: '', message: '' });
  const element = (
    <ConfirmDialog
      open={state.open}
      title={state.title}
      message={state.message}
      confirmLabel={state.confirmLabel}
      danger={state.danger}
      onConfirm={() => { state.resolve?.(true); setState({ ...state, open: false }); }}
      onCancel={() => { state.resolve?.(false); setState({ ...state, open: false }); }}
    />
  );
  const confirm = (opts: { title: string; message: string; confirmLabel?: string; danger?: boolean }) =>
    new Promise<boolean>((resolve) => setState({ ...opts, open: true, resolve }));
  return [element, confirm] as const;
}

// ---------------- Theme hook ----------------
export type Theme = 'system' | 'light' | 'dark';

export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>('system');
  useEffect(() => {
    try {
      const v = localStorage.getItem('infos:theme');
      if (v === 'light' || v === 'dark') setThemeState(v);
      else setThemeState('system');
    } catch {}
  }, []);
  const setTheme = (t: Theme) => {
    setThemeState(t);
    try {
      if (t === 'system') {
        localStorage.removeItem('infos:theme');
        document.documentElement.removeAttribute('data-theme');
      } else {
        localStorage.setItem('infos:theme', t);
        document.documentElement.setAttribute('data-theme', t);
      }
    } catch {}
  };
  return [theme, setTheme];
}

// ---------------- Search bar ----------------
export function SearchBar({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div style={{ position: 'relative', marginBottom: '1rem' }}>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder || 'Search…'}
        className="infos-input"
        style={{ ...S.input, paddingLeft: '36px' }}
      />
      <span style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', fontSize: '14px', color: C.textTertiary, pointerEvents: 'none' }}>🔍</span>
      {value && (
        <button onClick={() => onChange('')} type="button"
          style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', cursor: 'pointer', color: C.textTertiary, fontSize: '14px', padding: '4px 8px' }}
          title="Clear search">
          ✕
        </button>
      )}
    </div>
  );
}
