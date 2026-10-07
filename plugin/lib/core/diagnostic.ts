/** Two severity levels. error = a breach of record discipline, warning = worth attention. */
export type Severity = 'error' | 'warning';

/** An LSP Diagnostic-compatible 0-based position. Converted to 1-based only for human-readable display. */
export interface Position {
  line: number;
  character: number;
}

/** start is inclusive and end is exclusive (LSP-compatible). */
export interface Range {
  start: Position;
  end: Position;
}

/**
 * Three anchor kinds.
 * - range: a violation that can be pointed at a position inside a file
 * - file: a violation against a whole file (no position can be identified)
 * - repo: a violation against the whole repository (not tied to a particular file)
 * Every file is a POSIX path relative to the parent directory of roadmap/.
 */
export type Anchor =
  | { kind: 'range'; file: string; range: Range }
  | { kind: 'file'; file: string }
  | { kind: 'repo' };

export interface Diagnostic {
  rule: string;
  severity: Severity;
  anchor: Anchor;
  /** The "what it is" of the report format (doctor-compatible) */
  message: string;
  /** The "what to do about it" of the report format (doctor-compatible) */
  suggestion: string;
}

const SEVERITY_RANK: Record<Severity, number> = { warning: 1, error: 2 };

/** For comparisons such as the fail-severity threshold (the higher, the more severe). */
export function severityRank(severity: Severity): number {
  return SEVERITY_RANK[severity];
}
