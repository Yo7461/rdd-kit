import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

// Checks on the committed distribution artifacts that scripts/build-plugin.mjs generates: the readable
// copy of the core and its dependencies under plugin/lib (what the plugin's hooks module imports), the
// license files, and the CLI bundle of the npm channel. Their freshness is verified byte for byte by
// `pnpm run build:plugin -- --check` (the same manual convention as regen:fixtures); what is checked here
// is the shape the artifacts must have, from the files themselves.

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const pluginDir = path.join(repoRoot, 'plugin');
const libDir = path.join(pluginDir, 'lib');
const coreCopyDir = path.join(libDir, 'core');
const vendorDir = path.join(libDir, 'vendor');
const coreSrcDir = path.join(repoRoot, 'packages', 'core', 'src');
const cliDir = path.join(repoRoot, 'packages', 'cli');
const bundlePath = path.join(cliDir, 'bundle', 'roadmap-lint.cjs');

/** Every file under a directory, as POSIX paths relative to it, sorted. */
function filesUnder(dir: string, skip?: string): string[] {
  const out: string[] = [];
  const walk = (rel: string): void => {
    for (const entry of readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const next = rel === '' ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name !== skip) walk(next);
      } else out.push(next);
    }
  };
  walk('');
  return out.sort();
}

const read = (file: string): string => readFileSync(file, 'utf8');
const isFile = (file: string): boolean => existsSync(file) && statSync(file).isFile();

/** The specifiers a source imports: `from '…'` of an import or an export, and `import('…')`. Each with whether the statement is type-only. */
function specifiersOf(source: string): { specifier: string; isTypeOnly: boolean }[] {
  // A JSDoc comment names types as `import('mdast').Root` — a type, erased, not an import
  const text = source.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/^\s*\/\/.*$/gmu, '');
  const out: { specifier: string; isTypeOnly: boolean }[] = [];
  for (const match of text.matchAll(/^(import|export)\b([^'"]*?)\bfrom\s*['"]([^'"]+)['"]/gmu)) {
    out.push({ specifier: match[3] as string, isTypeOnly: /^\s+type\s/u.test(match[2] as string) });
  }
  for (const match of text.matchAll(/^import\s+['"]([^'"]+)['"]/gmu)) out.push({ specifier: match[1] as string, isTypeOnly: false });
  for (const match of text.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/gu)) out.push({ specifier: match[1] as string, isTypeOnly: false });
  return out;
}

