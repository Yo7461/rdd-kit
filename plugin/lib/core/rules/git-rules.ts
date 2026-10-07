import { shownOptionValue } from '../config.ts';
import type { GitCommitInfo } from '../corpus/git.ts';
import { isDefined } from '../corpus/index.ts';
import type { ParsedFile } from '../parse/parsed-file.ts';
import { plural } from '../plural.ts';
import { frontMatterKeyRange, frontMatterTokenAnchor, isRecord, showValue } from './helpers.ts';
import type { CorpusRuleContext, RuleDiagnostic, RuleModule } from './types.ts';

/** The `open_session` of the root status.md (non-null means recording is still in progress). */
function openSession(context: CorpusRuleContext): string | null {
  const root = context.files.find((f) => f.type === 'root-status');
  const data = root?.markdown?.frontMatter?.data;
  if (!isRecord(data)) return null;
  const value = data['open_session'];
  return typeof value === 'string' && /^S\d{4}$/.test(value) ? value : null;
}

/**
 * GIT-1: uncommitted changes under roadmap/.
 * While `open_session` is not null, recording is still in progress and uncommitted changes are normal → dropped to a notice.
 */
export const git1: RuleModule = {
  id: 'GIT-1',
  description: 'Uncommitted changes under roadmap/ (a notice while a session is open)',
  defaultSeverity: 'warning',
  defaultOptions: {},
  checkCorpus(context) {
    const git = context.corpus.git;
    if (!git || git.uncommittedRoadmapPaths.length === 0) return [];
    const session = openSession(context);
    if (session) {
      const count = git.uncommittedRoadmapPaths.length;
      context.notice?.(
        `\`roadmap/\` has ${count} uncommitted ${plural(count, 'change')} (session ${session} is open — normal while records are still being written).`,
      );
      return [];
    }
    return git.uncommittedRoadmapPaths.map((p) => ({
      anchor: { kind: 'file', file: p } as const,
      message: 'Uncommitted changes under `roadmap/` (no session is open).',
      suggestion:
        'Commit the record changes. If a close was left unfinished, finalize it at the start of the next session.',
    }));
  },
};

/** The subject prefix of the commit convention. Subjects without it are GIT-2's finding — the subject rules that build on the convention (GIT-4 / GIT-5) skip them instead of reporting the same root cause twice. */
const CONVENTION_PREFIX = /^\[S\d{4}\] /;

/**
 * Applies the `sinceCommit` option shared by the commit-subject rules (GIT-2 / GIT-4 / GIT-5):
 * a 7–40 digit hex hash declares where that rule's convention started — the commit itself and
 * everything before it fall out of scope (for a repository with existing history).
 * Fails open with a notice (everything stays checked) on an invalid or unfindable value.
 */
function applySinceCommit(
  ruleId: string,
  commits: GitCommitInfo[],
  since: unknown,
  notice: ((message: string) => void) | undefined,
): GitCommitInfo[] {
  if (since == null) return commits;
  if (typeof since !== 'string' || !/^[0-9a-f]{7,40}$/i.test(since)) {
    notice?.(
      `${ruleId}: Ignored the invalid \`sinceCommit\` value \`${shownOptionValue(since)}\` — expected a 7–40 digit hex commit hash, so all commits are checked.`,
    );
    return commits;
  }
  // commits is newest first (corpus/git.ts) — everything from the prefix match onward (older, itself included) is exempt
  const boundary = commits.findIndex((c) => c.hash.startsWith(since.toLowerCase()));
  if (boundary === -1) {
    notice?.(
      `${ruleId}: Could not find \`sinceCommit\` ${since} among the commits being checked (those after roadmap/ was first tracked), so all commits are checked. This is normal when it points at or before that commit — otherwise check the hash for a typo.`,
    );
    return commits;
  }
  return commits.slice(0, boundary);
}

/**
 * GIT-2: a commit without an [S####] prefix (after the commit that first tracked roadmap/, merges excluded).
 * The first-tracking commit itself (init's first commit) is already out of scope at collection time (corpus/git.ts).
 */
export const git2: RuleModule = {
  id: 'GIT-2',
  description: 'Commits without an [S####] prefix, after roadmap/ tracking began',
  defaultSeverity: 'warning',
  defaultOptions: { sinceCommit: null },
  checkCorpus({ corpus, options, notice }) {
    const git = corpus.git;
    if (!git) return [];
    const commits = applySinceCommit('GIT-2', git.commits, options['sinceCommit'], notice);
    const out: RuleDiagnostic[] = [];
    for (const commit of commits) {
      if (CONVENTION_PREFIX.test(commit.subject)) continue;
      out.push({
        anchor: { kind: 'repo' },
        message: `Commit ${commit.hash.slice(0, 7)} does not start with an \`[S####]\` prefix: "${commit.subject}".`,
        suggestion:
          'Use the `[S####]` convention from here on — rewriting existing history is not the fix. Use `sinceCommit` in the GIT-2 config to exempt history from before the convention.',
      });
    }
    return out;
  },
};

