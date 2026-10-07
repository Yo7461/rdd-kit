import type { FileType } from '../files.ts';

/** The state at the end of a phase heading in roadmap.md. */
export const PHASE_STATES = ['planned', 'active', 'done', 'dropped', 'blocked'] as const;
/** The `- type:` of roadmap.md. */
export const PHASE_TYPES = ['build', 'research', 'experiment', 'decision'] as const;
/** The stability of a contract YAML block. */
export const CONTRACT_STABILITIES = ['draft', 'stable', 'deprecated'] as const;

export type KnownFileType = Exclude<FileType, 'unknown'>;

/**
 * The declarative spec of a front matter value (the source of truth for FM-2).
 * scalar-or-null: an all-digit commit hash becomes a number under YAML 1.2, so string|number is allowed.
 */
export type ValueSpec =
  | { kind: 'string' }
  | { kind: 'date' }
  | { kind: 'enum'; values: readonly string[] }
  | { kind: 'id'; prefix: 'P' | 'S' | 'R' | 'E' }
  | { kind: 'id-or-null'; prefix: 'P' | 'S' | 'R' | 'E' }
  | { kind: 're-id-or-null' }
  | { kind: 'bool' }
  | { kind: 'scalar-or-null' }
  | { kind: 'list' }
  | { kind: 'id-list'; prefixes: readonly ('R' | 'E' | 'C')[] };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function idPattern(prefix: string): RegExp {
  return new RegExp(`^${prefix}\\d{4}$`);
}

/** The description of what was expected (for the diagnostic message). */
export function describeSpec(spec: ValueSpec): string {
  switch (spec.kind) {
    case 'string':
      return 'a non-empty string';
    case 'date':
      return 'YYYY-MM-DD';
    case 'enum':
      return spec.values.join(' | ');
    case 'id':
      return `${spec.prefix}####`;
    case 'id-or-null':
      return `${spec.prefix}#### or null`;
    case 're-id-or-null':
      return 'R####/E#### or null';
    case 'bool':
      return 'true | false';
    case 'scalar-or-null':
      return 'a commit hash or null';
    case 'list':
      return 'a list';
    case 'id-list':
      return `a list containing only ${spec.prefixes.map((p) => `${p}####`).join('/')}`;
  }
}

/** Returns null when it conforms, and the description of what was expected when it does not. */
export function validateValue(spec: ValueSpec, value: unknown): string | null {
  const ok = ((): boolean => {
    switch (spec.kind) {
      case 'string':
        return typeof value === 'string' && value.trim() !== '';
      case 'date':
        return typeof value === 'string' && DATE_RE.test(value);
      case 'enum':
        return typeof value === 'string' && spec.values.includes(value);
      case 'id':
        return typeof value === 'string' && idPattern(spec.prefix).test(value);
      case 'id-or-null':
        return value === null || (typeof value === 'string' && idPattern(spec.prefix).test(value));
      case 're-id-or-null':
        return value === null || (typeof value === 'string' && /^[RE]\d{4}$/.test(value));
      case 'bool':
        return typeof value === 'boolean';
      case 'scalar-or-null':
        return value === null || typeof value === 'string' || typeof value === 'number';
      case 'list':
        return Array.isArray(value);
      case 'id-list':
        return (
          Array.isArray(value) &&
          value.every(
            (v) => typeof v === 'string' && spec.prefixes.some((p) => idPattern(p).test(v)),
          )
        );
    }
  })();
  return ok ? null : describeSpec(spec);
}

export interface FrontMatterKeySpec {
  key: string;
  spec: ValueSpec;
  /** false marks a conditional key (FM-4 checks when it has to be there; FM-2 checks the value format when it is) */
  required: boolean;
}

/** The structural schema of one file type (the shared source of truth for FM / SIZE / STRUCT). */
export interface FileTypeSchema {
  type: KnownFileType;
  label: string;
  frontMatter: FrontMatterKeySpec[];
  h1Pattern: RegExp;
  h1Expected: string;
  /** The required H2 headings in template order (the set for STRUCT-1, the source of truth for STRUCT-2's ordering) */
  requiredH2: readonly string[];
  /** The line limit for the whole file (referenced by SIZE-1/2/3/7 — a physical line count) */
  maxLines?: number;
}

