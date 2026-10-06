import type { Host } from '../host.js';

export interface GitCommitInfo {
  hash: string;
  subject: string;
}

/** The commit that last changed one line of a tracked file, as `git blame` reports it (GIT-7). */
export interface LineHistory {
  /** The full commit hash (40 hex digits, or 64 in a SHA-256 repository) — all zeros for a line changed in the working tree and not committed yet */
  hash: string;
  /** The committer time in seconds since the epoch (0 for an uncommitted line) */
  committerTime: number;
  /** The committer's zone as git records it (`+0900`), the zone `git log` shows dates in ('' for an uncommitted line) */
  committerTz: string;
}

/** The hash `git blame` gives a line that is not committed yet (the SHA-1 form — see isUncommittedHash for both). */
export const UNCOMMITTED_HASH = '0'.repeat(40);

/** Whether a blame hash is the all-zero "not committed yet" one, in a SHA-1 or a SHA-256 repository. */
export function isUncommittedHash(hash: string): boolean {
  return /^0+$/.test(hash);
}

/**
 * A snapshot of the git state used by the GIT rules (GIT-1–GIT-7) and REF-3's untracked check, plus
 * `lineHistory`, a view of `git blame` for the one rule that needs it, read ahead by `loadLineHistory`.
 * The engine collects it once when a run starts and injects it as corpus.git.
 */
export interface GitInfo {
  /** Every tracked file (a POSIX path relative to baseDir) */
  trackedFiles: Set<string>;
  /** The non-merge commits after the one that first tracked roadmap/ (the boundary commit itself is excluded; newest first) */
  commits: GitCommitInfo[];
  /** Uncommitted changes and untracked paths under roadmap/ (ascending) */
  uncommittedRoadmapPaths: string[];
  /** Paths that are tracked even though they match .gitignore (ascending) */
  ignoredTracked: string[];
  /** Every commit hash reachable from HEAD (all history, merges included; sorted ascending so GIT-6 can binary-search by prefix) */
  headHashes: string[];
  /** Whether the repository is a shallow clone — its truncated history dates every line at the grafted commit, so GIT-7 skips it with a notice */
  shallow: boolean;
  /**
   * The last change of every line of a tracked file (index = 0-based line of the working-tree file), as
   * loadLineHistory read it from `git blame --porcelain`. null when the file is not tracked, blame failed,
   * or the file was not loaded — the caller (GIT-7) skips with a notice. Only the hash and the committer
   * time are kept.
   */
  lineHistory(relPath: string): LineHistory[] | null;
  /** Reads the blame of the given files ahead (each once), so that lineHistory can answer synchronously from a rule */
  loadLineHistory(relPaths: readonly string[]): Promise<void>;
}

const SEP = '\u001F';

/**
 * Reads the per-line history out of `git blame --porcelain` output. A line group opens with
 * `<hash> <original line> <final line> [<group size>]`; the first group of a commit carries its header lines
 * (`committer-time <epoch>` and `committer-tz <zone>` among them) and every group ends with the content
 * line, prefixed with a tab. Nothing but the hash, the committer time, and the zone is read — the author
 * headers are skipped. Hashes are 40 hex digits, or 64 in a SHA-256 repository.
 */
export function parseBlamePorcelain(raw: string): LineHistory[] {
  const committerTimes = new Map<string, number>();
  const committerZones = new Map<string, string>();
  const out: LineHistory[] = [];
  let current: { hash: string; finalLine: number } | null = null;
  for (const line of raw.split('\n')) {
    const head = /^([0-9a-f]{40}|[0-9a-f]{64}) \d+ (\d+)(?: \d+)?$/.exec(line);
    if (head) {
      current = { hash: head[1] ?? '', finalLine: Number(head[2]) };
      continue;
    }
    if (!current) continue;
    if (line.startsWith('committer-time ')) {
      committerTimes.set(current.hash, Number(line.slice('committer-time '.length)));
      continue;
    }
    if (line.startsWith('committer-tz ')) {
      committerZones.set(current.hash, line.slice('committer-tz '.length).trim());
      continue;
    }
    if (line.startsWith('\t')) {
      const uncommitted = isUncommittedHash(current.hash);
      out[current.finalLine - 1] = {
        hash: current.hash,
        committerTime: uncommitted ? 0 : (committerTimes.get(current.hash) ?? 0),
        committerTz: uncommitted ? '' : (committerZones.get(current.hash) ?? ''),
      };
      current = null;
    }
  }
  return out;
}

/**
 * Collects the git state. Returns null when git is absent or this is not a repository (the caller skips and emits a notice).
 * Paths are read with -z (NUL-separated), so quotepath has no effect on them.
 */
