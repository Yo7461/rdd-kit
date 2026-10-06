import { describe, expect, it } from 'vitest';
import path, { basename, dirname, isAbsolute, join, normalize, posix, relative, resolve } from '../src/path.js';

// The core's own path functions stand in for node:path where Node is absent. Every result uses `/`,
// both separators are read, a drive letter is a root (written in upper case), and nothing here knows
// the working directory

describe('normalize', () => {
  it('turns backslashes into slashes, folds . and .., and keeps a trailing slash as node:path does', () => {
    expect(normalize('a\\b\\..\\c\\.\\d\\')).toBe('a/c/d/');
    expect(normalize('/a//b/./c/../d')).toBe('/a/b/d');
    expect(normalize('roadmap/x.md/')).toBe('roadmap/x.md/'); // a link to a file written with a slash stays distinguishable
    expect(normalize('')).toBe('.');
    expect(normalize('.')).toBe('.');
    expect(normalize('a/..')).toBe('.');
    expect(normalize('a/../')).toBe('./');
  });

  it('keeps a relative path that climbs above its start, and stops an absolute one at its root', () => {
    expect(normalize('../../a')).toBe('../../a');
    expect(normalize('a/../../b')).toBe('../b');
    expect(normalize('/../a')).toBe('/a');
    expect(normalize('C:\\..\\a')).toBe('C:/a');
  });

  it('reads a drive and a UNC share as roots, the drive letter in upper case, and does not climb above a share', () => {
    expect(normalize('c:\\Projects\\x\\..\\z')).toBe('C:/Projects/z');
    expect(normalize('C:/')).toBe('C:/');
    expect(normalize('\\\\server\\share\\a\\..\\b')).toBe('//server/share/b');
    expect(normalize('//server/share/proj/../../x')).toBe('//server/share/x');
    expect(normalize('/')).toBe('/');
  });
});

describe('posix', () => {
  it('reads only / as a separator and only / as a root, as node:path.posix does', () => {
    expect(posix.normalize('roadmap/assets\\E0001\\run.mjs')).toBe('roadmap/assets\\E0001\\run.mjs');
    expect(posix.join('a\\b', 'c')).toBe('a\\b/c');
    expect(posix.normalize('C:/a/../b')).toBe('C:/b'); // a drive is an ordinary segment here
    expect(posix.normalize('C:/..')).toBe('.');
    expect(posix.dirname('a\\b/c')).toBe('a\\b');
    expect(posix.basename('a\\b/c.md', '.md')).toBe('c');
  });
});

describe('isAbsolute', () => {
  it('is true for a POSIX root, a drive, and a UNC path, and false for everything else', () => {
    expect(isAbsolute('/a')).toBe(true);
    expect(isAbsolute('C:\\a')).toBe(true);
    expect(isAbsolute('c:/a')).toBe(true);
    expect(isAbsolute('\\\\server\\share')).toBe(true);
    expect(isAbsolute('a/b')).toBe(false);
    expect(isAbsolute('C:a')).toBe(false); // drive-relative — not a root
    expect(isAbsolute('')).toBe(false);
  });
});

describe('join and resolve', () => {
  it('join concatenates and normalizes, skipping empty parts', () => {
    expect(join('a', 'b', 'c')).toBe('a/b/c');
    expect(join('C:\\proj', 'roadmap', '..', 'x.md')).toBe('C:/proj/x.md');
    expect(join('', 'a', '')).toBe('a');
    expect(join()).toBe('.');
    expect(join('/a/', '/b')).toBe('/a/b');
  });

  it('resolve reads right to left up to the last absolute segment, drops a trailing slash, and keeps a relative result relative', () => {
    expect(resolve('C:\\proj', 'roadmap\\status.md')).toBe('C:/proj/roadmap/status.md');
    expect(resolve('/x', 'C:/proj', 'a')).toBe('C:/proj/a');
    expect(resolve('/x', '/y/z', '..', 'w')).toBe('/y/w');
    expect(resolve('a', 'b')).toBe('a/b');
    expect(resolve('.')).toBe('.');
    expect(resolve('C:\\proj\\roadmap\\..\\roadmap')).toBe('C:/proj/roadmap');
    expect(resolve('C:\\proj\\')).toBe('C:/proj');
    expect(resolve('/a/b/')).toBe('/a/b');
    expect(resolve('C:/')).toBe('C:/');
  });
});

describe('dirname and basename', () => {
  it('dirname is the parent, the root for a top-level entry, and . for a bare name', () => {
    expect(dirname('/a/b/c')).toBe('/a/b');
    expect(dirname('C:\\a\\b')).toBe('C:/a');
    expect(dirname('C:\\a')).toBe('C:/');
    expect(dirname('/a')).toBe('/');
    expect(dirname('/')).toBe('/');
    expect(dirname('a')).toBe('.');
    expect(dirname('a/b/')).toBe('a');
    expect(dirname('/a/b/')).toBe('/a');
    expect(dirname('//server/share/a')).toBe('//server/share/');
  });

  it('basename is the last segment, with the extension removed as node:path removes it', () => {
    expect(basename('/a/b/c.md')).toBe('c.md');
    expect(basename('C:\\a\\b\\S0001.md', '.md')).toBe('S0001');
    expect(basename('roadmap/x/')).toBe('x');
    expect(basename('.md', '.md')).toBe(''); // the name is the extension alone — node:path gives '' too
    expect(basename('a.txt', '.md')).toBe('a.txt');
  });
});

describe('relative', () => {
  it('walks up and down between two paths of the same kind', () => {
    expect(relative('/a/b', '/a/b/c/d')).toBe('c/d');
    expect(relative('/a/b/c', '/a/d')).toBe('../../d');
    expect(relative('C:\\proj', 'C:\\proj\\roadmap\\status.md')).toBe('roadmap/status.md');
    expect(relative('c:\\proj\\x', 'C:\\proj\\y')).toBe('../y');
    expect(relative('/a/b', '/a/b')).toBe('');
    expect(relative('a/b', 'a/c')).toBe('../c');
    expect(relative('/', '/a')).toBe('a');
    expect(relative('/a/', '/a/b/')).toBe('b');
  });

  it('returns the target as it is when the two paths have different roots', () => {
    expect(relative('C:/a', 'D:/b')).toBe('D:/b');
    expect(relative('/a', 'C:/b')).toBe('C:/b');
  });
});

describe('the default export and posix', () => {
  it('carry the same functions under the names the rules and the engine use', () => {
    expect(path.join('a', 'b')).toBe('a/b');
    expect(posix.join('roadmap', 'spec', 'map.md')).toBe('roadmap/spec/map.md');
    expect(posix.normalize('roadmap/./spec/../map.md')).toBe('roadmap/map.md');
    expect(posix.dirname('roadmap/spec/map.md')).toBe('roadmap/spec');
    expect(posix.basename('roadmap/spec/map.md', '.md')).toBe('map');
    expect(path.posix).toBe(posix);
  });
});
