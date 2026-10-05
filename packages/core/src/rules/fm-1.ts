import { FILE_TYPE_SCHEMAS } from '../schema/file-types.js';
import { isRecord } from './helpers.js';
import type { RuleDiagnostic, RuleModule } from './types.js';

/** FM-1: a required front matter key is missing. */
export const fm1: RuleModule = {
  id: 'FM-1',
  description: 'Missing required front matter keys',
  defaultSeverity: 'error',
  defaultOptions: {},
  check({ file }) {
    if (file.type === 'unknown') return [];
    const schema = FILE_TYPE_SCHEMAS[file.type];
    const frontMatter = file.markdown?.frontMatter;
    if (!frontMatter) {
      return [
        {
          anchor: { kind: 'file', file: file.relPath },
          message: `Missing front matter in ${schema.label}.`,
          suggestion: 'Add front matter at the top of the file as shown in the schemas.md template.',
        },
      ];
    }
    // Reporting unparseable YAML belongs to TXT-2 — this avoids a cascade of false missing-key reports
    if (frontMatter.parseError) return [];
    if (!isRecord(frontMatter.data)) {
      return [
        {
          anchor: { kind: 'range', file: file.relPath, range: frontMatter.range },
          message: 'Expected front matter to be a mapping of keys to values.',
          suggestion: 'Change the front matter to key-value form as shown in the schemas.md template.',
        },
      ];
    }
    const data = frontMatter.data;
    const out: RuleDiagnostic[] = [];
    for (const { key, required } of schema.frontMatter) {
      if (!required || key in data) continue;
      out.push({
        anchor: { kind: 'range', file: file.relPath, range: frontMatter.range },
        message: `Missing required front matter key \`${key}\` in ${schema.label}.`,
        suggestion: `Add \`${key}\` as shown in the schemas.md template.`,
      });
    }
    return out;
  },
};
