#!/usr/bin/env node
// Generate the single distribution bundle with esbuild — the same bytes for both channels:
//   plugin/bin/roadmap-lint.js            shipped with the plugin (where step 2 of the hook's resolution order looks)
//   packages/cli/bundle/roadmap-lint.cjs  the bin of the npm channel
// and the license files that travel with it:
//   plugin/LICENSE                        a copy of the root LICENSE (an installed plugin is the plugin/ directory alone)
//   plugin/THIRD-PARTY-LICENSES.txt       the license of every third-party package the bundle inlines
//   packages/cli/LICENSE                  the same copy for the npm tarball (pnpm's own LICENSE copying is skipped as
//                                         soon as any packed file name contains "LICENSE", so the copy is explicit)
//   packages/cli/THIRD-PARTY-LICENSES.txt the same list for the npm tarball
//
// Usage:
//   node scripts/build-plugin.mjs          # regenerate (overwrite)
//   node scripts/build-plugin.mjs --check  # verify byte equality with the existing files without writing (exit 1 on a difference)
//
// The format is CJS: an installed plugin directory has no package.json, so a .js there is read as CJS
// (ESM would be a SyntaxError). The dependencies (ESM) are converted and inlined by esbuild.
// plugin/bin carries a package.json ({"type":"commonjs"}) beside it to pin that reading — this repository's
// root package.json is type: module, and without it the bundle would be read as ESM and fail inside the repository.
// The npm side pins it through the .cjs extension instead (packages/cli is type: module).
// --version is injected at build time from the value in packages/cli/package.json (a dev run falls back to
// reading package.json in main.ts). esbuild produces deterministic output for the same input and the same
// version, so the byte comparison of --check works as a freshness check.
//
// The third-party list is derived from esbuild's metafile: every input that contributes bytes to the bundle
// and sits under node_modules belongs to the nearest package.json above it, and the list carries that
// package's name, version, declared license, and every license file it ships. A package that ships none is
// listed with the copyright lines found in its README and main file followed by the standard text of the
// license it declares (the build stops on a license this script has no text for, and on a package it cannot
// resolve). Entries are sorted by name and written with LF line endings, so the same lockfile gives the same
// bytes on every machine.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const entry = path.join(repoRoot, 'packages', 'cli', 'src', 'main.ts');
const outFile = path.join(repoRoot, 'plugin', 'bin', 'roadmap-lint.js');
const check = process.argv.includes('--check');

const { version } = JSON.parse(
  readFileSync(path.join(repoRoot, 'packages', 'cli', 'package.json'), 'utf8'),
);

const result = await build({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  outfile: outFile,
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
  console.error('The generated bundle does not start with a shebang (check that esbuild is preserving the hashbang).');
  process.exit(1);
}

// ---------------------------------------------------------------------------------------------
// Third-party packages inlined in the bundle

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

function collectThirdParty(metafile) {
  // Only the inputs that contribute bytes to the bundle: a module esbuild parsed and then tree-shook
  // away entirely (an unused helper package) is not inlined, so its license is not carried along
  const contributing = Object.values(metafile.outputs).flatMap((output) =>
    Object.entries(output.inputs)
      .filter(([, usage]) => usage.bytesInOutput > 0)
      .map(([inputPath]) => inputPath),
  );
  const byId = new Map();
  for (const inputPath of contributing) {
    const normalized = inputPath.replace(/\\/g, '/');
    if (!normalized.includes('node_modules/')) continue; // this repository's own sources
    const found = packageDirOf(normalized);
    if (!found) throw new Error(`Cannot find the package.json of the bundled input ${normalized}`);
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
    'Third-party licenses for the roadmap-lint bundle',
    '',
    'The roadmap-lint bundle (bin/roadmap-lint.js in the plugin directory, bundle/roadmap-lint.cjs',
    'in the npm tarball) inlines the packages listed below. Each entry gives the package name',
    'and version, the license its package.json declares, and the license text the package',
    'ships. A package that ships no license file is listed with the copyright and license lines',
    'found in its README and main file, followed by the standard text of the license it declares.',
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

const thirdParty = Buffer.from(renderThirdParty(collectThirdParty(result.metafile)), 'utf8');
const rootLicense = readFileSync(path.join(repoRoot, 'LICENSE'));

// ---------------------------------------------------------------------------------------------
// Generated files: the plugin-side bundle plus its type pin, the npm-side .cjs (the same bytes),
// and the license files of both channels

const outputs = [
  { file: outFile, content: generated },
  { file: path.join(path.dirname(outFile), 'package.json'), content: Buffer.from('{ "type": "commonjs" }\n') },
  { file: path.join(repoRoot, 'packages', 'cli', 'bundle', 'roadmap-lint.cjs'), content: generated },
  { file: path.join(repoRoot, 'plugin', 'LICENSE'), content: rootLicense },
  { file: path.join(repoRoot, 'plugin', 'THIRD-PARTY-LICENSES.txt'), content: thirdParty },
  { file: path.join(repoRoot, 'packages', 'cli', 'LICENSE'), content: rootLicense },
  { file: path.join(repoRoot, 'packages', 'cli', 'THIRD-PARTY-LICENSES.txt'), content: thirdParty },
];

if (check) {
  for (const { file, content } of outputs) {
    const rel = path.relative(repoRoot, file);
    if (!existsSync(file)) {
      console.error(`--check: missing generated file: ${rel}`);
      process.exit(1);
    }
    if (!readFileSync(file).equals(content)) {
      console.error(`--check: out of date: ${rel}. Run \`node scripts/build-plugin.mjs\` to regenerate it.`);
      process.exit(1);
    }
  }
  console.log(
    `--check OK: ${path.relative(repoRoot, outFile)} and the ${outputs.length - 1} files generated with it are up to date (v${version} / ${generated.length} bytes)`,
  );
} else {
  for (const { file, content } of outputs) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
    console.log(`generated: ${path.relative(repoRoot, file)} (v${version} / ${content.length} bytes)`);
  }
}
