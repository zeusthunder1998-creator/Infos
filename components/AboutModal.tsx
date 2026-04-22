'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { C, S } from './styles';
import { AboutContent, DEFAULT_ABOUT, saveAbout, uploadQrImage, friendlyError } from '@/lib/storage';

function CopyAddressButton({ value }: { value: string }) {
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
      style={{
        padding: '6px 12px', fontSize: '12px',
        border: `1px solid ${copied ? C.accent : C.borderStrong}`,
        background: copied ? C.accentSoft : C.cardBg,
        borderRadius: '6px', cursor: 'pointer',
        color: copied ? C.accentText : C.textPrimary,
        fontWeight: 600, transition: 'all 0.15s', whiteSpace: 'nowrap',
      }}>
      {copied ? '✓ Copied' : 'Copy'}
    </button>
  );
}

function TextInput(props: any) { return <input {...props} className={'infos-input ' + (props.className || '')} style={{ ...S.input, ...(props.style || {}) }} />; }
function TextArea(props: any) { return <textarea {...props} className={'infos-input ' + (props.className || '')} style={{ ...S.textarea, ...(props.style || {}) }} />; }

type Props = {
  open: boolean;
  onClose: () => void;
  content: AboutContent;          // Current content (from DB or default)
  canEdit: boolean;               // True only for Zeus
  onSaved: () => void;            // Called after successful save, so parent reloads
};

