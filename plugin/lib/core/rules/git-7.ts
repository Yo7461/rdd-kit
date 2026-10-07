import { shownOptionValue } from '../config.ts';
import { isUncommittedHash, type LineHistory } from '../corpus/git.ts';
import type { ParsedFile } from '../parse/parsed-file.ts';
import { findH2Section } from '../parse/sections.ts';
import { plural } from '../plural.ts';
import type { RuleDiagnostic, RuleModule } from './types.ts';

/** The sections of roadmap.md whose items have a shelf life. */
const REVISIT_SECTIONS = ['Parking Lot', 'Deferred'] as const;

const DEFAULT_MAX_AGE_DAYS = 30;

/** A bullet whose whole text is one parenthesized remark — `(none)`, `(なし)` — is a placeholder, not an item. */
const PLACEHOLDER = /^[((][^))]*[))]$/;

/** The text of a bullet line after its marker (`-`, `*`, `+`, or `1.` / `1)`). */
const MARKER = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/;

interface ListItem {
  section: (typeof REVISIT_SECTIONS)[number];
  /** The bullet line (0-based) */
  startLine: number;
  /** The last line the item contains — a nested bullet, a lazy or indented continuation, a later paragraph (0-based, inclusive) */
  endLine: number;
}

/**
 * The top-level list items of one section, as the Markdown parser delimits them (a nested list, an
 * indented paragraph, or a lazy continuation stays inside its item; a bullet inside an HTML comment
 * or a code block is not an item).
 */
function listItemsOf(file: ParsedFile, section: ListItem['section']): ListItem[] {
  if (!file.markdown) return [];
  const found = findH2Section(file.markdown, file.lineCount, section);
  if (!found) return [];
  const items: ListItem[] = [];
  for (const item of file.markdown.listItems) {
    const startLine = item.range.start.line;
    if (item.depth !== 1 || startLine < found.bodyStartLine || startLine >= found.bodyEndLine) continue;
    const body = (MARKER.exec(file.lines[startLine] ?? '')?.[1] ?? '').trim();
    if (body === '' || PLACEHOLDER.test(body)) continue;
    items.push({ section, startLine, endLine: Math.min(item.range.end.line, found.bodyEndLine - 1) });
  }
  return items;
}

/** The calendar date of an epoch time in the committer's own zone (`+0900` and the like — what `git log --date=short` shows). */
function committerDate(entry: LineHistory): string {
  const zone = /^([+-])(\d{2})(\d{2})$/.exec(entry.committerTz);
  const offsetSeconds = zone
    ? (zone[1] === '-' ? -1 : 1) * (Number(zone[2]) * 3600 + Number(zone[3]) * 60)
    : 0;
  return new Date((entry.committerTime + offsetSeconds) * 1000).toISOString().slice(0, 10);
}

/**
 * GIT-7: a Parking Lot or Deferred item that nobody has revisited for longer than `maxAgeDays`.
 * The age of an item is counted from the run's `now` back to the committer time
 * of the last commit that changed any of its lines (`git blame`); an item with a line changed in the
 * working tree is 0 days old. Rewriting the line is what resets the clock — the review step of a
 * `replan` or a `phase close` decides keep / promote / drop. A warning, like GIT-1: a
 * true positive that the next review clears, and one whose result depends on the day the lint runs.
 * A repository whose history cannot date the items (a shallow clone, an untracked roadmap.md, a repository
 * with no commits yet, blame lines that do not match the parsed file) is skipped with a notice rather than
 * judged wrongly.
 */
export const git7: RuleModule = {
  id: 'GIT-7',
  description: 'Parking Lot and Deferred items not revisited for longer than maxAgeDays',
  defaultSeverity: 'warning',
  defaultOptions: { maxAgeDays: DEFAULT_MAX_AGE_DAYS },
  checkCorpus({ files, corpus, options, notice, now }) {
    const git = corpus.git;
    if (!git) return [];
    const roadmap = files.find((f) => f.type === 'roadmap');
    if (!roadmap?.markdown) return [];
    const items = REVISIT_SECTIONS.flatMap((section) => listItemsOf(roadmap, section));
    if (items.length === 0) return [];

    const configured = options['maxAgeDays'];
    let maxAgeDays = DEFAULT_MAX_AGE_DAYS;
    if (typeof configured === 'number' && Number.isFinite(configured) && configured >= 0) {
      maxAgeDays = configured;
    } else if (configured !== undefined) {
      notice?.(
        `GIT-7: Ignored the invalid \`maxAgeDays\` value \`${shownOptionValue(configured)}\` — expected a non-negative number, so the default ${DEFAULT_MAX_AGE_DAYS} is used.`,
      );
    }

    if (git.shallow) {
      notice?.(
        'GIT-7: Skipped the revisit check because the repository is a shallow clone — its truncated history cannot date the items.',
      );
      return [];
    }
    const history = git.lineHistory(roadmap.relPath);
    if (history === null) {
      notice?.(
        `GIT-7: Skipped the revisit check because \`${roadmap.relPath}\` has no git history to date its items by (not tracked yet, or \`git blame\` failed).`,
      );
      return [];
    }
    if (history.length !== roadmap.lineCount) {
      notice?.(
        `GIT-7: Skipped the revisit check because \`git blame\` reports ${history.length} ${plural(history.length, 'line')} for \`${roadmap.relPath}\` while the file parses into ${roadmap.lineCount} (a lone CR in the file, or a file that changed during the run).`,
      );
      return [];
    }

    const nowMs = (now ?? new Date()).getTime();
    const out: RuleDiagnostic[] = [];
    for (const item of items) {
      let newest: LineHistory | null = null;
      let uncommitted = false;
      for (let line = item.startLine; line <= item.endLine; line++) {
        const entry = history[line];
        if (!entry || isUncommittedHash(entry.hash)) {
          uncommitted = true;
          break;
        }
        if (!newest || entry.committerTime > newest.committerTime) newest = entry;
      }
      if (uncommitted || !newest) continue; // Being rewritten right now = revisited (0 days)
      const days = Math.floor((nowMs - newest.committerTime * 1000) / 86_400_000);
      if (days <= maxAgeDays) continue;
      out.push({
        anchor: {
          kind: 'range',
          file: roadmap.relPath,
          range: {
            start: { line: item.startLine, character: 0 },
            end: { line: item.endLine, character: (roadmap.lines[item.endLine] ?? '').length },
          },
        },
        message: `This ${item.section} item has not been revisited for ${days} ${plural(days, 'day')} (last changed in ${newest.hash.slice(0, 7)} on ${committerDate(newest)}).`,
        suggestion:
          'Decide at the next replan or phase close: keep it (rewrite the line so its return condition is current — that resets the clock), promote it to a phase, or drop it.',
      });
    }
    return out;
  },
};
