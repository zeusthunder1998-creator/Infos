// ============================================================================
// components/DynamicComponents.tsx — Tab Customization Phase 2
// ----------------------------------------------------------------------------
// Template-aware UI components that render any tab template:
//
//   - <DynamicForm>  — renders an entry form for any template
//   - <DynamicCard>  — renders an entry card for any template
//   - <DynamicField> — renders a single form field by type
//
// These coexist with the existing hardcoded tab components. Phase 3 will swap
// the UI to use them. Phase 2 just builds them.
// ============================================================================

'use client';

import { useState } from 'react';
import { S, C } from './styles';
import { friendlyError } from '../lib/storage';
import {
  TEMPLATE_DEFS,
  type TemplateField,
  type TemplateDef,
  validateEntry,
} from '../lib/templates';
import type { TabTemplate, DynamicEntry } from '../lib/storage';

// Local input primitives — match the ones inside InfosApp.tsx (TextInput,
// TextArea, Btn) so visual style stays consistent. Phase 3 may consolidate
// these into a shared module.
function TextInput(props: any) {
  return <input {...props} className={'infos-input ' + (props.className || '')} style={{ ...S.input, ...(props.style || {}) }} />;
}
function TextArea(props: any) {
  return <textarea {...props} className={'infos-input ' + (props.className || '')} style={{ ...S.textarea, ...(props.style || {}) }} />;
}
function Btn(props: any) {
  const { primary, danger, ...rest } = props;
  const base = primary ? S.btnPrimary : danger ? S.btnDanger : S.btn;
  return <button {...rest} style={{ ...base, ...(rest.style || {}) }}>{rest.children}</button>;
}

// ---------------- Field renderer ----------------

type DynamicFieldProps = {
  field: TemplateField;
  value: string;
  onChange: (v: string) => void;
};

/**
 * Renders one input field based on its type. Used inside DynamicForm but also
 * exported so other components (edit modals) can reuse it.
 */
export function DynamicField({ field, value, onChange }: DynamicFieldProps) {
  const labelEl = (
    <label style={S.label}>
      {field.label}
      {!field.required && (
        <span style={{ fontWeight: 400, color: C.textTertiary, marginLeft: '4px' }}>(optional)</span>
      )}
    </label>
  );

  if (field.type === 'textarea') {
    return (
      <div>
        {labelEl}
        <TextArea
          value={value}
          onChange={(e: any) => onChange(e.target.value)}
          placeholder={field.placeholder || field.label}
          maxLength={field.maxLength}
        />
      </div>
    );
  }

  // text / url / password all use TextInput with different `type` attribute
  const inputType =
    field.type === 'url' ? 'url' :
    field.type === 'password' ? 'password' :
    'text';

  return (
    <div>
      {labelEl}
      <TextInput
        type={inputType}
        value={value}
        onChange={(e: any) => onChange(e.target.value)}
        placeholder={field.placeholder || field.label}
        maxLength={field.maxLength}
      />
    </div>
  );
}

// ---------------- Form renderer ----------------

type DynamicFormProps = {
  template: TabTemplate;
  /** Optional initial data — used when editing an existing entry */
  initialData?: Record<string, any>;
  /** Assignee picker is rendered separately and passed through this slot */
  assigneePickerSlot?: React.ReactNode;
  /** Called when user clicks the submit button */
  onSubmit: (data: Record<string, any>) => Promise<void> | void;
  /** Button label (default: 'Add') */
  submitLabel?: string;
};

/**
 * Renders an entry form for a given template. Validation, busy state, error
 * messaging are all handled here. The parent component supplies the assignee
 * picker via the slot so this component stays template-agnostic.
 */