/** The label vocabulary of schemas.md § Commit convention. */
const DEFAULT_LABELS: readonly string[] = [
  'init',
  'research',
  'experiment',
  'build',
  'spec',
  'decision',
  'session-close',
  'phase-close',
  'post',
  'wip',
];

/** A label-shaped lead after the [S####] prefix: lower-case start, kebab body, followed by ": ". A capitalized or ID-like lead (`R0001: …`) is prose, not a label — the label itself is optional. */
const LABEL_SHAPE = /^\[S\d{4}\] ([a-z][a-z0-9-]*): /;

/**
 * GIT-4: an off-vocabulary label in a commit subject.
 * Applies only to subjects that carry the [S####] prefix (the rest is GIT-2's finding) and only when
 * a label-shaped segment follows it. options.labels replaces the vocabulary; options.sinceCommit
 * exempts history from before the convention (same semantics as GIT-2 — the label of a commit that is already made cannot be changed).
 */
export const git4: RuleModule = {
  id: 'GIT-4',
  description: 'Commit labels outside the convention vocabulary',
  defaultSeverity: 'warning',
  defaultOptions: { labels: [...DEFAULT_LABELS], sinceCommit: null },
  checkCorpus({ corpus, options, notice }) {
    const git = corpus.git;
    if (!git) return [];
    let labels = options['labels'];
    if (!Array.isArray(labels) || !labels.every((l) => typeof l === 'string')) {
      notice?.(
        `GIT-4: Ignored the invalid \`labels\` value — expected an array of strings, so the default vocabulary is used.`,
      );
      labels = [...DEFAULT_LABELS];
    }
    const vocabulary = new Set(labels as string[]);
    const commits = applySinceCommit('GIT-4', git.commits, options['sinceCommit'], notice);
    const out: RuleDiagnostic[] = [];
    for (const commit of commits) {
      const label = LABEL_SHAPE.exec(commit.subject)?.[1];
      if (label === undefined || vocabulary.has(label)) continue;
      out.push({
        anchor: { kind: 'repo' },
        message: `Commit ${commit.hash.slice(0, 7)} uses a label outside the vocabulary: "${commit.subject}".`,
        suggestion: `Use one of the convention labels (${[...vocabulary].join(' / ')}) — the same word for the same thing — or adjust \`labels\` in the GIT-4 config.`,
      });
    }
    return out;
  },
};

/**
 * GIT-5: a commit subject ending with a period.
 * Applies only to subjects that carry the [S####] prefix (the rest is GIT-2's finding). Both the
 * ASCII period and the Japanese full stop count; options.sinceCommit exempts history (same semantics as GIT-2).
 */
export const git5: RuleModule = {
  id: 'GIT-5',
  description: 'Commit subjects ending with a period',
  defaultSeverity: 'warning',
  defaultOptions: { sinceCommit: null },
  checkCorpus({ corpus, options, notice }) {
    const git = corpus.git;
    if (!git) return [];
    const commits = applySinceCommit('GIT-5', git.commits, options['sinceCommit'], notice);
    const out: RuleDiagnostic[] = [];
    for (const commit of commits) {
      if (!CONVENTION_PREFIX.test(commit.subject)) continue;
      if (!/[.。]$/.test(commit.subject)) continue;
      out.push({
        anchor: { kind: 'repo' },
        message: `Commit ${commit.hash.slice(0, 7)} ends its subject with a period: "${commit.subject}".`,
        suggestion: 'Drop the trailing period — a subject ends with neither `.` nor `。`.',
      });
    }
    return out;
  },
};

/** GIT-3: a file that is tracked even though it matches .gitignore (generated output that crept in). */
export const git3: RuleModule = {
  id: 'GIT-3',
  description: 'Tracked files that match .gitignore',
  defaultSeverity: 'error',
  defaultOptions: {},
  checkCorpus({ corpus }) {
    const git = corpus.git;
    if (!git) return [];
    return git.ignoredTracked.map((p) => ({
      anchor: { kind: 'file', file: p } as const,
      message: 'Tracked file matches `.gitignore` (generated output committed by mistake).',
      suggestion: `Run \`git rm --cached ${p}\` in the next session to untrack it.`,
    }));
  },
};

/** The [S####] lead of a commit subject. Lenient about what follows the bracket, so a subject with a
 * second bracket right behind it ([S####][P####]) resolves to its session instead of a false positive. */
const SUBJECT_SESSION = /^\[(S\d{4})\]/;

/** The session ID a session file defines by its name (a broken name belongs to ID-3). */
function sessionFileId(file: ParsedFile): string | null {
  const base = file.relPath.slice(file.relPath.lastIndexOf('/') + 1);
  return /^(S\d{4})(?!\d)/.exec(base)?.[1] ?? null;
}

/** Whether some hash in the ascending list starts with prefix (lower-case hex, binary search). */
function hasHashWithPrefix(sorted: readonly string[], prefix: string): boolean {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((sorted[mid] ?? '') < prefix) lo = mid + 1;
    else hi = mid;
  }
  return (sorted[lo] ?? '').startsWith(prefix);
}

