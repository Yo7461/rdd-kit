import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  listViolationCases,
  materializeCase,
  readExpectedDiagnostics,
  type ViolationCase,
} from '../../core/src/testing/index.js';

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const cliMain = path.join(repoRoot, 'packages', 'cli', 'dist', 'main.js');
const fixturesRoot = path.join(repoRoot, 'fixtures');
const validRoot = path.join(fixturesRoot, 'valid');

function runCli(args: string[], cwd: string = repoRoot) {
  return spawnSync(process.execPath, [cliMain, ...args], { encoding: 'utf8', cwd });
}

function sizeCase(): ViolationCase {
  const found = listViolationCases(fixturesRoot).find((c) => c.ruleId === 'SIZE-1');
  if (!found) throw new Error('violations/SIZE-1 does not exist');
  return found;
}

function withSizeViolation<T>(fn: (dir: string) => T): T {
  const { dir, cleanup } = materializeCase(validRoot, sizeCase().overlayDir);
  try {
    return fn(dir);
  } finally {
    cleanup();
  }
}

it('precondition: the CLI is built (pnpm test runs typecheck and build first)', () => {
  expect(existsSync(cliMain)).toBe(true);
});

describe('SIZE-1 end to end', () => {
  it('a violation corpus: exit 1, with the position, rule ID, and suggestion in the text output', () => {
    withSizeViolation((dir) => {
      const res = runCli([dir]);
      expect(res.status).toBe(1);
      expect(res.stdout).toContain('roadmap/status.md:60:1 error SIZE-1');
      expect(res.stdout).toContain('[Fix: ');
      expect(res.stdout).toContain('1 problem (1 error, 0 warnings) in ');
    });
  });

  it('a violation corpus: --format json matches the golden', () => {
    withSizeViolation((dir) => {
      const res = runCli(['--format', 'json', dir]);
      expect(res.status).toBe(1);
      const report = JSON.parse(res.stdout) as {
        version: number;
        diagnostics: unknown;
        summary: { errors: number; warnings: number };
      };
      expect(report.version).toBe(1);
      expect(report.diagnostics).toEqual(readExpectedDiagnostics(sizeCase().expectedPath));
      expect(report.summary.errors).toBe(1);
      expect(report.summary.warnings).toBe(0);
    });
  });

  it('the valid corpus: exit 0 (no false positives)', () => {
    // validRoot sits inside a git repository, and the GIT rules judge that host state rather than the
    // corpus — lint-corpus.config.json takes them out of scope (the same config lint:corpus uses)
    const res = runCli(['--config', path.join(repoRoot, 'lint-corpus.config.json'), validRoot]);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('No problems found in ');
  });

  it('looks for roadmap/ from the current directory when path is omitted', () => {
    // The corpus config again — with no path argument the host repository's git is still what the GIT rules see
    const res = runCli(['--config', path.join(repoRoot, 'lint-corpus.config.json')], validRoot);
    expect(res.status).toBe(0);
  });
});

