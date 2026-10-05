import type { Severity } from '../diagnostic.js';
import type { FileType } from '../files.js';
import { findH2Section } from '../parse/sections.js';
import { FILE_TYPE_SCHEMAS } from '../schema/file-types.js';
import type { RuleModule } from './types.js';

interface FileSizeRuleSpec {
  id: string;
  description: string;
  fileType: FileType;
  /** What it is called in a diagnostic message */
  label: string;
  defaultMaxLines: number;
  defaultSeverity: Severity;
  suggestion: (maxLines: number) => string;
}

/**
 * The `maxLines` option as a whole number of lines. The engine has already dropped a value of the wrong
 * shape with a notice (config.ts), so this only guards a direct call that skips it — a non-number falls
 * back to the default rather than turning into NaN, which would put a null line into the diagnostic's
 * position. A fraction is floored once here, so the message, the suggestion, and the anchor of
 * every SIZE rule show the same limit.
 */
export function maxLinesOf(options: Record<string, unknown>, defaultMaxLines: number): number {
  const configured = options['maxLines'];
  return typeof configured === 'number' && Number.isFinite(configured) && configured >= 0
    ? Math.floor(configured)
    : defaultMaxLines;
}

/** The rules that limit the line count of a whole file (SIZE-2/3/6/7). The count is the physical line count, and exactly at the limit is normal. */
function makeFileSizeRule(spec: FileSizeRuleSpec): RuleModule {
  return {
    id: spec.id,
    description: spec.description,
    defaultSeverity: spec.defaultSeverity,
    defaultOptions: { maxLines: spec.defaultMaxLines },
    check({ file, options }) {
      if (file.type !== spec.fileType) return [];
      const maxLines = maxLinesOf(options, spec.defaultMaxLines);
      if (file.lineCount <= maxLines) return [];
      const lastLine = file.lines.at(-1) ?? '';
      return [
        {
          anchor: {
            kind: 'range',
            file: file.relPath,
            // Points from the line where the overflow starts to the end of the file
            range: {
              start: { line: maxLines, character: 0 },
              end: { line: file.lineCount - 1, character: lastLine.length },
            },
          },
          message: `${spec.label} has too many lines (${file.lineCount}). Maximum allowed is ${maxLines}.`,
          suggestion: spec.suggestion(maxLines),
        },
      ];
    },
  };
}

/**
 * SIZE-1: the line limit of the root status.md. The `## Phase Index` section — its heading
 * and its body — is left out of the count: the index grows by one row per phase for the life
 * of the project, while the limit is about keeping the human entry point (Now, Next, the blockers) short.
 * Every other line is counted physically, and exactly at the limit is normal.
 */
export const size1: RuleModule = {
  id: 'SIZE-1',
  description: 'Line limit for the root status.md (the Phase Index section is not counted)',
  defaultSeverity: 'error',
  defaultOptions: { maxLines: FILE_TYPE_SCHEMAS['root-status'].maxLines ?? 60 },
  check({ file, options }) {
    if (file.type !== 'root-status') return [];
    const maxLines = maxLinesOf(options, 60);
    const index = file.markdown
      ? findH2Section(file.markdown, file.lineCount, 'Phase Index')
      : null;
    const counted: number[] = [];
    for (let line = 0; line < file.lineCount; line++) {
      if (index && line >= index.heading.range.start.line && line < index.bodyEndLine) continue;
      counted.push(line);
    }
    if (counted.length <= maxLines) return [];
    // The counted region normally ends with the blank separator above the Phase Index, which is no place to
    // point at — so the anchor runs from the counted line where the overflow starts to the last counted line
    // that has content, and collapses onto that line when the overflow is nothing but blank lines
    let lastIndex = counted.length - 1;
    while (lastIndex > 0 && (file.lines[counted[lastIndex] ?? 0] ?? '').trim() === '') lastIndex--;
    const last = counted[lastIndex] ?? 0;
    const first = Math.min(counted[maxLines] ?? 0, last);
    return [
      {
        anchor: {
          kind: 'range',
          file: file.relPath,
          range: {
            start: { line: first, character: 0 },
            end: { line: last, character: (file.lines[last] ?? '').length },
          },
        },
        message: `The root status.md has too many lines (${counted.length}, not counting the Phase Index section). Maximum allowed is ${maxLines}.`,
        suggestion: `Remove detail from the Next tasks to fit within ${maxLines} lines (the Phase Index section is not counted).`,
      },
    ];
  },
};

/** SIZE-2: the line limit of spec/map.md. */
export const size2 = makeFileSizeRule({
  id: 'SIZE-2',
  description: 'Line limit for spec/map.md',
  fileType: 'spec-map',
  label: 'spec/map.md',
  defaultMaxLines: FILE_TYPE_SCHEMAS['spec-map'].maxLines ?? 80,
  defaultSeverity: 'error',
  suggestion: (max) => `Move the details to a domain file to fit within ${max} lines.`,
});

/** SIZE-3: the line limit of a contract file (spec/<domain>.md). */
export const size3 = makeFileSizeRule({
  id: 'SIZE-3',
  description: 'Line limit for a contract file',
  fileType: 'spec-domain',
  label: 'The contract file',
  defaultMaxLines: FILE_TYPE_SCHEMAS['spec-domain'].maxLines ?? 200,
  defaultSeverity: 'error',
  suggestion: (max) => `Move some contracts into another domain file to fit within ${max} lines.`,
});

/** SIZE-6: the line count of a whole phase status (a warning — the sign to split the phase). */
export const size6 = makeFileSizeRule({
  id: 'SIZE-6',
  description: 'Line count of a phase status.md (a sign to split the phase)',
  fileType: 'phase-status',
  label: 'The phase status.md',
  defaultMaxLines: 300,
  defaultSeverity: 'warning',
  suggestion: () => 'Run `/roadmap replan` to split the phase — the phase has grown too large.',
});

/**
 * SIZE-7: the line count of roadmap.md (the back horizon of the Intent layer).
 * A warning rather than an error: roadmap.md grows with every completed phase even when the record is
 * kept correctly (a folded entry is a heading plus a one-line goal, so about 3 lines each), so a fixed
 * line count is a smell detector like SIZE-6, not a fixed budget like the rewritten-in-full status.md.
 * The default 200 holds a roadmap of about 25 done phases, folded (about 140 lines), with room for
 * roughly 20 more, and fires once about 5 phases of detail are left unfolded.
 */
export const size7 = makeFileSizeRule({
  id: 'SIZE-7',
  description: 'Line limit for roadmap.md (a sign that done phases are not folded)',
  fileType: 'roadmap',
  label: 'roadmap.md',
  defaultMaxLines: FILE_TYPE_SCHEMAS['roadmap'].maxLines ?? 200,
  defaultSeverity: 'warning',
  suggestion: (max) =>
    `Fold the done phases into a heading and a one-line goal to fit within ${max} lines.`,
});