export async function collectGitInfo(baseDir: string, host: Host): Promise<GitInfo | null> {
  // --no-optional-locks: the linter only reads. Without it `git status` refreshes the index cache under
  // .git/ as a side effect, which takes index.lock and can collide with a git command the user runs at
  // the same moment (the hook runs after every edit).
  // The host reports the exit code as it is; a non-zero exit is turned into an error here so that every
  // command below keeps the same meaning it had with a throwing runner
  const git = async (...args: string[]): Promise<string> => {
    const ran = await host.run(['git', '-C', baseDir, '--no-optional-locks', ...args]);
    if (ran.exitCode !== 0) {
      throw new Error(`git ${args.join(' ')} exited with ${ran.exitCode}: ${ran.stderr.trim()}`);
    }
    return ran.stdout;
  };
  try {
    if ((await git('rev-parse', '--is-inside-work-tree')).trim() !== 'true') return null;
  } catch {
    return null;
  }

  const splitZ = (raw: string): string[] => raw.split('\u0000').filter((s) => s.length > 0);

  const trackedFiles = new Set(splitZ(await git('ls-files', '-z')));
  const ignoredTracked = splitZ(await git('ls-files', '-ciz', '--exclude-standard')).sort();

  // porcelain -z: NUL-separated "XY path". A rename (X is R or C) is followed by one more path right after it
  const uncommitted = new Set<string>();
  // --untracked-files=normal: a wholly untracked directory collapses to one entry, whatever the user's status.showUntrackedFiles says
  const statusChunks = splitZ(await git('status', '--porcelain', '-z', '--untracked-files=normal', '--', 'roadmap'));
  for (let i = 0; i < statusChunks.length; i++) {
    const chunk = statusChunks[i] ?? '';
    const state = chunk.slice(0, 2);
    const p = chunk.slice(3);
    if (p.startsWith('roadmap/')) uncommitted.add(p);
    if (state.startsWith('R') || state.startsWith('C')) {
      const from = statusChunks[++i];
      if (from?.startsWith('roadmap/')) uncommitted.add(from);
    }
  }
  const uncommittedRoadmapPaths = [...uncommitted].sort();

  // Only what comes after the commit that first tracked roadmap/ is in scope (without one, the convention has not started = nothing is in scope).
  // The boundary commit itself can be init's first commit (outside a session = no S####), so it is left out of scope
  // An unborn HEAD (git init with no commits yet) has no history to read: nothing has tracked roadmap/, so no
  // commit is in scope. Any other failure of the history commands still surfaces as an execution error
  let unborn = false;
  try {
    await git('rev-parse', '-q', '--verify', 'HEAD');
  } catch {
    unborn = true;
  }
  const boundary = unborn
    ? undefined
    : (await git('log', '--diff-filter=A', '--format=%H', '--reverse', '--', 'roadmap'))
        .split('\n')
        .find((l) => l.length > 0);
  const commits: GitCommitInfo[] = [];
  if (boundary) {
    for (const line of (await git('log', `--format=%H${SEP}%P${SEP}%s`)).split('\n')) {
      if (!line) continue;
      const [hash = '', parents = '', subject = ''] = line.split(SEP);
      if (hash === boundary) break;
      const isMerge = parents.split(' ').filter((p) => p.length > 0).length >= 2;
      if (!isMerge) commits.push({ hash, subject });
    }
  }

  const headHashes: string[] = unborn
    ? [] // GIT-6 skips its record-side checks
    : (await git('rev-list', 'HEAD'))
        .split('\n')
        .filter((l) => l.length > 0)
        .sort();

  let shallow = false;
  try {
    shallow = (await git('rev-parse', '--is-shallow-repository')).trim() === 'true';
  } catch {
    // The question itself failed (both it and --no-optional-locks date from git 2.15, so a git old
    // enough to lack it never gets this far) — read as a full repository
  }

  // Blame is read ahead for the files a rule will ask for (one process per file, once) — a run with GIT-7 turned off pays nothing
  const histories = new Map<string, LineHistory[] | null>();
  const loadLineHistory = async (relPaths: readonly string[]): Promise<void> => {
    for (const relPath of relPaths) {
      if (histories.has(relPath)) continue;
      let history: LineHistory[] | null = null;
      if (trackedFiles.has(relPath)) {
        try {
          history = parseBlamePorcelain(await git('blame', '--porcelain', '--', relPath));
        } catch {
          history = null; // Deleted in the working tree, or blame refused — GIT-7 skips with a notice
        }
      }
      histories.set(relPath, history);
    }
  };
  const lineHistory = (relPath: string): LineHistory[] | null => histories.get(relPath) ?? null;

  return { trackedFiles, commits, uncommittedRoadmapPaths, ignoredTracked, headHashes, shallow, lineHistory, loadLineHistory };
}
