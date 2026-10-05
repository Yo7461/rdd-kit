import { FILE_TYPE_SCHEMAS } from '../schema/file-types.js';
import type { RuleDiagnostic, RuleModule } from './types.js';

/** STRUCT-1: a required heading is missing (the H1 form plus the fixed H2s). */
export const struct1: RuleModule = {
  id: 'STRUCT-1',
  description: 'Missing required headings',
  defaultSeverity: 'error',
  defaultOptions: {},
  check({ file }) {
    if (file.type === 'unknown' || !file.markdown) return [];
    const schema = FILE_TYPE_SCHEMAS[file.type];
    const out: RuleDiagnostic[] = [];

    const h1 = file.markdown.headings.find((h) => h.depth === 1);
    if (!h1) {
      out.push({
        anchor: { kind: 'file', file: file.relPath },
        message: `Missing an H1 heading. Expected \`${schema.h1Expected}\`.`,
        suggestion:
          'Add the H1 from the schemas.md template at the top of the file, after the front matter.',
      });
    } else if (!schema.h1Pattern.test(h1.text)) {
      out.push({
        anchor: { kind: 'range', file: file.relPath, range: h1.range },
        message: `Unexpected H1 heading \`${h1.text}\`. Expected \`${schema.h1Expected}\`.`,
        suggestion: 'Change the H1 to the template form.',
      });
    }

    const present = new Set(
      file.markdown.headings.filter((h) => h.depth === 2).map((h) => h.text),
    );
    for (const required of schema.requiredH2) {
      if (present.has(required)) continue;
      out.push({
        anchor: { kind: 'file', file: file.relPath },
        message: `Missing required heading \`## ${required}\` in ${schema.label}.`,
        suggestion: 'Add the fixed heading from the schemas.md template.',
      });
    }
    return out;
  },
};
