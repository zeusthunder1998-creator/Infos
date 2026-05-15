'use client';

import { useEffect, useRef, useState } from 'react';
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
      // For destructive actions, do NOT auto-confirm on Enter — user must explicitly click.
      // This prevents accidentally wiping a co-admin workspace by hitting Enter.
      if (e.key === 'Enter' && !danger) onConfirm();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onCancel, onConfirm, danger]);

  if (!open) return null;
  return (
    <div className="infos-modal-backdrop" onClick={onCancel}
      style={{ position: 'fixed', inset: 0, background: 'var(--modal-backdrop)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <div className="infos-modal" onClick={(e) => e.stopPropagation()}
        style={{ background: C.cardBg, border: `1px solid ${C.borderStrong}`, borderRadius: '14px', padding: '1.5rem', maxWidth: '400px', width: '100%', boxShadow: 'var(--shadow-pop)' }}>
        <div style={{ fontSize: '16px', fontWeight: 600, marginBottom: '8px', letterSpacing: '-0.01em' }}>{title}</div>
        <div style={{ fontSize: '13.5px', color: C.textSecondary, marginBottom: '18px', lineHeight: 1.5, whiteSpace: 'pre-line' }}>{message}</div>
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
      onConfirm={() => { state.resolve?.(true); setState((s) => ({ ...s, open: false, resolve: undefined })); }}
      onCancel={() => { state.resolve?.(false); setState((s) => ({ ...s, open: false, resolve: undefined })); }}
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

// ---------------- Toast system (v21.3) ----------------
// Lightweight slide-in notifications to replace browser alert() popups.
// Self-contained: useToast() returns [element, toast()]. Drop both into your
// component, then call toast({ message, type }) from anywhere.
//
// Auto-dismiss after 4s by default. Can be dismissed manually via × button.
// Stacked (multiple toasts can show at once, newest on top).
type ToastType = 'success' | 'error' | 'info';
type ToastItem = { id: number; message: string; type: ToastType };

export function useToast() {
  const [items, setItems] = useState<ToastItem[]>([]);
  const counterRef = useRef(0);

  const remove = (id: number) => setItems((prev) => prev.filter((t) => t.id !== id));

  const toast = (opts: { message: string; type?: ToastType; durationMs?: number }) => {
    const id = ++counterRef.current;
    const item: ToastItem = { id, message: opts.message, type: opts.type || 'info' };
    setItems((prev) => [...prev, item]);
    // Auto-dismiss
    const dur = opts.durationMs ?? 4000;
    setTimeout(() => remove(id), dur);
    return id;
  };

  const colorFor = (t: ToastType) => {
    if (t === 'success') return { bg: 'var(--success-soft)', border: 'var(--success)', text: 'var(--success)', icon: '✓' };
    if (t === 'error')   return { bg: 'var(--danger-soft)',  border: 'var(--danger)',  text: 'var(--danger)',  icon: '⚠' };
    return                       { bg: 'var(--accent-soft)', border: 'var(--accent)',  text: 'var(--accent-text)', icon: 'ℹ' };
  };

  const element = (
    <div aria-live="polite" aria-atomic="true" className="infos-toast-stack" style={{
      // v24.2: Mobile-bulletproof toast position.
      // - Top-anchored with safe-area-inset for notch clearance
      // - left:0/right:0 with internal padding so toasts NEVER overflow viewport edges
      // - Centered horizontally via flex alignItems on parent
      // - max-width caps width on desktop
      // - box-sizing border-box so padding doesn't break width calc
      position: 'fixed',
      top: 'calc(env(safe-area-inset-top, 0px) + 14px)',
      left: 0,
      right: 0,
      paddingLeft: '14px',
      paddingRight: '14px',
      zIndex: 11000,
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px',
      pointerEvents: 'none',
      boxSizing: 'border-box',
    }}>
      {items.map((t) => {
        const c = colorFor(t.type);
        return (
          <div key={t.id}
            style={{
              pointerEvents: 'auto',
              display: 'flex', alignItems: 'center', gap: '10px',
              padding: '10px 14px',
              background: 'var(--card-bg)',
              border: `1px solid ${c.border}`,
              borderLeft: `4px solid ${c.border}`,
              borderRadius: '8px',
              boxShadow: 'var(--shadow-pop)',
              width: '100%',
              maxWidth: '420px',
              minWidth: 0,
              boxSizing: 'border-box',
              fontSize: '13.5px', fontWeight: 500,
              color: 'var(--text-primary)',
              animation: 'infosSlideUp 0.22s ease-out',
            }}>
            <span style={{ color: c.text, fontSize: '15px', fontWeight: 700, flexShrink: 0 }}>{c.icon}</span>
            <span style={{ flex: 1, lineHeight: 1.4 }}>{t.message}</span>
            <button onClick={() => remove(t.id)} type="button" aria-label="Dismiss"
              style={{ background: 'transparent', border: 'none', color: 'var(--text-tertiary)', fontSize: '16px', cursor: 'pointer', padding: '2px 4px', flexShrink: 0, lineHeight: 1 }}>
              ×
            </button>
          </div>
        );
      })}
    </div>
  );

  return [element, toast] as const;
}

// ---------------- Skeleton loader (v21.3) ----------------
// Shimmering placeholder for loading states. Use as a generic shape OR with
// a dedicated `lines` count to render a list-style placeholder.
export function Skeleton({ width, height, lines, style }: { width?: string; height?: string; lines?: number; style?: any }) {
  // v25.8: When `lines` is set, render card-shaped placeholders that mimic
  // the real list item structure (title row + body lines + footer chips).
  // This gives a much more confident "content is coming" signal than the
  // older generic rectangles.
  if (lines && lines > 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', ...style }}>
        {Array.from({ length: lines }).map((_, i) => (
          <div key={i} style={{
            background: 'var(--card-bg)',
            border: '1px solid var(--border)',
            borderRadius: '12px',
            padding: '16px 16px 14px',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
          }}>
            {/* Title row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div className="infos-skeleton-bar" style={{
                width: `${50 + ((i * 13) % 30)}%`,
                height: '14px',
                borderRadius: '4px',
                background: 'linear-gradient(90deg, var(--soft-bg) 0%, var(--border) 50%, var(--soft-bg) 100%)',
                backgroundSize: '200% 100%',
                animation: 'infosShimmer 1.4s ease-in-out infinite',
              }} />
            </div>
            {/* Body line */}
            <div className="infos-skeleton-bar" style={{
              width: '92%',
              height: '11px',
              borderRadius: '4px',
              background: 'linear-gradient(90deg, var(--soft-bg) 0%, var(--border) 50%, var(--soft-bg) 100%)',
              backgroundSize: '200% 100%',
              animation: 'infosShimmer 1.4s ease-in-out infinite',
              animationDelay: '0.1s',
            }} />
            {/* Footer chips row */}
            <div style={{ display: 'flex', gap: '6px', marginTop: '2px' }}>
              <div className="infos-skeleton-bar" style={{
                width: '60px', height: '18px', borderRadius: '5px',
                background: 'linear-gradient(90deg, var(--soft-bg) 0%, var(--border) 50%, var(--soft-bg) 100%)',
                backgroundSize: '200% 100%',
                animation: 'infosShimmer 1.4s ease-in-out infinite',
                animationDelay: '0.2s',
              }} />
              <div className="infos-skeleton-bar" style={{
                width: '70px', height: '18px', borderRadius: '5px',
                background: 'linear-gradient(90deg, var(--soft-bg) 0%, var(--border) 50%, var(--soft-bg) 100%)',
                backgroundSize: '200% 100%',
                animation: 'infosShimmer 1.4s ease-in-out infinite',
                animationDelay: '0.3s',
              }} />
            </div>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="infos-skeleton" style={{
      width: width || '100%',
      height: height || '20px',
      borderRadius: '6px',
      background: 'linear-gradient(90deg, var(--soft-bg) 0%, var(--border) 50%, var(--soft-bg) 100%)',
      backgroundSize: '200% 100%',
      animation: 'infosShimmer 1.4s ease-in-out infinite',
      ...style,
    }} />
  );
}

// ---------------- Empty state with illustration (v21.3) ----------------
// Friendly placeholder shown when a tab/list has no items. Centered emoji
// "illustration" + headline + optional helper text. Replaces the old plain
// "No notices yet" text everywhere.
export function EmptyState({ icon, title, hint }: { icon: string; title: string; hint?: string }) {
  return (
    <div style={{
      // v25.15: Polished empty state. Adds a soft circular "halo" backdrop behind
      // the icon to feel more illustrated and less generic-emoji.
      padding: '56px 24px 48px',
      textAlign: 'center',
      borderRadius: '16px',
      background: 'var(--soft-bg)',
      border: '1px dashed var(--border)',
      animation: 'infosFadeIn 0.3s ease-out',
      maxWidth: '460px',
      margin: '0 auto',
    }}>
      {/* Icon with circular gradient backdrop */}
      <div style={{
        width: '92px',
        height: '92px',
        margin: '0 auto 18px',
        borderRadius: '50%',
        background: 'radial-gradient(circle, var(--accent-soft) 0%, transparent 70%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
      }}>
        {/* Inner halo */}
        <div style={{
          position: 'absolute',
          inset: '18px',
          borderRadius: '50%',
          background: 'var(--card-bg)',
          border: '1px solid var(--border)',
          boxShadow: '0 4px 16px var(--accent-soft)',
        }} />
        <div style={{
          fontSize: '36px',
          lineHeight: 1,
          position: 'relative',
          zIndex: 1,
        }}>
          {icon}
        </div>
      </div>
      <div style={{
        fontSize: '16px',
        fontWeight: 600,
        color: 'var(--text-primary)',
        letterSpacing: '-0.01em',
        marginBottom: hint ? '8px' : 0,
      }}>
        {title}
      </div>
      {hint && (
        <div style={{
          fontSize: '13px',
          color: 'var(--text-secondary)',
          lineHeight: 1.5,
          maxWidth: '320px',
          margin: '0 auto',
        }}>
          {hint}
        </div>
      )}
    </div>
  );
}
