import path from '../path.js';
import type { ParsedFile } from '../parse/parsed-file.js';
import { frontMatterKeyRange, isRecord, showValue } from './helpers.js';
import type { Anchor } from '../diagnostic.js';
import type { RuleDiagnostic, RuleModule } from './types.js';

function anchorAt(file: ParsedFile, key: string): Anchor {
  const range = frontMatterKeyRange(file, key);
  return range ? { kind: 'range', file: file.relPath, range } : { kind: 'file', file: file.relPath };
}

/** Pulls the expected ID out of a directory or file name in relPath (null when there is none — checking the naming is ID-3's job). */
function idFromSegment(segment: string | undefined, prefix: string): string | null {
  const match = segment?.match(new RegExp(`^(${prefix}\\d{4})(?:-|$|\\.)`));
  return match?.[1] ?? null;
}

/** FM-4: conditional keys against the file name or location (a `phase` that has to match its directory, for instance). */
export const fm4: RuleModule = {
  id: 'FM-4',
  description: 'Agreement between conditional keys and file name or location',
  defaultSeverity: 'error',
  defaultOptions: {},
  check({ file }) {
    const frontMatter = file.markdown?.frontMatter;
    if (!frontMatter || frontMatter.parseError || !isRecord(frontMatter.data)) return [];
    const data = frontMatter.data;
    const out: RuleDiagnostic[] = [];
    const push = (key: string, message: string, suggestion: string): void => {
      out.push({ anchor: anchorAt(file, key), message, suggestion });
    };
    const segments = file.relPath.split('/');

    if (file.type === 'research' || file.type === 'experiment') {
      const status = data['status'];
      const completed = data['completed'];
      if (status === 'done' && completed === null) {
        push(
          'completed',
          'Missing `completed` while `status` is `done`.',
          'Record the session (S####) that finished it in `completed`.',
        );
      }
      if (typeof status === 'string' && status !== 'done' && typeof completed === 'string') {
        push(
          'completed',
          `Unexpected \`completed\` value \`${showValue(completed)}\` while \`status\` is \`${status}\`.`,
          'Record `completed` when the status becomes `done`, and leave it null until then.',
        );
      }
      const prefix = file.type === 'research' ? 'R' : 'E';
      const expectedId = idFromSegment(segments.at(-1), prefix);
      if (expectedId && typeof data['id'] === 'string' && data['id'] !== expectedId) {
        push(
          'id',
          `Inconsistent \`id\`: the front matter says \`${String(data['id'])}\`, the file name says \`${expectedId}\`.`,
          'Rename the file or fix `id`. IDs are never renumbered.',
        );
      }
      const expectedType = file.type;
      if (
        typeof data['type'] === 'string' &&
        ['research', 'experiment'].includes(data['type']) &&
        data['type'] !== expectedType
      ) {
        push(
          'type',
          `Inconsistent \`type\`: the front matter says \`${String(data['type'])}\`, the ID prefix and location say \`${expectedType}\`.`,
          'Change `type` to match the location and the ID prefix.',
        );
      }
    }

    if (file.type === 'phase-status') {
      const state = data['state'];
      if (state === 'done' && !('closed' in data)) {
        push(
          'state',
          'Missing `closed` (the completion date) while `state` is `done`.',
          'Add `closed: YYYY-MM-DD` to the front matter.',
        );
      }
      if (typeof state === 'string' && state !== 'done' && 'closed' in data) {
        push(
          'closed',
          `Unexpected \`closed\` while \`state\` is \`${state}\`.`,
          'Remove `closed`. It belongs only in a phase status with `state: done`.',
        );
      }
      const expectedPhase = idFromSegment(segments[2], 'P');
      if (expectedPhase && typeof data['phase'] === 'string' && data['phase'] !== expectedPhase) {
        push(
          'phase',
          `Inconsistent \`phase\`: the front matter says \`${String(data['phase'])}\`, the directory says \`${expectedPhase}\`.`,
          'Change `phase` to the P#### of the directory.',
        );
      }
    }

    if (file.type === 'session') {
      const stem = path.posix.basename(file.relPath, '.md');
      if (/^S\d{4}$/.test(stem) && typeof data['session'] === 'string' && data['session'] !== stem) {
        push(
          'session',
          `Inconsistent \`session\`: the front matter says \`${String(data['session'])}\`, the file name says \`${stem}\`.`,
          'Rename the file or fix `session`. IDs are never renumbered.',
        );
      }
      const expectedPhase = idFromSegment(segments[2], 'P');
      if (expectedPhase && typeof data['phase'] === 'string' && data['phase'] !== expectedPhase) {
        push(
          'phase',
          `Inconsistent \`phase\`: the front matter says \`${String(data['phase'])}\`, the phase directory says \`${expectedPhase}\`.`,
          'Change `phase` to the P#### of the containing directory.',
        );
      }
    }

    return out;
  },
};
