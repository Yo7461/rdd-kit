import { resolveRuleConfig, type LintConfig } from './config.js';
import { collectGitInfo } from './corpus/git.js';
import { buildCorpusIndex, type CorpusIndex } from './corpus/index.js';
import type { Diagnostic } from './diagnostic.js';
import { collectFiles, resolveTarget, type RoadmapTarget } from './files.js';
import type { Host } from './host.js';
import { parseRoadmapFile } from './parse/parsed-file.js';
import path from './path.js';
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

export async function runLint(
  target: RoadmapTarget,
  host: Host,
  config: LintConfig = {},
  options: LintOptions = {},
): Promise<LintResult> {
  const now = options.now ?? new Date();
  const refs = await collectFiles(target, host);
  const files = await Promise.all(
    refs.filter((ref) => ref.relPath.endsWith('.md')).map((ref) => parseRoadmapFile(ref, host)),
  );
  const git = await collectGitInfo(target.baseDir, host);

  // The rules ask `pathExists` and `lineHistory` synchronously, and the host answers asynchronously. So a
  // first pass of the corpus rules only records what they ask — every path reads as missing and every
  // history as absent, the answers that make REF-2, REF-3, and GIT-7 ask the most — then the answers are
  // read from the host in one go, and the real pass below reads them from memory. A question the first
  // pass did not record throws, so a rule whose questions depend on the answers fails loudly instead of
  // being answered wrongly
  const existing = new Map<string, boolean>();
  const corpus = buildCorpusIndex(
    refs.map((ref) => ({ relPath: ref.relPath, type: ref.type })),
    files,
    (relPath) => {
      const known = existing.get(relPath);
      if (known === undefined) {
        throw new Error(`pathExists was asked for ${relPath}, which the recording pass did not record.`);
      }
      return known;
    },
    git,
  );
  const askedPaths = new Set<string>();
  const askedHistories = new Set<string>();
  const recording: CorpusIndex = {
    ...corpus,
    pathExists: (relPath) => {
      askedPaths.add(relPath);
      return false;
    },
    git:
      git &&
      ({
        ...git,
        lineHistory: (relPath) => {
          askedHistories.add(relPath);
          return null;
        },
      } satisfies typeof git),
  };
  for (const rule of allRules) {
    const resolved = resolveRuleConfig(rule, config, () => {});
    if (!rule.checkCorpus || !resolved.enabled) continue;
    const ruleOptions = rule.validateOptions ? rule.validateOptions(resolved.options, () => {}) : resolved.options;
    rule.checkCorpus({ files, corpus: recording, options: ruleOptions, notice: () => {}, now });
  }
  await Promise.all(
    [...askedPaths].map(async (relPath) => {
      existing.set(relPath, await host.exists(path.join(target.baseDir, relPath)));
    }),
  );
  await git?.loadLineHistory([...askedHistories]);
  // The real pass answers from what was loaded — and, like pathExists above, throws on a file the
  // recording pass did not ask about, instead of handing the rule a null that looks like "not tracked"
  const answering: CorpusIndex = {
    ...corpus,
    git:
      git &&
      ({
        ...git,
        lineHistory: (relPath) => {
          if (!askedHistories.has(relPath)) {
            throw new Error(`lineHistory was asked for ${relPath}, which the recording pass did not record.`);
          }
          return git.lineHistory(relPath);
        },
      } satisfies typeof git),
  };

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
        corpus: answering,
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
export async function lintPath(
  inputPath: string,
  host: Host,
  config: LintConfig = {},
  options: LintOptions = {},
): Promise<LintResult> {
  const target = await resolveTarget(inputPath, host);
  if (!target) throw new Error(`Cannot find roadmap/ under ${inputPath}.`);
  return runLint(target, host, config, options);
}