/** A source text with every import specifier replaced by one placeholder, so two files compare apart from where they import from. */
const withoutSpecifiers = (text: string): string =>
  text.replace(/(\bfrom\s*|\bimport\s*\(?\s*)(['"])[^'"]+\2/gu, (_match, lead: string, quote: string) => `${lead}${quote}…${quote}`);

/** `name version` of every entry of a third-party list, and the block of text under each. */
function entriesOf(list: string): { id: string; name: string; version: string; license: string; block: string }[] {
  const heads = [...list.matchAll(/^(\S+) (\d+\.\d+\.\d+\S*) — (.+)$/gmu)];
  const blocks = list.split(/^=+\n\S+ \d+\.\d+\.\d+\S* — .+\n=+\n/mu).slice(1);
  expect(blocks.length).toBe(heads.length);
  return heads.map((match, index) => ({
    id: `${match[1] as string} ${match[2] as string}`,
    name: match[1] as string,
    version: match[2] as string,
    license: (match[3] as string).replace(/\s*\(.*\)$/u, ''),
    block: blocks[index] as string,
  }));
}

/** The packages a vendor copy holds, by directory: `name` (scoped ones under their scope directory). */
function vendorPackages(): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(vendorDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('@')) {
      for (const inner of readdirSync(path.join(vendorDir, entry.name))) out.push(`${entry.name}/${inner}`);
    } else out.push(entry.name);
  }
  return out.sort();
}

it('precondition: the generated files are committed (run pnpm run build:plugin when they are not)', () => {
  expect(existsSync(path.join(coreCopyDir, 'index.ts'))).toBe(true);
  expect(existsSync(vendorDir)).toBe(true);
  expect(existsSync(bundlePath)).toBe(true);
});

describe('the plugin directory', () => {
  it('ships no bin/ and no bundle: its hooks are one module, and what the module imports sits under lib/', () => {
    expect(existsSync(path.join(pluginDir, 'bin'))).toBe(false);
    expect(readdirSync(path.join(pluginDir, 'hooks')).sort()).toEqual(['hooks.json', 'register.ts']);
    expect(JSON.parse(read(path.join(pluginDir, 'hooks', 'hooks.json')))).toEqual({ modules: ['./register.ts'] });
    expect(readdirSync(libDir).sort()).toEqual(['core', 'vendor']);
  });

  it('has every file of lib/ in git — none hidden by an ignore rule (a dependency ships files under a directory named dist)', () => {
    // Needs git. The copy is regenerated whole, so a file git ignores is a file the published plugin would lack
    const ignored = spawnSync('git', ['ls-files', '--others', '--ignored', '--exclude-standard', '--', 'plugin/lib'], { cwd: repoRoot, encoding: 'utf8' });
    expect(ignored.error, 'git could not be started (is it on the PATH?)').toBeUndefined();
    expect(ignored.status, ignored.stderr).toBe(0);
    expect(ignored.stdout.trim()).toBe('');
    // And the copy on disk is what git sees: the same files, no more (-z: a name is never quoted)
    const tracked = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', 'plugin/lib'], { cwd: repoRoot, encoding: 'utf8' });
    expect(tracked.status, tracked.stderr).toBe(0);
    expect(tracked.stdout.split('\0').filter((name) => name !== '').sort()).toEqual(filesUnder(libDir).map((rel) => `plugin/lib/${rel}`));
  });
});

describe('the readable copy of the core under plugin/lib/core', () => {
  it('holds every source file of packages/core/src but testing/, and nothing else', () => {
    expect(filesUnder(coreCopyDir)).toEqual(filesUnder(coreSrcDir, 'testing'));
  });

  it('is the source itself — each file differs from its original only in where it imports from', () => {
    for (const rel of filesUnder(coreCopyDir)) {
      expect(withoutSpecifiers(read(path.join(coreCopyDir, rel))), rel).toBe(withoutSpecifiers(read(path.join(coreSrcDir, rel))));
    }
  });

  it('imports its own files as .ts, the dependencies by relative path into lib/vendor, and nothing bare but a type', () => {
    for (const rel of filesUnder(coreCopyDir)) {
      for (const { specifier, isTypeOnly } of specifiersOf(read(path.join(coreCopyDir, rel)))) {
        const hint = `${rel} imports ${specifier}`;
        if (!specifier.startsWith('.')) {
          expect(isTypeOnly, `${hint}, which is bare and not a type`).toBe(true);
          continue;
        }
        const target = path.posix.normalize(path.posix.join('core', path.posix.dirname(rel), specifier));
        expect(isFile(path.join(libDir, target)), `${hint}, and ${target} is not a file of the copy`).toBe(true);
        if (target.startsWith('core/')) expect(specifier.endsWith('.ts'), `${hint} — a file of the core is imported as .ts`).toBe(true);
        else expect(target.startsWith('vendor/'), hint).toBe(true);
      }
    }
  });
});

describe('the dependencies under plugin/lib/vendor', () => {
  it('import nothing but their own files and each other, by relative path that resolves inside lib/vendor; no node: module anywhere under lib/', () => {
    for (const rel of filesUnder(libDir)) {
      if (!/\.(m?js|cjs|ts)$/u.test(rel)) continue; // the license files
      const text = read(path.join(libDir, rel));
      expect(text, `${rel} names a node: module`).not.toMatch(/\bfrom\s*['"]node:/u);
      if (!rel.startsWith('vendor/')) continue;
      for (const { specifier } of specifiersOf(text)) {
        const hint = `${rel} imports ${specifier}`;
        expect(specifier.startsWith('.'), `${hint}, which is not a relative path`).toBe(true);
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(rel), specifier));
        expect(target.startsWith('vendor/'), `${hint}, which leaves lib/vendor`).toBe(true);
        expect(isFile(path.join(libDir, target)), `${hint}, and ${target} is not a file of the copy`).toBe(true);
      }
    }
  });

  it('hold no code built from a string and no invisible character, and say at the head of a copy and in the list where a copy differs from the installed file', () => {
    // Anthropic's directory reads the hooks module and every file it imports as text: an eval or a Function
    // constructor anywhere is refused, even in a branch that never runs, and an invisible character in a string
    // or a comment is held for a reviewer. The build patches the one and escapes the other, and marks each
    // changed copy at its head and in the third-party list — the two have to agree
    const ranges: [number, number][] = [
      [0xa0, 0xa0], [0xad, 0xad], [0x34f, 0x34f], [0x61c, 0x61c], [0x115f, 0x1160], [0x1680, 0x1680], [0x17b4, 0x17b5],
      [0x180b, 0x180e], [0x2000, 0x200f], [0x2028, 0x202f], [0x205f, 0x2064], [0x2066, 0x206f], [0x3000, 0x3000],
      [0x3164, 0x3164], [0xfe00, 0xfe0f], [0xfeff, 0xfeff], [0xffa0, 0xffa0], [0xfff9, 0xfffb], [0xe0000, 0xe007f], [0xe0100, 0xe01ef],
    ];
    const invisible = new RegExp(`[${ranges.map(([from, to]) => `\\u{${from.toString(16)}}-\\u{${to.toString(16)}}`).join('')}]`, 'u');
    const marked: string[] = [];
    for (const rel of filesUnder(pluginDir)) {
      const text = read(path.join(pluginDir, rel));
      expect(text, `${rel} holds an invisible character`).not.toMatch(invisible);
      if (/\.(m?js|cjs|ts)$/u.test(rel)) expect(text, `${rel} builds code from a string`).not.toMatch(/\beval\s*\(|,\s*eval\s*\)|\bFunction\s*\(/u);
      if (text.startsWith("// Modified in this copy by rdd-kit's build (scripts/build-plugin.mjs): ")) marked.push(rel);
    }
    expect(marked).toContain('lib/vendor/format/format.js'); // the eval the directory refused
    const listed = [...read(path.join(pluginDir, 'THIRD-PARTY-LICENSES.txt')).matchAll(/^Modified in rdd-kit's copy \((lib\/vendor\/[^:]+): /gmu)].map((match) => match[1] as string);
    expect([...new Set(listed)].sort()).toEqual(marked.sort());
  });

  // The copy as a module package of its own, outside the repository: what Node itself makes of it, with
  // no test runner resolving imports on its behalf
  const packageDir = mkdtempSync(path.join(tmpdir(), 'rdd-kit-lib-'));
  if (existsSync(libDir)) {
    cpSync(libDir, path.join(packageDir, 'lib'), { recursive: true });
    writeFileSync(path.join(packageDir, 'package.json'), '{ "type": "module" }\n');
  }
  afterAll(() => rmSync(packageDir, { recursive: true, force: true, maxRetries: 3 }));

  it('load as ES modules under Node itself — the one CommonJS dependency included, converted', () => {
    const script = path.join(packageDir, 'load-vendor.mjs');
    writeFileSync(
      script,
      [
        "import { readdirSync } from 'node:fs';",
        "import path from 'node:path';",
        "import { fileURLToPath, pathToFileURL } from 'node:url';",
        "const root = fileURLToPath(new URL('./lib/vendor/', import.meta.url));",
        'const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : /\\.(m?js|cjs)$/.test(e.name) ? [path.join(dir, e.name)] : []));',
        'let count = 0;',
        'for (const file of walk(root)) { await import(pathToFileURL(file).href); count++; }',
        'process.stdout.write(String(count));',
      ].join('\n'),
    );
    const res = spawnSync(process.execPath, [script], { encoding: 'utf8', cwd: packageDir });
    expect(res.status, res.stderr).toBe(0);
    expect(Number(res.stdout)).toBe(filesUnder(vendorDir).filter((rel) => /\.(m?js|cjs)$/u.test(rel)).length);
  });

  it('run the core without the globals the engine leaves out — no console, no timers — and with code generation from strings forbidden', () => {
    // The hooks-module environment has neither Node nor the browser's globals; a dependency that reaches for
    // `console` (yaml's parser, to print a warning) would throw there. Node strips the copy's types itself
    const script = path.join(packageDir, 'lint-without-globals.mjs');
    writeFileSync(
      script,
      [
        "import { execFile } from 'node:child_process';",
        "import { access, readdir, readFile, stat } from 'node:fs/promises';",
        "import { pathToFileURL } from 'node:url';",
        'const [target, configFile, yaml] = process.argv.slice(2);',
        "const core = await import(new URL('./lib/core/index.ts', import.meta.url).href);",
        "const kindOf = (s) => (s.isFile() ? 'file' : s.isDirectory() ? 'dir' : 'other');",
        'const host = {',
        "  readText: (file) => readFile(file, 'utf8'),",
        '  exists: (p) => access(p).then(() => true, () => false),',
        '  listDir: async (dir) => (await readdir(dir, { withFileTypes: true })).map((e) => ({ name: e.name, kind: kindOf(e) })),',
        '  stat: (p) => stat(p).then((s) => ({ kind: kindOf(s) }), () => null),',
        "  run: (argv) => new Promise((resolve, reject) => execFile(argv[0], argv.slice(1), { encoding: 'utf8', windowsHide: true }, (error, stdout, stderr) => (error === null ? resolve({ exitCode: 0, stdout, stderr }) : typeof error.code === 'number' ? resolve({ exitCode: error.code, stdout, stderr }) : reject(error)))),",
        '};',
        "for (const name of ['console', 'Buffer', 'setTimeout', 'setInterval', 'setImmediate', 'clearTimeout', 'clearInterval', 'clearImmediate', 'queueMicrotask', 'fetch']) delete globalThis[name];",
        'const frontMatter = core.parseFrontMatterValue(yaml);',
        'const config = await core.loadConfigFile(configFile, host);',
        "const linted = await core.lintPath(target, host, config, { now: new Date('2026-07-01T00:00:00Z') });",
        'process.stdout.write(JSON.stringify({ frontMatter, report: core.toJsonReport(linted) }));',
      ].join('\n'),
    );
    const res = spawnSync(
      process.execPath,
      ['--disallow-code-generation-from-strings', script, path.join(repoRoot, 'fixtures', 'valid'), path.join(repoRoot, 'lint-corpus.config.json'), 'updated: !custom 2026-07-01\n'],
      { encoding: 'utf8', cwd: packageDir },
    );
    expect(res.status, res.stderr).toBe(0);
    const out = JSON.parse(res.stdout) as { frontMatter: { data: unknown; parseError: string | null }; report: { diagnostics: unknown[]; summary: { filesChecked: number } } };
    // An unresolved tag is a warning the parser would print — kept to itself, the value still parses
    expect(out.frontMatter).toEqual({ data: { updated: '2026-07-01' }, parseError: null });
    expect(out.report.summary.filesChecked).toBeGreaterThan(0);
    expect(out.report.diagnostics).toEqual([]);
  });

  it('are listed in THIRD-PARTY-LICENSES.txt, every one, at the installed version, with the license files each ships beside its files', () => {
    const list = read(path.join(pluginDir, 'THIRD-PARTY-LICENSES.txt'));
    expect(list).not.toContain('\r');
    const entries = entriesOf(list);
    expect(entries.map((entry) => entry.name)).toEqual(vendorPackages());
    expect(list).toContain(`Packages: ${entries.length}.`);

    // The installed version, read from the package's own manifest in pnpm's store (the store directory's
    // name carries the version too, but a peer suffix or pnpm's shortening of a long name can hide it)
    const store = path.join(repoRoot, 'node_modules', '.pnpm');
    const installed = (name: string): string[] =>
      readdirSync(store).flatMap((dir) => {
        const manifest = path.join(store, dir, 'node_modules', name, 'package.json');
        return isFile(manifest) ? [(JSON.parse(read(manifest)) as { version: string }).version] : [];
      });
    for (const { name, version } of entries) expect(installed(name), `${name}@${version} is installed`).toContain(version);

    // Every entry carries what its license requires a copy to carry: the copyright line, and the
    // permission notice of the declared license (a license text, or the standard text written for a
    // package that ships none). A declared license this map does not know fails here until it is added
    const PERMISSION_NOTICE: Record<string, string> = {
      MIT: 'Permission is hereby granted, free of charge',
      ISC: 'Permission to use, copy, modify, and/or distribute this software',
    };
    const declared = new Set<string>();
    for (const { name, license, block } of entries) {
      declared.add(license);
      expect(PERMISSION_NOTICE[license], `${name}: declared license ${license}`).toBeDefined();
      // The holder's line, not a wrapped "copyright notice and this permission notice" of the text itself
      expect(block, `${name}: copyright line`).toMatch(/^(?:\s*\S+: )?Copyright\b(?! notice)/mu);
      expect(block, `${name}: permission notice`).toContain(PERMISSION_NOTICE[license]);
      // The copy carries the package's own license files, or the list says the package ships none
      const shipped = readdirSync(path.join(vendorDir, name)).filter((file) => /licen[cs]e|^copying/iu.test(file) && statSync(path.join(vendorDir, name, file)).isFile());
      expect(shipped.length > 0, `${name}: license files in the copy`).toBe(!block.includes('No license file is shipped with this package.'));
    }
    // The READMEs name the licenses the copy carries
    for (const document of ['README.md', path.join('plugin', 'README.md')]) {
      const text = read(path.join(repoRoot, document));
      for (const id of declared) expect(text, `${document} names ${id}`).toContain(id);
    }
  });

  it('cover every package the CLI bundle inlines, at the same version', () => {
    // The bundle carries a `// node_modules/.pnpm/<store dir>/node_modules/<package>/<file>` comment
    // above every inlined module (what tree shaking kept — a subset of the copy); the version is read
    // from that package directory's package.json — the store directory name carries it too, but a
    // peer suffix (`_<peer>@<version>`) or pnpm's shortening of a long name can hide it
    const inlined = new Set<string>();
    for (const match of read(bundlePath).matchAll(/^\s*\/\/ (node_modules\/\.pnpm\/[^/\n]+\/node_modules\/((?:@[^/\n]+\/)?[^/\n]+))\//gmu)) {
      const { version } = JSON.parse(read(path.join(repoRoot, match[1] as string, 'package.json'))) as { version: string };
      inlined.add(`${match[2] as string} ${version}`);
    }
    expect(inlined.size).toBeGreaterThan(0);
    const listed = new Set(entriesOf(read(path.join(pluginDir, 'THIRD-PARTY-LICENSES.txt'))).map((entry) => entry.id));
    expect([...inlined].filter((id) => !listed.has(id))).toEqual([]);
  });
});

describe('the license files', () => {
  it('plugin/LICENSE is the root LICENSE, and the npm package carries the same two files as the plugin', () => {
    expect(readFileSync(path.join(pluginDir, 'LICENSE')).equals(readFileSync(path.join(repoRoot, 'LICENSE')))).toBe(true);
    expect(readFileSync(path.join(cliDir, 'LICENSE')).equals(readFileSync(path.join(repoRoot, 'LICENSE')))).toBe(true);
    expect(
      readFileSync(path.join(cliDir, 'THIRD-PARTY-LICENSES.txt')).equals(readFileSync(path.join(pluginDir, 'THIRD-PARTY-LICENSES.txt'))),
    ).toBe(true);
  });
});

describe('the CLI bundle of the npm channel', () => {
  // Self-containment is checked in an isolated copy outside the repository (it must depend on neither
  // node_modules nor a package.json — the same conditions as a global npm install's bin directory)
  const isolatedDir = mkdtempSync(path.join(tmpdir(), 'rdd-kit-bundle-'));
  if (existsSync(bundlePath)) cpSync(bundlePath, path.join(isolatedDir, 'roadmap-lint.cjs'));
  afterAll(() => rmSync(isolatedDir, { recursive: true, force: true }));

  function runIsolated(args: string[]) {
    return spawnSync(process.execPath, [path.join(isolatedDir, 'roadmap-lint.cjs'), ...args], { encoding: 'utf8', cwd: isolatedDir });
  }

  it('is a single CJS file with a shebang, reporting the version of packages/cli/package.json from --version (injected through define)', () => {
    expect(read(bundlePath).startsWith('#!/usr/bin/env node\n')).toBe(true);
    const { version } = JSON.parse(read(path.join(cliDir, 'package.json'))) as { version: string };
    const res = runIsolated(['--version']);
    expect(res.status).toBe(0);
    expect(res.stdout.trim()).toBe(version);
  });

  it('lints the valid corpus from the isolated copy with no diagnostics (self-contained)', () => {
    // The GIT rules judge the host repository's git state rather than the corpus, so lint-corpus.config.json
    // takes them out of scope (the same config the corpus checks and lint:corpus use)
    const res = runIsolated([path.join(repoRoot, 'fixtures', 'valid'), '--config', path.join(repoRoot, 'lint-corpus.config.json'), '--format', 'json']);
    expect(res.status).toBe(0);
    const report = JSON.parse(res.stdout) as { diagnostics: { rule: string }[] };
    expect(report.diagnostics).toEqual([]);
  });

  it('package.json: bin points at the bundle, there are no runtime dependencies, and files holds the bundle, the hook, the two license files, and the copyright notice alone', () => {
    const pkg = JSON.parse(read(path.join(cliDir, 'package.json'))) as {
      bin: Record<string, string>;
      files: string[];
      dependencies?: Record<string, string>;
    };
    expect(pkg.bin).toEqual({ 'roadmap-lint': 'bundle/roadmap-lint.cjs' });
    // LICENSE is a generated copy of the root file and is listed explicitly: pnpm's own copying of the
    // workspace LICENSE is skipped as soon as any packed file name contains "LICENSE"
    expect(pkg.files).toEqual(['bundle', 'hooks', 'LICENSE', 'NOTICE', 'THIRD-PARTY-LICENSES.txt']);
    expect(pkg.dependencies).toBeUndefined();
  });

  it('packs exactly the bundle, the hook, the two license files, the copyright notice, and package.json (npm pack --dry-run)', () => {
    // Needs npm on the PATH. One command string through the shell, so the shell resolves npm.cmd / npm.exe
    // on Windows without a deprecation warning; --ignore-scripts keeps a lifecycle script's output out of stdout
    const res = spawnSync('npm pack --dry-run --json --ignore-scripts', { encoding: 'utf8', cwd: cliDir, shell: true });
    expect(res.error, 'npm could not be started (is it on the PATH?)').toBeUndefined();
    expect(res.status, res.stderr).toBe(0);
    const [packed] = JSON.parse(res.stdout) as { files: { path: string }[] }[];
    expect(packed?.files.map((file) => file.path).sort()).toEqual([
      'LICENSE',
      'NOTICE',
      'THIRD-PARTY-LICENSES.txt',
      'bundle/roadmap-lint.cjs',
      'hooks/roadmap-lint-hook.mjs',
      'package.json',
    ]);
  });
});
