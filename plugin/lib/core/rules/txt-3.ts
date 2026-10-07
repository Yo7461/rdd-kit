import type { RuleDiagnostic, RuleModule } from './types.ts';

/**
 * TXT-3: merge conflict markers left in a record (a leftover `=======` is valid Markdown,
 * passing as a setext underline). Matches the four git markers at the start of a physical line, at
 * git's default size of exactly 7 (a custom `conflict-marker-size` is out of scope). Code fences
 * are not excluded — like TXT-1, this checks the soundness of the bytes, and a merge leaves its
 * markers inside fences too.
 */
const MARKERS: readonly { pattern: RegExp; marker: string }[] = [
  { pattern: /^<{7}(?= |$)/, marker: '<<<<<<<' },
  { pattern: /^\|{7}(?= |$)/, marker: '|||||||' },
  { pattern: /^={7}$/, marker: '=======' },
  { pattern: /^>{7}(?= |$)/, marker: '>>>>>>>' },
];

export const txt3: RuleModule = {
  id: 'TXT-3',
  description: 'Merge conflict markers left in a file',
  defaultSeverity: 'error',
  defaultOptions: {},
  check({ file }) {
    const out: RuleDiagnostic[] = [];
    for (let line = 0; line < file.lines.length; line++) {
      const text = file.lines[line] ?? '';
      const hit = MARKERS.find((m) => m.pattern.test(text));
      if (!hit) continue;
      out.push({
        anchor: {
          kind: 'range',
          file: file.relPath,
          range: { start: { line, character: 0 }, end: { line, character: 7 } },
        },
        message: `Merge conflict marker \`${hit.marker}\` left in the file.`,
        suggestion:
          'Finish the conflict resolution — keep the intended text and delete the marker lines. If a `=======` line is an intentional underline, use an ATX heading (`#`) instead.',
      });
    }
    return out;
  },
};
