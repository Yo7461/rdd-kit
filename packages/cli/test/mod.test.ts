import { execFile, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { access, readdir, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { EngineInterface, FileToolName, FsEntry, FsStat, On, ProcessRunInit, ProcessRunResult, Register, SessionAppendInput, TimerCall, ToolCallResult, ToolSpec } from 'claude-code';
import { beforeAll, describe, expect, it } from 'vitest';
import { listViolationCases, materializeCase, withTempGitRepo } from '../../core/src/testing/index.js';

// The plugin's hooks module (plugin/hooks/register.ts) run over a stand-in for the engine: `$` answers
// from Node — the real file system and the real git — and `on` collects the hooks, which the tests
// call the way the engine would. What is checked is the module's own behavior: when it lints, what it
// hands over to the result row, that a failure leaves the result untouched, and what the registered
// tool answers. That the engine wires the hooks as the module expects is what a run inside Claude
// Code shows; the module's imports — the copy under plugin/lib — load here through the test runner
// (the copy's own portability is checked in bundle.test.ts). The command hook of the npm package
// writes the same report to stderr, so the two are held together.

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const registerPath = path.join(repoRoot, 'plugin', 'hooks', 'register.ts');
const pluginName = (JSON.parse(readFileSync(path.join(repoRoot, 'plugin', '.claude-plugin', 'plugin.json'), 'utf8')) as { name: string }).name;
const toolFullName = `mcp__${pluginName}__roadmap_lint`;
const commandHook = path.join(repoRoot, 'packages', 'cli', 'hooks', 'roadmap-lint-hook.mjs');
const cliMain = path.join(repoRoot, 'packages', 'cli', 'dist', 'main.js');
const fixturesRoot = path.join(repoRoot, 'fixtures');
const validRoot = path.join(fixturesRoot, 'valid');

type AnyHook = (...args: unknown[]) => unknown;
interface Collected {
  event: string;
  matcher: unknown;
  hook: AnyHook;
}

/** The hooks the module registers, as `on` received them. */
let hooks: Collected[] = [];
beforeAll(async () => {
  // The path is computed, so the type checker does not follow the import into the copy (it is checked by tsconfig.plugin.json)
  const { register } = (await import(pathToFileURL(registerPath).href)) as { register: Register };
  const on = ((event: string, a: unknown, b?: unknown): void => {
    if (typeof a === 'function') hooks.push({ event, matcher: undefined, hook: a as AnyHook });
    else hooks.push({ event, matcher: a, hook: b as AnyHook });
  }) as unknown as On;
  hooks = [];
  register(on, {});
});

function hookFor(event: string, matcher?: unknown): AnyHook {
  const found = hooks.find((h) => h.event === event && (matcher === undefined ? h.matcher === undefined : JSON.stringify(h.matcher) === JSON.stringify(matcher)));
  if (!found) throw new Error(`no hook on ${event} with matcher ${JSON.stringify(matcher)}`);
  return found.hook;
}

const kindOf = (s: { isFile(): boolean; isDirectory(): boolean }): FsEntry['kind'] => (s.isFile() ? 'file' : s.isDirectory() ? 'dir' : 'other');

type Overrides = Partial<{
  read: (p: string) => Promise<string>;
  list: (p?: string) => Promise<FsEntry[]>;
  /** Answers a command — `real` is the stand-in's own runner, for an override that only touches some commands */
  run: (argv: readonly string[], real: (argv: readonly string[]) => Promise<ProcessRunResult>) => Promise<ProcessRunResult>;
  after: TimerCall;
  register: (t: ToolSpec) => Promise<{ tool: string }>;
  root: () => Promise<string>;
  log: (text: string) => void;
}>;

/** A stand-in for the engine interface over Node: the real file system under `root`, the real git, and recorders for what the module says and registers. */
function engineAt(root: string, overrides: Overrides = {}) {
  const logged: string[] = [];
  const registered: ToolSpec[] = [];
  const ran: string[][] = [];
  const inits: (ProcessRunInit | undefined)[] = [];
  let reads = 0;
  const realRun = (argv: readonly string[]): Promise<ProcessRunResult> =>
    new Promise((resolve, reject) => {
      const [command = '', ...args] = argv;
      execFile(command, args, { encoding: 'utf8', cwd: root, windowsHide: true }, (error, stdout, stderr) => {
        if (error === null) resolve({ exitCode: 0, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false });
        else if (typeof error.code === 'number') resolve({ exitCode: error.code, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false });
        else reject(error);
      });
    });
  const $ = {
    session: { cwd: async () => root, root: overrides.root ?? (async () => root) },
    fs: {
      read: async (p: string): Promise<string> => {
        reads++;
        return overrides.read ? overrides.read(p) : readFile(p, 'utf8');
      },
      list: async (p?: string): Promise<FsEntry[]> => {
        if (overrides.list) return overrides.list(p);
        return (await readdir(p ?? root, { withFileTypes: true })).map((entry) => ({ name: entry.name, kind: kindOf(entry), size: 0, mtimeMs: 0, isLink: entry.isSymbolicLink() }));
      },
      exists: async (p: string): Promise<boolean> => {
        try {
          await access(p);
          return true;
        } catch {
          return false;
        }
      },
      stat: async (p: string): Promise<FsStat> => {
        const s = await stat(p); // rejects when missing, as the engine does
        return { kind: kindOf(s), size: s.size, mtimeMs: s.mtimeMs, isLink: false };
      },
    },
    process: {
      run: (argv: readonly string[], init?: ProcessRunInit): Promise<ProcessRunResult> => {
        ran.push([...argv]);
        inits.push(init);
        return overrides.run ? overrides.run(argv, realRun) : realRun(argv);
      },
    },
    clock: {
      after:
        overrides.after ??
        ((ms: number, fn: () => void) => {
          const timer = setTimeout(fn, ms);
          timer.unref();
          return { cancel: () => clearTimeout(timer) };
        }),
    },
    ui: { log: overrides.log ?? ((text: string): void => void logged.push(text)) },
    tool: {
      register: async (t: ToolSpec): Promise<{ tool: string }> => {
        if (overrides.register) return overrides.register(t);
        registered.push(t);
        return { tool: `mcp__${pluginName}__${t.name}` };
      },
    },
  } as unknown as EngineInterface;
  return { $, logged, registered, ran, inits, reads: () => reads };
}

/** A timer that fires at once: the deadline of a check comes first */
const atOnce: TimerCall = (_ms, fn) => {
  queueMicrotask(fn);
  return { cancel: () => undefined };
};

const editOf = (dir: string, file: string, id: string) => ({ tool: 'Edit' as const, tool_use_id: id, file_path: path.join(dir, file), old_string: 'a', new_string: 'b' });
const writeOf = (dir: string, file: string, id: string) => ({ tool: 'Write' as const, tool_use_id: id, file_path: path.join(dir, file), content: 'b' });
const editResult = (): ToolCallResult => ({ result: { filePath: 'x' }, text: 'The file has been updated successfully.', ref: 1 });

/** One `session.append` of a tool-result row, as the engine raises it after the call: `content` is the row's blocks. */
function appendOf(blocks: SessionAppendInput['message']['content'], tool: FileToolName = 'Edit'): SessionAppendInput {
  return { message: { type: 'user', role: 'user', content: blocks }, door: 'tool-result', origin: { kind: 'tool', tool }, uuid: 'row-1' };
}

async function runEdit(dir: string, file: string, $: EngineInterface, id: string, next: () => Promise<ToolCallResult> = async () => editResult()) {
  const expected = await next();
  const answered = (await hookFor('tool.call', { tool: ['Edit', 'Write'] })($, editOf(dir, file, id), async () => expected)) as ToolCallResult;
  return { answered, expected };
}

/**
 * What the module did with a row: the blocks it passed to `next` (null when it passed the row as it came),
 * and whether it relayed `next`'s answer unchanged — the engine skips a hook that answers anything else.
 */
async function runAppend($: EngineInterface, blocks: SessionAppendInput['message']['content'], tool: FileToolName = 'Edit') {
  let seen: SessionAppendInput | null = null;
  const e = appendOf(blocks, tool);
  const stored = { message: e.message, uuid: e.uuid };
  const answered = await hookFor('session.append', { door: 'tool-result' })($, e, async (passed: SessionAppendInput) => {
    seen = passed;
    return stored;
  });
  const passed = seen as SessionAppendInput | null;
  if (passed === null) throw new Error('the hook did not call next');
  expect(answered, 'the hook relays what next answered').toBe(stored);
  return passed === e ? null : passed.message.content;
}

const bodyOf = (content: SessionAppendInput['message']['content'] | null, index = 0): unknown => content?.[index]?.['content'];

function withSizeViolation<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const found = listViolationCases(fixturesRoot).find((c) => c.ruleId === 'SIZE-1');
  if (!found) throw new Error('violations/SIZE-1 does not exist');
  const { dir, cleanup } = materializeCase(validRoot, found.overlayDir);
  return fn(dir).finally(cleanup);
}

async function withValid<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  // A copy outside this repository's git, so the GIT rules do not judge the host history
  const dir = mkdtempSync(path.join(tmpdir(), 'rdd-kit-mod-valid-'));
  cpSync(validRoot, dir, { recursive: true });
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  }
}

