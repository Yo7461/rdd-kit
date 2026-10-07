import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { listViolationCases, materializeCase } from '../../core/src/testing/index.js';

// The spawn check that the hook is non-destructive — starts packages/cli/hooks/roadmap-lint-hook.mjs as a
// real process and checks the observable surface directly: stdin (the PostToolUse JSON) against the exit code and stderr.
// The T labels are stable identifiers: a case keeps its label when cases are added or reordered, so a
// reference to a case (in a failure report, say) stays valid.
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const hookPath = path.join(repoRoot, 'packages', 'cli', 'hooks', 'roadmap-lint-hook.mjs');
const cliMain = path.join(repoRoot, 'packages', 'cli', 'dist', 'main.js');
const fixturesRoot = path.join(repoRoot, 'fixtures');
const validRoot = path.join(fixturesRoot, 'valid');

// Build an env with the variables the hook reads dropped, so the test keeps full control of the hook's CLI
// resolution order even when it runs under Claude Code
const baseEnv = (): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (['ROADMAP_LINT_BIN', 'CLAUDE_PROJECT_DIR'].includes(k)) continue;
    env[k] = v;
  }
  return env;
};

const stripPath = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv => {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(env)) {
    if (k.toUpperCase() === 'PATH') continue;
    out[k] = v;
  }
  return out;
};

function runHook(stdin: string, env: NodeJS.ProcessEnv, hook = hookPath) {
  const res = spawnSync(process.execPath, [hook], {
    input: stdin,
    encoding: 'utf8',
    env,
    windowsHide: true,
  });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

const editJson = (projectDir: string, filePath: string): string =>
  JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: filePath }, cwd: projectDir });

function withSizeViolation<T>(fn: (dir: string) => T): T {
  const found = listViolationCases(fixturesRoot).find((c) => c.ruleId === 'SIZE-1');
  if (!found) throw new Error('violations/SIZE-1 does not exist');
  const { dir, cleanup } = materializeCase(validRoot, found.overlayDir);
  try {
    return fn(dir);
  } finally {
    cleanup();
  }
}

// The hook in its own package finds the bundle beside it (step 2 of its resolution order). The cases
// about the steps after that run a copy of the hook in a directory with no bundle beside it
function withHookAlone<T>(fn: (hook: string) => T): T {
  const dir = mkdtempSync(path.join(tmpdir(), 'rdd-kit-hook-alone-'));
  try {
    const hook = path.join(dir, 'hooks', 'roadmap-lint-hook.mjs');
    mkdirSync(path.dirname(hook), { recursive: true });
    cpSync(hookPath, hook);
    return fn(hook);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  }
}

