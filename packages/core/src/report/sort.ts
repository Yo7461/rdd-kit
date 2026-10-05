import type { Anchor, Diagnostic } from '../diagnostic.js';

function anchorFile(anchor: Anchor): string {
  return anchor.kind === 'repo' ? '' : anchor.file;
}

function anchorLine(anchor: Anchor): number {
  return anchor.kind === 'range' ? anchor.range.start.line : -1;
}

function anchorCharacter(anchor: Anchor): number {
  return anchor.kind === 'range' ? anchor.range.start.character : -1;
}

/**
 * The stable sort of the report: file (the repo anchor comes first) → line (a file anchor comes before one with a line)
 * → character → rule ID → message. String comparison is by code unit (locale-independent).
 */
export function compareDiagnostics(a: Diagnostic, b: Diagnostic): number {
  const fileA = anchorFile(a.anchor);
  const fileB = anchorFile(b.anchor);
  if (fileA !== fileB) return fileA < fileB ? -1 : 1;
  const lineA = anchorLine(a.anchor);
  const lineB = anchorLine(b.anchor);
  if (lineA !== lineB) return lineA - lineB;
  const charA = anchorCharacter(a.anchor);
  const charB = anchorCharacter(b.anchor);
  if (charA !== charB) return charA - charB;
  if (a.rule !== b.rule) return a.rule < b.rule ? -1 : 1;
  if (a.message !== b.message) return a.message < b.message ? -1 : 1;
  return 0;
}

export function sortDiagnostics(diagnostics: readonly Diagnostic[]): Diagnostic[] {
  return [...diagnostics].sort(compareDiagnostics);
}