/** The valid corpus as a tree, for a temporary git repository. */
function validTree(): Record<string, string> {
  const tree: Record<string, string> = {};
  const walk = (rel: string): void => {
    for (const entry of readdirSync(path.join(validRoot, rel), { withFileTypes: true })) {
      const next = rel === '' ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(next);
      else tree[next] = readFileSync(path.join(validRoot, next), 'utf8');
    }
  };
  walk('');
  return tree;
}

/** The command hook of the npm package over the same directory: its stderr, trimmed. */
function commandHookReport(dir: string): string {
  const env: NodeJS.ProcessEnv = { ...process.env, CLAUDE_PROJECT_DIR: dir, ROADMAP_LINT_BIN: cliMain };
  const res = spawnSync(process.execPath, [commandHook], {
    input: JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: path.join('roadmap', 'status.md') }, cwd: dir }),
    encoding: 'utf8',
    env,
    windowsHide: true,
  });
  expect(res.status).toBe(2);
  return res.stderr.trimEnd();
}

describe('the hooks the module registers', () => {
  it('are the edit check, the row rewrite, the tool registration, and the tool itself', () => {
    expect(hooks.map((h) => `${h.event} ${JSON.stringify(h.matcher)}`)).toEqual([
      'tool.call {"tool":["Edit","Write"]}',
      'session.append {"door":"tool-result"}',
      'session.start undefined',
      `tool.call {"tool":"${toolFullName}"}`,
    ]);
  });

  it('session.start registers the roadmap_lint tool with a path and a format, and still calls next', async () => {
    const { $, registered, logged } = engineAt('C:/anywhere');
    const e = { cwd: 'C:/anywhere', surface: null, isInteractive: false };
    const answered = await hookFor('session.start')($, e, async () => ({ cwd: e.cwd }));
    expect(answered).toEqual({ cwd: 'C:/anywhere' });
    expect(registered.map((t) => t.name)).toEqual(['roadmap_lint']);
    expect(registered[0]?.description).toContain('roadmap-lint');
    expect(Object.keys((registered[0]?.inputSchema as { properties: object }).properties).sort()).toEqual(['format', 'path']);
    expect(logged).toEqual([]);
  });

  it('session.start says so in the transcript when the registration is refused, and still calls next', async () => {
    const { $, logged } = engineAt('C:/anywhere', { register: async () => { throw new Error('not yet bound'); } });
    let called = false;
    await hookFor('session.start')($, { cwd: 'C:/anywhere', surface: null, isInteractive: true }, async () => {
      called = true;
      return { cwd: 'C:/anywhere' };
    });
    expect(called).toBe(true);
    expect(logged).toEqual(['roadmap-lint: the roadmap_lint tool could not be registered — Error: not yet bound']);
  });
});

