import path from 'node:path';
import type { ParsedFile } from '../parse/parsed-file.js';
import { frontMatterKeyRange, isRecord } from './helpers.js';
import type { RuleDiagnostic, RuleModule } from './types.js';

function sessionId(file: ParsedFile): string | null {
  const stem = path.posix.basename(file.relPath, '.md');
  if (/^S\d{4}$/.test(stem)) return stem;
  const fromKey = isRecord(file.markdown?.frontMatter?.data)
    ? file.markdown.frontMatter.data['session']
    : undefined;
  return typeof fromKey === 'string' && /^S\d{4}$/.test(fromKey) ? fromKey : null;
}

function sessionState(file: ParsedFile): string | null {
  const data = file.markdown?.frontMatter?.data;
  if (!isRecord(data)) return null;
  return typeof data['state'] === 'string' ? data['state'] : null;
}

function anchorAt(file: ParsedFile, key: string): RuleDiagnostic['anchor'] {
  const range = frontMatterKeyRange(file, key);
  return range ? { kind: 'range', file: file.relPath, range } : { kind: 'file', file: file.relPath };
}

/** FM-3: `open_session` against the actual session state. Runs on the corpus view — it needs more than one file. */
export const fm3: RuleModule = {
  id: 'FM-3',
  description: 'Agreement between `open_session` and actual session state',
  defaultSeverity: 'error',
  defaultOptions: {},
  checkCorpus({ files }) {
    const root = files.find((f) => f.type === 'root-status');
    if (!root) return [];
    const frontMatter = root.markdown?.frontMatter;
    if (!frontMatter || frontMatter.parseError || !isRecord(frontMatter.data)) return [];
    const declared = frontMatter.data['open_session'];
    const declaredId =
      typeof declared === 'string' && /^S\d{4}$/.test(declared) ? declared : null;
    // A malformed value (neither null nor S####) belongs to FM-2
    if (declared !== null && declaredId === null) return [];

    const sessions = files
      .filter((f) => f.type === 'session')
      .map((f) => ({ file: f, id: sessionId(f), state: sessionState(f) }));
    const out: RuleDiagnostic[] = [];

    if (declaredId !== null) {
      const target = sessions.find((s) => s.id === declaredId);
      // A missing target (nothing to refer to) belongs to REF-1
      if (target && target.state !== null && target.state !== 'open') {
        out.push({
          anchor: anchorAt(root, 'open_session'),
          message: `\`open_session\` points to ${declaredId}, but that session has \`state: ${target.state}\`.`,
          suggestion:
            'Update `open_session`, or reconcile that session with the recovery procedure in workflows.md.',
        });
      }
      for (const s of sessions) {
        if (s.state === 'open' && s.id !== declaredId) {
          out.push({
            anchor: anchorAt(s.file, 'state'),
            message: `Session ${s.id ?? s.file.relPath} has \`state: open\` but \`open_session\` points to ${declaredId}.`,
            suggestion: 'Close that session. Only one session may have `state: open` at a time.',
          });
        }
      }
    } else {
      for (const s of sessions) {
        if (s.state === 'open') {
          out.push({
            anchor: anchorAt(s.file, 'state'),
            message: `\`open_session\` is null but session ${s.id ?? s.file.relPath} has \`state: open\`.`,
            suggestion:
              'Close the session after the fact with the recovery procedure in workflows.md, or update `open_session`.',
          });
        }
      }
    }
    return out;
  },
};
