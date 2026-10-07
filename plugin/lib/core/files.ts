import type { Host } from './host.ts';
import path from './path.ts';

/** The file type (8 types). Anything that cannot be identified is unknown (detecting a file outside the conventions belongs to FILE-1). */
export type FileType =
  | 'roadmap'
  | 'root-status'
  | 'phase-status'
  | 'session'
  | 'research'
  | 'experiment'
  | 'spec-map'
  | 'spec-domain'
  | 'unknown';

export interface RoadmapTarget {
  /** The parent of roadmap/. Diagnostic paths are relative to this */
  baseDir: string;
  roadmapDir: string;
}

/**
 * Resolves the target: accepts either a directory that contains roadmap/ or roadmap/ itself.
 * The path is taken as given — a relative one stays relative to whatever the host reads it against,
 * so a caller that wants an absolute target passes one (the CLI resolves its argument first).
 */
export async function resolveTarget(inputPath: string, host: Host): Promise<RoadmapTarget | null> {
  const abs = path.resolve(inputPath);
  if ((await host.stat(abs))?.kind !== 'dir') return null;
  const sub = path.join(abs, 'roadmap');
  if ((await host.stat(sub))?.kind === 'dir') {
    return { baseDir: abs, roadmapDir: sub };
  }
  if (path.basename(abs) === 'roadmap') {
    return { baseDir: path.dirname(abs), roadmapDir: abs };
  }
  return null;
}

/** Turns a path that came from Windows into the POSIX form the diagnostics use. */
export function toPosix(relPath: string): string {
  return relPath.replace(/\\/g, '/');
}

export interface RoadmapFileRef {
  absPath: string;
  /** A POSIX path relative to baseDir (always starting with roadmap/) */
  relPath: string;
  type: FileType;
}

/**
 * Classifies by position (the path structure). How strictly the slug and the ID are named plays no part —
 * the content checks run even on a broken name, and checking the naming is left to ID-3.
 */
export function classifyFile(relPath: string): FileType {
  if (relPath === 'roadmap/roadmap.md') return 'roadmap';
  if (relPath === 'roadmap/status.md') return 'root-status';
  if (relPath === 'roadmap/spec/map.md') return 'spec-map';
  if (/^roadmap\/spec\/[^/]+\.md$/.test(relPath)) return 'spec-domain';
  if (/^roadmap\/phases\/[^/]+\/status\.md$/.test(relPath)) return 'phase-status';
  if (/^roadmap\/phases\/[^/]+\/sessions\/[^/]+\.md$/.test(relPath)) return 'session';
  if (/^roadmap\/research\/[^/]+\.md$/.test(relPath)) return 'research';
  if (/^roadmap\/experiments\/[^/]+\.md$/.test(relPath)) return 'experiment';
  return 'unknown';
}

/** Lists every regular file under roadmap/ in ascending relPath order (so the order does not depend on the environment). */
export async function collectFiles(target: RoadmapTarget, host: Host): Promise<RoadmapFileRef[]> {
  const files: RoadmapFileRef[] = [];
  // Directories are listed side by side. A symbolic link (`other`) is neither followed nor counted.
  // A name is appended as the host returned it, not normalized — on POSIX a backslash is part of a
  // name, not a separator — and the relative path grows with the walk, so it never depends on the
  // platform (roadmapDir is normalized and ends in `roadmap`, so every relPath starts with `roadmap/`)
  const walk = async (dir: string, rel: string): Promise<void> => {
    const entries = await host.listDir(dir);
    await Promise.all(
      entries.map(async (entry) => {
        const absPath = `${dir}/${entry.name}`;
        const relPath = `${rel}/${entry.name}`;
        if (entry.kind === 'dir') return walk(absPath, relPath);
        if (entry.kind !== 'file') return;
        files.push({ absPath, relPath, type: classifyFile(relPath) });
      }),
    );
  };
  await walk(target.roadmapDir, 'roadmap');
  files.sort((a, b) => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0));
  return files;
}
