// ============================================================================
// lib/templates.ts — Tab Customization Phase 2: Templates system
// ----------------------------------------------------------------------------
// Defines the field schemas for each template type, plus helpers for
// validation, search, and translation between old hardcoded schemas and the
// new dynamic_entries schema.
//
// Templates supported:
//   - 'notice'      — title + body + optional link (visibility via recipients[])
//   - 'entry'       — name + optional short name + link + description (visibility via assignees[])
//   - 'credential'  — name + username + password + optional description (visibility via assignees[])
//
// Phase 2 scope: definitions only. Phase 3 wires these into the UI.
// ============================================================================

import type { TabTemplate, DynamicEntry } from './storage';

// ---------- Field types ----------

/** A field can be one of these primitive types. */
export type FieldType = 'text' | 'textarea' | 'url' | 'password';

/** Definition of a single field in a template. */
export type TemplateField = {
  /** The key under `data` where this field's value lives, e.g. 'title' */
  key: string;
  /** Human-readable label, e.g. 'Title' */
  label: string;
  /** UI input type */
  type: FieldType;
  /** Whether the user must fill this in */
  required: boolean;
  /** Placeholder text shown when empty */
  placeholder?: string;
  /** Max characters allowed (soft limit, enforced in validation) */
  maxLength?: number;
};

/** A full template definition. */
export type TemplateDef = {
  /** Identifies the template */
  id: TabTemplate;
  /** Human-readable name (shown when picking a template for a new tab) */
  displayName: string;
  /** Default emoji for tabs of this template */
  defaultIcon: string;
  /** Short description (shown in template picker) */
  description: string;
  /** The fields in this template, in display order */
  fields: TemplateField[];
  /** Which field name is used for the card's primary heading */
  primaryField: string;
  /** Which field name is used for the card's secondary line (optional) */
  secondaryField?: string;
  /**
   * Which list field on the entry holds the targets for visibility.
   * - 'recipients' for notices
   * - 'assignees' for entries/credentials
   * Note: in dynamic_entries the field is always called `assignees`,
   * but we expose the conceptual name for clarity in UI labels.
   */
  visibilityFieldLabel: 'recipients' | 'assignees';
  /** Verb to use in UI like "Send to" vs "Assign to" */
  visibilityVerb: 'Send to' | 'Assign to';
};

// ---------- Template definitions ----------

export const TEMPLATE_DEFS: Record<TabTemplate, TemplateDef> = {
  notice: {
    id: 'notice',
    displayName: 'Notice',
    defaultIcon: '📢',
    description: 'Announcements with a title, body, and optional link. Sent to selected sub-admins.',
    fields: [
      { key: 'title',  label: 'Title', type: 'text',     required: true,  maxLength: 200, placeholder: 'Short headline' },
      { key: 'body',   label: 'Message', type: 'textarea', required: true,  maxLength: 4000, placeholder: 'Full message text' },
      { key: 'link',   label: 'Link', type: 'url',      required: false, maxLength: 500, placeholder: 'https://...' },
    ],
    primaryField: 'title',
    secondaryField: 'body',
    visibilityFieldLabel: 'recipients',
    visibilityVerb: 'Send to',
  },
  entry: {
    id: 'entry',
    displayName: 'Entry',
    defaultIcon: '⚙️',
    description: 'Links + metadata. Useful for tabs like System, Games, Tools — anything with a name and a URL.',
    fields: [
      { key: 'gameName',    label: 'Name',           type: 'text',     required: true,  maxLength: 200, placeholder: 'Display name' },
      { key: 'shortName',   label: 'Short name',     type: 'text',     required: false, maxLength: 50,  placeholder: 'Optional shorthand' },
      { key: 'link',        label: 'Link',           type: 'url',      required: true,  maxLength: 500, placeholder: 'https://...' },
      { key: 'description', label: 'Description',    type: 'textarea', required: false, maxLength: 2000, placeholder: 'Optional notes' },
    ],
    primaryField: 'gameName',
    secondaryField: 'link',
    visibilityFieldLabel: 'assignees',
    visibilityVerb: 'Assign to',
  },
  credential: {
    id: 'credential',
    displayName: 'Credential',
    defaultIcon: '🔐',
    description: 'Username + password pairs. Useful for tabs like Id & Pass — anything with login credentials.',
    fields: [
      { key: 'game',        label: 'Service / Game',  type: 'text',     required: true,  maxLength: 200, placeholder: 'What is this for?' },
      { key: 'shortName',   label: 'Short name',      type: 'text',     required: false, maxLength: 50,  placeholder: 'Optional shorthand' },
      { key: 'username',    label: 'Username',        type: 'text',     required: true,  maxLength: 200, placeholder: 'Account username' },
      { key: 'password',    label: 'Password',        type: 'password', required: true,  maxLength: 200, placeholder: 'Account password' },
      { key: 'description', label: 'Description',     type: 'textarea', required: false, maxLength: 2000, placeholder: 'Optional notes' },
    ],
    primaryField: 'game',
    secondaryField: 'username',
    visibilityFieldLabel: 'assignees',
    visibilityVerb: 'Assign to',
  },
};

