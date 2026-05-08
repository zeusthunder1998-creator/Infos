// Shared styles for the app

export const C = {
  cardBg: 'var(--card-bg)',
  softBg: 'var(--soft-bg)',
  border: 'var(--border)',
  borderStrong: 'var(--border-strong)',
  textPrimary: 'var(--text-primary)',
  textSecondary: 'var(--text-secondary)',
  textTertiary: 'var(--text-tertiary)',
  accent: 'var(--accent)',
  accentSoft: 'var(--accent-soft)',
  accentText: 'var(--accent-text)',
  danger: 'var(--danger)',
  dangerSoft: 'var(--danger-soft)',
  success: 'var(--success)',
  successSoft: 'var(--success-soft)',
};

export const S: Record<string, any> = {
  shell: { maxWidth: '720px', margin: '0 auto', padding: '1.5rem 1rem' },
  card: { background: C.cardBg, border: `1px solid ${C.border}`, borderRadius: '14px', padding: '1.5rem', boxShadow: 'var(--shadow-card)' },
  softCard: { background: C.softBg, border: `1px solid ${C.border}`, borderRadius: '12px', padding: '1rem' },
  headerBar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', paddingBottom: '1rem', borderBottom: `1px solid ${C.border}`, gap: '8px' },
  brand: { fontSize: '20px', fontWeight: 600, letterSpacing: '-0.02em', lineHeight: 1.2 },
  sub: { fontSize: '12.5px', color: C.textSecondary, marginTop: '2px' },
  tabs: { display: 'flex', gap: '2px', borderBottom: `1px solid ${C.border}`, marginBottom: '1.25rem', flexWrap: 'wrap' as const },
  input: { width: '100%', padding: '10px 12px', fontSize: '14px', border: `1px solid ${C.borderStrong}`, borderRadius: '8px', background: C.cardBg, color: C.textPrimary, boxSizing: 'border-box' as const, transition: 'border-color 0.15s, box-shadow 0.15s', lineHeight: '1.4' },
  textarea: { width: '100%', padding: '10px 12px', fontSize: '14px', border: `1px solid ${C.borderStrong}`, borderRadius: '8px', background: C.cardBg, color: C.textPrimary, boxSizing: 'border-box' as const, minHeight: '72px', resize: 'vertical' as const, transition: 'border-color 0.15s, box-shadow 0.15s', lineHeight: '1.5' },
  label: { display: 'block', fontSize: '12.5px', color: C.textSecondary, marginBottom: '5px', fontWeight: 500, letterSpacing: '-0.005em' },
  btn: { padding: '9px 14px', fontSize: '13.5px', border: `1px solid ${C.borderStrong}`, borderRadius: '8px', background: C.cardBg, cursor: 'pointer', color: C.textPrimary, fontWeight: 500, transition: 'background 0.15s' },
  btnPrimary: { padding: '10px 18px', fontSize: '14px', border: 'none', borderRadius: '8px', background: C.accent, color: 'white', cursor: 'pointer', fontWeight: 600, transition: 'all 0.15s', letterSpacing: '-0.005em' },
  btnDanger: { padding: '6px 10px', fontSize: '12px', border: `1px solid ${C.border}`, borderRadius: '6px', background: 'transparent', color: C.danger, cursor: 'pointer', fontWeight: 500 },
  grid3: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' },
  grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' },
  empty: { padding: '2.5rem 1rem', textAlign: 'center' as const, color: C.textTertiary, fontSize: '13.5px', background: C.softBg, border: `1px dashed ${C.border}`, borderRadius: '12px' },
  item: { padding: '14px', background: C.cardBg, border: `1px solid ${C.border}`, borderRadius: '10px', marginBottom: '10px', display: 'flex', gap: '4px' },
  linkPill: { display: 'inline-block', padding: '4px 10px', fontSize: '12px', background: C.accentSoft, color: C.accentText, borderRadius: '6px', textDecoration: 'none', wordBreak: 'break-all' as const, fontWeight: 500 },
  badge: { display: 'inline-block', padding: '2px 8px', fontSize: '11px', background: C.softBg, color: C.textSecondary, borderRadius: '5px', marginLeft: '8px', fontWeight: 500 },
  assigneePill: { display: 'inline-block', padding: '3px 9px', fontSize: '11px', background: C.accentSoft, color: C.accentText, borderRadius: '5px', marginRight: '5px', marginTop: '4px', fontWeight: 500 },
  allPill: { display: 'inline-block', padding: '3px 9px', fontSize: '11px', background: C.accent, color: 'white', borderRadius: '5px', marginRight: '5px', marginTop: '4px', fontWeight: 600, letterSpacing: '0.02em' },
  descBox: { marginTop: '10px', padding: '10px 12px', background: C.softBg, fontSize: '13px', color: C.textSecondary, borderLeft: `3px solid ${C.accent}`, borderRadius: '0 8px 8px 0', whiteSpace: 'pre-wrap' as const, lineHeight: '1.5' },
  dragHandle: { flexShrink: 0, width: '22px', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '2px', color: C.textTertiary, cursor: 'grab', fontSize: '14px', lineHeight: '1', userSelect: 'none' as const },
};

export function tabStyle(active: boolean) {
  return {
    padding: '10px 14px',
    fontSize: '13.5px',
    cursor: 'pointer',
    background: 'transparent',
    border: 'none',
    borderBottom: active ? `2px solid ${C.accent}` : '2px solid transparent',
    color: active ? C.textPrimary : C.textSecondary,
    fontWeight: active ? 600 : 500,
    marginBottom: '-1px',
    transition: 'color 0.15s',
    letterSpacing: '-0.01em',
    whiteSpace: 'nowrap' as const,
  };
}
