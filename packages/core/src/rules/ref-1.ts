import { layerOf } from '../corpus/index.js';
import { lineInBlockquote, lineInCode, positionInInlineCode } from '../parse/sections.js';
import { contractYamlFences } from './corpus-helpers.js';
import type { RuleDiagnostic, RuleModule } from './types.js';

/** Match the D form first, so the P#### it contains is not reported twice. */
const ID_TOKEN = /\b(?:D-P\d{4}-\d{4}|[PSREBC]\d{4})\b/g;

/**
 * REF-1: a referenced ID exists.
 * - What is walked: every line of the .md files of the 8 known types (front matter values included). unknown (assets and the like) is out of scope
 * - What is excluded: code fences, inline code, and blockquotes (the config can bring them in).
 *   Only the contract yaml fence of a spec domain file is walked, as structured data
 * - The layer test: a reference to a resolved B or a retired C is normal only in the Fact layer
 * - A forward reference to the next session (the highest S defined, plus 1) is exempt (`S0001` is exempt when no session exists yet)
 */
export const ref1: RuleModule = {
  id: 'REF-1',
  description: 'Referenced IDs exist, judged by layer',
  defaultSeverity: 'error',
  defaultOptions: {
    scanCodeFences: false,
    scanInlineCode: false,
    scanBlockquotes: false,
    allowNextSessionRef: true,
  },
  checkCorpus({ files, corpus, options }) {
    const out: RuleDiagnostic[] = [];
    const nextSession = (corpus.maxSession ?? 0) + 1;

    for (const file of files) {
      if (file.type === 'unknown' || !file.markdown) continue;
      const layer = layerOf(file.relPath);
      const contractLines = new Set<number>();
      for (const { fence } of contractYamlFences(file)) {
        for (let l = fence.range.start.line; l <= fence.range.end.line; l++) contractLines.add(l);
      }

      for (let line = 0; line < file.lines.length; line++) {
        if (
          options['scanCodeFences'] !== true &&
          lineInCode(file.markdown, line) &&
          !contractLines.has(line)
        ) {
          continue;
        }
        if (options['scanBlockquotes'] !== true && lineInBlockquote(file.markdown, line)) {
          continue;
        }
        const text = file.lines[line] ?? '';
        for (const match of text.matchAll(ID_TOKEN)) {
          const token = match[0];
          const column = match.index;
          if (
            options['scanInlineCode'] !== true &&
            positionInInlineCode(file.markdown, line, column)
          ) {
            continue;
          }
          if (corpus.definitions.has(token)) continue;
          const kind = token.startsWith('D-') ? 'D' : (token[0] as string);
          if (
            kind === 'S' &&
            options['allowNextSessionRef'] !== false &&
            Number(token.slice(1)) === nextSession
          ) {
            continue; // The conventional forward reference in next_command and Handoff
          }
          if ((kind === 'B' || kind === 'C') && layer === 'fact') continue;
          const note =
            kind === 'B'
              ? ' Not in the Blockers table — a reference to a resolved blocker is normal only in the Fact layer (phases/, research/, experiments/).'
              : kind === 'C'
                ? ' Not in the spec — a reference to a retired contract is normal only in the Fact layer.'
                : '';
          out.push({
            anchor: {
              kind: 'range',
              file: file.relPath,
              range: {
                start: { line, character: column },
                end: { line, character: column + token.length },
              },
            },
            message: `Cannot find a definition for ${token}.${note}`,
            suggestion:
              kind === 'B' || kind === 'C'
                ? 'Change the reference to a definition that still exists, or move the note into the Fact layer (a session log, for example) if it describes past history.'
                : 'Add the missing definition, or fix the typo in the ID.',
          });
        }
      }
    }
    return out;
  },
};