export function AboutModal({ open, onClose, content, canEdit, onSaved }: Props) {
  const [editMode, setEditMode] = useState(false);
  const [draft, setDraft] = useState<AboutContent>(content);
  const [qrFile, setQrFile] = useState<File | null>(null);
  const [qrPreview, setQrPreview] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  // Reset draft ONLY when the modal transitions from closed to open.
  // If `content` changes while the modal is open (e.g. realtime update from another tab),
  // we don't wipe the user's in-progress edits.
  const prevOpenRef = useRef(false);
  useEffect(() => {
    if (open && !prevOpenRef.current) {
      setDraft(content);
      setEditMode(false);
      setQrFile(null);
      setQrPreview('');
      setErr('');
    }
    prevOpenRef.current = open;
  }, [open, content]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // Cleanup object URL
  useEffect(() => {
    return () => { if (qrPreview) URL.revokeObjectURL(qrPreview); };
  }, [qrPreview]);

  if (!open) return null;

  const pickQrFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { setErr('Please select an image file (PNG, JPG, or WebP).'); return; }
    if (file.size > 2 * 1024 * 1024) { setErr('Image is too large (max 2 MB).'); return; }
    setErr('');
    if (qrPreview) URL.revokeObjectURL(qrPreview);
    setQrFile(file);
    setQrPreview(URL.createObjectURL(file));
  };

  const save = async () => {
    setErr('');
    if (!draft.developerName.trim() || !draft.companyName.trim() || !draft.version.trim()) {
      return setErr('Developer name, company, and version are required.');
    }
    if (!draft.walletAddress.trim()) {
      return setErr('Wallet address is required.');
    }
    setSaving(true);
    try {
      let qrUrl = draft.qrImageUrl;
      if (qrFile) {
        qrUrl = await uploadQrImage(qrFile, content.qrImageUrl);
      }
      await saveAbout({ ...draft, qrImageUrl: qrUrl });
      setSaving(false);
      setEditMode(false);
      setQrFile(null);
      if (qrPreview) URL.revokeObjectURL(qrPreview);
      setQrPreview('');
      onSaved();
    } catch (e: any) {
      setSaving(false);
      setErr(friendlyError(e, 'Could not save changes.'));
    }
  };

  const resetToDefaults = () => {
    setDraft({ ...DEFAULT_ABOUT });
    setQrFile(null);
    if (qrPreview) URL.revokeObjectURL(qrPreview);
    setQrPreview('');
  };

  // For display: prefer live QR preview > draft.qrImageUrl > default
  const displayedQr = qrPreview || (editMode ? draft.qrImageUrl : content.qrImageUrl) || '/donate-qr.png';
  const isRemoteQr = displayedQr.startsWith('http');

  return (
    <div className="infos-modal-backdrop" onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'var(--modal-backdrop)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <div className="infos-modal" onClick={(e) => e.stopPropagation()}
        style={{ background: C.cardBg, border: `1px solid ${C.borderStrong}`, borderRadius: '14px', maxWidth: '520px', width: '100%', maxHeight: '92vh', boxShadow: 'var(--shadow-pop)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '18px 20px 14px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
          <div style={{ fontSize: '16px', fontWeight: 600, letterSpacing: '-0.01em' }}>
            {editMode ? 'Edit About Us' : 'About Infos'}
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {canEdit && !editMode && (
              <button onClick={() => setEditMode(true)} type="button"
                style={{ fontSize: '12px', padding: '6px 12px', border: `1px solid ${C.borderStrong}`, background: C.cardBg, borderRadius: '6px', cursor: 'pointer', color: C.textPrimary, fontWeight: 600 }}>
                ✏️ Edit
              </button>
            )}
            <button onClick={onClose} type="button" style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '20px', color: C.textTertiary, lineHeight: 1, padding: '4px 8px', borderRadius: '4px' }}>×</button>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
          {/* VIEW MODE */}
          {!editMode && (
            <>
              <div style={{ textAlign: 'center', marginBottom: '18px' }}>
                <div style={{ width: '72px', height: '72px', position: 'relative', margin: '0 auto' }}>
                  <Image src="/logo.png" alt="Infos" fill style={{ objectFit: 'contain' }} />
                </div>
                <div style={{ fontSize: '22px', fontWeight: 700, letterSpacing: '-0.03em', marginTop: '12px' }}>Infos</div>
                <div style={{ fontSize: '12.5px', color: C.textTertiary, marginTop: '2px', fontWeight: 500, fontFamily: 'ui-monospace, monospace' }}>{content.version}</div>
              </div>

              <div style={{ background: C.softBg, borderRadius: '10px', padding: '14px 16px', marginBottom: '16px' }}>
                <div style={{ fontSize: '12px', color: C.textTertiary, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>Developer</div>
                <div style={{ fontSize: '15px', fontWeight: 600, marginBottom: '4px' }}>{content.developerName}</div>
                <div style={{ fontSize: '13px', color: C.textSecondary, marginBottom: '10px' }}>{content.companyName}</div>
                <div style={{ fontSize: '12.5px', color: C.textSecondary }}>
                  Contact / report issues:{' '}
                  <a href={`mailto:${content.contactEmail}`} style={{ color: C.accentText, textDecoration: 'underline', fontWeight: 500, wordBreak: 'break-all' }}>
                    {content.contactEmail}
                  </a>
                </div>
              </div>

              <div style={{ border: `1px solid ${C.border}`, borderRadius: '10px', padding: '16px' }}>
                <div style={{ fontSize: '14px', fontWeight: 700, marginBottom: '4px', letterSpacing: '-0.01em' }}>{content.donationIntro}</div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '12px', marginBottom: '10px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '13.5px', fontWeight: 600 }}>{content.cryptoName}</span>
                  <span style={{ fontSize: '11px', padding: '2px 8px', background: C.accentSoft, color: C.accentText, borderRadius: '10px', fontWeight: 600, letterSpacing: '0.02em' }}>{content.cryptoNetwork} Network</span>
                </div>

                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '14px' }}>
                  <div style={{ background: 'white', padding: '10px', borderRadius: '10px', border: `1px solid ${C.border}` }}>
                    {isRemoteQr ? (
                      // Use regular img for remote URLs (Next Image needs domain config for externals)
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={displayedQr} alt="QR code" width={240} style={{ display: 'block', maxWidth: '100%', height: 'auto' }} />
                    ) : (
                      <Image src={displayedQr} alt="QR code" width={240} height={210} style={{ display: 'block', maxWidth: '100%', height: 'auto' }} />
                    )}
                  </div>
                </div>

                <div style={{ fontSize: '12px', color: C.textSecondary, marginBottom: '6px', fontWeight: 500 }}>{content.cryptoName} Address:</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: C.softBg, padding: '10px 12px', borderRadius: '8px', marginBottom: '14px', flexWrap: 'wrap' }}>
                  <span style={{ flex: 1, minWidth: '200px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '12px', color: C.textPrimary, wordBreak: 'break-all', fontWeight: 500 }}>
                    {content.walletAddress}
                  </span>
                  <CopyAddressButton value={content.walletAddress} />
                </div>

                <div style={{ fontSize: '12px', color: 'var(--warn-text)', background: 'var(--warn-soft)', border: '1px solid var(--warn-border)', borderRadius: '8px', padding: '10px 12px', lineHeight: 1.5, fontWeight: 500 }}>
                  ⚠️ <strong>Important:</strong> {content.warningText}
                </div>
              </div>
            </>
          )}

          {/* EDIT MODE (Zeus only) */}
          {editMode && canEdit && (
            <div style={{ display: 'grid', gap: '12px' }}>
              <div>
                <label style={S.label}>Developer name</label>
                <TextInput value={draft.developerName} onChange={(e: any) => setDraft({ ...draft, developerName: e.target.value })} />
              </div>
              <div>
                <label style={S.label}>Company name</label>
                <TextInput value={draft.companyName} onChange={(e: any) => setDraft({ ...draft, companyName: e.target.value })} />
              </div>
              <div>
                <label style={S.label}>App version</label>
                <TextInput value={draft.version} onChange={(e: any) => setDraft({ ...draft, version: e.target.value })} placeholder="e.g. v18" />
              </div>
              <div>
                <label style={S.label}>Contact email</label>
                <TextInput type="email" value={draft.contactEmail} onChange={(e: any) => setDraft({ ...draft, contactEmail: e.target.value })} />
              </div>
              <div>
                <label style={S.label}>Donation intro text</label>
                <TextInput value={draft.donationIntro} onChange={(e: any) => setDraft({ ...draft, donationIntro: e.target.value })} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <label style={S.label}>Crypto name</label>
                  <TextInput value={draft.cryptoName} onChange={(e: any) => setDraft({ ...draft, cryptoName: e.target.value })} placeholder="USDT" />
                </div>
                <div>
                  <label style={S.label}>Network</label>
                  <TextInput value={draft.cryptoNetwork} onChange={(e: any) => setDraft({ ...draft, cryptoNetwork: e.target.value })} placeholder="TRC20" />
                </div>
              </div>
              <div>
                <label style={S.label}>Wallet address</label>
                <TextInput value={draft.walletAddress} onChange={(e: any) => setDraft({ ...draft, walletAddress: e.target.value })} style={{ fontFamily: 'ui-monospace, monospace', fontSize: '12.5px' }} />
              </div>
              <div>
                <label style={S.label}>QR code image</label>
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <div style={{ background: 'white', padding: '6px', borderRadius: '8px', border: `1px solid ${C.border}`, flexShrink: 0 }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={qrPreview || draft.qrImageUrl || '/donate-qr.png'} alt="QR preview" width={100} height={100} style={{ display: 'block', width: '100px', height: '100px', objectFit: 'contain' }} />
                  </div>
                  <div style={{ flex: 1, minWidth: '180px' }}>
                    <button type="button" onClick={() => fileRef.current?.click()}
                      style={{ ...S.btn, fontSize: '13px', padding: '8px 14px' }}>
                      {qrFile ? `✓ ${qrFile.name}` : 'Upload new QR'}
                    </button>
                    <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={pickQrFile} style={{ display: 'none' }} />
                    <div style={{ fontSize: '11px', color: C.textTertiary, marginTop: '6px', lineHeight: 1.5 }}>
                      PNG, JPG, or WebP. Max 2 MB. Square images work best.
                    </div>
                  </div>
                </div>
              </div>
              <div>
                <label style={S.label}>Warning text (shown below address)</label>
                <TextArea value={draft.warningText} onChange={(e: any) => setDraft({ ...draft, warningText: e.target.value })} />
              </div>

              {err && <div style={{ fontSize: '13px', color: C.danger, padding: '8px 12px', background: C.dangerSoft, borderRadius: '6px', fontWeight: 500 }}>{err}</div>}

              <div style={{ fontSize: '11px', color: C.textTertiary, fontStyle: 'italic', textAlign: 'right' }}>
                <button type="button" onClick={resetToDefaults}
                  style={{ background: 'transparent', border: 'none', color: C.textTertiary, cursor: 'pointer', fontSize: '11px', fontStyle: 'italic', textDecoration: 'underline', padding: 0 }}>
                  Reset all fields to defaults
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer buttons shown only in edit mode */}
        {editMode && canEdit && (
          <div style={{ padding: '14px 20px', borderTop: `1px solid ${C.border}`, display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
            <button onClick={() => { setEditMode(false); setDraft(content); setQrFile(null); if (qrPreview) URL.revokeObjectURL(qrPreview); setQrPreview(''); setErr(''); }}
              className="infos-btn" style={S.btn}>Cancel</button>
            <button onClick={save} disabled={saving} className="infos-btn-primary"
              style={{ ...S.btnPrimary, opacity: saving ? 0.7 : 1 }}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
