#!/usr/bin/env node
// Generate the committed distribution artifacts, all in one go:
//   plugin/lib/core/**                    the lint core as readable source — packages/core/src without testing/
//   plugin/lib/vendor/<package>/**        the third-party packages the core imports, as readable source, each
//                                         with the license files it ships
//   plugin/LICENSE                        a copy of the root LICENSE (an installed plugin is the plugin/ directory alone)
//   plugin/THIRD-PARTY-LICENSES.txt       the license of every package copied into plugin/lib/vendor
//   packages/cli/bundle/roadmap-lint.cjs  the CLI as one esbuild bundle — the bin of the npm channel
//   packages/cli/LICENSE                  the same copy for the npm tarball (pnpm's own LICENSE copying is skipped as
//                                         soon as any packed file name contains "LICENSE", so the copy is explicit)
//   packages/cli/THIRD-PARTY-LICENSES.txt the same list for the npm tarball
//
// Usage:
//   node scripts/build-plugin.mjs          # regenerate (plugin/lib is removed and written anew, the rest overwritten)
//   node scripts/build-plugin.mjs --check  # verify byte equality with the existing files without writing (exit 1 on
//                                          # a difference, a missing file, or a file under plugin/lib that would not
//                                          # be generated)
//
// The copy under plugin/lib is what the plugin's hooks module imports. Claude Code loads a hooks module in an
// environment of its own — no Node.js — and a module there imports its own plugin's files by relative path
// and nothing else: no bare package names, no `node:` modules. So the copy rewrites every import. The set
// of files is what esbuild reaches from packages/core/src/index.ts with `platform: 'neutral'` (the `module`
// entry of a package ahead of `main`, so yaml comes as its browser build) — every file reached, not only
// the bytes a bundle would keep, because the engine loads the module graph as written. A bare import is
// rewritten to the relative path of the file esbuild resolved it to; a relative `./x.js` of the core's own
// source becomes `./x.ts`, the file that actually exists (the type-only imports esbuild drops included).
// The one CommonJS file among the dependencies is converted to an ES module on its own. The core's files
// that carry types alone (the Host interface, the rule types) are copied as well, so the copy type-checks
// (tsconfig.plugin.json). A type-only import of a types package (`import type … from 'mdast'`) stays as
// it is: it is erased before the module runs.
//
// The third-party list is derived from the same reach: every copied file under node_modules belongs to the
// nearest package.json above it, and the list carries that package's name, version, declared license, and
// every license file it ships. A package that ships none is listed with the copyright lines found in its
// README and main file followed by the standard text of the license it declares (the build stops on a
// license this script has no text for, and on a package it cannot resolve). The CLI bundle inlines a subset
// of the same packages (what tree shaking keeps) — the build checks that it names nothing outside the list.
// Entries are sorted by name and written with LF line endings, and esbuild's output is deterministic for
// the same input and the same version, so the same lockfile gives the same bytes on every machine and the
// byte comparison of --check works as a freshness check.
//
// The bundle's format is CJS with a .cjs extension (packages/cli is type: module). --version is injected at
// build time from the value in packages/cli/package.json (a dev run falls back to reading package.json in
// main.ts).

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const check = process.argv.includes('--check');

const coreSrc = 'packages/core/src';
const libDir = path.join('plugin', 'lib');
const toPosix = (p) => p.split(path.sep).join('/');

const { version } = JSON.parse(readFileSync(path.join(repoRoot, 'packages', 'cli', 'package.json'), 'utf8'));

// ---------------------------------------------------------------------------------------------
// Packages and licenses

/** The nearest package.json above a file that names a package (a nested one that only pins `type` does not count). */
function packageDirOf(inputPath) {
  let dir = path.dirname(path.join(repoRoot, inputPath));
  for (;;) {
    const manifest = path.join(dir, 'package.json');
    if (existsSync(manifest)) {
      const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
      if (typeof pkg.name === 'string' && typeof pkg.version === 'string') return { dir, pkg };
    }
    const parent = path.dirname(dir);
    if (parent === dir || !parent.startsWith(repoRoot)) return null;
    dir = parent;
  }
}

