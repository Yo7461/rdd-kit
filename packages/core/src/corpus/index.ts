import type { FileType } from '../files.js';
import type { ParsedFile } from '../parse/parsed-file.js';
import { findH2Section } from '../parse/sections.js';
import type { GitInfo } from './git.js';

export type IdKind = 'P' | 'S' | 'R' | 'E' | 'C' | 'B' | 'D';

/**
 * The layer used by the reference checks.
 * fact = the append-only layer (phases / research / experiments / assets) — a reference to a resolved B or a retired C is normal.
 * current = the rewritten layer (roadmap.md, status.md, spec/) — what is referenced has to exist right now.
 */
export type Layer = 'fact' | 'current';

export function layerOf(relPath: string): Layer {
  return relPath.startsWith('roadmap/phases/') ||
    relPath.startsWith('roadmap/research/') ||
    relPath.startsWith('roadmap/experiments/') ||
    relPath.startsWith('roadmap/assets/')
    ? 'fact'
    : 'current';
}

/**
 * The shape of a definition. The duplicate-listing check for C (ID-1) tells heading and invariant-line apart.
 * path = the file itself is the definition (S / R / E).
 */
export type DefinitionVia = 'path' | 'heading' | 'invariant-line' | 'table-row' | 'list-item';

export interface IdDefinition {
  id: string;
  kind: IdKind;
  file: string;
  /** The line of the definition (0-based). 0 when via is path */
  line: number;
  via: DefinitionVia;
}

export interface CorpusEntry {
  relPath: string;
  type: FileType;
}

export interface CorpusIndex {
  /** Every regular file under roadmap/ (non-.md included, ascending relPath) */
  entries: CorpusEntry[];
  /** ID → where it is defined (file, line), ascending. Two or more = the evidence for ID-1 */
  definitions: Map<string, IdDefinition[]>;
  /** Whether a path relative to the repository root (the parent of roadmap/) exists (injected by the engine) */
  pathExists(relPath: string): boolean;
  /** The highest S#### already defined (REF-1's exemption for a forward reference to the next session) */
  maxSession: number | null;
  /** The git state (injected by the engine. null when git is absent or this is not a repository → the GIT rules are skipped) */
  git: GitInfo | null;
}

export function isDefined(index: CorpusIndex, id: string): boolean {
  return index.definitions.has(id);
}

/**
 * Picks up the ID at the head of a file name leniently.
 * A broken name (`S0001-notes.md`, say) still counts as a definition, and checking the naming strictly is left to ID-3.
 * An overflowing number (`S00001` and the like) does not count as a definition, though (an ID always has four digits).
 */
function idFromBasename(relPath: string, kind: 'S' | 'R' | 'E'): string | null {
  const base = relPath.slice(relPath.lastIndexOf('/') + 1);
  const match = new RegExp(`^(${kind}\\d{4})(?!\\d)`).exec(base);
  return match?.[1] ?? null;
}

function push(
  map: Map<string, IdDefinition[]>,
  definition: IdDefinition,
): void {
  const list = map.get(definition.id);
  if (list) list.push(definition);
  else map.set(definition.id, [definition]);
}

/** Applies matcher to every line in the body of an H2 section to pick up definitions (B: the Blockers table, D: a Decisions entry). */
function scanSection(
  map: Map<string, IdDefinition[]>,
  file: ParsedFile,
  headingText: string,
  matcher: RegExp,
  kind: IdKind,
  via: DefinitionVia,
): void {
  if (!file.markdown) return;
  const section = findH2Section(file.markdown, file.lineCount, headingText);
  if (!section) return;
  for (let line = section.bodyStartLine; line < section.bodyEndLine; line++) {
    const match = matcher.exec(file.lines[line] ?? '');
    if (match?.[1]) push(map, { id: match[1], kind, file: file.relPath, line, via });
  }
}

/**
 * Builds the corpus index.
 * Where an ID is defined: P = a `### P####:` heading in roadmap.md / S, R, E = the file itself /
 * C = a `## C####:` heading in a spec domain file plus an Invariants line in map.md /
 * B = a row of the Blockers table in roadmap.md / D = a Decisions entry in a phase status.
 */
export function buildCorpusIndex(
  entries: CorpusEntry[],
  files: ParsedFile[],
  pathProbe: (relPath: string) => boolean,
  git: GitInfo | null = null,
): CorpusIndex {
  const definitions = new Map<string, IdDefinition[]>();

  for (const file of files) {
    switch (file.type) {
      case 'roadmap': {
        for (const heading of file.markdown?.headings ?? []) {
          if (heading.depth !== 3) continue;
          const match = /^(P\d{4}):/.exec(heading.text);
          if (match?.[1]) {
            push(definitions, {
              id: match[1],
              kind: 'P',
              file: file.relPath,
              line: heading.range.start.line,
              via: 'heading',
            });
          }
        }
        scanSection(definitions, file, 'Blockers', /^\|\s*(B\d{4})\s*\|/, 'B', 'table-row');
        break;
      }
      case 'session':
      case 'research':
      case 'experiment': {
        const kind = file.type === 'session' ? 'S' : file.type === 'research' ? 'R' : 'E';
        const id = idFromBasename(file.relPath, kind);
        if (id) push(definitions, { id, kind, file: file.relPath, line: 0, via: 'path' });
        break;
      }
      case 'spec-domain': {
        for (const heading of file.markdown?.headings ?? []) {
          if (heading.depth !== 2) continue;
          const match = /^(C\d{4}):/.exec(heading.text);
          if (match?.[1]) {
            push(definitions, {
              id: match[1],
              kind: 'C',
              file: file.relPath,
              line: heading.range.start.line,
              via: 'heading',
            });
          }
        }
        break;
      }
      case 'spec-map': {
        scanSection(definitions, file, 'Invariants', /^-\s+(C\d{4})\b/, 'C', 'invariant-line');
        break;
      }
      case 'phase-status': {
        scanSection(
          definitions,
          file,
          'Decisions',
          /^-\s+(D-P\d{4}-\d{4})\b/,
          'D',
          'list-item',
        );
        break;
      }
      case 'root-status':
      case 'unknown':
        break;
    }
  }

  for (const list of definitions.values()) {
    list.sort((a, b) =>
      a.file !== b.file ? (a.file < b.file ? -1 : 1) : a.line - b.line,
    );
  }

  let maxSession: number | null = null;
  for (const id of definitions.keys()) {
    if (!/^S\d{4}$/.test(id)) continue;
    const n = Number(id.slice(1));
    if (maxSession === null || n > maxSession) maxSession = n;
  }

  return { entries, definitions, pathExists: pathProbe, maxSession, git };
}
