import type { HeadingInfo } from '../parse/markdown.ts';
import { FILE_TYPE_SCHEMAS } from '../schema/file-types.ts';
import type { RuleDiagnostic, RuleModule } from './types.ts';

/** STRUCT-2: a duplicated fixed heading (error) plus an ordering slip (warning). */
export const struct2: RuleModule = {
  id: 'STRUCT-2',
  description: 'Duplicated or out-of-order fixed headings',
  defaultSeverity: 'error',
  defaultOptions: {},
  check({ file }) {
    if (file.type === 'unknown' || !file.markdown) return [];
    const schema = FILE_TYPE_SCHEMAS[file.type];
    if (schema.requiredH2.length === 0) return [];
    const requiredSet = new Set(schema.requiredH2);
    const occurrences = new Map<string, HeadingInfo[]>();
    const firstAppearance: HeadingInfo[] = [];
    for (const heading of file.markdown.headings) {
      if (heading.depth !== 2 || !requiredSet.has(heading.text)) continue;
      const list = occurrences.get(heading.text) ?? [];
      if (list.length === 0) firstAppearance.push(heading);
      list.push(heading);
      occurrences.set(heading.text, list);
    }
    const out: RuleDiagnostic[] = [];

    for (const [text, list] of occurrences) {
      if (list.length < 2) continue;
      const second = list[1];
      if (!second) continue;
      out.push({
        anchor: { kind: 'range', file: file.relPath, range: second.range },
        message: `Duplicate fixed heading \`## ${text}\` (${list.length} occurrences).`,
        suggestion:
          'Move the content into a single section. Duplicated headings leave it ambiguous which one is authoritative.',
      });
    }

    // Order: whether the sequence of first appearances matches the template order (narrowed to the subsequence that is present)
    const expectedOrder = schema.requiredH2.filter((t) => occurrences.has(t));
    for (let i = 0; i < firstAppearance.length; i++) {
      const actual = firstAppearance[i];
      if (!actual || actual.text === expectedOrder[i]) continue;
      out.push({
        anchor: { kind: 'range', file: file.relPath, range: actual.range },
        message: `Unexpected position for fixed heading \`## ${actual.text}\`. Expected order: ${expectedOrder.join(' → ')}.`,
        suggestion: 'Move the headings into the order of the schemas.md template.',
        severity: 'warning',
      });
      break; // Report only the first slip (everything after it slips in a chain)
    }
    return out;
  },
};
