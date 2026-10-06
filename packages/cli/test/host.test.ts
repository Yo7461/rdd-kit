import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { nodeHost as harnessHost } from '../../core/src/testing/node-host.js';
import { nodeHost as cliHost } from '../src/host.js';

// The Node implementation of the core's Host exists twice on purpose — the CLI's and the test
// harness's — because the core itself carries no Node and the two packages cannot share a file. This
// test runs both over the same tree and the same commands, so the two cannot drift apart unnoticed,
// and pins the behavior the core relies on: kinds, missing paths, exit codes, and a command that
// cannot start

const dir = mkdtempSync(path.join(tmpdir(), 'roadmap-lint-host-'));
afterAll(() => rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));

mkdirSync(path.join(dir, 'sub'));
writeFileSync(path.join(dir, 'a.md'), 'alpha\n');
writeFileSync(path.join(dir, 'sub', 'b.md'), 'beta\n');
let hasLink = false;
try {
  symlinkSync(path.join(dir, 'a.md'), path.join(dir, 'link.md'));
  hasLink = true;
} catch {
  // Creating a symbolic link needs a privilege on Windows that a plain account may lack — those checks are skipped then
}

const hosts = [
  ['the CLI host', cliHost],
  ['the harness host', harnessHost],
] as const;

describe.each(hosts)('%s', (_name, host) => {
  it('reads text, answers exists, and lists a directory with the kind of every entry', async () => {
    expect(await host.readText(path.join(dir, 'a.md'))).toBe('alpha\n');
    expect(await host.exists(path.join(dir, 'a.md'))).toBe(true);
    expect(await host.exists(path.join(dir, 'sub'))).toBe(true);
    expect(await host.exists(path.join(dir, 'missing.md'))).toBe(false);
    const listed = (await host.listDir(dir)).map((entry) => `${entry.name}:${entry.kind}`).sort();
    expect(listed).toEqual(hasLink ? ['a.md:file', 'link.md:other', 'sub:dir'] : ['a.md:file', 'sub:dir']);
  });

  it('stats a path by what it leads to, null when there is nothing there', async () => {
    expect(await host.stat(path.join(dir, 'a.md'))).toEqual({ kind: 'file' });
    expect(await host.stat(path.join(dir, 'sub'))).toEqual({ kind: 'dir' });
    expect(await host.stat(path.join(dir, 'missing'))).toBeNull();
    if (hasLink) expect(await host.stat(path.join(dir, 'link.md'))).toEqual({ kind: 'file' }); // followed
  });

  it('rejects a read of a missing file and a listing of a missing directory', async () => {
    await expect(host.readText(path.join(dir, 'missing.md'))).rejects.toThrow();
    await expect(host.listDir(path.join(dir, 'missing'))).rejects.toThrow();
  });

  it('runs a command and resolves whatever its exit code, with its output', async () => {
    const ok = await host.run([process.execPath, '-e', "process.stdout.write('out'); process.stderr.write('err')"]);
    expect(ok).toEqual({ exitCode: 0, stdout: 'out', stderr: 'err' });
    const failed = await host.run([process.execPath, '-e', "process.stdout.write('partial'); process.exit(3)"]);
    expect(failed).toEqual({ exitCode: 3, stdout: 'partial', stderr: '' });
  });

  it('closes the child stdin, so a command that reads it finishes', async () => {
    const read = await host.run([
      process.execPath,
      '-e',
      "let n = 0; process.stdin.on('data', (c) => { n += c.length }); process.stdin.on('end', () => { process.stdout.write(`eof:${n}`) })",
    ]);
    expect(read).toEqual({ exitCode: 0, stdout: 'eof:0', stderr: '' });
  });

  it('rejects a command that cannot start', async () => {
    await expect(host.run(['roadmap-lint-no-such-command-7f3a', '--version'])).rejects.toThrow();
  });
});

describe('the two hosts', () => {
  it('give the same answers over the same tree', async () => {
    const probe = async (host: typeof cliHost) => ({
      text: await host.readText(path.join(dir, 'sub', 'b.md')),
      listed: (await host.listDir(dir)).sort((a, b) => a.name.localeCompare(b.name)),
      stat: await host.stat(path.join(dir, 'sub')),
      exists: [await host.exists(dir), await host.exists(path.join(dir, 'nope'))],
      run: await host.run([process.execPath, '-e', 'process.exit(2)']),
    });
    expect(await probe(cliHost)).toEqual(await probe(harnessHost));
  });
});