/** Get template definition by id. Falls back to 'entry' if unknown. */
export function getTemplate(t: TabTemplate | string): TemplateDef {
  return TEMPLATE_DEFS[t as TabTemplate] || TEMPLATE_DEFS.entry;
}

/** List all templates (for the "create new tab" picker). */
export function listTemplates(): TemplateDef[] {
  return [TEMPLATE_DEFS.notice, TEMPLATE_DEFS.entry, TEMPLATE_DEFS.credential];
}

// ---------- Validation ----------

/**
 * Validate a data payload against a template's field schema.
 * Returns an array of error messages (empty array = valid).
 *
 * Phase 2 deliberately keeps validation simple — required-field + max-length only.
 * Phase 3 may add format-specific checks (URL, etc.) but they're not blocking.
 */
export function validateEntry(template: TabTemplate, data: Record<string, any>): string[] {
  const def = getTemplate(template);
  const errors: string[] = [];
  for (const field of def.fields) {
    const value = data?.[field.key];
    const strValue = typeof value === 'string' ? value : (value == null ? '' : String(value));

    if (field.required && !strValue.trim()) {
      errors.push(`${field.label} is required`);
      continue;
    }
    if (field.maxLength && strValue.length > field.maxLength) {
      errors.push(`${field.label} is too long (max ${field.maxLength} characters)`);
    }
  }
  return errors;
}

// ---------- Search ----------

/**
 * Extract searchable text from a dynamic entry — concatenates all string field values.
 * Used by the global search to match entries against a query.
 */
export function entrySearchText(entry: DynamicEntry): string {
  if (!entry?.data) return '';
  const def = getTemplate(entry.template);
  const parts: string[] = [];
  for (const field of def.fields) {
    // Don't include passwords in search index — they leak via search results otherwise
    if (field.type === 'password') continue;
    const v = entry.data[field.key];
    if (typeof v === 'string' && v) parts.push(v.toLowerCase());
  }
  return parts.join(' \u00b7 ');
}

/** Get the primary display value for an entry (used as card heading). */
export function entryPrimary(entry: DynamicEntry): string {
  if (!entry?.data) return '';
  const def = getTemplate(entry.template);
  return entry.data[def.primaryField] || '';
}

/** Get the secondary display value for an entry (used as card subtitle). */
export function entrySecondary(entry: DynamicEntry): string {
  if (!entry?.data) return '';
  const def = getTemplate(entry.template);
  if (!def.secondaryField) return '';
  return entry.data[def.secondaryField] || '';
}

// ---------- Old → new translation helpers ----------
//
// Phase 5 will migrate existing notices/backend_entries/game_entries/idpass_entries
// rows into dynamic_entries. These helpers describe how the translation works,
// so Phase 5 can do it consistently and so Phase 3 can keep a backward-compat
// view of "what does an old-schema row look like as a dynamic entry?"

/** Convert an old notice row to dynamic_entries format. */
export function noticeToDynamic(notice: any, tabId: string): Partial<DynamicEntry> {
  return {
    id: notice.id,
    tabId,
    ownerId: notice.ownerId || notice.owner_id,
    template: 'notice',
    data: {
      title: notice.title || '',
      body:  notice.body  || '',
      link:  notice.link  || '',
    },
    assignees: notice.recipients || [],
    sortOrder: notice.sortOrder || notice.sort_order || 0,
    createdAt: notice.createdAt || notice.created_at || Date.now(),
    updatedAt: notice.updatedAt || notice.updated_at || Date.now(),
    deletedAt: notice.deletedAt || notice.deleted_at || null,
  };
}

/** Convert an old backend_entries / game_entries row to dynamic_entries format. */
export function gameEntryToDynamic(entry: any, tabId: string): Partial<DynamicEntry> {
  return {
    id: entry.id,
    tabId,
    ownerId: entry.ownerId || entry.owner_id,
    template: 'entry',
    data: {
      gameName:    entry.gameName    || entry.game_name    || '',
      shortName:   entry.shortName   || entry.short_name   || '',
      link:        entry.link        || '',
      description: entry.description || '',
    },
    assignees: entry.assignees || [],
    sortOrder: entry.sortOrder || entry.sort_order || 0,
    createdAt: entry.createdAt || entry.created_at || Date.now(),
    updatedAt: entry.updatedAt || entry.updated_at || Date.now(),
    deletedAt: entry.deletedAt || entry.deleted_at || null,
  };
}

/** Convert an old idpass_entries row to dynamic_entries format. */
export function idPassToDynamic(entry: any, tabId: string): Partial<DynamicEntry> {
  return {
    id: entry.id,
    tabId,
    ownerId: entry.ownerId || entry.owner_id,
    template: 'credential',
    data: {
      game:        entry.game        || '',
      shortName:   entry.shortName   || entry.short_name   || '',
      username:    entry.username    || '',
      password:    entry.password    || '',
      description: entry.description || '',
    },
    assignees: entry.assignees || [],
    sortOrder: entry.sortOrder || entry.sort_order || 0,
    createdAt: entry.createdAt || entry.created_at || Date.now(),
    updatedAt: entry.updatedAt || entry.updated_at || Date.now(),
    deletedAt: entry.deletedAt || entry.deleted_at || null,
  };
}
