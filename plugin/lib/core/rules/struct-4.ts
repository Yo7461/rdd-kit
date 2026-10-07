import { parseFrontMatterValue } from '../parse/frontmatter.ts';
import { findH2Section } from '../parse/sections.ts';
import { contractYamlFences } from './corpus-helpers.ts';
import { isRecord, lineRange } from './helpers.ts';
import type { RuleDiagnostic, RuleModule } from './types.ts';

const SUGGESTION =
  'Name the test that holds the contract up in `verified_by` (`path::name`, several allowed), or write `manual` when no test can cover it — either way the strength of the contract stays visible.';

/**
 * The verifier entries of a `verified_by` value, split the way REF-2 reads them (`,`-separated, with
 * everything from `::` on stripped): a string or a list of strings. null for any other type.
 */
function verifierParts(value: unknown): string[] | null {
  if (value === null || value === undefined) return []; // a bare `verified_by:` parses as null — empty, not mistyped
  const strings =
    typeof value === 'string'
      ? [value]
      : Array.isArray(value) && value.every((v) => typeof v === 'string')
        ? (value as string[])
        : null;
  if (strings === null) return null;
  return strings
    .flatMap((s) => s.split(','))
    .map((part) => (part.split('::')[0] ?? '').trim())
    .filter((part) => part !== '');
}

/**
 * STRUCT-4: every contract names its verifier.
 * A `## C####:` heading in spec/<domain>.md has to carry its contract yaml block on the line right below
 * (schemas.md § Template: contract file), the block has to parse, and its `verified_by` has to hold at
 * least one entry (`manual` counts). An Invariants line in spec/map.md carries the same field in its
 * folded `— verified_by:` tail. Whether the path named there exists is REF-2's finding.
 */
export const struct4: RuleModule = {
  id: 'STRUCT-4',
  description: 'A contract without a `verified_by`',
  defaultSeverity: 'error',
  defaultOptions: {},
  check({ file }) {
    if (!file.markdown) return [];
    const out: RuleDiagnostic[] = [];

    if (file.type === 'spec-domain') {
      const fences = contractYamlFences(file);
      const withBlock = new Set(fences.map(({ heading }) => heading.range.start.line));
      for (const heading of file.markdown.headings) {
        if (heading.depth !== 2 || withBlock.has(heading.range.start.line)) continue;
        const contract = /^C\d{4}/.exec(heading.text)?.[0];
        if (!contract) continue;
        out.push({
          anchor: { kind: 'range', file: file.relPath, range: heading.range },
          message: `${contract} has no contract block — the \`\`\`yaml fence has to start on the line right after the heading.`,
          suggestion:
            'Add the YAML block of schemas.md § Template: contract file directly below the heading (kind / stability / source / verified_by / since / verified).',
        });
      }

      for (const { heading, fence } of fences) {
        const contract = /^C\d{4}/.exec(heading.text)?.[0] ?? heading.text;
        const bodyStart = fence.range.start.line + 1;
        const bodyLines = file.lines.slice(bodyStart, fence.range.end.line);
        const { data, parseError } = parseFrontMatterValue(bodyLines.join('\n'));
        if (parseError !== null) {
          out.push({
            anchor: { kind: 'range', file: file.relPath, range: lineRange(file, fence.range.start.line) },
            message: `${contract}'s contract block cannot be parsed as YAML (${parseError.split('\n')[0]}), so its \`verified_by\` cannot be read.`,
            suggestion:
              'Fix the YAML of the contract block (schemas.md § Template: contract file) — a value that holds a colon or parentheses has to be quoted.',
          });
          continue;
        }
        const keyLineOffset = bodyLines.findIndex((l) => /^\s*verified_by:/.test(l));
        const keyAnchor = lineRange(
          file,
          keyLineOffset < 0 ? heading.range.start.line : bodyStart + keyLineOffset,
        );
        if (!isRecord(data) || !('verified_by' in data)) {
          out.push({
            anchor: { kind: 'range', file: file.relPath, range: lineRange(file, heading.range.start.line) },
            message: `${contract} has no \`verified_by\`.`,
            suggestion: SUGGESTION,
          });
          continue;
        }
        const parts = verifierParts(data['verified_by']);
        if (parts === null) {
          out.push({
            anchor: { kind: 'range', file: file.relPath, range: keyAnchor },
            message: `${contract} has a \`verified_by\` of the wrong type — a string or a list of strings is expected.`,
            suggestion: SUGGESTION,
          });
        } else if (parts.length === 0) {
          out.push({
            anchor: { kind: 'range', file: file.relPath, range: keyAnchor },
            message: `${contract} has an empty \`verified_by\`.`,
            suggestion: SUGGESTION,
          });
        }
      }
    }

    if (file.type === 'spec-map') {
      const section = findH2Section(file.markdown, file.lineCount, 'Invariants');
      if (!section) return out;
      for (let line = section.bodyStartLine; line < section.bodyEndLine; line++) {
        const text = file.lines[line] ?? '';
        const match = /^-\s+(C\d{4})\b/.exec(text);
        if (!match) continue;
        const tail = /verified_by:(.*)$/.exec(text)?.[1];
        const parts = tail === undefined ? null : verifierParts(tail);
        if (parts !== null && parts.length > 0) continue;
        out.push({
          anchor: { kind: 'range', file: file.relPath, range: lineRange(file, line) },
          message:
            tail === undefined
              ? `${match[1]} (an Invariants line) has no \`verified_by\`.`
              : `${match[1]} (an Invariants line) has an empty \`verified_by\`.`,
          suggestion: SUGGESTION,
        });
      }
    }
    return out;
  },
};
