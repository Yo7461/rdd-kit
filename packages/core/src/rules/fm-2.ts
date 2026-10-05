import { parseFrontMatterValue } from '../parse/frontmatter.js';
import type { ParsedFile } from '../parse/parsed-file.js';
import { findH2Section, lineInCode } from '../parse/sections.js';
import {
  CONTRACT_STABILITIES,
  FILE_TYPE_SCHEMAS,
  PHASE_STATES,
  PHASE_TYPES,
  validateValue,
} from '../schema/file-types.js';
import { frontMatterKeyRange, isRecord, lineRange, showValue } from './helpers.js';
import type { RuleDiagnostic, RuleModule } from './types.js';

function checkFrontMatterValues(file: ParsedFile): RuleDiagnostic[] {
  const schema = FILE_TYPE_SCHEMAS[file.type as Exclude<ParsedFile['type'], 'unknown'>];
  const frontMatter = file.markdown?.frontMatter;
  if (!frontMatter || frontMatter.parseError || !isRecord(frontMatter.data)) return [];
  const data = frontMatter.data;
  const out: RuleDiagnostic[] = [];
  for (const { key, spec } of schema.frontMatter) {
    if (!(key in data)) continue;
    const expected = validateValue(spec, data[key]);
    if (expected === null) continue;
    out.push({
      anchor: {
        kind: 'range',
        file: file.relPath,
        range: frontMatterKeyRange(file, key) ?? frontMatter.range,
      },
      message: `Unexpected value \`${showValue(data[key])}\` for front matter key \`${key}\`. Allowed: ${expected}.`,
      suggestion: 'Change the value to one of the allowed values.',
    });
  }
  return out;
}

/** The body of roadmap.md: the state in a phase heading and the `- type:` line (a heading and a list line, but checked in the same category). */
function checkRoadmapBody(file: ParsedFile): RuleDiagnostic[] {
  const markdown = file.markdown;
  if (!markdown) return [];
  const out: RuleDiagnostic[] = [];
  for (const heading of markdown.headings) {
    if (heading.depth !== 3 || !/^P\d{4}:/.test(heading.text)) continue;
    const match = heading.text.match(/—\s*(\S+)\s*$/u);
    if (!match) continue; // A broken heading shape belongs to the STRUCT and ID rules
    const state = match[1] ?? '';
    if ((PHASE_STATES as readonly string[]).includes(state)) continue;
    out.push({
      anchor: { kind: 'range', file: file.relPath, range: heading.range },
      message: `Unexpected phase state \`${state}\` in the phase heading. Allowed: ${PHASE_STATES.join(' | ')}.`,
      suggestion: 'Change the state at the end of the heading to one of the allowed values.',
    });
  }
  const phases = findH2Section(markdown, file.lineCount, 'Phases');
  if (phases) {
    for (let line = phases.bodyStartLine; line < phases.bodyEndLine; line++) {
      if (lineInCode(markdown, line)) continue;
      const match = (file.lines[line] ?? '').match(/^- type:\s*(.*)$/);
      if (!match) continue;
      const value = (match[1] ?? '').trim();
      if ((PHASE_TYPES as readonly string[]).includes(value)) continue;
      out.push({
        anchor: { kind: 'range', file: file.relPath, range: lineRange(file, line) },
        message: `Unexpected phase type \`${value}\`. Allowed: ${PHASE_TYPES.join(' | ')}.`,
        suggestion: 'Change `type` to one of the allowed values.',
      });
    }
  }
  return out;
}

/** The YAML block of a contract file: the allowed values of stability. */
function checkContractBlocks(file: ParsedFile): RuleDiagnostic[] {
  const markdown = file.markdown;
  if (!markdown) return [];
  const out: RuleDiagnostic[] = [];
  for (const fence of markdown.codeFences) {
    if (fence.lang !== 'yaml') continue;
    const bodyStart = fence.range.start.line + 1;
    const bodyLines = file.lines.slice(bodyStart, fence.range.end.line);
    const { data } = parseFrontMatterValue(bodyLines.join('\n'));
    if (!isRecord(data) || !('stability' in data)) continue;
    const stability = data['stability'];
    if (typeof stability === 'string' && (CONTRACT_STABILITIES as readonly string[]).includes(stability)) {
      continue;
    }
    const lineOffset = bodyLines.findIndex((l) => l.startsWith('stability:'));
    const anchorLine = lineOffset < 0 ? fence.range.start.line : bodyStart + lineOffset;
    out.push({
      anchor: { kind: 'range', file: file.relPath, range: lineRange(file, anchorLine) },
      message: `Unexpected contract stability \`${showValue(stability)}\`. Allowed: ${CONTRACT_STABILITIES.join(' | ')}.`,
      suggestion: 'Change `stability` to one of the allowed values.',
    });
  }
  return out;
}

/** FM-2: a value outside the allowed set (the front matter plus the structural values in the body that fall in the same category). */
export const fm2: RuleModule = {
  id: 'FM-2',
  description: 'Front matter or structural values outside the allowed set',
  defaultSeverity: 'error',
  defaultOptions: {},
  check({ file }) {
    if (file.type === 'unknown') return [];
    const out = checkFrontMatterValues(file);
    if (file.type === 'roadmap') out.push(...checkRoadmapBody(file));
    if (file.type === 'spec-domain') out.push(...checkContractBlocks(file));
    return out;
  },
};
