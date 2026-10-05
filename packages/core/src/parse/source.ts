/** Strips a leading BOM (U+FEFF) and normalizes line endings to \n. Every position from here on is based on the normalized text. */
export function normalizeText(text: string): string {
  const withoutBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  return withoutBom.replace(/\r\n?/g, '\n');
}

/**
 * Splits into physical lines. What counts as a line:
 * physical lines including the front matter and blank lines, with a trailing newline not counted as a line.
 */
export function splitLines(normalized: string): string[] {
  if (normalized === '') return [];
  const lines = normalized.split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
}
