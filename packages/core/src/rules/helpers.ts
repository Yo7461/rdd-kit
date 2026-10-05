import type { Anchor, Range } from '../diagnostic.js';
import type { ParsedFile } from '../parse/parsed-file.js';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A Range covering a whole line (0-based). */
export function lineRange(file: ParsedFile, line: number): Range {
  return { start: { line, character: 0 }, end: { line, character: (file.lines[line] ?? '').length } };
}

/** The Range of a top-level key line inside the front matter. null when the key line cannot be identified. */
export function frontMatterKeyRange(file: ParsedFile, key: string): Range | null {
  const frontMatter = file.markdown?.frontMatter;
  if (!frontMatter) return null;
  const bodyStart = frontMatter.range.start.line + 1;
  const index = frontMatter.raw.split('\n').findIndex((l) => l.startsWith(`${key}:`));
  return index < 0 ? null : lineRange(file, bodyStart + index);
}

/** Formats a value for display (in a diagnostic message). */
export function showValue(value: unknown): string {
  return value === undefined ? '(not set)' : JSON.stringify(value);
}

/** An anchor at the position of a token inside the front matter (degrades to a file anchor when it cannot be found). */
export function frontMatterTokenAnchor(file: ParsedFile, token: string): Anchor {
  const frontMatterInfo = file.markdown?.frontMatter;
  if (frontMatterInfo) {
    const bodyStart = frontMatterInfo.range.start.line + 1;
    const pattern = new RegExp(`\\b${token}\\b`);
    const rawLines = frontMatterInfo.raw.split('\n');
    for (let i = 0; i < rawLines.length; i++) {
      const match = pattern.exec(rawLines[i] ?? '');
      if (match) {
        const line = bodyStart + i;
        return {
          kind: 'range',
          file: file.relPath,
          range: {
            start: { line, character: match.index },
            end: { line, character: match.index + token.length },
          },
        };
      }
    }
  }
  return { kind: 'file', file: file.relPath };
}
