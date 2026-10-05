import type { CorpusIndex } from '../corpus/index.js';
import type { ParsedFile } from '../parse/parsed-file.js';
import { findH2Section, lineInCode } from '../parse/sections.js';
import { fileMap } from './corpus-helpers.js';
import { frontMatterKeyRange, frontMatterTokenAnchor, isRecord, lineRange, showValue } from './helpers.js';
import type { RuleDiagnostic, RuleModule } from './types.js';

/** Derives the ID a file defines (via: path) from its name. A broken name belongs to ID-3. */
function ownId(file: ParsedFile): string | null {
  const base = file.relPath.slice(file.relPath.lastIndexOf('/') + 1);
  return /^([SRE]\d{4})(?!\d)/.exec(base)?.[1] ?? null;
}

function frontMatter(file: ParsedFile): Record<string, unknown> | null {
  const data = file.markdown?.frontMatter?.data;
  return isRecord(data) ? data : null;
}

/** Looks up the file that defines id (via: path). A reference with no definition belongs to REF-1, so it returns null. */
function definedFile(
  corpus: CorpusIndex,
  byPath: Map<string, ParsedFile>,
  id: string,
): ParsedFile | null {
  const definition = corpus.definitions.get(id)?.find((d) => d.via === 'path');
  return definition ? (byPath.get(definition.file) ?? null) : null;
}

const showLink = (value: unknown): string => (typeof value === 'string' ? value : showValue(value));

/**
 * BID-1: session artifacts checked against the R/E.
 * It is a violation when neither the `created` nor the `completed` of an R/E listed in artifacts points at that session.
 * C#### is out of scope (checking the matching `since` key is a candidate for a future warning).
 * An element outside the ID format belongs to FM-2, and a missing target belongs to REF-1.
 */
export const bid1: RuleModule = {
  id: 'BID-1',
  description: 'Session artifacts match R/E `created` and `completed` (S to R/E)',
  defaultSeverity: 'error',
  defaultOptions: {},
  checkCorpus({ files, corpus }) {
    const byPath = fileMap(files);
    const out: RuleDiagnostic[] = [];
    for (const file of files) {
      if (file.type !== 'session') continue;
      const sessionId = ownId(file);
      const data = frontMatter(file);
      if (!sessionId || !data) continue;
      const artifacts = data['artifacts'];
      if (!Array.isArray(artifacts)) continue; // A missing key or a broken shape belongs to FM-1 and FM-2
      for (const item of artifacts) {
        if (typeof item !== 'string' || !/^[RE]\d{4}$/.test(item)) continue;
        const target = definedFile(corpus, byPath, item);
        const targetData = target ? frontMatter(target) : null;
        if (!targetData) continue;
        const created = targetData['created'];
        const completed = targetData['completed'];
        if (created === sessionId || completed === sessionId) continue;
        out.push({
          anchor: frontMatterTokenAnchor(file, item),
          message: `Inconsistent \`artifacts\` entry ${item}: neither its \`created\` nor its \`completed\` points to ${sessionId} (${item} has \`created: ${showLink(created)}\`, \`completed: ${showLink(completed)}\`).`,
          suggestion: `Fix \`created\` or \`completed\` in ${item}, or remove ${item} from \`artifacts\`.`,
        });
      }
    }
    return out;
  },
};

/**
 * BID-2: the `created` and `completed` of an R/E checked against the session artifacts.
 * It is a violation when the artifacts of the session `created` (or a non-null `completed`) points at do not carry this ID.
 * When both keys point at the same session, the diagnostics are bundled into one. A missing session belongs to REF-1
 * and a missing artifacts key belongs to FM-1. Because fixing it collides with the immutability of a closed log,
 * the suggestion points at a typo on the R/E side first (never fixed automatically).
 */
