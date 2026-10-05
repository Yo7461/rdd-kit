import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { LintConfig } from '../config.js';
import { runLint, type LintOptions, type LintResult } from '../engine.js';
import { resolveTarget } from '../files.js';

/** One case under fixtures/violations/<rule ID>/ (the overlay approach — a minimal mutation of the valid corpus). */
export interface ViolationCase {
  ruleId: string;
  caseDir: string;
  /** The mutated files laid over the valid corpus (the structure is relative to the fixture root) */
  overlayDir: string;
  /** The golden (the diagnostics array in the JSON reporter format) */
  expectedPath: string;
}

export function listViolationCases(fixturesRoot: string): ViolationCase[] {
  const violationsDir = path.join(fixturesRoot, 'violations');
  if (!existsSync(violationsDir)) return [];
  return readdirSync(violationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const caseDir = path.join(violationsDir, entry.name);
      return {
        ruleId: entry.name,
        caseDir,
        overlayDir: path.join(caseDir, 'overlay'),
        expectedPath: path.join(caseDir, 'expected.json'),
      };
    })
    .sort((a, b) => (a.ruleId < b.ruleId ? -1 : a.ruleId > b.ruleId ? 1 : 0));
}

/**
 * One case under fixtures/valid-variants/<name>/ — a corpus that stays clean. It is the valid corpus
 * plus an overlay, exactly like a violation case, but the expected result is zero diagnostics, so it
 * carries a shape the single valid corpus cannot be in at the same time (the terminal state, for instance).
 */
export interface ValidVariant {
  name: string;
  caseDir: string;
  /** The mutated files laid over the valid corpus (the structure is relative to the fixture root) */
  overlayDir: string;
}

export function listValidVariants(fixturesRoot: string): ValidVariant[] {
  const variantsDir = path.join(fixturesRoot, 'valid-variants');
  if (!existsSync(variantsDir)) return [];
  return readdirSync(variantsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const caseDir = path.join(variantsDir, entry.name);
      return { name: entry.name, caseDir, overlayDir: path.join(caseDir, 'overlay') };
    })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** Composes the valid corpus plus an overlay into a temporary directory. The caller must always call cleanup(). */
export function materializeCase(
  validRoot: string,
  overlayDir: string,
): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), 'roadmap-lint-fixture-'));
  cpSync(validRoot, dir, { recursive: true });
  if (existsSync(overlayDir)) {
    cpSync(overlayDir, dir, { recursive: true, force: true });
  }
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true, maxRetries: 3 }) };
}

export function lintDir(dir: string, config: LintConfig = {}, options: LintOptions = {}): LintResult {
  const target = resolveTarget(dir);
  if (!target) throw new Error(`Cannot find roadmap/ under ${dir}.`);
  return runLint(target, config, options);
}

export function readExpectedDiagnostics(expectedPath: string): unknown {
  return JSON.parse(readFileSync(expectedPath, 'utf8'));
}

/** Reduces the result to the same plain JSON value as the golden (expected.json), for comparison. */
export function diagnosticsToJsonValue(result: LintResult): unknown {
  return JSON.parse(JSON.stringify(result.diagnostics));
}

/**
 * Assembles a temporary git repository and hands it to fn (for the GIT rules).
 * The keys of tree are repository-relative paths (POSIX) and the values are file contents. Every file goes into one commit.
 */
export function withTempGitRepo<T>(
  tree: Record<string, string>,
  fn: (repoDir: string) => T,
  commitMessage = 'fixture',
): T {
  const repoDir = mkdtempSync(path.join(tmpdir(), 'roadmap-lint-git-'));
  try {
    const git = (...args: string[]): string =>
      execFileSync('git', ['-C', repoDir, ...args], { encoding: 'utf8' });
    git('init', '-q');
    git('config', 'user.name', 'fixture');
    git('config', 'user.email', 'fixture@example.com');
    git('config', 'commit.gpgsign', 'false');
    // Keep the bytes exactly as written (avoiding line-ending conversion warnings and drift)
    git('config', 'core.autocrlf', 'false');
    for (const [relPath, content] of Object.entries(tree)) {
      const filePath = path.join(repoDir, ...relPath.split('/'));
      mkdirSync(path.dirname(filePath), { recursive: true });
      writeFileSync(filePath, content);
    }
    git('add', '-A');
    git('commit', '-q', '--allow-empty', '-m', commitMessage);
    return fn(repoDir);
  } finally {
    rmSync(repoDir, { recursive: true, force: true, maxRetries: 3 });
  }
}
