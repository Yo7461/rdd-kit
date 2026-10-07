import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { nodeHost as harnessHost } from '../../core/src/testing/node-host.js';
import { nodeHost as cliHost } from '../src/host.js';

// A partial clone (--filter=blob:none) holds no blobs until something reads them, and `git blame` would
// then fetch them from the promisor remote — over the network, with the user's credentials, writing to
// .git/objects. The hosts run git with the lazy fetch off, so the lint reads only what the clone holds:
// the blame fails, and the core reads that as a skip of the rule that dates shelf items. The remote here
// is a directory on the machine, so the fetch being prevented would not have left it anyway.

const git = (args: string[], cwd: string, env: NodeJS.ProcessEnv = process.env): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], env });

const author = ['-c', 'user.name=t', '-c', 'user.email=t@example.com'];

/** How many objects the clone knows of but does not hold — counted without fetching any. */
const missingObjects = (repo: string): number =>
  git(['rev-list', '--objects', '--missing=print', 'HEAD'], repo, { ...process.env, GIT_NO_LAZY_FETCH: '1' })
    .split('\n')
    .filter((line) => line.startsWith('?')).length;

/** GIT_NO_LAZY_FETCH is read from git 2.46 on; before that there is nothing to test here. */
function hasNoLazyFetch(): boolean {
  const found = /git version (\d+)\.(\d+)/u.exec(git(['--version'], tmpdir()));
  if (!found) return false;
  const [major, minor] = [Number(found[1]), Number(found[2])];
  return major > 2 || (major === 2 && minor >= 46);
}

const base = mkdtempSync(path.join(tmpdir(), 'rdd-kit-partial-'));
afterAll(() => rmSync(base, { recursive: true, force: true, maxRetries: 3 }));

describe.runIf(hasNoLazyFetch())('git in a partial clone', () => {
  for (const [name, host] of [
    ['the CLI host', cliHost],
    ['the harness host', harnessHost],
  ] as const) {
    it(`${name}: blame does not fetch the missing blob — it fails, and the clone stays as it was`, async () => {
      const origin = path.join(base, `${name.replace(/\W/gu, '')}-origin`);
      const clone = `${origin}-clone`;
      // Two versions of the file: the clone checks out the latest blob, and the earlier one — which blame
      // walks back to — stays missing
      git(['init', '-q', '-b', 'main', origin], base);
      git(['config', 'uploadpack.allowFilter', 'true'], origin);
      writeFileSync(path.join(origin, 'roadmap.md'), '# roadmap\n');
      git([...author, 'add', 'roadmap.md'], origin);
      git([...author, 'commit', '-q', '-m', 'one'], origin);
      writeFileSync(path.join(origin, 'roadmap.md'), '# roadmap\n\nmore\n');
      git([...author, 'commit', '-q', '-a', '-m', 'two'], origin);
      git(['clone', '-q', '--no-local', '--filter=blob:none', pathToFileURL(origin).href, clone], base);
      const before = missingObjects(clone);
      expect(before, 'the clone lacks the earlier blob').toBe(1);

      const ran = await host.run(['git', '-C', clone, '--no-optional-locks', 'blame', '--porcelain', '--', 'roadmap.md']);
      expect(ran.exitCode).not.toBe(0);
      expect(ran.stderr).toContain('Cannot read blob');
      expect(missingObjects(clone), 'nothing was fetched').toBe(before);

      // The control: the same blame with git's default behavior fetches the blob (from the directory here)
      git(['-C', clone, '--no-optional-locks', 'blame', '--porcelain', '--', 'roadmap.md'], base, { ...process.env, GIT_NO_LAZY_FETCH: '0' });
      expect(missingObjects(clone), 'what the hosts prevent').toBe(0);
    });
  }
});