export const bid2: RuleModule = {
  id: 'BID-2',
  description: 'R/E `created` and `completed` match session artifacts (R/E to S)',
  defaultSeverity: 'error',
  defaultOptions: {},
  checkCorpus({ files, corpus }) {
    const byPath = fileMap(files);
    const out: RuleDiagnostic[] = [];
    for (const file of files) {
      if (file.type !== 'research' && file.type !== 'experiment') continue;
      const id = ownId(file);
      const data = frontMatter(file);
      if (!id || !data) continue;
      const bySession = new Map<string, string[]>();
      for (const key of ['created', 'completed'] as const) {
        const value = data[key];
        if (typeof value !== 'string' || !/^S\d{4}$/.test(value)) continue; // null and anything outside the format belong to FM-2
        const keys = bySession.get(value);
        if (keys) keys.push(key);
        else bySession.set(value, [key]);
      }
      for (const [sessionId, keys] of bySession) {
        const session = definedFile(corpus, byPath, sessionId);
        const sessionData = session ? frontMatter(session) : null;
        if (!sessionData) continue;
        const artifacts = sessionData['artifacts'];
        if (!Array.isArray(artifacts) || artifacts.includes(id)) continue;
        const label = keys.join(' / ');
        const range = frontMatterKeyRange(file, keys[0] ?? 'created');
        out.push({
          anchor: range
            ? { kind: 'range', file: file.relPath, range }
            : { kind: 'file', file: file.relPath },
          message: `Missing ${id} in the \`artifacts\` of ${sessionId} (pointed to by \`${label}\`).`,
          suggestion: `First check \`${label}\` in ${id} for a typo. If ${sessionId} really needs the entry, record why in the Did of the next session and fix it there.`,
        });
      }
    }
    return out;
  },
};

/**
 * BID-3: session files checked against Session Log rows, per phase (a merge or parallel work can
 * drop a row without a trace). A closed session file with no row in its own phase's Session Log, and a row
 * whose session file lives in another phase, are violations. An open session is exempt — its row is
 * written at close, and the invariant holds when the records are at rest. A row whose ID is defined
 * nowhere belongs to REF-1, duplicate rows for one session belong to SIZE-5, a missing Session Log
 * heading belongs to STRUCT-2, a broken file name belongs to ID-3, and a state outside open/closed
 * belongs to FM-2.
 */
export const bid3: RuleModule = {
  id: 'BID-3',
  description: 'Session files match Session Log rows, per phase (S to row, row to S)',
  defaultSeverity: 'error',
  defaultOptions: {},
  checkCorpus({ files, corpus }) {
    const out: RuleDiagnostic[] = [];
    for (const status of files) {
      if (status.type !== 'phase-status' || !status.markdown) continue;
      const section = findH2Section(status.markdown, status.lineCount, 'Session Log');
      if (!section) continue;
      const phaseDir = status.relPath.slice(0, status.relPath.lastIndexOf('/'));
      const rows = new Map<string, number>();
      for (let line = section.bodyStartLine; line < section.bodyEndLine; line++) {
        if (lineInCode(status.markdown, line)) continue;
        const text = status.lines[line] ?? '';
        if (!text.startsWith('|')) continue;
        const firstCell = (text.split('|')[1] ?? '').trim();
        if (!/^S\d{4}$/.test(firstCell) || rows.has(firstCell)) continue;
        rows.set(firstCell, line);
      }
      for (const file of files) {
        if (file.type !== 'session' || !file.relPath.startsWith(`${phaseDir}/sessions/`)) continue;
        const id = ownId(file);
        if (!id || rows.has(id)) continue;
        if (frontMatter(file)?.['state'] !== 'closed') continue;
        out.push({
          anchor: {
            kind: 'range',
            file: status.relPath,
            range: lineRange(status, section.heading.range.start.line),
          },
          message: `Missing Session Log row for the closed session ${id} (${file.relPath}).`,
          suggestion: `Append the one-line row for ${id} — if a merge or a hand edit dropped it, rebuild it from that session file's front matter.`,
        });
      }
      for (const [id, line] of rows) {
        const definition = corpus.definitions.get(id)?.find((d) => d.via === 'path');
        if (!definition || definition.file.startsWith(`${phaseDir}/sessions/`)) continue;
        out.push({
          anchor: { kind: 'range', file: status.relPath, range: lineRange(status, line) },
          message: `Session Log row for ${id}, whose session file is in another phase (${definition.file}).`,
          suggestion: `Move the row to that phase's status.md, or fix the session ID in this row.`,
        });
      }
    }
    return out;
  },
};