export const FILE_TYPE_SCHEMAS: Record<KnownFileType, FileTypeSchema> = {
  roadmap: {
    type: 'roadmap',
    label: 'roadmap.md',
    frontMatter: [
      { key: 'project', spec: { kind: 'string' }, required: true },
      { key: 'updated', spec: { kind: 'date' }, required: true },
    ],
    h1Pattern: /^Roadmap: .+/,
    h1Expected: '# Roadmap: <one-line summary>',
    requiredH2: ['Vision', 'Principles', 'Phases', 'Blockers', 'Parking Lot', 'Deferred'],
    maxLines: 200,
  },
  'root-status': {
    type: 'root-status',
    label: 'the root status.md',
    frontMatter: [
      { key: 'current_phase', spec: { kind: 'id', prefix: 'P' }, required: true },
      { key: 'open_session', spec: { kind: 'id-or-null', prefix: 'S' }, required: true },
      { key: 'last_session', spec: { kind: 'id-or-null', prefix: 'S' }, required: true },
      { key: 'next_command', spec: { kind: 'string' }, required: true },
      { key: 'updated', spec: { kind: 'date' }, required: true },
    ],
    h1Pattern: /^Status: .+/,
    h1Expected: '# Status: <project name>',
    requiredH2: ['Now', 'Next', 'Open Blockers / Risks', 'Phase Index'],
    maxLines: 60,
  },
  'phase-status': {
    type: 'phase-status',
    label: 'a phase status.md',
    frontMatter: [
      { key: 'phase', spec: { kind: 'id', prefix: 'P' }, required: true },
      { key: 'state', spec: { kind: 'enum', values: ['active', 'done', 'dropped'] }, required: true },
      { key: 'started', spec: { kind: 'date' }, required: true },
      { key: 'closed', spec: { kind: 'date' }, required: false },
    ],
    h1Pattern: /^P\d{4}: .+ — Status$/,
    h1Expected: '# P####: <phase name> — Status',
    requiredH2: ['Outcome Summary', 'Acceptance Progress', 'Session Log', 'Decisions', 'Roadmap Changes'],
  },
  session: {
    type: 'session',
    label: 'a session log',
    frontMatter: [
      { key: 'session', spec: { kind: 'id', prefix: 'S' }, required: true },
      { key: 'phase', spec: { kind: 'id', prefix: 'P' }, required: true },
      { key: 'date', spec: { kind: 'date' }, required: true },
      { key: 'state', spec: { kind: 'enum', values: ['open', 'closed'] }, required: true },
      { key: 'base_commit', spec: { kind: 'scalar-or-null' }, required: true },
      { key: 'commits', spec: { kind: 'list' }, required: true },
      { key: 'artifacts', spec: { kind: 'id-list', prefixes: ['R', 'E', 'C'] }, required: true },
      { key: 'roadmap_changed', spec: { kind: 'bool' }, required: true },
    ],
    h1Pattern: /^S\d{4}$/,
    h1Expected: '# S####',
    requiredH2: ['Plan', 'Did', 'Result', 'Learned / Decisions', 'Handoff'],
  },
  research: {
    type: 'research',
    label: 'a research file (R####)',
    frontMatter: [
      { key: 'id', spec: { kind: 'id', prefix: 'R' }, required: true },
      { key: 'type', spec: { kind: 'enum', values: ['research', 'experiment'] }, required: true },
      { key: 'created', spec: { kind: 'id', prefix: 'S' }, required: true },
      { key: 'completed', spec: { kind: 'id-or-null', prefix: 'S' }, required: true },
      { key: 'phase', spec: { kind: 'id', prefix: 'P' }, required: true },
      { key: 'status', spec: { kind: 'enum', values: ['planned', 'running', 'done'] }, required: true },
      { key: 'superseded_by', spec: { kind: 're-id-or-null' }, required: true },
    ],
    h1Pattern: /^R\d{4}: .+/,
    h1Expected: '# R####: <title>',
    requiredH2: ['Question', 'Method', 'Results', 'Conclusion'],
  },
  experiment: {
    type: 'experiment',
    label: 'an experiment file (E####)',
    frontMatter: [
      { key: 'id', spec: { kind: 'id', prefix: 'E' }, required: true },
      { key: 'type', spec: { kind: 'enum', values: ['research', 'experiment'] }, required: true },
      { key: 'created', spec: { kind: 'id', prefix: 'S' }, required: true },
      { key: 'completed', spec: { kind: 'id-or-null', prefix: 'S' }, required: true },
      { key: 'phase', spec: { kind: 'id', prefix: 'P' }, required: true },
      { key: 'status', spec: { kind: 'enum', values: ['planned', 'running', 'done'] }, required: true },
      { key: 'superseded_by', spec: { kind: 're-id-or-null' }, required: true },
    ],
    h1Pattern: /^E\d{4}: .+/,
    h1Expected: '# E####: <title>',
    requiredH2: ['Question', 'Method', 'Results', 'Conclusion'],
  },
  'spec-map': {
    type: 'spec-map',
    label: 'spec/map.md',
    frontMatter: [{ key: 'updated', spec: { kind: 'date' }, required: true }],
    h1Pattern: /^Spec Map: .+/,
    h1Expected: '# Spec Map: <project name>',
    requiredH2: ['System Map', 'Invariants', 'Spec Index'],
    maxLines: 80,
  },
  'spec-domain': {
    type: 'spec-domain',
    label: 'a contract file (spec/<domain>.md)',
    frontMatter: [
      { key: 'domain', spec: { kind: 'string' }, required: true },
      { key: 'updated', spec: { kind: 'date' }, required: true },
    ],
    h1Pattern: /^Spec: .+/,
    h1Expected: '# Spec: <domain name>',
    requiredH2: [],
    maxLines: 200,
  },
};