describe('the check after an Edit or Write under roadmap/', () => {
  it('M1: with diagnostics — the result is returned as it is, the report is logged, and it joins the body of the tool_result row by the call\'s id', () =>
    withSizeViolation(async (dir) => {
      const { $, logged } = engineAt(dir);
      const { answered, expected } = await runEdit(dir, path.join('roadmap', 'status.md'), $, 'toolu_01');
      expect(answered).toBe(expected);
      expect(logged).toHaveLength(1);
      const report = logged[0] as string;
      expect(report.split('\n')[0]).toBe('roadmap-lint: 1 problem (1 error, 0 warnings) after editing roadmap/.');
      expect(report).toMatch(/^roadmap\/status\.md:\d+ error SIZE-1 /mu);
      expect(report).toContain('[Fix: ');

      // The row's content as a string
      expect(bodyOf(await runAppend($, [{ type: 'tool_result', tool_use_id: 'toolu_01', content: 'The file has been updated successfully.' }]))).toBe(
        `The file has been updated successfully.\n\n${report}`,
      );
      // Handed over once: the next row with the same id is left alone
      expect(await runAppend($, [{ type: 'tool_result', tool_use_id: 'toolu_01', content: 'again' }])).toBeNull();

      // As blocks, and with no content at all
      await runEdit(dir, path.join('roadmap', 'status.md'), $, 'toolu_02');
      expect(bodyOf(await runAppend($, [{ type: 'tool_result', tool_use_id: 'toolu_02', content: [{ type: 'text', text: 'ok' }] }]))).toEqual([
        { type: 'text', text: 'ok' },
        { type: 'text', text: report },
      ]);
      await runEdit(dir, path.join('roadmap', 'status.md'), $, 'toolu_02b');
      expect(bodyOf(await runAppend($, [{ type: 'tool_result', tool_use_id: 'toolu_02b' }]))).toEqual([{ type: 'text', text: report }]);

      // A row of two results rewrites the one the report belongs to; a row of another call, and a row
      // that is not a tool result, are left alone; the report waits for its row as long as it takes
      await runEdit(dir, path.join('roadmap', 'status.md'), $, 'toolu_03');
      expect(await runAppend($, [{ type: 'tool_result', tool_use_id: 'toolu_99', content: 'other' }])).toBeNull();
      expect(await runAppend($, [{ type: 'text', text: 'a prompt' }])).toBeNull();
      const two = await runAppend($, [
        { type: 'tool_result', tool_use_id: 'toolu_98', content: 'first' },
        { type: 'tool_result', tool_use_id: 'toolu_03', content: 'later' },
      ]);
      expect(two?.map((block) => block['content'])).toEqual(['first', `later\n\n${report}`]);
    }));

  it('M1b: the report is the one the command hook writes to stderr — the notice about an ignored option included', () =>
    withSizeViolation(async (dir) => {
      const configs: (object | undefined)[] = [undefined, { rules: { 'SIZE-1': { options: { maxLines: '80' } } } }];
      for (const [index, config] of configs.entries()) {
        if (config !== undefined) writeFileSync(path.join(dir, '.roadmap-lint.json'), JSON.stringify(config));
        const { $, logged } = engineAt(dir);
        const id = `toolu_1b${index}`;
        await runEdit(dir, path.join('roadmap', 'status.md'), $, id);
        expect(logged, `config ${index}`).toHaveLength(1);
        if (config !== undefined) expect(logged[0]).toContain('Note: SIZE-1: Ignored the invalid `maxLines` value `"80"`');
        expect(commandHookReport(dir), `config ${index}`).toBe(logged[0]);
        expect(await runAppend($, [{ type: 'tool_result', tool_use_id: id, content: 'ok' }])).not.toBeNull();
      }
    }));

  it('M1c: a Write under roadmap/ is checked like an Edit — its input has a content and no strings — and the report joins the row of a Write result', () =>
    withSizeViolation(async (dir) => {
      const { $, logged } = engineAt(dir);
      const expected = editResult();
      const answered = await hookFor('tool.call', { tool: ['Edit', 'Write'] })($, writeOf(dir, path.join('roadmap', 'status.md'), 'toolu_w1'), async () => expected);
      expect(answered).toBe(expected);
      expect(logged).toHaveLength(1);
      const report = logged[0] as string;
      expect(report.split('\n')[0]).toBe('roadmap-lint: 1 problem (1 error, 0 warnings) after editing roadmap/.');
      expect(bodyOf(await runAppend($, [{ type: 'tool_result', tool_use_id: 'toolu_w1', content: 'File created successfully.' }], 'Write'))).toBe(
        `File created successfully.\n\n${report}`,
      );
      expect(await runAppend($, [{ type: 'tool_result', tool_use_id: 'toolu_w1', content: 'again' }], 'Write')).toBeNull();
    }));

  it('M2: with no diagnostics — nothing is logged, and the row is left alone', () =>
    withValid(async (dir) => {
      const { $, logged, reads } = engineAt(dir);
      const { answered, expected } = await runEdit(dir, path.join('roadmap', 'status.md'), $, 'toolu_m2');
      expect(answered).toBe(expected);
      expect(reads()).toBeGreaterThan(0);
      expect(logged).toEqual([]);
      expect(await runAppend($, [{ type: 'tool_result', tool_use_id: 'toolu_m2', content: 'ok' }])).toBeNull();
    }));

  it('M3: a file outside roadmap/ — nothing is read, nothing is logged, the row is left alone', () =>
    withSizeViolation(async (dir) => {
      const { $, logged, reads, ran } = engineAt(dir);
      for (const file of [path.join('src', 'main.ts'), 'roadmap.md', path.join('..', 'roadmap', 'status.md')]) {
        const { answered, expected } = await runEdit(dir, file, $, 'toolu_m3');
        expect(answered, file).toBe(expected);
      }
      expect(reads()).toBe(0);
      expect(ran).toEqual([]);
      expect(logged).toEqual([]);
      expect(await runAppend($, [{ type: 'tool_result', tool_use_id: 'toolu_m3', content: 'ok' }])).toBeNull();
    }));

  it('M4: a refused or failed edit is not checked', () =>
    withSizeViolation(async (dir) => {
      const { $, logged, reads } = engineAt(dir);
      for (const result of [{ deny: 'no' }, { isError: true as const, result: 'failed', text: 'failed' }] as ToolCallResult[]) {
        const { answered, expected } = await runEdit(dir, path.join('roadmap', 'status.md'), $, 'toolu_m4', async () => result);
        expect(answered).toBe(expected);
      }
      expect(reads()).toBe(0);
      expect(logged).toEqual([]);
      expect(await runAppend($, [{ type: 'tool_result', tool_use_id: 'toolu_m4', content: 'ok' }])).toBeNull();
    }));

  it('M5: a lint that fails or outruns its deadline leaves the result untouched and says so in one line (fail-open)', () =>
    withSizeViolation(async (dir) => {
      // (git that cannot start is not a failure: the core reads it as "no git" and skips the GIT rules with a notice)
      const failures: [string, Overrides, RegExp][] = [
        ['a file that cannot be read', { read: async () => { throw new Error('EACCES: permission denied'); } }, /^roadmap-lint: the check after editing roadmap\/ did not run — Error: EACCES: permission denied$/u],
        ['a directory that cannot be listed', { list: async () => { throw new Error('EIO: i/o error'); } }, /^roadmap-lint: the check after editing roadmap\/ did not run — Error: EIO: i\/o error$/u],
        ['a check past its deadline', { after: atOnce }, /^roadmap-lint: the check after editing roadmap\/ did not run — Error: the check took longer than 20000 ms$/u],
      ];
      for (const [name, overrides, line] of failures) {
        const { $, logged } = engineAt(dir, overrides);
        const { answered, expected } = await runEdit(dir, path.join('roadmap', 'status.md'), $, 'toolu_m5');
        expect(answered, name).toBe(expected);
        expect(logged, name).toHaveLength(1);
        expect(logged[0], name).toMatch(line);
        expect(await runAppend($, [{ type: 'tool_result', tool_use_id: 'toolu_m5', content: 'ok' }]), name).toBeNull();
      }
    }));

  it('M6: inside a git repository the GIT rules run through $.process.run, and an output the engine cut short is a failure, not a report', () =>
    withTempGitRepo(validTree(), async (repoDir) => {
      const { $, logged, ran, inits } = engineAt(repoDir);
      await runEdit(repoDir, path.join('roadmap', 'status.md'), $, 'toolu_m6');
      expect(ran.some((argv) => argv[0] === 'git' && argv.includes('--no-optional-locks') && argv.includes('ls-files'))).toBe(true);
      // Every git runs with the lazy fetch of a partial clone off: the check reads only what the clone holds
      expect(inits.length).toBe(ran.length);
      expect(inits.every((init) => init?.env?.['GIT_NO_LAZY_FETCH'] === '1')).toBe(true);
      expect(logged).toHaveLength(1);
      // The fixture's hashes are not in this repository's history (the one commit that first tracked roadmap/ is exempt from the subject rule)
      expect(logged[0]).toContain('error GIT-6');
      expect(await runAppend($, [{ type: 'tool_result', tool_use_id: 'toolu_m6', content: 'ok' }])).not.toBeNull();

      const cut = engineAt(repoDir, {
        run: async (argv, real) => {
          const ran = await real(argv);
          return argv.includes('ls-files') ? { ...ran, isStdoutTruncated: true } : ran;
        },
      });
      const { answered, expected } = await runEdit(repoDir, path.join('roadmap', 'status.md'), cut.$, 'toolu_m6b');
      expect(answered).toBe(expected);
      expect(cut.logged).toEqual(['roadmap-lint: the check after editing roadmap/ did not run — Error: The output of git exceeds what the engine hands over (4 MiB).']);
    }));

  it('M8: a project root that cannot be read, and a transcript line that cannot be written, leave the result untouched (fail-open)', () =>
    withSizeViolation(async (dir) => {
      const noRoot = engineAt(dir, { root: async () => { throw new Error('no session'); } });
      const { answered, expected } = await runEdit(dir, path.join('roadmap', 'status.md'), noRoot.$, 'toolu_m8');
      expect(answered).toBe(expected);
      expect(noRoot.logged).toEqual(['roadmap-lint: the check after editing roadmap/ did not run — Error: no session']);
      expect(await runAppend(noRoot.$, [{ type: 'tool_result', tool_use_id: 'toolu_m8', content: 'ok' }])).toBeNull();

      const noLog = engineAt(dir, { log: () => { throw new Error('no transcript'); } });
      const again = await runEdit(dir, path.join('roadmap', 'status.md'), noLog.$, 'toolu_m8b');
      expect(again.answered).toBe(again.expected);
      // The report still reaches the row
      expect(bodyOf(await runAppend(noLog.$, [{ type: 'tool_result', tool_use_id: 'toolu_m8b', content: 'ok' }]))).toMatch(/^ok\n\nroadmap-lint: 1 problem /u);
    }));

  it.runIf(process.platform === 'win32')('M7: on Windows a path that differs in case is still under roadmap/', () =>
    withSizeViolation(async (dir) => {
      const { $, logged } = engineAt(dir);
      await runEdit(dir.toUpperCase(), path.join('ROADMAP', 'STATUS.MD'), $, 'toolu_m7');
      expect(logged).toHaveLength(1);
      expect(logged[0]).toContain('SIZE-1');
      expect(await runAppend($, [{ type: 'tool_result', tool_use_id: 'toolu_m7', content: 'ok' }])).not.toBeNull();
    }));
});

