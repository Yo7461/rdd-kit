import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// A single version for the skill and the CLI together: plugin.json and packages/* (cli, core) carry the same version.
// The source of truth for the sync is scripts/sync-version.mjs (--check is the CLI face of this same check).

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));

function readVersion(...segments: string[]): string {
  return (JSON.parse(readFileSync(path.join(repoRoot, ...segments), 'utf8')) as { version: string })
    .version;
}

describe('a single version for the skill and the CLI', () => {
  it('keeps plugin.json, packages/cli, and packages/core at the same SemVer version', () => {
    const plugin = readVersion('plugin', '.claude-plugin', 'plugin.json');
    expect(plugin).toMatch(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/);
    expect(readVersion('packages', 'cli', 'package.json')).toBe(plugin);
    expect(readVersion('packages', 'core', 'package.json')).toBe(plugin);
  });

  it('exits 0 from sync-version --check (the script agrees with what is on disk)', () => {
    const res = spawnSync(
      process.execPath,
      [path.join(repoRoot, 'scripts', 'sync-version.mjs'), '--check'],
      { encoding: 'utf8' },
    );
    expect(res.stderr).toBe('');
    expect(res.status).toBe(0);
  });

  it('reads its argument behind the `--` that `pnpm run sync:version -- --check` passes on', () => {
    const script = path.join(repoRoot, 'scripts', 'sync-version.mjs');
    const checked = spawnSync(process.execPath, [script, '--', '--check'], { encoding: 'utf8' });
    expect(checked.stderr).toBe('');
    expect(checked.status).toBe(0);
    // What is neither a version nor --check is still a usage error, and nothing is written
    const refused = spawnSync(process.execPath, [script, '--', 'next'], { encoding: 'utf8' });
    expect(refused.status).toBe(2);
    expect(refused.stderr).toContain('Usage:');
  });
});
