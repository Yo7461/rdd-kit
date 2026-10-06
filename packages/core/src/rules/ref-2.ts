import path from '../path.js';
import { layerOf } from '../corpus/index.js';
import { parseFrontMatterValue } from '../parse/frontmatter.js';
import { findH2Section } from '../parse/sections.js';
import { contractYamlFences } from './corpus-helpers.js';
import { isRecord, lineRange } from './helpers.js';
import type { RuleDiagnostic, RuleModule } from './types.js';

/** A URL (with a scheme), an absolute path, and a fragment are out of scope. */
function isExternal(p: string): boolean {
  return (
    /^[a-z][a-z0-9+.-]+:/i.test(p) || // http:, mailto:, and so on (two characters or more, to tell it from a drive letter)
    p.startsWith('/') ||
    /^[A-Za-z]:[\\/]/.test(p) ||
    p.startsWith('#')
  );
}

function normalizeFrom(baseDirOfFile: string, target: string): string {
  return path.posix.normalize(path.posix.join(baseDirOfFile, target));
}

const PATHLIKE_RE = /^[A-Za-z0-9._/-]+$/;

/** A path-like token in inline code (the last segment has to carry an extension). */
function inlineCodeCandidate(value: string): string | null {
  const stripped = (value.split('::')[0] ?? '').trim();
  if (stripped === '' || /\s/.test(stripped)) return null;
  if (!stripped.includes('/')) return null;
  if (isExternal(stripped) || !PATHLIKE_RE.test(stripped)) return null;
  const last = stripped.slice(stripped.lastIndexOf('/') + 1);
  if (!last.includes('.')) return null;
  return stripped;
}

const FIX_SUGGESTION = 'Fix the path, or put the referenced file in place.';

/**
 * REF-2: a referenced path exists. Three kinds of reference are checked:
 * (a) The structured fields = source / verified_by in a contract yaml (relative to the repository root, a string or a
 *     list of strings, `,`-separated, with everything from `::` on stripped and manual excluded) plus the status column of Phase Index (relative to roadmap/) — error
 * (b) The relative path of a Markdown link (relative to where the file sits) — error
 * (c) A path-like token in inline code (the OR of three criteria) — warning
 * In the Fact layer (append-only and immutable), (b) and (c) are checked only for references inside roadmap/ — the paths of
 * project code can legitimately change after a record is written.
 */
export const ref2: RuleModule = {
  id: 'REF-2',
  description: 'Referenced paths exist, in structured fields, links, and inline code',
  defaultSeverity: 'error',
  defaultOptions: { checkInlineCodePaths: true },
  checkCorpus({ files, corpus, options }) {
    const out: RuleDiagnostic[] = [];

    for (const file of files) {
      if (file.type === 'unknown' || !file.markdown) continue;
      const fileDir = path.posix.dirname(file.relPath);
      const fact = layerOf(file.relPath) === 'fact';

      // (a) source / verified_by in a contract yaml
      for (const { heading, fence } of contractYamlFences(file)) {
        const bodyStart = fence.range.start.line + 1;
        const bodyLines = file.lines.slice(bodyStart, fence.range.end.line);
        const { data } = parseFrontMatterValue(bodyLines.join('\n'));
        if (!isRecord(data)) continue;
        const contract = /^C\d{4}/.exec(heading.text)?.[0] ?? heading.text;
        for (const key of ['source', 'verified_by'] as const) {
          const value = data[key];
          // A string, or a list of strings (STRUCT-4 accepts both forms) — every entry may itself be `,`-separated
          const entries =
            typeof value === 'string'
              ? [value]
              : Array.isArray(value)
                ? value.filter((v): v is string => typeof v === 'string')
                : [];
          for (const rawPart of entries.flatMap((entry) => entry.split(','))) {
            const part = (rawPart.trim().split('::')[0] ?? '').trim();
            if (part === '' || part === 'manual' || isExternal(part)) continue;
            if (corpus.pathExists(part)) continue;
            const keyLineOffset = bodyLines.findIndex((l) => l.startsWith(`${key}:`));
            out.push({
              anchor: {
                kind: 'range',
                file: file.relPath,
                range: lineRange(
                  file,
                  keyLineOffset < 0 ? fence.range.start.line : bodyStart + keyLineOffset,
                ),
              },
              message: `Cannot find the referenced path \`${part}\` (${contract} \`${key}\` — relative to the repository root).`,
              suggestion: FIX_SUGGESTION,
            });
          }
        }
      }

      // (a) The status column of Phase Index
      if (file.type === 'root-status') {
        const section = findH2Section(file.markdown, file.lineCount, 'Phase Index');
        if (section) {
          for (let line = section.bodyStartLine; line < section.bodyEndLine; line++) {
            const text = file.lines[line] ?? '';
            if (!/^\|.*\|\s*$/.test(text)) continue;
            const cells = text.replace(/^\||\|\s*$/g, '').split('|').map((c) => c.trim());
            if (!/^(P\d{4})(?!\d)\b/.test(cells[0] ?? '')) continue;
            const statusPath = cells[2] ?? '';
            if (statusPath === '' || statusPath === '—' || isExternal(statusPath)) continue;
            if (corpus.pathExists(`roadmap/${statusPath}`)) continue;
            out.push({
              anchor: { kind: 'range', file: file.relPath, range: lineRange(file, line) },
              message: `Cannot find the referenced path \`${statusPath}\` (Phase Index status column — relative to roadmap/).`,
              suggestion: FIX_SUGGESTION,
            });
          }
        }
      }

      // (b) A Markdown link (relative to where the file sits)
      for (const link of file.markdown.links) {
        const cleaned = (link.url.split(/[#?]/)[0] ?? '').trim();
        if (cleaned === '' || isExternal(link.url)) continue;
        const resolved = normalizeFrom(fileDir, cleaned);
        if (fact && !resolved.startsWith('roadmap/')) continue; // In the Fact layer, only a link inside roadmap/ is checked
        if (corpus.pathExists(resolved)) continue;
        out.push({
          anchor: { kind: 'range', file: file.relPath, range: link.range },
          message: `Cannot find the linked path \`${link.url}\`.`,
          suggestion: FIX_SUGGESTION,
        });
      }

      // (c) A path-like token in inline code (warning)
      if (options['checkInlineCodePaths'] !== false) {
        for (const span of file.markdown.inlineCode) {
          const candidate = inlineCodeCandidate(span.value);
          if (!candidate) continue;
          // In the Fact layer, only a token the author spelled out from roadmap/ is checked.
          // It is neither resolved relatively nor completed with a roadmap/ prefix — so a quoted path from another repository is not a false positive
          if (fact && !candidate.startsWith('roadmap/')) continue;
          const bases = fact
            ? [path.posix.normalize(candidate)]
            : [
                normalizeFrom(fileDir, candidate),
                path.posix.normalize(candidate),
                path.posix.normalize(`roadmap/${candidate}`),
              ];
          if (bases.some((b) => corpus.pathExists(b))) continue;
          out.push({
            severity: 'warning',
            anchor: { kind: 'range', file: file.relPath, range: span.range },
            message: `Cannot find the referenced path \`${candidate}\` (a path-like token in inline code).`,
            suggestion: `${FIX_SUGGESTION} Use \`checkInlineCodePaths: false\` in the config if the token is not a path.`,
          });
        }
      }
    }
    return out;
  },
};