describe('the config file', () => {
  it('automatic discovery: the .roadmap-lint.json in baseDir turns SIZE-1 off -> exit 0', () => {
    withSizeViolation((dir) => {
      writeFileSync(
        path.join(dir, '.roadmap-lint.json'),
        JSON.stringify({ rules: { 'SIZE-1': { enabled: false } } }),
      );
      expect(runCli([dir]).status).toBe(0);
    });
  });

  it('an explicit --config: with severity=warning the default fail-severity gives exit 0, and --fail-severity warning gives exit 1', () => {
    withSizeViolation((dir) => {
      const configPath = path.join(dir, 'custom-config.json');
      writeFileSync(configPath, JSON.stringify({ rules: { 'SIZE-1': { severity: 'warning' } } }));
      expect(runCli(['--config', configPath, dir]).status).toBe(0);
      expect(runCli(['--config', configPath, '--fail-severity', 'warning', dir]).status).toBe(1);
    });
  });

  it('an invalid config (an unknown top-level key) gives exit 2 and a configuration error', () => {
    withSizeViolation((dir) => {
      writeFileSync(path.join(dir, '.roadmap-lint.json'), '{"rule": {}}');
      const res = runCli([dir]);
      expect(res.status).toBe(2);
      expect(res.stderr).toContain('Configuration error: ');
    });
  });

  it('gives exit 2 when --config points nowhere', () => {
    const res = runCli(['--config', path.join(repoRoot, 'no-such-config.json'), validRoot]);
    expect(res.status).toBe(2);
    expect(res.stderr).toContain('Configuration error: ');
  });

  it('accepts a config with an unknown rule ID (forward compatibility)', () => {
    withSizeViolation((dir) => {
      writeFileSync(
        path.join(dir, '.roadmap-lint.json'),
        JSON.stringify({ rules: { 'FUTURE-9': { enabled: false } } }),
      );
      expect(runCli([dir]).status).toBe(1);
    });
  });

  it('an option of the wrong shape or an unknown option key falls back to the default with a notice, and the run goes on', () => {
    withSizeViolation((dir) => {
      writeFileSync(
        path.join(dir, '.roadmap-lint.json'),
        JSON.stringify({ rules: { 'SIZE-1': { options: { maxLines: 'abc', maxLine: 100 } } } }),
      );
      // The SIZE-1 violation is still found against the default 60, and neither value bends the result
      const res = runCli([dir]);
      expect(res.status).toBe(1);
      expect(res.stdout).toContain('roadmap/status.md:60:1 error SIZE-1');
      expect(res.stdout).toContain(
        'Note: SIZE-1: Ignored the invalid `maxLines` value `"abc"` — expected a non-negative number, so the default 60 is used.',
      );
      expect(res.stdout).toContain(
        'Note: SIZE-1: Ignored the unknown option `maxLine` — the options of this rule are `maxLines`.',
      );
      const json = runCli(['--format', 'json', dir]);
      const report = JSON.parse(json.stdout) as { notices: string[] };
      expect(report.notices.filter((n) => n.startsWith('SIZE-1: Ignored'))).toHaveLength(2);
    });
  });

  it('keeps every position an integer whatever maxLines is set to', () => {
    withSizeViolation((dir) => {
      // A fractional limit is a number, so it is accepted — the anchor still has to be a whole line
      const gitOff = Object.fromEntries(['GIT-1', 'GIT-2', 'GIT-3', 'GIT-4', 'GIT-5', 'GIT-6', 'GIT-7'].map((id) => [id, { enabled: false }]));
      writeFileSync(
        path.join(dir, '.roadmap-lint.json'),
        JSON.stringify({ rules: { ...gitOff, 'SIZE-2': { options: { maxLines: 1.5 } }, 'SIZE-4': { options: { maxLines: 0.5 } } } }),
      );
      const res = runCli(['--format', 'json', dir]);
      expect(res.status).toBe(1);
      const report = JSON.parse(res.stdout) as {
        diagnostics: { rule: string; message: string; anchor: { kind: string; range?: { start: { line: number }; end: { line: number } } } }[];
      };
      const rules = report.diagnostics.map((d) => d.rule);
      expect(rules).toContain('SIZE-2');
      expect(rules).toContain('SIZE-4');
      for (const d of report.diagnostics) {
        if (d.anchor.kind !== 'range' || !d.anchor.range) continue;
        expect(Number.isInteger(d.anchor.range.start.line), `${d.rule}: ${d.message}`).toBe(true);
        expect(Number.isInteger(d.anchor.range.end.line), `${d.rule}: ${d.message}`).toBe(true);
      }
      expect(report.diagnostics.find((d) => d.rule === 'SIZE-2')?.anchor.range?.start.line).toBe(1);
    });
  });

  it('ignores the LOG_TOKENS / LOG_STREAM variables of its YAML parser, so the JSON report stays parseable', () => {
    const res = spawnSync(
      process.execPath,
      [cliMain, '--config', path.join(repoRoot, 'lint-corpus.config.json'), '--format', 'json', validRoot],
      { encoding: 'utf8', env: { ...process.env, LOG_TOKENS: '1', LOG_STREAM: '1' } },
    );
    expect(res.status).toBe(0);
    expect(res.stdout.startsWith('{')).toBe(true);
    expect((JSON.parse(res.stdout) as { diagnostics: unknown[] }).diagnostics).toEqual([]);
  });
});

describe('arguments and exit codes', () => {
  it('still gives exit 1 for an error diagnostic under --fail-severity warning', () => {
    withSizeViolation((dir) => {
      expect(runCli(['--fail-severity', 'warning', dir]).status).toBe(1);
    });
  });

  it('gives exit 2 and the usage text for an unknown option', () => {
    const res = runCli(['--bogus']);
    expect(res.status).toBe(2);
    expect(res.stderr).toContain('Usage: roadmap-lint');
  });

  it('gives exit 2 for an invalid --format value', () => {
    const res = runCli(['--format', 'xml']);
    expect(res.status).toBe(2);
    expect(res.stderr).toContain('The --format option must be either text or json.');
  });

  it('gives exit 2 for an invalid --fail-severity value', () => {
    const res = runCli(['--fail-severity', 'info']);
    expect(res.status).toBe(2);
    expect(res.stderr).toContain('The --fail-severity option must be either error or warning.');
  });

  it('gives exit 2 when more than one path is passed', () => {
    const res = runCli(['.', '..']);
    expect(res.status).toBe(2);
    expect(res.stderr).toContain('Too many positional arguments: . ..');
  });

  it('gives exit 2 for a path with no roadmap/ under it', () => {
    const res = runCli([path.join(repoRoot, 'packages')]);
    expect(res.status).toBe(2);
    expect(res.stderr).toContain('Cannot find roadmap/ under ');
  });

  it('prints the usage text with exit 0 for --help', () => {
    const res = runCli(['--help']);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('Usage: roadmap-lint');
    // The one-line description is the same sentence as in the READMEs and the metadata description
    expect(res.stdout).toContain('Lint the roadmap/ records of a roadmap-driven project.');
    // Defaults read `(default: …)`, and an option description carries no trailing period
    expect(res.stdout).toContain('Output format (default: text)');
    expect(res.stdout).not.toMatch(/^ +--\S.*\.\r?$/mu);
  });

  it('prints the version with exit 0 for --version', () => {
    const res = runCli(['--version']);
    expect(res.status).toBe(0);
    expect(res.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