/** A recorded hash from a parsed value — the fallback when the raw flow form is not available. */
function recordedHash(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

/** The raw text of a top-level front matter value, as written. YAML rewrites a digits-only hash
 * into a number (dropping leading zeros) and an exponent-shaped one like 592e497 into a float, so
 * the history checks read the source text instead of the parsed value. */
function rawFrontMatterValue(file: ParsedFile, key: string): string | null {
  const raw = file.markdown?.frontMatter?.raw;
  const line = raw?.split('\n').find((l) => l.startsWith(`${key}:`));
  return line === undefined ? null : line.slice(key.length + 1).trim();
}

function stripQuotes(token: string): string {
  const quoted =
    (token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"));
  return quoted && token.length >= 2 ? token.slice(1, -1) : token;
}

const HASH_SUGGESTION =
  'Copy the real hash from `git log --oneline` — a fabricated or mistyped hash breaks the commit-to-session correspondence.';

/**
 * GIT-6: session records against git history (without this rule a fabricated base_commit,
 * fabricated commits entries, and a subject naming a session that never existed all pass). History side: a subject whose
 * [S####] names a session with no record is a warning (history is not rewritten — same stance and
 * sinceCommit semantics as GIT-2). Record side: base_commit and every commits entry must resolve
 * by prefix into the history reachable from HEAD, and a resolved entry whose subject names another
 * session is over-attribution. A subject with no [S####] lead belongs to GIT-2, and a broken
 * front matter shape belongs to FM-1 and FM-2.
 */
export const git6: RuleModule = {
  id: 'GIT-6',
  description: 'Session records against git history (subject sessions, base_commit, commits)',
  defaultSeverity: 'error',
  defaultOptions: { sinceCommit: null },
  checkCorpus({ files, corpus, options, notice }) {
    const git = corpus.git;
    if (!git) return [];
    const out: RuleDiagnostic[] = [];

    for (const commit of applySinceCommit('GIT-6', git.commits, options['sinceCommit'], notice)) {
      const sid = SUBJECT_SESSION.exec(commit.subject)?.[1];
      if (!sid || isDefined(corpus, sid)) continue;
      out.push({
        severity: 'warning',
        anchor: { kind: 'repo' },
        message: `Commit ${commit.hash.slice(0, 7)} names a session with no record: "${commit.subject}".`,
        suggestion:
          'Check the session ID in the subject for a typo. If the commit is from before the records began, exempt the old history with `sinceCommit` in the GIT-6 config.',
      });
    }

    if (git.headHashes.length === 0) return out; // An unborn HEAD — no history to verify against (fail open)
    for (const file of files) {
      if (file.type !== 'session') continue;
      const sessionId = sessionFileId(file);
      const data = file.markdown?.frontMatter?.data;
      if (!sessionId || !isRecord(data)) continue;

      const rawBase = data['base_commit'];
      if (rawBase != null) {
        const written = rawFrontMatterValue(file, 'base_commit');
        const token = written === null ? recordedHash(rawBase) : stripQuotes(written);
        if (token === null || !hasHashWithPrefix(git.headHashes, token.toLowerCase())) {
          const range = frontMatterKeyRange(file, 'base_commit');
          out.push({
            anchor: range
              ? { kind: 'range', file: file.relPath, range }
              : { kind: 'file', file: file.relPath },
            message:
              '`base_commit` ' + (token ?? showValue(rawBase)) + ' is not found in the commits reachable from HEAD.',
            suggestion: HASH_SUGGESTION,
          });
        }
      }

      const list = data['commits'];
      if (!Array.isArray(list)) continue;
      const rawList = rawFrontMatterValue(file, 'commits');
      const tokens =
        rawList !== null && rawList.startsWith('[') && rawList.endsWith(']')
          ? rawList
              .slice(1, -1)
              .split(',')
              .map((s) => stripQuotes(s.trim()))
              .filter((s) => s.length > 0)
          : list.map(recordedHash).filter((s): s is string => s !== null);
      for (const hash of tokens) {
        if (!hasHashWithPrefix(git.headHashes, hash.toLowerCase())) {
          out.push({
            anchor: frontMatterTokenAnchor(file, hash),
            message: '`commits` entry ' + hash + ' is not found in the commits reachable from HEAD.',
            suggestion: HASH_SUGGESTION,
          });
          continue;
        }
        const info = git.commits.find((c) => c.hash.startsWith(hash.toLowerCase()));
        const sid = info ? SUBJECT_SESSION.exec(info.subject)?.[1] : undefined;
        if (info && sid && sid !== sessionId) {
          out.push({
            anchor: frontMatterTokenAnchor(file, hash),
            message: '`commits` entry ' + hash + ' belongs to ' + sid + ' by its subject: "' + info.subject + '".',
            suggestion:
              'Record a commit in the session that made it — remove the entry here, or fix the commit subject if the subject is the one that is wrong.',
          });
        }
      }
    }
    return out;
  },
};
