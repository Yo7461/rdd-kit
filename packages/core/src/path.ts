/**
 * The path functions the core needs, with no `node:path` behind them — the core also runs where Node
 * is absent (Claude Code's hooks-module environment). Two flavours, as node:path has:
 *
 * - The named exports and the default export stand in for `node:path` on the host's paths (the
 *   target directory, the files walked, the config file). Both separators are read, every result uses
 *   `/`, and a Windows drive (`C:/`) or a UNC share (`//server/share/`) is a root, the drive letter
 *   written in upper case so that two spellings of one path compare equal. Nothing else is folded:
 *   the comparisons are case-sensitive, as node:path's are.
 * - `posix` stands in for `node:path.posix` on the paths the records write (always `/`): a backslash
 *   is an ordinary character there, as it is for node:path.posix, and the only root is `/`.
 *
 * Nothing here knows the working directory: `resolve` with no absolute segment returns the normalized
 * relative path, and a caller that wants an absolute result passes an absolute base (the CLI resolves
 * its argument with Node, the mod with the session's working directory).
 */

interface PathFns {
  isAbsolute(p: string): boolean;
  normalize(p: string): string;
  join(...parts: string[]): string;
  resolve(...parts: string[]): string;
  dirname(p: string): string;
  basename(p: string, ext?: string): string;
  relative(from: string, to: string): string;
}

function build(hostPaths: boolean): PathFns {
  const slashes = (p: string): string => (hostPaths ? p.replace(/\\/g, '/') : p);

  /** The root prefix of an absolute path (`/`, `C:/`, `//server/share/`), or '' for a relative one. */
  const rootOf = (p: string): string => {
    if (hostPaths) {
      if (/^[A-Za-z]:\//.test(p)) return `${p[0]?.toUpperCase() ?? ''}:/`;
      const unc = /^\/\/[^/]+\/[^/]+/.exec(p);
      if (unc) return `${unc[0]}/`;
      if (p.startsWith('//')) return '//';
    }
    if (p.startsWith('/')) return '/';
    return '';
  };

  const isAbsolute = (p: string): boolean => rootOf(slashes(p)) !== '';

  /** Folds `.` and `..`, collapses repeated separators, and keeps a trailing separator as node:path does. */
  const normalize = (p: string): string => {
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
    let out = root + segments.join('/');
    if (out === '') out = '.';
    if (s.endsWith('/') && out !== root && !out.endsWith('/')) out += '/';
    return out;
  };

  /** A path with its trailing separators removed, the root kept whole. */
  const trimmed = (p: string): string => {
    const n = normalize(p);
    const root = rootOf(n);
    let end = n.length;
    while (end > root.length && n[end - 1] === '/') end--;
    return end === n.length ? n : n.slice(0, end);
  };

  const join = (...parts: string[]): string => {
    const kept = parts.filter((part) => part !== '');
    return kept.length === 0 ? '.' : normalize(kept.join('/'));
  };

  /** Resolves right to left until an absolute segment is found; with none, the normalized relative join. */
  const resolve = (...parts: string[]): string => {
    let acc = '';
    for (let i = parts.length - 1; i >= 0; i--) {
      const part = parts[i] ?? '';
      if (part === '') continue;
      acc = acc === '' ? part : `${part}/${acc}`;
      if (isAbsolute(part)) break;
    }
    return trimmed(acc);
  };

  const dirname = (p: string): string => {
    const n = trimmed(p);
    const root = rootOf(n);
    if (n === root) return n;
    const i = n.lastIndexOf('/');
    if (i < 0) return '.';
    if (i < root.length) return root;
    return n.slice(0, i);
  };

  /** The last segment, with `ext` removed when the name ends with it (a name that is `ext` alone becomes '', as with node:path). */
  const basename = (p: string, ext?: string): string => {
    const n = slashes(p).replace(/\/+$/, '');
    const name = n.slice(n.lastIndexOf('/') + 1);
    if (ext !== undefined && ext !== '' && name.endsWith(ext)) return name.slice(0, -ext.length);
    return name;
  };

  /** The path from `from` to `to`, both read as the same kind (absolute or relative). Two paths under different roots have no relative path, so `to` is returned as it is. */
  const relative = (from: string, to: string): string => {
    const a = trimmed(from);
    const b = trimmed(to);
    const rootA = rootOf(a);
    const rootB = rootOf(b);
    if (rootA !== rootB) return b;
    const segmentsA = a === rootA || a === '.' ? [] : a.slice(rootA.length).split('/');
    const segmentsB = b === rootB || b === '.' ? [] : b.slice(rootB.length).split('/');
    let common = 0;
    while (common < segmentsA.length && common < segmentsB.length && segmentsA[common] === segmentsB[common]) common++;
    const up = segmentsA.slice(common).map(() => '..');
    return [...up, ...segmentsB.slice(common)].join('/');
  };

  return { isAbsolute, normalize, join, resolve, dirname, basename, relative };
}

const host = build(true);
const posixFns = build(false);

export const { isAbsolute, normalize, join, resolve, dirname, basename, relative } = host;

/** The functions the rules use on the records' own paths, with node:path.posix's reading: `/` is the only separator. */
export const posix = {
  join: posixFns.join,
  normalize: posixFns.normalize,
  dirname: posixFns.dirname,
  basename: posixFns.basename,
};

const path = { isAbsolute, normalize, join, resolve, dirname, basename, relative, posix };
export default path;
