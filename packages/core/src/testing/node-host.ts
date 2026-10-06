import { execFile } from 'node:child_process';
import { access, readdir, readFile, stat } from 'node:fs/promises';
import type { Host, HostKind } from '../host.js';

// The Host of the test harness: the core on Node, reading the real file system and starting the real
// git. The CLI carries the same implementation in its own package (packages/cli/src/host.ts) — the
// core itself has no Node, and the two cannot share a file across the package boundary. The fixture
// tests here and the end-to-end tests of the CLI check the two against the same golden files.

const kindOf = (entry: { isFile(): boolean; isDirectory(): boolean }): HostKind =>
  entry.isFile() ? 'file' : entry.isDirectory() ? 'dir' : 'other';

export const nodeHost: Host = {
  readText: (file) => readFile(file, 'utf8'),
  exists: async (p) => {
    try {
      await access(p);
      return true;
    } catch {
      return false;
    }
  },
  listDir: async (dir) =>
    (await readdir(dir, { withFileTypes: true })).map((entry) => ({ name: entry.name, kind: kindOf(entry) })),
  stat: async (p) => {
    try {
      return { kind: kindOf(await stat(p)) };
    } catch {
      return null;
    }
  },
  run: (argv) =>
    new Promise((resolve, reject) => {
      const [command = '', ...args] = argv;
      const child = execFile(
        command,
        args,
        { encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 },
        (error, stdout, stderr) => {
          // A process that ran and exited non-zero reports its code as a number; one that could not
          // start (ENOENT) or was killed carries a string code or a signal — those reject
          if (error === null) resolve({ exitCode: 0, stdout, stderr });
          else if (typeof error.code === 'number') resolve({ exitCode: error.code, stdout, stderr });
          else reject(error);
        },
      );
      // Nothing is written to the child: close its stdin, so a command that reads it sees EOF instead of waiting
      child.stdin?.end();
    }),
};
