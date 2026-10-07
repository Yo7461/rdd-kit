import { findH2Section, lineInCode } from '../parse/sections.ts';
import { lineRange } from './helpers.ts';
import type { RuleDiagnostic, RuleModule } from './types.ts';

/**
 * SIZE-5: Session Log holds one line per session.
 * The mechanical test: two or more table data rows (a first cell of S####) for the same S# is a violation.
 */
export const size5: RuleModule = {
  id: 'SIZE-5',
  description: 'One line per session in Session Log',
  defaultSeverity: 'error',
  defaultOptions: {},
  check({ file }) {
    if (file.type !== 'phase-status' || !file.markdown) return [];
    const section = findH2Section(file.markdown, file.lineCount, 'Session Log');
    if (!section) return [];
    const rowsBySession = new Map<string, number[]>();
    for (let line = section.bodyStartLine; line < section.bodyEndLine; line++) {
      if (lineInCode(file.markdown, line)) continue;
      const text = file.lines[line] ?? '';
      if (!text.startsWith('|')) continue;
      const firstCell = (text.split('|')[1] ?? '').trim();
      if (!/^S\d{4}$/.test(firstCell)) continue; // The header and the separator row are out of scope
      const rows = rowsBySession.get(firstCell) ?? [];
      rows.push(line);
      rowsBySession.set(firstCell, rows);
    }
    const out: RuleDiagnostic[] = [];
    for (const [sessionId, rows] of rowsBySession) {
      if (rows.length < 2) continue;
      const secondRow = rows[1] ?? rows[0] ?? section.bodyStartLine;
      out.push({
        anchor: { kind: 'range', file: file.relPath, range: lineRange(file, secondRow) },
        message: `Duplicate Session Log rows for session ${sessionId} (${rows.length} rows). Session Log holds one line per session.`,
        suggestion: 'Move the detail into that session log and keep one line here.',
      });
    }
    return out;
  },
};
