import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

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

/** Resolves the target: accepts either a directory that contains roadmap/ or roadmap/ itself. */
export function resolveTarget(inputPath: string): RoadmapTarget | null {
  const abs = path.resolve(inputPath);
  if (!existsSync(abs) || !statSync(abs).isDirectory()) return null;
  const sub = path.join(abs, 'roadmap');
  if (existsSync(sub) && statSync(sub).isDirectory()) {
    return { baseDir: abs, roadmapDir: sub };
  }
  if (path.basename(abs) === 'roadmap') {
    return { baseDir: path.dirname(abs), roadmapDir: abs };
  }
  return null;
}

export function toPosix(relPath: string): string {
  return relPath.split(path.sep).join('/');
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
export function collectFiles(target: RoadmapTarget): RoadmapFileRef[] {
  const entries = readdirSync(target.roadmapDir, { recursive: true, withFileTypes: true });
  const files: RoadmapFileRef[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const absPath = path.join(entry.parentPath, entry.name);
    const relPath = toPosix(path.relative(target.baseDir, absPath));
    files.push({ absPath, relPath, type: classifyFile(relPath) });
  }
  files.sort((a, b) => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0));
  return files;
}
