import { shownOptionValue } from '../config.js';
import type { ParsedFile } from '../parse/parsed-file.js';
import path from '../path.js';
import { findH2Section } from '../parse/sections.js';
import { isRecord } from './helpers.js';
import type { RuleDiagnostic, RuleModule } from './types.js';

/** The default volatile vocabulary (replaceable through the volatilePatterns option. A trailing separator on a root is absorbed by normalization). */
const DEFAULT_VOLATILE_PATTERNS = [
  'scratchpad',
  '/tmp',
  '%TEMP%',
  '%TMP%',
  'AppData/Local/Temp',
  'C:\\Windows\\Temp',
  '$TMPDIR',
];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A root without its trailing separators — null when nothing is left (an empty entry, or one made of separators alone). */
function volatileRoot(entry: unknown): string | null {
  if (typeof entry !== 'string') return null;
  const root = entry.replace(/[/\\]+$/, '');
  return root.length > 0 ? root : null;
}

/**
 * The content check of `volatilePatterns` (its shape has been checked by the engine): an entry that is
 * empty once its trailing separators are gone would match every `/word`, so it is dropped with a notice,
 * and the run says when no entry is left.
 */
function validateOptions(
  options: Record<string, unknown>,
  notice: (message: string) => void,
): Record<string, unknown> {
  const configured = options['volatilePatterns'];
  if (!Array.isArray(configured)) return options;
  const usable = configured.filter((entry) => volatileRoot(entry) !== null);
  for (const entry of new Set(configured.filter((entry) => volatileRoot(entry) === null))) {
    notice(
      `REF-3: Ignored the empty entry \`${shownOptionValue(entry)}\` in \`volatilePatterns\` — a root has to have something before its trailing separator.`,
    );
  }
  if (usable.length === 0) {
    notice('REF-3: `volatilePatterns` has no usable entry, so the volatile-location check is off for this run.');
  }
  return { ...options, volatilePatterns: usable };
}

/**
 * Only a reference with another path segment right after the volatile root counts as a violation.
 * Defining or mentioning the vocabulary itself (a list such as "scratchpad/, /tmp, …") is the root alone, so it does not match.
 */
function volatileMatchers(options: Record<string, unknown>): RegExp[] {
  const configured = options['volatilePatterns'];
  // A direct call may skip validateOptions, so the same filtering happens here, silently
  const roots = (Array.isArray(configured) ? configured : DEFAULT_VOLATILE_PATTERNS)
    .map(volatileRoot)
    .filter((root): root is string => root !== null);
  return roots.map(
    (root) =>
      new RegExp(`(?<![A-Za-z0-9_.\\-])${escapeRegExp(root)}[/\\\\][A-Za-z0-9_.\\-]`, 'gi'),
  );
}

/** The body line ranges of Method and Results (a list of [start, end)). */
function targetSections(file: ParsedFile): { start: number; end: number }[] {
  if (!file.markdown) return [];
  const out: { start: number; end: number }[] = [];
  for (const heading of ['Method', 'Results']) {
    const section = findH2Section(file.markdown, file.lineCount, heading);
    if (section) out.push({ start: section.bodyStartLine, end: section.bodyEndLine });
  }
  return out;
}

/**
 * REF-3: a `done` R/E referring to a volatile location or a path git does not track (SKILL.md ground rule 8).
 * (a) The volatile vocabulary plus a required following segment — git is not needed
 * (b) A path reference inside roadmap/ (inline code or a link, an extension required) that exists but is untracked — git is needed
 * A path whose target does not exist belongs to REF-2. Only Method and Results are in scope.
 */
export const ref3: RuleModule = {
  id: 'REF-3',
  description: 'References to volatile or untracked paths in a `done` R/E',
  defaultSeverity: 'error',
  defaultOptions: { volatilePatterns: DEFAULT_VOLATILE_PATTERNS },
  validateOptions,
  checkCorpus({ files, corpus, options }) {
    const matchers = volatileMatchers(options);
    const out: RuleDiagnostic[] = [];
    for (const file of files) {
      if (file.type !== 'research' && file.type !== 'experiment') continue;
      const data = file.markdown?.frontMatter?.data;
      if (!isRecord(data) || data['status'] !== 'done') continue;
      const sections = targetSections(file);
      const inSections = (line: number): boolean =>
        sections.some((s) => line >= s.start && line < s.end);

      // (a) The volatile vocabulary — a root plus a following segment
      for (const { start, end } of sections) {
        for (let line = start; line < end; line++) {
          const text = file.lines[line] ?? '';
          for (const matcher of matchers) {
            for (const match of text.matchAll(matcher)) {
              // The token runs to the next whitespace or delimiter. The CJK punctuation stays in this class on
              // purpose: records are written in the user's language, so a path can be followed directly by 、 or ) with no space
              const token = /^[^\s、。・)」』()]+/.exec(text.slice(match.index))?.[0] ?? match[0];
              out.push({
                anchor: {
                  kind: 'range',
                  file: file.relPath,
                  range: {
                    start: { line, character: match.index },
                    end: { line, character: match.index + token.length },
                  },
                },
                message: `Unexpected reference to a volatile location in a \`done\` file: \`${token}\`.`,
                suggestion:
                  'Move the asset to `roadmap/assets/<ID>/` under version control and update the reference (ground rule 8).',
              });
            }
          }
        }
      }

      // (b) The untracked check for a path reference inside roadmap/ (skipped when git is absent — the engine has already emitted the notice)
      const git = corpus.git;
      if (!git) continue;
      const spans = [
        ...(file.markdown?.inlineCode.map((s) => ({ token: s.value, range: s.range })) ?? []),
        ...(file.markdown?.links.map((l) => ({ token: l.url, range: l.range })) ?? []),
      ];
      for (const { token, range } of spans) {
        if (!inSections(range.start.line)) continue;
        if (!token.startsWith('roadmap/') || token.includes('#')) continue;
        const lastSegment = token.slice(token.lastIndexOf('/') + 1);
        if (!lastSegment.includes('.')) continue; // A mention of a directory is out of scope (the same outline as REF-2's inline-code check)
        if (!corpus.pathExists(token)) continue; // A missing target belongs to REF-2
        // Tracked paths are listed normalized, so the token is normalized too (`roadmap/./x.md` is `roadmap/x.md`)
        if (git.trackedFiles.has(path.posix.normalize(token))) continue;
        out.push({
          anchor: { kind: 'range', file: file.relPath, range },
          message: `Referenced path is not tracked by git: \`${token}\` (it exists but is not committed).`,
          suggestion:
            'Track the referenced path with `git add`. If it is generated output, revisit the `roadmap/assets/` policy.',
        });
      }
    }
    return out;
  },
};
