import type { Anchor, Severity } from '../diagnostic.js';
import type { CorpusIndex } from '../corpus/index.js';
import type { ParsedFile } from '../parse/parsed-file.js';

/**
 * The diagnostic a rule returns. The engine fills in rule.
 * Set severity only for a case within a rule that is weightier or lighter than the default (a STRUCT-2 ordering slip, say, is a warning).
 * Resolution order: the severity override from the config > the per-diagnostic severity > the rule default.
 */
export interface RuleDiagnostic {
  anchor: Anchor;
  message: string;
  suggestion: string;
  severity?: Severity;
}

export interface RuleContext {
  file: ParsedFile;
  /** defaultOptions with the options from the config merged in */
  options: Record<string, unknown>;
}

/** The corpus view (every file). Used by a check that does not close within a single file, such as FM-3. */
export interface CorpusRuleContext {
  /** Every .md under roadmap/ (ascending relPath, already parsed) */
  files: ParsedFile[];
  /** The ID definition table and the path table (referenced by the corpus rules) */
  corpus: CorpusIndex;
  options: Record<string, unknown>;
  /** Display-only information outside the diagnostic list (it does not affect the exit code). Injected by the engine */
  notice?(message: string): void;
  /** The moment the run is judged at (GIT-7 counts an item's age back from it). Injected by the engine — a fixed date in tests. Falls back to the wall clock */
  now?: Date;
}

/** Implements at least one of check (once per file) and checkCorpus (once for the whole corpus). */
export interface RuleModule {
  id: string;
  description: string;
  defaultSeverity: Severity;
  defaultOptions: Record<string, unknown>;
  /**
   * Checks the content of options whose shape the engine has already accepted (a known script name, an
   * integer of at least 2) — once per run, before any file is checked. Returns the options the rule will
   * run with: what it cannot use is left out (a single value falls back to the default, an unusable entry
   * of a list is dropped while the rest of the list applies) and said so through notice (fail-open).
   * The per-file check has no notice channel of its own, which is why this hook exists.
   */
  validateOptions?(
    options: Record<string, unknown>,
    notice: (message: string) => void,
  ): Record<string, unknown>;
  check?(context: RuleContext): RuleDiagnostic[];
  checkCorpus?(context: CorpusRuleContext): RuleDiagnostic[];
}
