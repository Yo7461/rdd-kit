import type { MarkdownIndex } from '../parse/markdown.ts';
import type { ParsedFile } from '../parse/parsed-file.ts';
import { lineInBlockquote, lineInCode } from '../parse/sections.ts';
import { lineRange } from './helpers.ts';
import type { RuleDiagnostic, RuleModule } from './types.ts';

const OPEN_FENCE = /^ {0,3}(`{3,}|~{3,})/;
const CLOSE_ONLY_FENCE = /^ {0,3}(`{3,}|~{3,})\s*$/;
const PIPE_LINE = /^ {0,3}\|.*\|\s*$/;
const DELIMITER_ROW = /^ {0,3}\|(?:\s*:?-+:?\s*\|)+\s*$/;

function lineAnchor(file: ParsedFile, line: number): RuleDiagnostic['anchor'] {
  return { kind: 'range', file: file.relPath, range: lineRange(file, line) };
}

/** The character spans of a line that inline code covers (excluded when counting the | of a table). */
function inlineCodeMasks(
  markdown: MarkdownIndex,
  line: number,
  lineLength: number,
): { start: number; end: number }[] {
  const masks: { start: number; end: number }[] = [];
  for (const span of markdown.inlineCode) {
    const { start, end } = span.range;
    if (line < start.line || line > end.line) continue;
    masks.push({
      start: line === start.line ? start.character : 0,
      end: line === end.line ? end.character : lineLength,
    });
  }
  return masks;
}

/** Derives the cell count from the number of separating | left after escapes (\|) and inline code are removed. */
function countCells(text: string, masks: { start: number; end: number }[]): number {
  let pipes = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '|') continue;
    if (i > 0 && text[i - 1] === '\\') continue;
    if (masks.some((m) => i >= m.start && i < m.end)) continue;
    pipes++;
  }
  return pipes - 1;
}

/**
 * TXT-2: broken Markdown. Enumerated rather than defined universally:
 * (1) an unclosed code fence (2) mismatched front matter delimiters and YAML that cannot be parsed
 * (delegated by FM-1 — fm-1.ts) (3) an uneven table column count (warning).
 * A broken relative link belongs to REF-2. Add a check only together with a violation fixture.
 */
export const txt2: RuleModule = {
  id: 'TXT-2',
  description: 'Broken Markdown: unclosed fences, malformed front matter, uneven table columns',
  defaultSeverity: 'error',
  defaultOptions: {},
  check({ file }) {
    const markdown = file.markdown;
    if (!markdown) return [];
    const out: RuleDiagnostic[] = [];

    // (1) An unclosed code fence (an indented code block and a fence inside a blockquote are out of scope)
    for (const fence of markdown.codeFences) {
      const startLine = fence.range.start.line;
      const opening = OPEN_FENCE.exec(file.lines[startLine] ?? '');
      if (!opening) continue;
      const endLine = fence.range.end.line;
      const closing = endLine > startLine ? CLOSE_ONLY_FENCE.exec(file.lines[endLine] ?? '') : null;
      const closed =
        closing !== null &&
        (closing[1] ?? '')[0] === (opening[1] ?? '')[0] &&
        (closing[1] ?? '').length >= (opening[1] ?? '').length;
      if (!closed) {
        out.push({
          anchor: lineAnchor(file, startLine),
          message: 'Missing the closing code fence.',
          suggestion: 'Add the matching closing fence (``` or ~~~).',
        });
      }
    }

    // (2) Mismatched front matter delimiters and YAML that cannot be parsed (what FM-1 delegates here)
    if (markdown.frontMatter) {
      const { parseError, range } = markdown.frontMatter;
      if (parseError) {
        out.push({
          anchor: { kind: 'range', file: file.relPath, range },
          message: `Cannot parse front matter as YAML (${(parseError.split('\n')[0] ?? '').trim().replace(/:$/, '')}).`,
          suggestion: 'Fix the YAML syntax — brackets, quotes, and indentation.',
        });
      }
    } else if (file.lines[0] === '---') {
      out.push({
        anchor: lineAnchor(file, 0),
        message: 'Missing the closing `---` delimiter for front matter.',
        suggestion: 'Add the matching `---` to close the front matter.',
      });
    }

    // (3) An uneven table column count (warning) — a fence, a blockquote, and the front matter are out of scope
    const frontMatterEnd = markdown.frontMatter?.range.end.line ?? -1;
    const isTableLine = (line: number): boolean =>
      line < file.lines.length &&
      line > frontMatterEnd &&
      PIPE_LINE.test(file.lines[line] ?? '') &&
      !lineInCode(markdown, line) &&
      !lineInBlockquote(markdown, line);
    let line = frontMatterEnd + 1;
    while (line < file.lines.length) {
      if (!isTableLine(line)) {
        line++;
        continue;
      }
      const start = line;
      while (isTableLine(line)) line++;
      if (line - start < 2 || !DELIMITER_ROW.test(file.lines[start + 1] ?? '')) continue;
      const cells = (row: number): number => {
        const text = file.lines[row] ?? '';
        return countCells(text, inlineCodeMasks(markdown, row, text.length));
      };
      const headerCells = cells(start);
      for (let row = start + 1; row < line; row++) {
        const rowCells = cells(row);
        if (rowCells === headerCells) continue;
        out.push({
          severity: 'warning',
          anchor: lineAnchor(file, row),
          message: `Inconsistent table column count (header has ${headerCells}, this row has ${rowCells}).`,
          suggestion:
            'Change the row to match the header — escape a `|` inside a cell as `\\|` or wrap it in inline code.',
        });
      }
    }
    return out;
  },
};
