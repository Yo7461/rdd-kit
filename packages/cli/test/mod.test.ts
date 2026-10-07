import { execFile, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { access, readdir, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EngineInterface, FsEntry, FsStat, On, ProcessRunResult, Register, SessionAppendInput, ToolCallResult, ToolSpec } from 'claude-code';
import { beforeAll, describe, expect, it } from 'vitest';
import { listViolationCases, materializeCase } from '../../core/src/testing/index.js';

// The plugin's hooks module (plugin/hooks/register.ts) run over a stand-in for the engine: `$` answers
// from Node — the real file system and the real git — and `on` collects the hooks, which the tests
// call the way the engine would. What is checked is the module's own behavior: when it lints, what it
// hands over to the result row, that a failure leaves the result untouched, and what the registered
// tool answers. That the engine wires the hooks as the module expects is what a run inside Claude
// Code shows; the module's imports — the copy under plugin/lib — load here through the test runner.
// The command hook of the npm package writes the same report to stderr, so the two are held together.

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const registerPath = path.join(repoRoot, 'plugin', 'hooks', 'register.ts');
const pluginName = (JSON.parse(readFileSync(path.join(repoRoot, 'plugin', '.claude-plugin', 'plugin.json'), 'utf8')) as { name: string }).name;
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
  const { register } = (await import(registerPath)) as { register: Register };
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

/** A stand-in for the engine interface over Node: the real file system under `cwd`, the real git, and recorders for what the module says and registers. */
function engineAt(
  cwd: string,
  overrides: Partial<{
    read: (p: string) => Promise<string>;
    list: (p?: string) => Promise<FsEntry[]>;
    run: (argv: readonly string[]) => Promise<ProcessRunResult>;
    register: (t: ToolSpec) => Promise<{ tool: string }>;
  }> = {},
) {
  const logged: string[] = [];
  const registered: ToolSpec[] = [];
  const ran: string[][] = [];
  let reads = 0;
  const $ = {
    session: { cwd: async () => cwd },
    fs: {
      read: async (p: string): Promise<string> => {
        reads++;
        return overrides.read ? overrides.read(p) : readFile(p, 'utf8');
      },
      list: async (p?: string): Promise<FsEntry[]> => {
        if (overrides.list) return overrides.list(p);
        return (await readdir(p ?? cwd, { withFileTypes: true })).map((entry) => ({ name: entry.name, kind: kindOf(entry), size: 0, mtimeMs: 0, isLink: entry.isSymbolicLink() }));
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
      run: (argv: readonly string[]): Promise<ProcessRunResult> => {
        ran.push([...argv]);
        if (overrides.run) return overrides.run(argv);
        return new Promise((resolve, reject) => {
          const [command = '', ...args] = argv;
          execFile(command, args, { encoding: 'utf8', cwd, windowsHide: true }, (error, stdout, stderr) => {
            if (error === null) resolve({ exitCode: 0, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false });
            else if (typeof error.code === 'number') resolve({ exitCode: error.code, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false });
            else reject(error);
          });
        });
      },
    },
    ui: { log: (text: string): void => void logged.push(text) },
    tool: {
      register: async (t: ToolSpec): Promise<{ tool: string }> => {
        if (overrides.register) return overrides.register(t);
        registered.push(t);
        return { tool: `mcp__${pluginName}__${t.name}` };
      },
    },
  } as unknown as EngineInterface;
  return { $, logged, registered, ran, reads: () => reads };
}

const editOf = (dir: string, file: string, id = 'toolu_01') => ({ tool: 'Edit' as const, tool_use_id: id, file_path: path.join(dir, file), old_string: 'a', new_string: 'b' });
const editResult = (): ToolCallResult => ({ result: { filePath: 'x' }, text: 'The file has been updated successfully.', ref: 1 });

/** One `session.append` of a tool-result row, as the engine raises it after the call: `content` is the row's blocks. */
function appendOf(blocks: SessionAppendInput['message']['content']): SessionAppendInput {
  return { message: { type: 'user', role: 'user', content: blocks }, door: 'tool-result', origin: { kind: 'tool', tool: 'Edit' }, uuid: 'row-1' };
}

async function runEdit(dir: string, file: string, $: EngineInterface, next: () => Promise<ToolCallResult> = async () => editResult(), id?: string) {
  const expected = await next();
  const answered = (await hookFor('tool.call', { tool: ['Edit', 'Write'] })($, editOf(dir, file, id), async () => expected)) as ToolCallResult;
  return { answered, expected };
}

/** What the module hands over for the row: the rewritten content of the tool_result block, or null when it left the row alone. */
async function runAppend($: EngineInterface, blocks: SessionAppendInput['message']['content']): Promise<unknown> {
  let seen: SessionAppendInput | null = null;
  const e = appendOf(blocks);
  await hookFor('session.append', { door: 'tool-result' })($, e, async (passed: SessionAppendInput) => {
    seen = passed;
    return { message: passed.message, uuid: passed.uuid };
  });
  const passed = seen as SessionAppendInput | null;
  if (passed === null) throw new Error('the hook did not call next');
  return passed === e ? null : passed.message.content[0]?.['content'];
}

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

describe('the hooks the module registers', () => {
  it('are the edit check, the row rewrite, the tool registration, and the tool itself', () => {
    expect(hooks.map((h) => `${h.event} ${JSON.stringify(h.matcher)}`)).toEqual([
      'tool.call {"tool":["Edit","Write"]}',
      'session.append {"door":"tool-result"}',
      'session.start undefined',
      `tool.call {"tool":"mcp__${pluginName}__roadmap_lint"}`,
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
      const { answered, expected } = await runEdit(dir, path.join('roadmap', 'status.md'), $);
      expect(answered).toBe(expected);
      expect(logged).toHaveLength(1);
      const report = logged[0] as string;
      expect(report.split('\n')[0]).toBe('roadmap-lint: 1 problem (1 error, 0 warnings) after editing roadmap/.');
      expect(report).toMatch(/^roadmap\/status\.md:\d+ error SIZE-1 /mu);
      expect(report).toContain('[Fix: ');

      // The row's content as a string, and as blocks
      expect(await runAppend($, [{ type: 'tool_result', tool_use_id: 'toolu_01', content: 'The file has been updated successfully.' }])).toBe(
        `The file has been updated successfully.\n\n${report}`,
      );
      // Handed over once: the next row with the same id is left alone
      expect(await runAppend($, [{ type: 'tool_result', tool_use_id: 'toolu_01', content: 'again' }])).toBeNull();

      await runEdit(dir, path.join('roadmap', 'status.md'), $, undefined, 'toolu_02');
      expect(await runAppend($, [{ type: 'tool_result', tool_use_id: 'toolu_02', content: [{ type: 'text', text: 'ok' }] }])).toEqual([
        { type: 'text', text: 'ok' },
        { type: 'text', text: report },
      ]);
      // A row of another call, and a row that is not a tool result, are left alone
      await runEdit(dir, path.join('roadmap', 'status.md'), $, undefined, 'toolu_03');
      expect(await runAppend($, [{ type: 'tool_result', tool_use_id: 'toolu_99', content: 'other' }])).toBeNull();
      expect(await runAppend($, [{ type: 'text', text: 'a prompt' }])).toBeNull();
      // The report of that call is still waiting for its row (the module keeps it until the row comes)
      expect(await runAppend($, [{ type: 'tool_result', tool_use_id: 'toolu_03', content: 'later' }])).toBe(`later\n\n${report}`);
    }));

  it('M1b: the report is the one the command hook writes to stderr', () =>
    withSizeViolation(async (dir) => {
      const { $, logged } = engineAt(dir);
      await runEdit(dir, path.join('roadmap', 'status.md'), $, undefined, 'toolu_1b');
      expect(await runAppend($, [{ type: 'tool_result', tool_use_id: 'toolu_1b', content: 'ok' }])).not.toBeNull();
      const env: NodeJS.ProcessEnv = { ...process.env, CLAUDE_PROJECT_DIR: dir, ROADMAP_LINT_BIN: cliMain };
      delete env['CLAUDE_PLUGIN_ROOT'];
      const res = spawnSync(process.execPath, [commandHook], {
        input: JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: path.join('roadmap', 'status.md') }, cwd: dir }),
        encoding: 'utf8',
        env,
        windowsHide: true,
      });
      expect(res.status).toBe(2);
      expect(res.stderr.trimEnd()).toBe(logged[0]);
    }));

  it('M2: with no diagnostics — nothing is logged, and the row is left alone', () =>
    withValid(async (dir) => {
      const { $, logged, reads } = engineAt(dir);
      const { answered, expected } = await runEdit(dir, path.join('roadmap', 'status.md'), $, undefined, 'toolu_m2');
      expect(answered).toBe(expected);
      expect(reads()).toBeGreaterThan(0);
      expect(logged).toEqual([]);
      expect(await runAppend($, [{ type: 'tool_result', tool_use_id: 'toolu_m2', content: 'ok' }])).toBeNull();
    }));

  it('M3: a file outside roadmap/ — nothing is read, nothing is logged, the row is left alone', () =>
    withSizeViolation(async (dir) => {
      const { $, logged, reads, ran } = engineAt(dir);
      for (const file of [path.join('src', 'main.ts'), 'roadmap.md', path.join('..', 'roadmap', 'status.md')]) {
        const { answered, expected } = await runEdit(dir, file, $, undefined, 'toolu_m3');
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
        const { answered, expected } = await runEdit(dir, path.join('roadmap', 'status.md'), $, async () => result, 'toolu_m4');
        expect(answered).toBe(expected);
      }
      expect(reads()).toBe(0);
      expect(logged).toEqual([]);
      expect(await runAppend($, [{ type: 'tool_result', tool_use_id: 'toolu_m4', content: 'ok' }])).toBeNull();
    }));

  it('M5: a lint that fails leaves the result untouched and says so in one line (fail-open)', () =>
    withSizeViolation(async (dir) => {
      // (git that cannot start is not a failure: the core reads it as "no git" and skips the GIT rules with a notice)
      const failures: [string, Parameters<typeof engineAt>[1], RegExp][] = [
        ['a file that cannot be read', { read: async () => { throw new Error('EACCES: permission denied'); } }, /^roadmap-lint: the check after editing roadmap\/ did not run — Error: EACCES: permission denied$/u],
        ['a directory that cannot be listed', { list: async () => { throw new Error('EIO: i/o error'); } }, /^roadmap-lint: the check after editing roadmap\/ did not run — Error: EIO: i\/o error$/u],
      ];
      for (const [name, overrides, line] of failures) {
        const { $, logged } = engineAt(dir, overrides);
        const { answered, expected } = await runEdit(dir, path.join('roadmap', 'status.md'), $, undefined, 'toolu_m5');
        expect(answered, name).toBe(expected);
        expect(logged, name).toHaveLength(1);
        expect(logged[0], name).toMatch(line);
        expect(await runAppend($, [{ type: 'tool_result', tool_use_id: 'toolu_m5', content: 'ok' }]), name).toBeNull();
      }
    }));
});

describe('the roadmap_lint tool', () => {
  const tool = () => hookFor('tool.call', { tool: `mcp__${pluginName}__roadmap_lint` });
  const call = ($: EngineInterface, args: Record<string, unknown>) =>
    tool()($, { tool: `mcp__${pluginName}__roadmap_lint`, tool_use_id: 'toolu_t', ...args }, async () => {
      throw new Error('the tool answers for itself');
    }) as Promise<ToolCallResult>;

  it('answers the text report of the working directory by default, and the JSON report on request', () =>
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

  it('refuses a path without roadmap/, a format it does not know, and a lint that fails — as an error result', () =>
    withSizeViolation(async (dir) => {
      const { $ } = engineAt(dir);
      expect((await call($, { path: 'src' })).deny).toMatch(/^Cannot find roadmap\/ under .*src\.$/u);
      expect((await call($, { format: 'xml' })).deny).toBe('The format must be either text or json.');
      expect((await call($, { path: 7 })).deny).toBe('The path must be a string.');
      const failing = engineAt(dir, { read: async () => { throw new Error('EIO'); } });
      expect((await call(failing.$, {})).deny).toBe('roadmap-lint could not run: Error: EIO');
    }));
});