/** `MIT` from `"license": "MIT"`, or `MIT (http://…)` from the legacy `"licenses": [{type, url}]` form. */
function declaredLicense(pkg) {
  if (typeof pkg.license === 'string') return pkg.license;
  if (pkg.license && typeof pkg.license === 'object' && typeof pkg.license.type === 'string') {
    return pkg.license.url ? `${pkg.license.type} (${pkg.license.url})` : pkg.license.type;
  }
  if (Array.isArray(pkg.licenses) && pkg.licenses.length > 0) {
    return pkg.licenses
      .map((entry) => (entry.url ? `${entry.type} (${entry.url})` : String(entry.type)))
      .join(' / ');
  }
  return 'UNKNOWN';
}

const lf = (text) => text.replace(/\r\n?/g, '\n').replace(/\s+$/, '') + '\n';

/** The license files a package ships (LICENSE, LICENSE.md, LICENCE, LICENSE-MIT, MIT-LICENSE.txt, COPYING, …), sorted. */
function licenseFilesOf(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /licen[cs]e|^copying/i.test(entry.name))
    .filter((entry) => !/\.(m?js|cjs|ts|json|ya?ml|html?)$/i.test(entry.name)) // a license.js or licenses.json is code or data, not a text
    .map((entry) => entry.name)
    .sort();
}

// The standard text of the licenses a package may declare without shipping a file. The copyright line comes
// from the package itself (noticeLinesOf); the permission notice is what MIT and ISC require to be included
// in every copy. A declared license outside this map stops the build — add its text here deliberately.
const STANDARD_TEXTS = {
  MIT: [
    'Permission is hereby granted, free of charge, to any person obtaining a copy',
    'of this software and associated documentation files (the "Software"), to deal',
    'in the Software without restriction, including without limitation the rights',
    'to use, copy, modify, merge, publish, distribute, sublicense, and/or sell',
    'copies of the Software, and to permit persons to whom the Software is',
    'furnished to do so, subject to the following conditions:',
    '',
    'The above copyright notice and this permission notice shall be included in',
    'all copies or substantial portions of the Software.',
    '',
    'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR',
    'IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,',
    'FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE',
    'AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER',
    'LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,',
    'OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN',
    'THE SOFTWARE.',
  ].join('\n'),
  ISC: [
    'Permission to use, copy, modify, and/or distribute this software for any',
    'purpose with or without fee is hereby granted, provided that the above',
    'copyright notice and this permission notice appear in all copies.',
    '',
    'THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES',
    'WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF',
    'MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR',
    'ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES',
    'WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN',
    'ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF',
    'OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.',
  ].join('\n'),
};

