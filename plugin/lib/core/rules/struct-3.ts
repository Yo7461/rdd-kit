import type { ParsedFile } from '../parse/parsed-file.ts';
import { findH2Section, lineInCode } from '../parse/sections.ts';
import { frontMatterKeyRange, isRecord, lineRange } from './helpers.ts';
import type { Anchor } from '../diagnostic.ts';
import type { RuleDiagnostic, RuleModule } from './types.ts';

function keyAnchor(file: ParsedFile, key: string): Anchor {
  const range = frontMatterKeyRange(file, key);
  return range ? { kind: 'range', file: file.relPath, range } : { kind: 'file', file: file.relPath };
}

/** Compares with the inline-code backticks stripped (the body template writes the command in backticks). */
function normalizeCommand(text: string): string {
  return text.replaceAll('`', '').trim();
}

function checkNextCommand(file: ParsedFile): RuleDiagnostic[] {
  const data = file.markdown?.frontMatter?.data;
  if (!isRecord(data) || typeof data['next_command'] !== 'string' || !file.markdown) return [];
  const section = findH2Section(file.markdown, file.lineCount, 'Next');
  if (!section) return []; // A missing Next section belongs to STRUCT-1
  let recommendLine = -1;
  let recommendText = '';
  for (let line = section.bodyStartLine; line < section.bodyEndLine; line++) {
    if (lineInCode(file.markdown, line)) continue;
    const match = (file.lines[line] ?? '').match(/^Recommended:\s*(.*)$/);
    if (match) {
      recommendLine = line;
      recommendText = match[1] ?? '';
      break;
    }
  }
  if (recommendLine < 0) {
    return [
      {
        anchor: { kind: 'range', file: file.relPath, range: section.heading.range },
        message: 'Missing the recommended-command line in the Next section.',
        suggestion:
          'Add the recommended-command line (`Recommended: <command> — <reason>`) at the top of the Next section.',
      },
    ];
  }
  if (normalizeCommand(recommendText) === normalizeCommand(data['next_command'])) return [];
  return [
    {
      anchor: keyAnchor(file, 'next_command'),
      message:
        'Inconsistent `next_command` and the recommended-command line in the Next section (compared after removing backticks).',
      suggestion: 'Record the full text after `Recommended: ` in `next_command`, as the skill requires.',
    },
  ];
}

/** Whether there is a non-empty line other than a placeholder line (a line wrapped in parentheses, full-width or half-width). */
function hasSubstantiveContent(file: ParsedFile, startLine: number, endLine: number): boolean {
  for (let line = startLine; line < endLine; line++) {
    const text = (file.lines[line] ?? '').trim();
    if (text === '') continue;
    if (/^[((].*[))]$/.test(text)) continue;
    return true;
  }
  return false;
}

function checkRoadmapChanged(file: ParsedFile): RuleDiagnostic[] {
  const data = file.markdown?.frontMatter?.data;
  if (!isRecord(data) || typeof data['roadmap_changed'] !== 'boolean' || !file.markdown) return [];
  const section = findH2Section(file.markdown, file.lineCount, 'Roadmap Changes');
  if (data['roadmap_changed']) {
    if (section) return [];
    return [
      {
        anchor: keyAnchor(file, 'roadmap_changed'),
        message: 'Missing the Roadmap Changes section while `roadmap_changed` is `true`.',
        suggestion:
          'Record what changed and why in the Roadmap Changes section. History does not belong in roadmap.md.',
      },
    ];
  }
  if (section && hasSubstantiveContent(file, section.bodyStartLine, section.bodyEndLine)) {
    return [
      {
        anchor: { kind: 'range', file: file.relPath, range: section.heading.range },
        message: 'Unexpected content in the Roadmap Changes section while `roadmap_changed` is `false`.',
        suggestion: 'Change `roadmap_changed` to `true`, or revisit the content of the section.',
        severity: 'warning',
      },
    ];
  }
  return [];
}

/** STRUCT-3: within-file agreement — `next_command` against the Next section, `roadmap_changed` against the presence of its section. */
export const struct3: RuleModule = {
  id: 'STRUCT-3',
  description: 'Within-file agreement (`next_command`, `roadmap_changed`)',
  defaultSeverity: 'error',
  defaultOptions: {},
  check({ file }) {
    if (file.type === 'root-status') return checkNextCommand(file);
    if (file.type === 'session') return checkRoadmapChanged(file);
    return [];
  },
};
