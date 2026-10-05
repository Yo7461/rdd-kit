import type { Diagnostic } from '../diagnostic.js';
import type { LintResult } from '../engine.js';
import { plural } from '../plural.js';

/** The human-readable form of a position (1-based). */
function location(diagnostic: Diagnostic): string {
  const anchor = diagnostic.anchor;
  switch (anchor.kind) {
    case 'range':
      return `${anchor.file}:${anchor.range.start.line + 1}:${anchor.range.start.character + 1}`;
    case 'file':
      return anchor.file;
    case 'repo':
      return '(repo)';
  }
}

export function formatText(result: LintResult): string {
  const lines = result.diagnostics.map(
    (d) => `${location(d)} ${d.severity} ${d.rule} ${d.message} [Fix: ${d.suggestion}]`,
  );
  const total = result.diagnostics.length;
  const errors = result.diagnostics.filter((d) => d.severity === 'error').length;
  const warnings = total - errors;
  const files = `${result.filesChecked} ${plural(result.filesChecked, 'file')}`;
  lines.push(
    total === 0
      ? `No problems found in ${files}.`
      : `${total} ${plural(total, 'problem')} (${errors} ${plural(errors, 'error')}, ${warnings} ${plural(warnings, 'warning')}) in ${files}.`,
  );
  for (const notice of result.notices) lines.push(`Note: ${notice}`);
  return lines.join('\n') + '\n';
}
