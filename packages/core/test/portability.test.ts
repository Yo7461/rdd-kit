import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The core also runs where Node is absent (Claude Code's hooks-module environment, which refuses a
// `node:` import outright). Everything it reads from outside goes through its Host, and the one place
// that may touch Node is the test harness under src/testing/. This test pins that boundary: a `node:`
// import anywhere else in the core's source fails here before it fails inside the plugin

const srcRoot = fileURLToPath(new URL('../src', import.meta.url));

function sourcesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'testing') out.push(...sourcesUnder(full));
    } else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out.sort();
}

describe('the core has no Node of its own', () => {
  it('imports no node: module outside src/testing/', () => {
    const offenders = sourcesUnder(srcRoot).filter((file) => /\bfrom\s+['"]node:/u.test(readFileSync(file, 'utf8')));
    expect(offenders.map((file) => path.relative(srcRoot, file).replace(/\\/g, '/'))).toEqual([]);
  });

  it('imports no bare package at run time except the parsers it ships with (type-only imports are erased)', () => {
    // The bare imports the core may make: its declared dependencies. A type-only import of a types
    // package (`import type … from 'mdast'`) is erased before it runs, so it is allowed as well
    const runtime = new Set(['mdast-util-from-markdown', 'mdast-util-frontmatter', 'mdast-util-to-string', 'micromark-extension-frontmatter', 'yaml']);
    const offenders: string[] = [];
    for (const file of sourcesUnder(srcRoot)) {
      for (const match of readFileSync(file, 'utf8').matchAll(/^import\s+(type\s+)?[^'"]*from\s+['"]([^'".][^'"]*)['"]/gmu)) {
        const isType = match[1] !== undefined;
        const specifier = match[2] ?? '';
        if (!isType && !runtime.has(specifier)) offenders.push(`${path.relative(srcRoot, file)}: ${specifier}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