/** For a package without a license file: the copyright and license lines of its README and main file. */
function noticeLinesOf(dir, pkg) {
  const candidates = readdirSync(dir).filter((name) => /^readme(\..+)?$/i.test(name));
  const main = path.posix.normalize(typeof pkg.main === 'string' ? pkg.main : 'index.js');
  if (existsSync(path.join(dir, main))) candidates.push(main);
  const lines = [];
  for (const name of candidates.sort()) {
    const text = lf(readFileSync(path.join(dir, name), 'utf8'));
    for (const line of text.split('\n')) {
      const trimmed = line.replace(/^\s*(\/\/|\*|#)?\s*/, '').trim();
      if (/copyright|licen[cs]e/i.test(trimmed) && !/^licen[cs]e$/i.test(trimmed)) lines.push(`  ${name}: ${trimmed}`);
    }
  }
  return lines;
}

/** The block written for a package that ships no license file: its own notices, then the standard text of its license. */
function fallbackBlock(name, dir, pkg) {
  const declared = declaredLicense(pkg);
  if (declared.includes(' / ')) throw new Error(`${name}: no license file, and several declared licenses ("${declared}") — settle which text applies`);
  const id = declared.replace(/\s*\(.*\)$/, '');
  const text = STANDARD_TEXTS[id];
  if (!text) throw new Error(`${name}: no license file, and no standard text for the declared license "${declared}"`);
  const notices = noticeLinesOf(dir, pkg);
  // A holder's line ("Copyright 2010 Someone"), not a wrapped "copyright notice and this permission notice" or a bare heading
  if (!notices.some((line) => /:\s*Copyright\b(?! notice)\s*\S/.test(line))) throw new Error(`${name}: no license file, and no copyright line found in the package`);
  return [
    `No license file is shipped with this package. Its package.json declares ${declared}. Notices found in it:`,
    ...notices,
    '',
    `The text of the ${id} license:`,
    '',
    text,
  ].join('\n');
}

/** The packages a set of esbuild input paths belongs to, by name, sorted: `{ name, version, dir, pkg }` each. */
function packagesOf(inputPaths) {
  const byId = new Map();
  for (const inputPath of inputPaths) {
    if (!inputPath.includes('node_modules/')) continue; // this repository's own sources
    const found = packageDirOf(inputPath);
    if (!found) throw new Error(`Cannot find the package.json of the input ${inputPath}`);
    const { dir, pkg } = found;
    if (pkg.private === true) continue; // a workspace package reached through a symlink
    const id = `${pkg.name}@${pkg.version}`;
    if (!byId.has(id)) byId.set(id, { name: pkg.name, version: pkg.version, dir, pkg });
  }
  return [...byId.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

function renderThirdParty(packages) {
  const rule = '='.repeat(78);
  const parts = [
    'Third-party licenses for the roadmap-lint core',
    '',
    'rdd-kit distributes the packages listed below: as readable source under lib/vendor/ in the',
    'plugin directory (the files the lint core imports, each package with the license files it',
    'ships), and inlined in the roadmap-lint bundle (bundle/roadmap-lint.cjs in the npm tarball),',
    'which keeps a subset of them. Each entry gives the package name and version, the license its',
    'package.json declares, and the license text the package ships. A package that ships no',
    'license file is listed with the copyright and license lines found in its README and main',
    'file, followed by the standard text of the license it declares.',
    '',
    `Packages: ${packages.length}. Generated by scripts/build-plugin.mjs from the installed dependencies.`,
    '',
  ];
  for (const { name, version: pkgVersion, dir, pkg } of packages) {
    parts.push(rule, `${name} ${pkgVersion} — ${declaredLicense(pkg)}`, rule, '');
    const files = licenseFilesOf(dir);
    if (files.length === 0) {
      parts.push(fallbackBlock(name, dir, pkg), '');
      continue;
    }
    for (const file of files) {
      if (files.length > 1) parts.push(`--- ${file} ---`, '');
      parts.push(lf(readFileSync(path.join(dir, file), 'utf8')).trimEnd(), '');
    }
  }
  return lf(parts.join('\n'));
}

// ---------------------------------------------------------------------------------------------
// The readable copy under plugin/lib

/** The core's own source files, as POSIX paths relative to the repository root (testing/ left out). */
function coreSourceFiles() {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(path.join(repoRoot, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name !== 'testing') walk(rel);
      } else if (entry.name.endsWith('.ts')) out.push(rel);
    }
  };
  walk(coreSrc);
  return out.sort();
}

/** Where an esbuild input lands inside plugin/lib: `core/<path under packages/core/src>` or `vendor/<package>/<path inside it>`. */
function destinationOf(inputPath) {
  const i = inputPath.lastIndexOf('node_modules/');
  if (i < 0) {
    if (!inputPath.startsWith(`${coreSrc}/`)) throw new Error(`An own source outside ${coreSrc}: ${inputPath}`);
    return { kind: 'own', pkg: null, rel: `core/${inputPath.slice(coreSrc.length + 1)}` };
  }
  const rest = inputPath.slice(i + 'node_modules/'.length);
  const parts = rest.split('/');
  const pkg = parts[0].startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
  const inside = parts.slice(pkg.includes('/') ? 2 : 1).join('/');
  return { kind: 'third', pkg, rel: `vendor/${pkg}/${inside}` };
}

/** One CommonJS file as an ES module (esbuild, that file alone — anything it required would be inlined with it). */
async function cjsToEsm(inputPath) {
  const converted = await build({
    entryPoints: [path.join(repoRoot, inputPath)],
    bundle: true,
    platform: 'neutral',
    format: 'esm',
    target: 'es2022',
    write: false,
    logLevel: 'silent',
    absWorkingDir: repoRoot,
  });
  return converted.outputFiles[0].text;
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Replaces every import specifier `from '<original>'` / `import('<original>')` in a source text, and says how many it found. */
function rewriteSpecifier(text, original, replacement) {
  // `import x from 'o'` / `import 'o'` / `export * from 'o'` / `export { a } from 'o'` / `import('o')`
  const pattern = new RegExp(`(\\bfrom\\s*|\\bimport\\s*\\(?\\s*)(['"])${escapeRegExp(original)}\\2`, 'g');
  let count = 0;
  const rewritten = text.replace(pattern, (_match, lead, quote) => {
    count++;
    return `${lead}${quote}${replacement}${quote}`;
  });
  return { text: rewritten, count };
}

/** Everything that goes under plugin/lib, as `{ rel: Buffer }` (rel below plugin/lib), plus the packages copied. */
async function readableCopy() {
  const reach = await build({
    entryPoints: [path.join(repoRoot, coreSrc, 'index.ts')],
    bundle: true,
    platform: 'neutral',
    mainFields: ['module', 'main'],
    format: 'esm',
    target: 'es2022',
    write: false,
    metafile: true,
    absWorkingDir: repoRoot,
    logLevel: 'silent',
    logOverride: { 'empty-import-meta': 'silent' },
  });
  const inputs = new Map(Object.entries(reach.metafile.inputs).map(([p, input]) => [toPosix(p), input]));
  for (const [inputPath, input] of inputs) {
    const external = input.imports.filter((imp) => imp.external).map((imp) => imp.path);
    if (external.length > 0) throw new Error(`${inputPath} imports something the copy cannot carry: ${external.join(', ')}`);
  }

  const ownFiles = new Set(coreSourceFiles());
  // Where each reached file lands — and the core's files that carry types alone (nothing reaches them at run time)
  const destinations = new Map();
  const place = (inputPath) => {
    const destination = destinationOf(inputPath);
    for (const [other, placed] of destinations) {
      if (placed.rel === destination.rel) throw new Error(`Two inputs land on ${destination.rel}: ${other} and ${inputPath}`);
    }
    destinations.set(inputPath, destination);
  };
  for (const inputPath of inputs.keys()) place(inputPath);
  for (const ownFile of ownFiles) if (!destinations.has(ownFile)) place(ownFile);
  for (const [inputPath, destination] of destinations) {
    if (destination.kind === 'own' && !ownFiles.has(inputPath)) throw new Error(`${inputPath} is reached but is not one of the core's source files`);
  }

  const placed = new Set([...destinations.values()].map((destination) => destination.rel));
  const files = new Map();
  for (const [inputPath, destination] of destinations) {
    const input = inputs.get(inputPath);
    let text = input?.format === 'cjs' ? await cjsToEsm(inputPath) : readFileSync(path.join(repoRoot, inputPath), 'utf8');
    const fromDir = path.posix.dirname(destination.rel);
    const relativeTo = (targetRel) => {
      const rel = path.posix.relative(fromDir, targetRel);
      return rel.startsWith('.') ? rel : `./${rel}`;
    };
    // The imports esbuild resolved: a bare package name becomes the relative path of the file it resolved to,
    // and a relative path is re-aimed at the copy (where `./x.js` of the core is the file `./x.ts`)
    for (const imp of input?.imports ?? []) {
      if (imp.original === undefined) throw new Error(`${inputPath}: an import without its original specifier (${imp.path})`);
      const target = destinations.get(toPosix(imp.path));
      if (!target) throw new Error(`${inputPath}: imports ${imp.original}, resolved to ${imp.path}, which the copy does not carry`);
      const rewritten = rewriteSpecifier(text, imp.original, relativeTo(target.rel));
      if (rewritten.count === 0) throw new Error(`${inputPath}: the specifier ${imp.original} is not found in the source text`);
      text = rewritten.text;
    }
    // The core's type-only relative imports, which esbuild drops before the metafile sees them: `./x.js` → `./x.ts`.
    // A `.js` the rewrite above aimed at a vendor file is JavaScript and stays
    if (destination.kind === 'own') {
      text = text.replace(/(\bfrom\s*|\bimport\s*\(?\s*)(['"])(\.{1,2}\/[^'"]+)\.js\2/g, (match, lead, quote, base) => {
        if (placed.has(path.posix.normalize(path.posix.join(fromDir, `${base}.js`)))) return match;
        const asTs = path.posix.normalize(path.posix.join(fromDir, `${base}.ts`));
        if (!placed.has(asTs)) throw new Error(`${inputPath}: imports ${base}.js, and ${asTs} is not in the copy`);
        return `${lead}${quote}${base}.ts${quote}`;
      });
    }
    files.set(destination.rel, Buffer.from(text, 'utf8'));
  }

  // The license files each copied package ships, beside its files (what the list reproduces, in the copy itself)
  const packages = packagesOf([...inputs.keys()]);
  for (const { name, dir } of packages) {
    for (const file of licenseFilesOf(dir)) files.set(`vendor/${name}/${file}`, readFileSync(path.join(dir, file)));
  }
  return { files, packages };
}

// ---------------------------------------------------------------------------------------------
// The CLI bundle

async function cliBundle() {
  const result = await build({
    entryPoints: [path.join(repoRoot, 'packages', 'cli', 'src', 'main.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node24',
    outfile: path.join(repoRoot, 'packages', 'cli', 'bundle', 'roadmap-lint.cjs'),
    write: false,
    metafile: true,
    absWorkingDir: repoRoot,
    define: { ROADMAP_LINT_VERSION: JSON.stringify(version) },
    // The dev fallback of cliVersion() (import.meta.url) is dead code in the bundle because of define —
    // this only silences the warning esbuild raises while converting to CJS
    logOverride: { 'empty-import-meta': 'silent' },
  });
  const generated = Buffer.from(result.outputFiles[0].contents);
  if (!generated.subarray(0, 2).equals(Buffer.from('#!'))) {
    throw new Error('The generated bundle does not start with a shebang (check that esbuild is preserving the hashbang).');
  }
  // Only the inputs that contribute bytes to the bundle: a module esbuild parsed and then tree-shook away
  // entirely is not inlined
  const inlined = Object.values(result.metafile.outputs).flatMap((output) =>
    Object.entries(output.inputs)
      .filter(([, usage]) => usage.bytesInOutput > 0)
      .map(([inputPath]) => toPosix(inputPath)),
  );
  return { generated, packages: packagesOf(inlined) };
}

// ---------------------------------------------------------------------------------------------
// Generate, then write or compare

const copy = await readableCopy();
const bundle = await cliBundle();

const copied = new Set(copy.packages.map((p) => `${p.name}@${p.version}`));
const outside = bundle.packages.filter((p) => !copied.has(`${p.name}@${p.version}`));
if (outside.length > 0) {
  throw new Error(`The CLI bundle inlines packages the readable copy does not carry: ${outside.map((p) => `${p.name}@${p.version}`).join(', ')}`);
}

const thirdParty = Buffer.from(renderThirdParty(copy.packages), 'utf8');
const rootLicense = readFileSync(path.join(repoRoot, 'LICENSE'));

/** Every generated file, by POSIX path from the repository root. */
const outputs = new Map();
for (const [rel, content] of copy.files) outputs.set(`plugin/lib/${rel}`, content);
outputs.set('plugin/LICENSE', rootLicense);
outputs.set('plugin/THIRD-PARTY-LICENSES.txt', thirdParty);
outputs.set('packages/cli/bundle/roadmap-lint.cjs', bundle.generated);
outputs.set('packages/cli/LICENSE', rootLicense);
outputs.set('packages/cli/THIRD-PARTY-LICENSES.txt', thirdParty);

/** Every file under plugin/lib on disk, by POSIX path from the repository root. */
function filesUnderLib() {
  const out = [];
  const walk = (dir) => {
    if (!existsSync(path.join(repoRoot, dir))) return;
    for (const entry of readdirSync(path.join(repoRoot, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(rel);
      else out.push(rel);
    }
  };
  walk(toPosix(libDir));
  return out.sort();
}

const libBytes = [...copy.files.values()].reduce((sum, content) => sum + content.length, 0);
const summary = `plugin/lib: ${copy.files.size} files, ${libBytes} bytes, ${copy.packages.length} packages copied (${bundle.packages.length} of them inlined in the bundle) / bundle: v${version}, ${bundle.generated.length} bytes`;

if (check) {
  let stale = 0;
  for (const [rel, content] of outputs) {
    const file = path.join(repoRoot, rel);
    if (!existsSync(file)) {
      console.error(`--check: missing generated file: ${rel}`);
      stale++;
    } else if (!readFileSync(file).equals(content)) {
      console.error(`--check: out of date: ${rel}`);
      stale++;
    }
  }
  for (const rel of filesUnderLib()) {
    if (!outputs.has(rel)) {
      console.error(`--check: not generated (left over): ${rel}`);
      stale++;
    }
  }
  if (stale > 0) {
    console.error(`--check: ${stale} ${stale === 1 ? 'file is' : 'files are'} not what the build generates. Run \`node scripts/build-plugin.mjs\` to regenerate.`);
    process.exit(1);
  }
  console.log(`--check OK: ${outputs.size} generated files are up to date — ${summary}`);
} else {
  rmSync(path.join(repoRoot, libDir), { recursive: true, force: true });
  for (const [rel, content] of outputs) {
    const file = path.join(repoRoot, rel);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  console.log(`generated: ${outputs.size} files — ${summary}`);
}
