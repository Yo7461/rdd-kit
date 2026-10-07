import { findH2Section } from '../parse/sections.ts';
import { lineRange } from './helpers.ts';
import { maxLinesOf } from './size-limits.ts';
import type { RuleModule } from './types.ts';

/**
 * SIZE-4: the Outcome Summary of a phase status is 10 lines or fewer.
 * The count = the non-empty lines inside the section, excluding the heading line.
 */
export const size4: RuleModule = {
  id: 'SIZE-4',
  description: 'Line limit for Outcome Summary',
  defaultSeverity: 'error',
  defaultOptions: { maxLines: 10 },
  check({ file, options }) {
    if (file.type !== 'phase-status' || !file.markdown) return [];
    const section = findH2Section(file.markdown, file.lineCount, 'Outcome Summary');
    if (!section) return [];
    const maxLines = maxLinesOf(options, 10);
    const nonEmptyLines: number[] = [];
    for (let line = section.bodyStartLine; line < section.bodyEndLine; line++) {
      if ((file.lines[line] ?? '').trim() !== '') nonEmptyLines.push(line);
    }
    if (nonEmptyLines.length <= maxLines) return [];
    const overflowLine = nonEmptyLines[maxLines] ?? section.bodyStartLine;
    return [
      {
        anchor: { kind: 'range', file: file.relPath, range: lineRange(file, overflowLine) },
        message: `Outcome Summary has too many lines (${nonEmptyLines.length} non-empty). Maximum allowed is ${maxLines}.`,
        suggestion: `Update the summary to fit within ${maxLines} lines. This is the one section that may be rewritten as it rolls forward.`,
      },
    ];
  },
};
