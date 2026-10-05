import type { Diagnostic } from '../diagnostic.js';
import type { LintResult } from '../engine.js';

export const JSON_FORMAT_VERSION = 1;

export interface JsonReport {
  version: number;
  diagnostics: Diagnostic[];
  summary: { errors: number; warnings: number; filesChecked: number };
  /** Display-only information (it affects neither the exit code nor the diagnostic list) */
  notices: string[];
}

/** The machine-readable output. Positions stay LSP-compatible and 0-based. */
export function toJsonReport(result: LintResult): JsonReport {
  const errors = result.diagnostics.filter((d) => d.severity === 'error').length;
  return {
    version: JSON_FORMAT_VERSION,
    diagnostics: result.diagnostics,
    summary: {
      errors,
      warnings: result.diagnostics.length - errors,
      filesChecked: result.filesChecked,
    },
    notices: result.notices,
  };
}

export function formatJson(result: LintResult): string {
  return JSON.stringify(toJsonReport(result), null, 2) + '\n';
}
