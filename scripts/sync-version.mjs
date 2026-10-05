#!/usr/bin/env node
// A single version for the skill and the CLI together: brings the version of
// plugin.json and of packages/* (cli and core) to one SemVer value. The root package.json is the
// workspace shell (0.0.0 and private) and is out of scope.
//
// Usage:
//   node scripts/sync-version.mjs 0.2.0    # update all 3 at once (then run build:plugin so the bundle follows)
//   node scripts/sync-version.mjs --check  # verify that all 3 match (exit 1 when they do not)
//   pnpm run sync:version -- --check       # the same, through the package script

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const TARGETS = [
  path.join('plugin', '.claude-plugin', 'plugin.json'),
  path.join('packages', 'cli', 'package.json'),
  path.join('packages', 'core', 'package.json'),
];

const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;

// pnpm hands the `--` of `pnpm run sync:version -- --check` through as an argument of its own
const args = process.argv.slice(2);
if (args[0] === '--') args.shift();
const arg = args[0];
if (arg === undefined || (arg !== '--check' && !SEMVER.test(arg))) {
  console.error('Usage: node scripts/sync-version.mjs <SemVer> | --check');
  process.exit(2);
}

const entries = TARGETS.map((rel) => {
  const file = path.join(repoRoot, rel);
  const json = JSON.parse(readFileSync(file, 'utf8'));
  return { rel, file, json };
});

if (arg === '--check') {
  const versions = new Set(entries.map((e) => e.json.version));
  if (versions.size !== 1) {
    console.error('--check: the versions do not match:');
    for (const e of entries) console.error(`  ${e.rel}: ${e.json.version}`);
    console.error('Run `node scripts/sync-version.mjs <SemVer>` to bring them into line.');
    process.exit(1);
  }
  console.log(`--check OK: all 3 are at v${entries[0].json.version}`);
} else {
  for (const e of entries) {
    e.json.version = arg;
    writeFileSync(e.file, JSON.stringify(e.json, null, 2) + '\n');
    console.log(`updated: ${e.rel} -> v${arg}`);
  }
  console.log('next: pnpm run build:plugin (so the bundle\'s --version follows)');
}