describe('the roadmap_lint tool', () => {
  const call = ($: EngineInterface, args: Record<string, unknown>) =>
    hookFor('tool.call', { tool: toolFullName })($, { tool: toolFullName, tool_use_id: 'toolu_t', ...args }, async () => {
      throw new Error('the tool answers for itself');
    }) as Promise<ToolCallResult>;

  it('answers the text report of the project root by default, and the JSON report on request', () =>
    withSizeViolation(async (dir) => {
      const { $, logged } = engineAt(dir);
      const text = await call($, {});
      expect(text.deny).toBeUndefined();
      // The CLI's text report: a 1-based position, the summary line, then the notices
      expect(text.result).toMatch(/^roadmap\/status\.md:\d+:\d+ error SIZE-1 /u);
      expect(text.result).toMatch(/\n1 problem \(1 error, 0 warnings\) in \d+ files\.\n/u);

      const json = await call($, { format: 'json', path: 'roadmap' });
      const report = JSON.parse(json.result as string) as { version: number; diagnostics: { rule: string }[]; summary: { errors: number } };
      expect(report.version).toBe(1);
      expect(report.diagnostics.map((d) => d.rule)).toEqual(['SIZE-1']);
      expect(report.summary.errors).toBe(1);
      expect(logged).toEqual([]);
    }));

  it('refuses a path without roadmap/, an argument of the wrong shape, and a lint that fails or outruns its deadline — as an error result', () =>
    withSizeViolation(async (dir) => {
      const { $ } = engineAt(dir);
      expect((await call($, { path: 'src' })).deny).toMatch(/^Cannot find roadmap\/ under .*src\.$/u);
      expect((await call($, { format: 'xml' })).deny).toBe('The format must be either text or json.');
      expect((await call($, { format: null })).deny).toBe('The format must be either text or json.');
      expect((await call($, { path: 7 })).deny).toBe('The path must be a string.');
      expect((await call($, { path: null })).deny).toBe('The path must be a string.');
      const failing = engineAt(dir, { read: async () => { throw new Error('EIO'); } });
      expect((await call(failing.$, {})).deny).toBe('roadmap-lint could not run: Error: EIO');
      const late = engineAt(dir, { after: atOnce });
      expect((await call(late.$, {})).deny).toBe('roadmap-lint could not run: Error: the check took longer than 60000 ms');
      const noRoot = engineAt(dir, { root: async () => { throw new Error('no session'); } });
      expect((await call(noRoot.$, {})).deny).toBe('roadmap-lint could not run: Error: no session');
    }));
});
