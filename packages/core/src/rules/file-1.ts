import type { RuleDiagnostic, RuleModule } from './types.js';

function stringArray(value: unknown, fallback: readonly string[]): readonly string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string')
    ? (value as string[])
    : fallback;
}

/**
 * FILE-1: a file placed outside the conventions (a warning).
 * Reports every file except the canonical positions of the 8 known types, .gitkeep, and anything under roadmap/assets/.
 * A file in a canonical position with a broken name (sessions/notes.md, say) belongs to ID-3.
 */
export const file1: RuleModule = {
  id: 'FILE-1',
  description: 'Files outside the conventional layout',
  defaultSeverity: 'warning',
  defaultOptions: { allowNames: ['.gitkeep'], allowPaths: ['roadmap/assets/'] },
  checkCorpus({ corpus, options }) {
    const allowNames = stringArray(options['allowNames'], ['.gitkeep']);
    const allowPaths = stringArray(options['allowPaths'], ['roadmap/assets/']);
    const out: RuleDiagnostic[] = [];
    for (const entry of corpus.entries) {
      if (entry.type !== 'unknown') continue;
      const base = entry.relPath.slice(entry.relPath.lastIndexOf('/') + 1);
      if (allowNames.includes(base)) continue;
      if (allowPaths.some((prefix) => entry.relPath.startsWith(prefix))) continue;
      out.push({
        anchor: { kind: 'file', file: entry.relPath },
        message: `Unexpected file outside the conventional layout (not one of the 8 known file types, ${allowNames.join('/')}, or ${allowPaths.join('/')}).`,
        suggestion:
          'Move it into the directory layout in schemas.md — reproduction assets for an R/E go under `roadmap/assets/<ID>/`. Add it to `allowNames` or `allowPaths` in the config if the location is intentional.',
      });
    }
    return out;
  },
};
