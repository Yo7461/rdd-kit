import { describe, expect, it } from 'vitest';
import { collectFiles, resolveTarget } from '../src/files.js';
import type { Host, HostEntry } from '../src/host.js';

// The core reaches the file system only through a Host, so the walk and the target resolution are
// checked here against an in-memory host — the one way to put a name a real file system refuses on
// one platform (a backslash, on Windows) in front of the code

type Tree = Record<string, string | null>; // a path → its text, or null for a directory

function memoryHost(tree: Tree): Host {
  const kindOf = (p: string): HostEntry['kind'] | null => {
    if (!(p in tree)) return null;
    return tree[p] === null ? 'dir' : 'file';
  };
  return {
    readText: async (file) => {
      const text = tree[file];
      if (typeof text !== 'string') throw new Error(`ENOENT: ${file}`);
      return text;
    },
    exists: async (p) => p in tree,
    listDir: async (dir) => {
      if (kindOf(dir) !== 'dir') throw new Error(`ENOENT: ${dir}`);
      const prefix = `${dir}/`;
      return Object.keys(tree)
        .filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/'))
        .map((p) => ({ name: p.slice(prefix.length), kind: kindOf(p) ?? 'other' }));
    },
    stat: async (p) => {
      const kind = kindOf(p);
      return kind === null ? null : { kind };
    },
    run: async () => ({ exitCode: 127, stdout: '', stderr: 'not available' }),
  };
}

const tree: Tree = {
  '/repo': null,
  '/repo/roadmap': null,
  '/repo/roadmap/roadmap.md': '# r\n',
  '/repo/roadmap/status.md': '# s\n',
  '/repo/roadmap/spec': null,
  '/repo/roadmap/spec/map.md': '# m\n',
  '/repo/roadmap/assets': null,
  '/repo/roadmap/assets/notes\\x.md': 'a backslash in a POSIX name\n',
  '/repo/roadmap/assets/gen.py': 'print(1)\n',
};

describe('resolveTarget', () => {
  it('accepts the directory that holds roadmap/, or roadmap/ itself, and nothing else', async () => {
    const host = memoryHost(tree);
    expect(await resolveTarget('/repo', host)).toEqual({ baseDir: '/repo', roadmapDir: '/repo/roadmap' });
    expect(await resolveTarget('/repo/roadmap', host)).toEqual({ baseDir: '/repo', roadmapDir: '/repo/roadmap' });
    expect(await resolveTarget('/repo/roadmap/spec', host)).toBeNull();
    expect(await resolveTarget('/elsewhere', host)).toBeNull();
    expect(await resolveTarget('/repo/roadmap/status.md', host)).toBeNull();
  });

  it('normalizes the path it is given, a trailing slash included', async () => {
    const host = memoryHost(tree);
    expect(await resolveTarget('/repo/', host)).toEqual({ baseDir: '/repo', roadmapDir: '/repo/roadmap' });
    expect(await resolveTarget('/repo/spec/../roadmap', host)).toEqual({ baseDir: '/repo', roadmapDir: '/repo/roadmap' });
  });
});

describe('collectFiles', () => {
  it('walks every regular file under roadmap/, in ascending relPath order, and classifies it by position', async () => {
    const host = memoryHost(tree);
    const target = await resolveTarget('/repo', host);
    if (!target) throw new Error('unresolved');
    const files = await collectFiles(target, host);
    expect(files.map((f) => [f.relPath, f.type])).toEqual([
      ['roadmap/assets/gen.py', 'unknown'],
      ['roadmap/assets/notes\\x.md', 'unknown'],
      ['roadmap/roadmap.md', 'roadmap'],
      ['roadmap/spec/map.md', 'spec-map'],
      ['roadmap/status.md', 'root-status'],
    ]);
    // The absolute path is the host's own spelling, so the file can be read back — a backslash in a
    // name is kept as the host gave it, never read as a separator
    expect(files.map((f) => f.absPath)).toContain('/repo/roadmap/assets/notes\\x.md');
    for (const file of files) expect(await host.exists(file.absPath)).toBe(true);
  });

  it('neither follows nor counts an entry that is neither a file nor a directory', async () => {
    const host = memoryHost(tree);
    const linked: Host = {
      ...host,
      listDir: async (dir) =>
        dir === '/repo/roadmap' ? [...(await host.listDir(dir)), { name: 'link', kind: 'other' }] : host.listDir(dir),
    };
    const target = await resolveTarget('/repo', linked);
    if (!target) throw new Error('unresolved');
    const files = await collectFiles(target, linked);
    expect(files.some((f) => f.relPath.endsWith('/link'))).toBe(false);
    expect(files).toHaveLength(5);
  });
});