export function DynamicForm({
  template,
  initialData,
  assigneePickerSlot,
  onSubmit,
  submitLabel = 'Add',
}: DynamicFormProps) {
  const def: TemplateDef = TEMPLATE_DEFS[template] || TEMPLATE_DEFS.entry;

  // Initialize values for every field in the template
  const initialValues = (): Record<string, string> => {
    const v: Record<string, string> = {};
    for (const f of def.fields) {
      v[f.key] = (initialData?.[f.key] ?? '').toString();
    }
    return v;
  };
  const [values, setValues] = useState<Record<string, string>>(initialValues);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const handle = async () => {
    setErr('');
    const errors = validateEntry(template, values);
    if (errors.length > 0) {
      setErr(errors[0]);
      return;
    }
    setBusy(true);
    try {
      await onSubmit(values);
      // Reset form on success (only when adding, not editing)
      if (!initialData) setValues(initialValues());
    } catch (e: any) {
      setErr(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  // Group fields into a responsive grid like EntryForm does
  return (
    <div style={{ ...S.softCard, marginBottom: '1.25rem' }}>
      <div className="infos-grid3" style={S.grid3}>
        {def.fields
          .filter((f) => f.type !== 'textarea')
          .map((f) => (
            <DynamicField
              key={f.key}
              field={f}
              value={values[f.key] || ''}
              onChange={(v) => setValues({ ...values, [f.key]: v })}
            />
          ))}
      </div>
      {/* Textarea fields go full-width below */}
      {def.fields
        .filter((f) => f.type === 'textarea')
        .map((f) => (
          <div key={f.key} style={{ marginTop: '12px' }}>
            <DynamicField
              field={f}
              value={values[f.key] || ''}
              onChange={(v) => setValues({ ...values, [f.key]: v })}
            />
          </div>
        ))}
      {assigneePickerSlot && (
        <div style={{ marginTop: '12px' }}>
          <label style={S.label}>{def.visibilityVerb} sub-admin(s)</label>
          {assigneePickerSlot}
        </div>
      )}
      {err && (
        <div style={{ ...S.formError, marginTop: '10px' }}>
          <span style={{ fontSize: '14px', lineHeight: 1, flexShrink: 0 }}>⚠️</span>
          <span>{err}</span>
        </div>
      )}
      <div style={{ marginTop: '14px', textAlign: 'right' }}>
        <Btn primary onClick={handle} disabled={busy} style={{ opacity: busy ? 0.7 : 1 }}>
          {busy ? 'Saving…' : submitLabel}
        </Btn>
      </div>
    </div>
  );
}

// ---------------- Card renderer ----------------

type DynamicCardProps = {
  entry: DynamicEntry;
  /** Optional action buttons (edit, delete, pin) rendered to the right */
  actions?: React.ReactNode;
  /** Optional assignee chips rendered below the primary text */
  assigneesSlot?: React.ReactNode;
  /** Optional timestamp row */
  timestampSlot?: React.ReactNode;
  /** Whether to mask password fields (default: true) */
  maskPasswords?: boolean;
};

/**
 * Renders a single entry as a card. Picks fields based on the entry's
 * template definition. Used to display dynamic_entries rows in tab lists.
 */
export function DynamicCard({
  entry,
  actions,
  assigneesSlot,
  timestampSlot,
  maskPasswords = true,
}: DynamicCardProps) {
  const def = TEMPLATE_DEFS[entry.template] || TEMPLATE_DEFS.entry;
  const primary = entry.data[def.primaryField] || '';

  // Build a list of "field: value" rows for display, skipping primary (since
  // it's the heading), and masking passwords if requested.
  const visibleFields = def.fields.filter((f) => f.key !== def.primaryField);

  const renderValue = (field: TemplateField, value: any): React.ReactNode => {
    const str = typeof value === 'string' ? value : (value == null ? '' : String(value));
    if (!str) return null;

    if (field.type === 'password' && maskPasswords) {
      return <span style={{ fontFamily: 'monospace', letterSpacing: '0.05em' }}>{'•'.repeat(Math.min(str.length, 12))}</span>;
    }

    if (field.type === 'url') {
      return (
        <a href={str} target="_blank" rel="noopener noreferrer" style={S.linkPill}>
          {str}
        </a>
      );
    }

    if (field.type === 'textarea') {
      return <div style={S.descBox}>{str}</div>;
    }

    return <span style={{ fontSize: '13.5px', color: C.textPrimary }}>{str}</span>;
  };

  return (
    <div style={S.item}>
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Primary heading */}
        <div style={{ fontSize: '15px', fontWeight: 600, color: C.textPrimary, marginBottom: '6px', wordBreak: 'break-word' }}>
          {primary || <span style={{ color: C.textTertiary, fontStyle: 'italic' }}>(no title)</span>}
        </div>

        {/* Each other field */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {visibleFields.map((f) => {
            const val = entry.data[f.key];
            const rendered = renderValue(f, val);
            if (!rendered) return null;
            return (
              <div key={f.key} style={{ display: 'flex', gap: '6px', alignItems: 'baseline', flexWrap: 'wrap', minWidth: 0 }}>
                <span style={{
                  fontSize: '11.5px', fontWeight: 600, color: C.textTertiary,
                  textTransform: 'uppercase', letterSpacing: '0.04em',
                  flexShrink: 0,
                }}>
                  {f.label}:
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>{rendered}</span>
              </div>
            );
          })}
        </div>

        {assigneesSlot}
        {timestampSlot}
      </div>
      {actions && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {actions}
        </div>
      )}
    </div>
  );
}
