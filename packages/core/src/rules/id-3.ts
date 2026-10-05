import type { ParsedFile } from '../parse/parsed-file.js';
import { findH2Section } from '../parse/sections.js';
import { fileMap, lineAnchor } from './corpus-helpers.js';
import type { CorpusRuleContext, RuleDiagnostic, RuleModule } from './types.js';

const KEBAB = '[a-z0-9]+(?:-[a-z0-9]+)*';
const PHASE_DIR_RE = new RegExp(`^P\\d{4}-${KEBAB}$`);
const SESSION_FILE_RE = /^S\d{4}\.md$/;
const RE_FILE_RE = (prefix: 'R' | 'E'): RegExp => new RegExp(`^${prefix}\\d{4}-${KEBAB}\\.md$`);

function basename(relPath: string): string {
  return relPath.slice(relPath.lastIndexOf('/') + 1);
}

const RENAME_SUGGESTION =
  'Rename it to follow the conventions in schemas.md § IDs and naming. The ID number itself never changes.';

/** ID-3: ID format and naming conventions — four zero-padded digits, slugs, heading shapes, and which phase a D belongs to. */
export const id3: RuleModule = {
  id: 'ID-3',
  description: 'ID format and naming conventions',
  defaultSeverity: 'error',
  defaultOptions: {},
  checkCorpus(context: CorpusRuleContext) {
    const { files, corpus } = context;
    const byPath = fileMap(files);
    const out: RuleDiagnostic[] = [];

    // The slug convention for a phase directory
    const dirNames = new Set<string>();
    for (const entry of corpus.entries) {
      const name = /^roadmap\/phases\/([^/]+)\//.exec(entry.relPath)?.[1];
      if (name) dirNames.add(name);
    }
    for (const name of [...dirNames].sort()) {
      if (PHASE_DIR_RE.test(name)) continue;
      const statusPath = `roadmap/phases/${name}/status.md`;
      out.push({
        anchor: byPath.has(statusPath) ? { kind: 'file', file: statusPath } : { kind: 'repo' },
        message: `Phase directory name does not follow the \`P####-<lowercase-kebab>\` convention: \`phases/${name}\`.`,
        suggestion: RENAME_SUGGESTION,
      });
    }

    for (const file of files) {
      // The file-name conventions (a session log, an R/E)
      if (file.type === 'session' && !SESSION_FILE_RE.test(basename(file.relPath))) {
        out.push({
          anchor: { kind: 'file', file: file.relPath },
          message: `Unexpected session log file name \`${basename(file.relPath)}\`. Expected \`S####.md\`.`,
          suggestion: RENAME_SUGGESTION,
        });
      }
      if (
        (file.type === 'research' || file.type === 'experiment') &&
        !RE_FILE_RE(file.type === 'research' ? 'R' : 'E').test(basename(file.relPath))
      ) {
        out.push({
          anchor: { kind: 'file', file: file.relPath },
          message: `Unexpected file name \`${basename(file.relPath)}\`. Expected \`${file.type === 'research' ? 'R' : 'E'}####-<kebab>.md\`.`,
          suggestion: RENAME_SUGGESTION,
        });
      }

      // roadmap.md: an H3 in the Phases section has to take the shape of a phase heading (the value of state belongs to FM-2)
      if (file.type === 'roadmap' && file.markdown) {
        const phasesSection = findH2Section(file.markdown, file.lineCount, 'Phases');
        if (phasesSection) {
          for (const heading of file.markdown.headings) {
            if (heading.depth !== 3) continue;
            const line = heading.range.start.line;
            if (line < phasesSection.bodyStartLine || line >= phasesSection.bodyEndLine) continue;
            if (/^P\d{4}(?!\d): .+ — \S+/u.test(heading.text)) continue;
            out.push({
              anchor: lineAnchor(byPath, file.relPath, line),
              message: `Unexpected phase heading \`${heading.text}\`. Expected \`P####: <name> — <state>\`.`,
              suggestion:
                'Change the heading to the template form — four zero-padded digits and a state.',
            });
          }
        }
        // The digits of a B#### in the Blockers table
        const blockers = findH2Section(file.markdown, file.lineCount, 'Blockers');
        if (blockers) {
          for (let line = blockers.bodyStartLine; line < blockers.bodyEndLine; line++) {
            const cell = /^\|\s*(B\d+)\s*\|/.exec(file.lines[line] ?? '')?.[1];
            if (!cell || /^B\d{4}$/.test(cell)) continue;
            out.push({
              anchor: lineAnchor(byPath, file.relPath, line),
              message: `Unexpected blocker ID \`${cell}\`. Expected four zero-padded digits (\`B####\`).`,
              suggestion: RENAME_SUGGESTION,
            });
          }
        }
      }

      // A spec domain file: the shape of a contract heading
      if (file.type === 'spec-domain' && file.markdown) {
        for (const heading of file.markdown.headings) {
          if (heading.depth !== 2 || !/^C\d+:/.test(heading.text)) continue;
          if (/^C\d{4}(?!\d): .+/.test(heading.text)) continue;
          out.push({
            anchor: lineAnchor(byPath, file.relPath, heading.range.start.line),
            message: `Unexpected contract heading \`${heading.text}\`. Expected \`C####: <name>\`.`,
            suggestion: RENAME_SUGGESTION,
          });
        }
      }

      // A phase status: the shape of a D-P####-#### in Decisions and which phase it belongs to
      if (file.type === 'phase-status' && file.markdown) {
        const dirName = /^roadmap\/phases\/([^/]+)\//.exec(file.relPath)?.[1] ?? '';
        const dirId = /^(P\d{4})(?!\d)/.exec(dirName)?.[1] ?? null;
        const decisions = findH2Section(file.markdown, file.lineCount, 'Decisions');
        if (decisions) {
          for (let line = decisions.bodyStartLine; line < decisions.bodyEndLine; line++) {
            const loose = /^-\s+(D-P\d+-\d+)/.exec(file.lines[line] ?? '')?.[1];
            if (!loose) continue;
            const strict = /^D-P(\d{4})-\d{4}$/.exec(loose);
            if (!strict) {
              out.push({
                anchor: lineAnchor(byPath, file.relPath, line),
                message: `Unexpected decision ID \`${loose}\`. Expected \`D-P####-####\` with four zero-padded digits in each part.`,
                suggestion: RENAME_SUGGESTION,
              });
            } else if (dirId && `P${strict[1]}` !== dirId) {
              out.push({
                anchor: lineAnchor(byPath, file.relPath, line),
                message: `Inconsistent P part in ${loose}: the phase it is recorded under is ${dirId}.`,
                suggestion:
                  'Record a decision in the Decisions section of its own phase status.md, and match the P part to that phase.',
              });
            }
          }
        }
      }
    }
    return out;
  },
};
