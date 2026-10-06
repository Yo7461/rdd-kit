import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectGitInfo, isUncommittedHash, parseBlamePorcelain, UNCOMMITTED_HASH } from '../src/corpus/git.js';
import { lintDir, nodeHost, withTempGitRepo } from '../src/testing/index.js';

function hasGit(): boolean {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(!hasGit())('the temporary git repository helper', () => {
  it('writes the tree and puts it into one commit', async () => {
    let seenDir = '';
    await withTempGitRepo({ 'roadmap/status.md': 'x\n', 'a/b.txt': 'y\n' }, (repoDir) => {
      seenDir = repoDir;
      const files = execFileSync('git', ['-C', repoDir, 'ls-files'], { encoding: 'utf8' })
        .trim()
        .split('\n')
        .sort();
      expect(files).toEqual(['a/b.txt', 'roadmap/status.md']);
      const commits = execFileSync('git', ['-C', repoDir, 'rev-list', '--count', 'HEAD'], {
        encoding: 'utf8',
      }).trim();
      expect(commits).toBe('1');
    });
    expect(existsSync(seenDir)).toBe(false);
  });

  it('returns what fn returns, and works on an empty tree', async () => {
    expect(await withTempGitRepo({}, () => 42)).toBe(42);
  });

  it('collects headHashes: every commit reachable from HEAD, the boundary commit included', async () => {
    await withTempGitRepo({ 'roadmap/status.md': 'x\n' }, async (repoDir) => {
      const info = await collectGitInfo(repoDir, nodeHost);
      expect(info?.headHashes).toHaveLength(1);
      expect(info?.headHashes[0]).toMatch(/^[0-9a-f]{40}$/);
      // The commit that first tracked roadmap/ is outside `commits` but inside headHashes
      expect(info?.commits).toEqual([]);
    });
  });
});

describe.skipIf(!hasGit())('collectGitInfo only reads (--no-optional-locks)', () => {
  it('leaves .git/index byte for byte as it was, even when the cached stat data is stale', async () => {
    await withTempGitRepo({ 'roadmap/status.md': '---\ncurrent_phase: P0001\n---\n# Status\n' }, async (dir) => {
      // A fresh mtime on unchanged content: `git status` would refresh the index's stat cache and write
      // the index back, taking index.lock — unless it is told that the lock is optional and not to be taken
      const later = new Date(Date.now() + 60_000);
      utimesSync(path.join(dir, 'roadmap', 'status.md'), later, later);
      const indexPath = path.join(dir, '.git', 'index');
      const before = readFileSync(indexPath);
      const info = await collectGitInfo(dir, nodeHost);
      expect(info).not.toBeNull();
      expect(info?.uncommittedRoadmapPaths).toEqual([]);
      expect(readFileSync(indexPath).equals(before)).toBe(true);
      expect(existsSync(path.join(dir, '.git', 'index.lock'))).toBe(false);
    });
  });
});

describe('parseBlamePorcelain (GIT-7)', () => {
  it('reads the hash, the committer time and zone of every line, header groups and repeated groups alike, and skips the author headers', () => {
    const a = 'a'.repeat(40);
    const b = 'b'.repeat(40);
    const raw = [
      `${a} 1 1 2`,
      'author Someone',
      'author-mail <someone@example.com>',
      'author-time 1000',
      'author-tz +0000',
      'committer Someone Else',
      'committer-mail <else@example.com>',
      'committer-time 1700000000',
      'committer-tz +0900',
      'summary [S0001] init',
      'filename roadmap/roadmap.md',
      '\t- one',
      `${a} 2 2`,
      '\t- two',
      `${b} 1 3 1`,
      'author Someone',
      'author-mail <someone@example.com>',
      'author-time 2000',
      'author-tz +0000',
      'committer Someone',
      'committer-mail <someone@example.com>',
      'committer-time 1800000000',
      'committer-tz +0000',
      'summary [S0002] later',
      'previous ' + a + ' roadmap/roadmap.md',
      'filename roadmap/roadmap.md',
      '\t- three',
      `${UNCOMMITTED_HASH} 4 4 1`,
      'author Not Committed Yet',
      'author-mail <not.committed.yet>',
      'author-time 1900000000',
      'author-tz +0000',
      'committer Not Committed Yet',
      'committer-mail <not.committed.yet>',
      'committer-time 1900000000',
      'committer-tz +0000',
      'summary Version of roadmap/roadmap.md from roadmap/roadmap.md',
      'previous ' + b + ' roadmap/roadmap.md',
      'filename roadmap/roadmap.md',
      '\t- four (uncommitted)',
      '',
    ].join('\n');
    expect(parseBlamePorcelain(raw)).toEqual([
      { hash: a, committerTime: 1700000000, committerTz: '+0900' },
      { hash: a, committerTime: 1700000000, committerTz: '+0900' },
      { hash: b, committerTime: 1800000000, committerTz: '+0000' },
      { hash: UNCOMMITTED_HASH, committerTime: 0, committerTz: '' },
    ]);
    expect(parseBlamePorcelain('')).toEqual([]);
  });

  it('accepts the 64-digit hashes of a SHA-256 repository, with its all-zero hash for an uncommitted line', () => {
    const a = 'a'.repeat(64);
    const zero = '0'.repeat(64);
    const raw = [
      `${a} 1 1 1`,
      'author X',
      'committer-time 1700000000',
      'committer-tz +0000',
      'filename f',
      '\tone',
      `${zero} 2 2 1`,
      'author Not Committed Yet',
      'committer-time 1900000000',
      'committer-tz +0000',
      'filename f',
      '\ttwo',
      '',
    ].join('\n');
    expect(parseBlamePorcelain(raw)).toEqual([
      { hash: a, committerTime: 1700000000, committerTz: '+0000' },
      { hash: zero, committerTime: 0, committerTz: '' },
    ]);
    expect(isUncommittedHash(zero)).toBe(true);
    expect(isUncommittedHash(UNCOMMITTED_HASH)).toBe(true);
    expect(isUncommittedHash(a)).toBe(false);
  });
});

describe.skipIf(!hasGit())('GitInfo.lineHistory and GitInfo.shallow (GIT-7)', () => {
  it('lineHistory: reads blame once per file ahead of the rules, returns null for an untracked or unloaded file, and marks working-tree changes', async () => {
    await withTempGitRepo({ 'roadmap/roadmap.md': '- one\n- two\n' }, async (repoDir) => {
      const info = await collectGitInfo(repoDir, nodeHost);
      expect(info).not.toBeNull();
      expect(info?.shallow).toBe(false);
      const head = execFileSync('git', ['-C', repoDir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
      expect(info?.lineHistory('roadmap/roadmap.md')).toBeNull(); // not loaded yet
      await info?.loadLineHistory(['roadmap/roadmap.md', 'roadmap/status.md']);
      const history = info?.lineHistory('roadmap/roadmap.md');
      expect(history).toHaveLength(2);
      expect(history?.[0]?.hash).toBe(head);
      expect(history?.[0]?.committerTime).toBeGreaterThan(0);
      expect(history?.[0]?.committerTz).toMatch(/^[+-]\d{4}$/);
      await info?.loadLineHistory(['roadmap/roadmap.md']);
      expect(info?.lineHistory('roadmap/roadmap.md')).toBe(history); // memoized — loaded once
      expect(info?.lineHistory('roadmap/status.md')).toBeNull(); // not tracked

      writeFileSync(path.join(repoDir, 'roadmap', 'roadmap.md'), '- one\n- two (edited)\n- three\n');
      const again = await collectGitInfo(repoDir, nodeHost);
      await again?.loadLineHistory(['roadmap/roadmap.md']);
      const changed = again?.lineHistory('roadmap/roadmap.md');
      expect(changed?.map((h) => h.hash)).toEqual([head, UNCOMMITTED_HASH, UNCOMMITTED_HASH]);
    });
  });

  it('shallow: true on a depth-1 clone (whose blame would date every line at the grafted commit)', async () => {
    await withTempGitRepo({ 'roadmap/roadmap.md': '- one\n' }, async (repoDir) => {
      const git = (...args: string[]) =>
        execFileSync('git', ['-C', repoDir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      writeFileSync(path.join(repoDir, 'roadmap', 'roadmap.md'), '- one\n- two\n');
      git('add', '-A');
      git('commit', '-q', '-m', '[S0002] second');
      const cloneDir = mkdtempSync(path.join(tmpdir(), 'roadmap-lint-shallow-'));
      try {
        // A local path clone ignores --depth; the file:// form honours it
        execFileSync(
          'git',
          ['clone', '-q', '--depth', '1', `file:///${repoDir.replaceAll('\\', '/').replace(/^\//, '')}`, cloneDir],
          { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
        );
        expect((await collectGitInfo(cloneDir, nodeHost))?.shallow).toBe(true);
      } finally {
        rmSync(cloneDir, { recursive: true, force: true, maxRetries: 3 });
      }
    });
  });
});

describe.skipIf(!hasGit())('collectGitInfo on an unborn HEAD', () => {
  it('a repository with no commits yet is collected like any other: no commit in scope, the records untracked', async () => {
    const repoDir = mkdtempSync(path.join(tmpdir(), 'roadmap-lint-unborn-'));
    try {
      const git = (...args: string[]): string =>
        execFileSync('git', ['-C', repoDir, ...args], { encoding: 'utf8' });
      git('init', '-q');
      git('config', 'core.autocrlf', 'false');
      mkdirSync(path.join(repoDir, 'roadmap'), { recursive: true });
      writeFileSync(path.join(repoDir, 'roadmap', 'status.md'), 'x\n');
      const info = await collectGitInfo(repoDir, nodeHost);
      expect(info).not.toBeNull();
      expect(info?.commits).toEqual([]);
      expect(info?.headHashes).toEqual([]);
      expect(info?.trackedFiles.size).toBe(0);
      // git status collapses a wholly untracked directory into one entry, so the path is the directory itself
      expect(info?.uncommittedRoadmapPaths).toEqual(['roadmap/']);
      // The engine runs to the end instead of stopping with an execution error, and GIT-1 reports the untracked records
      const result = await lintDir(repoDir);
      expect(result.diagnostics.some((d) => d.rule === 'GIT-1')).toBe(true);
    } finally {
      rmSync(repoDir, { recursive: true, force: true, maxRetries: 3 });
    }
  });
});

describe.skipIf(!hasGit())('collectGitInfo on an unborn HEAD with staged files', () => {
  it('staged records before the first commit: tracked, uncommitted, and GIT-7 skips with a notice instead of failing', async () => {
    const repoDir = mkdtempSync(path.join(tmpdir(), 'roadmap-lint-unborn-staged-'));
    try {
      const git = (...args: string[]): string =>
        execFileSync('git', ['-C', repoDir, ...args], { encoding: 'utf8' });
      git('init', '-q');
      git('config', 'core.autocrlf', 'false');
      mkdirSync(path.join(repoDir, 'roadmap'), { recursive: true });
      writeFileSync(path.join(repoDir, 'roadmap', 'status.md'), 'x\n');
      writeFileSync(path.join(repoDir, 'roadmap', 'roadmap.md'), '## Parking Lot\n- an item\n\n## Deferred\n(none)\n');
      git('add', '-A');
      const info = await collectGitInfo(repoDir, nodeHost);
      expect(info?.trackedFiles.has('roadmap/status.md')).toBe(true);
      expect(info?.commits).toEqual([]);
      expect(info?.uncommittedRoadmapPaths).toEqual(['roadmap/roadmap.md', 'roadmap/status.md']);
      await info?.loadLineHistory(['roadmap/roadmap.md']);
      expect(info?.lineHistory('roadmap/roadmap.md')).toBeNull(); // blame has no HEAD to read
      const result = await lintDir(repoDir);
      expect(result.notices.some((n) => n.startsWith('GIT-7:'))).toBe(true);
    } finally {
      rmSync(repoDir, { recursive: true, force: true, maxRetries: 3 });
    }
  });
});