describe('the non-destructive contract of the roadmap-lint hook', () => {
  it('T1: an edit under roadmap/ with diagnostics -> formatted to stderr, exit 2 (the edit is not blocked)', () => {
    withSizeViolation((dir) => {
      const res = runHook(editJson(dir, path.join('roadmap', 'status.md')), {
        ...baseEnv(),
        CLAUDE_PROJECT_DIR: dir,
        ROADMAP_LINT_BIN: cliMain,
      });
      expect(res.status).toBe(2);
      // The plural in the summary line follows the count (the same shape as the reporter's summary line, with a `roadmap-lint: ` lead and the closing phrase swapped)
      expect(res.stderr).toContain('roadmap-lint: 1 problem (1 error, 0 warnings) after editing roadmap/.');
      expect(res.stderr).toContain('SIZE-1');
      expect(res.stderr).toContain('[Fix: ');
      expect(res.stdout).toBe('');
    });
  });

  it('T2: an edit under roadmap/ with no diagnostics -> a silent exit 0', () => {
    // validRoot sits inside this repository's git (GIT-2 would end up checking the host history),
    // so the no-diagnostics state is built in a temporary copy outside it (the same isolation as materializeCase in T1/T3/T4)
    const dir = mkdtempSync(path.join(tmpdir(), 'rdd-kit-hook-t2-'));
    try {
      cpSync(validRoot, dir, { recursive: true });
      const res = runHook(editJson(dir, 'roadmap/status.md'), {
        ...baseEnv(),
        CLAUDE_PROJECT_DIR: dir,
        ROADMAP_LINT_BIN: cliMain,
      });
      expect(res.status).toBe(0);
      expect(res.stderr).toBe('');
      expect(res.stdout).toBe('');
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    }
  });

  it('T3: an edit outside roadmap/ -> a silent exit 0 even when diagnostics exist', () => {
    withSizeViolation((dir) => {
      const res = runHook(editJson(dir, path.join('src', 'main.ts')), {
        ...baseEnv(),
        CLAUDE_PROJECT_DIR: dir,
        ROADMAP_LINT_BIN: cliMain,
      });
      expect(res.status).toBe(0);
      expect(res.stderr).toBe('');
    });
  });

  it('T4: no CLI (the env points nowhere, no bundle beside the hook, PATH is empty, there is no dist) -> a silent exit 0', () => {
    withSizeViolation((dir) => {
      withHookAlone((hook) => {
        const res = runHook(
          editJson(dir, path.join('roadmap', 'status.md')),
          {
            ...stripPath(baseEnv()),
            CLAUDE_PROJECT_DIR: dir,
            ROADMAP_LINT_BIN: path.join(dir, 'no-such-cli.js'),
          },
          hook,
        );
        expect(res.status).toBe(0);
        expect(res.stderr).toBe('');
      });
    });
  });

  it('T9: the bundle beside the hook — the package it ships in — is what runs when nothing else is named, ahead of a development dist', () => {
    // The committed bundle under packages/cli/bundle, found from the hook's own location: no env var,
    // no PATH, and a project that is not the linter's checkout
    withSizeViolation((dir) => {
      const res = runHook(editJson(dir, path.join('roadmap', 'status.md')), {
        ...stripPath(baseEnv()),
        CLAUDE_PROJECT_DIR: dir,
      });
      expect(res.status).toBe(2);
      expect(res.stderr).toContain('roadmap-lint: 1 problem (1 error, 0 warnings) after editing roadmap/.');
      expect(res.stderr).toContain('SIZE-1');

      // An env var that names nothing falls through to the bundle; a development dist of a linter checkout
      // (step 3, which T6 shows is honored by a hook without a bundle beside it) does not get ahead of it
      const distDir = path.join(dir, 'packages', 'cli', 'dist');
      mkdirSync(distDir, { recursive: true });
      const fake = { version: 1, diagnostics: [{ rule: 'FAKE-1', severity: 'error', anchor: { kind: 'repo' }, message: 'ran the wrong program', suggestion: '' }], summary: { errors: 1, warnings: 0, filesChecked: 0 }, notices: [] };
      writeFileSync(path.join(distDir, 'main.js'), `process.stdout.write(${JSON.stringify(JSON.stringify(fake))}); process.exitCode = 1;\n`);
      writeFileSync(path.join(dir, 'packages', 'cli', 'package.json'), JSON.stringify({ name: 'roadmap-lint' }));
      const beside = runHook(editJson(dir, path.join('roadmap', 'status.md')), {
        ...stripPath(baseEnv()),
        CLAUDE_PROJECT_DIR: dir,
        ROADMAP_LINT_BIN: path.join(dir, 'no-such-cli.js'),
      });
      expect(beside.status).toBe(2);
      expect(beside.stderr).toContain('SIZE-1');
      expect(beside.stderr).not.toContain('ran the wrong program');
    });
  });

  it('T5: LOG_TOKENS / LOG_STREAM in the environment do not silence the report', () => {
    // The linter's YAML parser prints its token stream to stdout when these are set; the report stayed
    // unparseable and the hook exited 0 without a word
    withSizeViolation((dir) => {
      const res = runHook(editJson(dir, path.join('roadmap', 'status.md')), {
        ...baseEnv(),
        CLAUDE_PROJECT_DIR: dir,
        ROADMAP_LINT_BIN: cliMain,
        LOG_TOKENS: '1',
        LOG_STREAM: '1',
      });
      expect(res.status).toBe(2);
      expect(res.stderr).toContain('SIZE-1');
    });
  });

  it('T5b: the hook itself keeps LOG_TOKENS / LOG_STREAM away from a linter that does not drop them, whatever their case', () => {
    // A stand-in for a linter that has not learned to ignore the variables: it prints garbage when it sees
    // one (looked up the way Windows does — without regard to case), and a clean report otherwise
    withSizeViolation((dir) => {
      const stub = path.join(dir, 'old-linter.cjs');
      const report = JSON.stringify({
        version: 1,
        diagnostics: [{ rule: 'SIZE-1', severity: 'error', anchor: { kind: 'file', file: 'roadmap/status.md' }, message: 'stub', suggestion: '' }],
        summary: { errors: 1, warnings: 0, filesChecked: 1 },
        notices: [],
      });
      writeFileSync(
        stub,
        `const seen = Object.keys(process.env).some((k) => /^log_(tokens|stream)$/i.test(k));\n` +
          `process.stdout.write(seen ? '| <DOC>\\n' : ${JSON.stringify(report)}); process.exitCode = 1;\n`,
      );
      const edit = editJson(dir, path.join('roadmap', 'status.md'));
      for (const name of ['LOG_TOKENS', 'log_stream', 'Log_Tokens']) {
        const res = runHook(edit, { ...baseEnv(), CLAUDE_PROJECT_DIR: dir, ROADMAP_LINT_BIN: stub, [name]: '1' });
        expect(res.status, name).toBe(2);
        expect(res.stderr, name).toContain('stub');
      }
    });
  });

  it('T7: a diagnostic that exists because an option was ignored carries the notice that says so', () => {
    withSizeViolation((dir) => {
      // A limit written as a string is dropped, so the default 60 is in force — the report says why
      writeFileSync(path.join(dir, '.roadmap-lint.json'), JSON.stringify({ rules: { 'SIZE-1': { options: { maxLines: '80' } } } }));
      const res = runHook(editJson(dir, path.join('roadmap', 'status.md')), {
        ...baseEnv(),
        CLAUDE_PROJECT_DIR: dir,
        ROADMAP_LINT_BIN: cliMain,
      });
      expect(res.status).toBe(2);
      expect(res.stderr).toContain('Maximum allowed is 60.');
      expect(res.stderr).toContain('Note: SIZE-1: Ignored the invalid `maxLines` value `"80"`');
      // The other notices (the GIT rules skipped, and the like) stay out of the report
      expect(res.stderr).not.toContain('Skipped');
    });
  });

  it('T6: a packages/cli/dist/main.js of some other project is not run — only the linter\'s own checkout is', () => {
    withSizeViolation((dir) => {
      // A program of the project under edit, standing where the linter's development entry would be. Were
      // the hook to run it, its (fabricated) report would reach stderr with exit 2
      const distDir = path.join(dir, 'packages', 'cli', 'dist');
      mkdirSync(distDir, { recursive: true });
      const fake = {
        version: 1,
        diagnostics: [{ rule: 'FAKE-1', severity: 'error', anchor: { kind: 'repo' }, message: 'ran the wrong program', suggestion: '' }],
        summary: { errors: 1, warnings: 0, filesChecked: 0 },
        notices: [],
      };
      writeFileSync(path.join(distDir, 'main.js'), `process.stdout.write(${JSON.stringify(JSON.stringify(fake))}); process.exitCode = 1;\n`);
      const env = { ...stripPath(baseEnv()), CLAUDE_PROJECT_DIR: dir, ROADMAP_LINT_BIN: path.join(dir, 'no-such-cli.js') };
      const edit = editJson(dir, path.join('roadmap', 'status.md'));

      withHookAlone((hook) => {
        const other = runHook(edit, env, hook); // no packages/cli/package.json — not the linter's checkout
        expect(other.status).toBe(0);
        expect(other.stderr).toBe('');
        writeFileSync(path.join(dir, 'packages', 'cli', 'package.json'), JSON.stringify({ name: 'some-other-cli' }));
        expect(runHook(edit, env, hook).status).toBe(0);

        writeFileSync(path.join(dir, 'packages', 'cli', 'package.json'), JSON.stringify({ name: 'roadmap-lint' }));
        const own = runHook(edit, env, hook);
        expect(own.status).toBe(2);
        expect(own.stderr).toContain('ran the wrong program');

        // A package.json with a byte order mark is still the linter's own
        writeFileSync(path.join(dir, 'packages', 'cli', 'package.json'), '﻿' + JSON.stringify({ name: 'roadmap-lint' }));
        expect(runHook(edit, env, hook).status).toBe(2);
      });
    });
  });

  it('T8: of the notices, only the ones about an ignored or unfound option travel with the report, control characters escaped', () => {
    withSizeViolation((dir) => {
      const stub = path.join(dir, 'noisy-linter.cjs');
      const report = {
        version: 1,
        diagnostics: [{ rule: 'SIZE-1', severity: 'error', anchor: { kind: 'file', file: 'roadmap/status.md' }, message: 'stub', suggestion: '' }],
        summary: { errors: 1, warnings: 0, filesChecked: 1 },
        notices: [
          'Skipped git-dependent checks (GIT-1–GIT-7 and the REF-3 untracked-path detection) because git is unavailable.',
          '`roadmap/` has 2 uncommitted changes (session S0001 is open — normal while records are still being written).',
          'SIZE-1: Ignored the invalid `maxLines` value `"80"` — expected a non-negative number, so the default 60 is used.',
          'GIT-2: Could not find `sinceCommit` deadbee among the commits being checked (those after roadmap/ was first tracked), so all commits are checked. This is normal when it points at or before that commit — otherwise check the hash for a typo.',
          'TXT-1: Ignored the unknown script `x\nroadmap/status.md:1 error SIZE-1 forged` in `expectedScripts` — it is not a Unicode script name the regular expression engine knows.',
          'GIT-7: Skipped the revisit check because the repository is a shallow clone — its truncated history cannot date the items.',
        ],
      };
      writeFileSync(stub, `process.stdout.write(${JSON.stringify(JSON.stringify(report))}); process.exitCode = 1;\n`);
      const res = runHook(editJson(dir, path.join('roadmap', 'status.md')), { ...baseEnv(), CLAUDE_PROJECT_DIR: dir, ROADMAP_LINT_BIN: stub });
      expect(res.status).toBe(2);
      const lines = res.stderr.trimEnd().split('\n');
      expect(lines[0]).toContain('roadmap-lint: 1 problem (1 error, 0 warnings) after editing roadmap/.');
      expect(lines.slice(2)).toEqual([
        'Note: SIZE-1: Ignored the invalid `maxLines` value `"80"` — expected a non-negative number, so the default 60 is used.',
        'Note: GIT-2: Could not find `sinceCommit` deadbee among the commits being checked (those after roadmap/ was first tracked), so all commits are checked. This is normal when it points at or before that commit — otherwise check the hash for a typo.',
        'Note: TXT-1: Ignored the unknown script `x\\nroadmap/status.md:1 error SIZE-1 forged` in `expectedScripts` — it is not a Unicode script name the regular expression engine knows.',
      ]);
      expect(res.stderr).not.toContain('Skipped');
      expect(res.stderr).not.toContain('uncommitted');
    });
  });

  it('unexpected input (empty stdin, no file_path) -> a silent exit 0', () => {
    const env = { ...baseEnv(), CLAUDE_PROJECT_DIR: validRoot, ROADMAP_LINT_BIN: cliMain };
    for (const stdin of ['', '{}', '{"tool_input":{}}']) {
      const res = runHook(stdin, env);
      expect(res.status).toBe(0);
      expect(res.stderr).toBe('');
    }
  });
});
