/**
 * The path functions the core needs, with no `node:path` behind them — the core also runs where Node
 * is absent (Claude Code's hooks-module environment). Both separators are accepted on input, and
 * every result uses `/`, so a path computed here is the POSIX form the diagnostics already use.
 *
 * A Windows drive (`C:`) and a UNC prefix (`//server/share`) are roots; the drive letter is written
 * in upper case so that two spellings of one path compare equal. Nothing here knows the working
 * directory: `resolve` with no absolute segment returns the normalized relative path, and a caller
 * that wants an absolute result passes an absolute base (the CLI resolves its argument with Node,
 * the mod with the session's working directory).
 */

function slashes(p: string): string {
  return p.replace(/\\/g, '/');
}

/** The root prefix of an absolute path (`/`, `C:/`, `//`), or '' for a relative one. */
function rootOf(p: string): string {
  if (/^[A-Za-z]:\//.test(p)) return `${p[0]?.toUpperCase() ?? ''}:/`;
  if (p.startsWith('//')) return '//';
  if (p.startsWith('/')) return '/';
  return '';
}

export function isAbsolute(p: string): boolean {
  return rootOf(slashes(p)) !== '';
}

export function normalize(p: string): string {
  const s = slashes(p);
  const root = rootOf(s);
  const segments: string[] = [];
  for (const segment of s.slice(root.length).split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (segments.length > 0 && segments[segments.length - 1] !== '..') segments.pop();
      else if (root === '') segments.push('..'); // a relative path may climb above its start; an absolute one stops at its root
      continue;
    }
    segments.push(segment);
  }
  const joined = segments.join('/');
  if (root !== '') return root + joined;
  return joined === '' ? '.' : joined;
}

export function join(...parts: string[]): string {
  const kept = parts.filter((part) => part !== '');
  return kept.length === 0 ? '.' : normalize(kept.join('/'));
}

/** Resolves right to left until an absolute segment is found; with none, the normalized relative join. */
export function resolve(...parts: string[]): string {
  let acc = '';
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i] ?? '';
    if (part === '') continue;
    acc = acc === '' ? part : `${part}/${acc}`;
    if (isAbsolute(part)) break;
  }
  return normalize(acc);
}

export function dirname(p: string): string {
  const n = normalize(p);
  const root = rootOf(n);
  if (n === root) return n;
  const i = n.lastIndexOf('/');
  if (i < 0) return '.';
  if (i < root.length) return root;
  return n.slice(0, i);
}

/** The last segment, with `ext` removed when the name ends with it and is not `ext` alone (as Node's basename does). */
export function basename(p: string, ext?: string): string {
  const n = slashes(p).replace(/\/+$/, '');
  const name = n.slice(n.lastIndexOf('/') + 1);
  if (ext !== undefined && ext !== '' && name !== ext && name.endsWith(ext)) return name.slice(0, -ext.length);
  return name;
}

/** The path from `from` to `to`, both read as the same kind (absolute or relative). Two paths under different roots have no relative path, so `to` is returned as it is. */
export function relative(from: string, to: string): string {
  const a = normalize(from);
  const b = normalize(to);
  const rootA = rootOf(a);
  const rootB = rootOf(b);
  if (rootA !== rootB) return b;
  const segmentsA = a === rootA || a === '.' ? [] : a.slice(rootA.length).split('/');
  const segmentsB = b === rootB || b === '.' ? [] : b.slice(rootB.length).split('/');
  let common = 0;
  while (common < segmentsA.length && common < segmentsB.length && segmentsA[common] === segmentsB[common]) common++;
  const up = segmentsA.slice(common).map(() => '..');
  return [...up, ...segmentsB.slice(common)].join('/');
}

/** The same functions under the name the rules used with Node's `path.posix` — every result here is POSIX already. */
export const posix = { join, normalize, dirname, basename };

const path = { isAbsolute, normalize, join, resolve, dirname, basename, relative, posix };
export default path;
