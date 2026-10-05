import { existsSync } from 'node:fs';
import path from 'node:path';
import { resolveRuleConfig, type LintConfig } from './config.js';
import { collectGitInfo } from './corpus/git.js';
import { buildCorpusIndex } from './corpus/index.js';
import type { Diagnostic } from './diagnostic.js';
import { collectFiles, resolveTarget, type RoadmapTarget } from './files.js';
import { parseRoadmapFile } from './parse/parsed-file.js';
import { allRules } from './rules/registry.js';
import type { RuleDiagnostic } from './rules/types.js';
import { sortDiagnostics } from './report/sort.js';

export interface LintResult {
  /** Sorted stably */
  diagnostics: Diagnostic[];
  /** The number of regular files walked under roadmap/ (files other than .md included) */
  filesChecked: number;
  /** Display-only information outside the diagnostic list (the skip when git is absent, the GIT-1 drop, and so on) */
  notices: string[];
}

export interface LintOptions {
  /** The moment the run is judged at — GIT-7 counts an item's age back from it. Defaults to the wall clock; tests inject a fixed date */
  now?: Date;
}

export function runLint(
  target: RoadmapTarget,
  config: LintConfig = {},
  options: LintOptions = {},
): LintResult {
  const now = options.now ?? new Date();
  const refs = collectFiles(target);
  const files = refs.filter((ref) => ref.relPath.endsWith('.md')).map(parseRoadmapFile);
  const git = collectGitInfo(target.baseDir);
  const corpus = buildCorpusIndex(
    refs.map((ref) => ({ relPath: ref.relPath, type: ref.type })),
    files,
    (relPath) => existsSync(path.join(target.baseDir, relPath)),
    git,
  );
  const notices: string[] = [];
  if (git === null) {
    notices.push(
      'Skipped git-dependent checks (GIT-1–GIT-7 and the REF-3 untracked-path detection) because git is unavailable.',
    );
  }
  const diagnostics: Diagnostic[] = [];
  for (const rule of allRules) {
    // An option of the wrong shape or an unknown option key falls back with a notice here, so
    // every rule — the per-file ones have no notice channel of their own — receives options it can trust
    const resolved = resolveRuleConfig(rule, config, (message) => notices.push(message));
    if (!resolved.enabled) continue;
    // The content of a value of the right shape (a script name, a range) is the rule's own business
    if (rule.validateOptions) {
      resolved.options = rule.validateOptions(resolved.options, (message) => notices.push(message));
    }
    const collect = (found: RuleDiagnostic): void => {
      diagnostics.push({
        rule: rule.id,
        severity: resolved.severityOverride ?? found.severity ?? rule.defaultSeverity,
        anchor: found.anchor,
        message: found.message,
        suggestion: found.suggestion,
      });
    };
    if (rule.check) {
      for (const file of files) {
        for (const found of rule.check({ file, options: resolved.options })) collect(found);
      }
    }
    if (rule.checkCorpus) {
      const found = rule.checkCorpus({
        files,
        corpus,
        options: resolved.options,
        notice: (message) => notices.push(message),
        now,
      });
      for (const item of found) collect(item);
    }
  }
  return { diagnostics: sortDiagnostics(diagnostics), filesChecked: refs.length, notices };
}

/** Runs against a given path. Throws when roadmap/ cannot be found (the CLI turns it into exit 2). */
export function lintPath(
  inputPath: string,
  config: LintConfig = {},
  options: LintOptions = {},
): LintResult {
  const target = resolveTarget(inputPath);
  if (!target) throw new Error(`Cannot find roadmap/ under ${inputPath}.`);
  return runLint(target, config, options);
}
