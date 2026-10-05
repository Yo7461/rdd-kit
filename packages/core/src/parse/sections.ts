import type { Range } from '../diagnostic.js';
import type { HeadingInfo, MarkdownIndex } from './markdown.js';

/** An H2 section. The body runs from the line after the heading to just before the next H2 line (0-based, end exclusive). */
export interface H2Section {
  heading: HeadingInfo;
  bodyStartLine: number;
  bodyEndLine: number;
}

export function h2Sections(markdown: MarkdownIndex, lineCount: number): H2Section[] {
  const h2s = markdown.headings.filter((h) => h.depth === 2);
  return h2s.map((heading, i) => ({
    heading,
    bodyStartLine: heading.range.start.line + 1,
    bodyEndLine: i + 1 < h2s.length ? (h2s[i + 1]?.range.start.line ?? lineCount) : lineCount,
  }));
}

export function findH2Section(
  markdown: MarkdownIndex,
  lineCount: number,
  headingText: string,
): H2Section | null {
  return h2Sections(markdown, lineCount).find((s) => s.heading.text === headingText) ?? null;
}

/** Whether the line is inside a code block (fenced or indented). Used to exclude example IDs and sample configs. */
export function lineInCode(markdown: MarkdownIndex, line: number): boolean {
  return markdown.codeFences.some(
    (f) => line >= f.range.start.line && line <= f.range.end.line,
  );
}

/** Whether the line is inside a blockquote (excluded as an example by REF-1). */
export function lineInBlockquote(markdown: MarkdownIndex, line: number): boolean {
  return markdown.blockquotes.some(
    (b) => line >= b.range.start.line && line <= b.range.end.line,
  );
}

/** Whether (line, character) falls inside range (start inclusive, end exclusive). */
export function positionInRange(range: Range, line: number, character: number): boolean {
  if (line < range.start.line || line > range.end.line) return false;
  if (line === range.start.line && character < range.start.character) return false;
  if (line === range.end.line && character >= range.end.character) return false;
  return true;
}

/** Whether (line, character) falls inside any inline code span. */
export function positionInInlineCode(
  markdown: MarkdownIndex,
  line: number,
  character: number,
): boolean {
  return markdown.inlineCode.some((c) => positionInRange(c.range, line, character));
}
