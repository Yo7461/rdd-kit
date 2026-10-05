#!/usr/bin/env node
// The roadmap-lint PostToolUse hook — an automatic lint right after an edit under roadmap/ (rdd-kit).
// The policy: being non-destructive comes first — a missing CLI, an execution error, and unexpected
// input all end in a silent exit 0. Only when there are diagnostics does it format them to stderr and
// exit 2 (in PostToolUse, stderr reaches both the user and Claude, and the edit itself is not blocked).

import { execFileSync, execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { delimiter, join, resolve, sep } from 'node:path';

const LINT_TIMEOUT_MS = 20_000;

// Path comparison on Windows is case-insensitive
const norm = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);

const jsOrExe = (p) => (/\.(mjs|cjs|js)$/i.test(p) ? { node: p } : { exe: p });

// The English plural for a count. The same rule as core's plural.ts — duplicated because the hook runs on its own
const plural = (count, singular) => (count === 1 ? singular : `${singular}s`);

// The development checkout of the linter itself: its packages/cli is the roadmap-lint package. Any other
// project with a packages/cli/dist/main.js is somebody else's program, which the hook must not run
function isLinterCheckout(projectDir) {
  try {
    const text = readFileSync(join(projectDir, 'packages', 'cli', 'package.json'), 'utf8').replace(/^\u{FEFF}/u, ''); // a BOM, which JSON.parse refuses
    return JSON.parse(text).name === 'roadmap-lint';
  } catch {
    return false;
  }
}

// Resolution order: an explicit env var -> the bin shipped with the plugin -> the dist of the linter's own development checkout -> PATH
function resolveCli(projectDir) {
  const envBin = process.env.ROADMAP_LINT_BIN;
  if (envBin && existsSync(envBin)) return jsOrExe(envBin);
  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT;
  if (pluginRoot) {
    const bundled = join(pluginRoot, 'bin', 'roadmap-lint.js');
    if (existsSync(bundled)) return { node: bundled };
  }
  const devDist = join(projectDir, 'packages', 'cli', 'dist', 'main.js');
  if (existsSync(devDist) && isLinterCheckout(projectDir)) return { node: devDist };
  const names =
    process.platform === 'win32' ? ['roadmap-lint.cmd', 'roadmap-lint.exe', 'roadmap-lint'] : ['roadmap-lint'];
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir) continue;
    for (const name of names) {
      const p = join(dir, name);
      if (existsSync(p)) return jsOrExe(p);
    }
  }
  return null;
}

function runLint(cli, projectDir) {
  const args = [projectDir, '--format', 'json'];
  // LOG_TOKENS / LOG_STREAM make the linter's YAML parser print its token stream to stdout, which would
  // corrupt the JSON report. The linter drops them itself; filtering here also covers a linter that does
  // not — one named by ROADMAP_LINT_BIN or found on the PATH.
  // Matched without regard to case — Windows reads environment variables that way
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^LOG_(TOKENS|STREAM)$/i.test(k)));
  const opts = { timeout: LINT_TIMEOUT_MS, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true, env };
  try {
    if (cli.node) return execFileSync(process.execPath, [cli.node, ...args], opts);
    if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(cli.exe)) {
      // A .cmd cannot be spawned directly (Node's EINVAL guard) — go through the shell, quoted
      return execSync(`"${cli.exe}" ${args.map((a) => `"${a}"`).join(' ')}`, opts);
    }
    return execFileSync(cli.exe, args, opts);
  } catch (err) {
    // exit 1 = there are diagnostics at or above fail-severity (stdout is valid JSON). Any other failure stays silent
    if (err && err.status === 1 && typeof err.stdout === 'string' && err.stdout !== '') return err.stdout;
    return null;
  }
}

function location(diag) {
  const a = diag.anchor ?? {};
  if (a.kind === 'range' && a.file) return `${a.file}:${(a.range?.start?.line ?? 0) + 1}`;
  if (a.file) return a.file;
  return 'roadmap/';
}

function main() {
  let input;
  try {
    input = JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    return 0;
  }
  const filePath = input?.tool_input?.file_path;
  if (typeof filePath !== 'string' || filePath === '') return 0;

  const projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  const roadmapRoot = resolve(projectDir, 'roadmap');
  const target = resolve(projectDir, filePath);
  if (norm(target) !== norm(roadmapRoot) && !norm(target).startsWith(norm(roadmapRoot + sep))) return 0;

  const cli = resolveCli(projectDir);
  if (!cli) return 0;
  const raw = runLint(cli, projectDir);
  if (raw == null) return 0;

  let report;
  try {
    report = JSON.parse(raw);
  } catch {
    return 0;
  }
  const diags = Array.isArray(report.diagnostics) ? report.diagnostics : [];
  if (diags.length === 0) return 0; // The notices (the GIT rules skipped, GIT-1 dropped while a session is open) stay silent

  const { errors = 0, warnings = 0 } = report.summary ?? {};
  const lines = diags.map(
    (d) => `${location(d)} ${d.severity} ${d.rule} ${d.message}${d.suggestion ? ` [Fix: ${d.suggestion}]` : ''}`,
  );
  // A diagnostic can exist only because an option was ignored (a `maxLines` of the wrong shape leaves the
  // default in force; a `sinceCommit` that is not found leaves every commit in scope) — the notice that
  // says so travels with the diagnostics, the other notices stay silent. Control characters are shown
  // escaped, so a value from the config cannot forge a line of the report
  const ignored = (Array.isArray(report.notices) ? report.notices : [])
    .filter((n) => typeof n === 'string' && /^[A-Z]+-\d+: (Ignored|Could not find) /.test(n))
    .map((n) => `Note: ${n.replace(/[\u0000-\u001f\u007f]/g, (c) => JSON.stringify(c).slice(1, -1))}`);
  const summary =
    `roadmap-lint: ${diags.length} ${plural(diags.length, 'problem')} ` +
    `(${errors} ${plural(errors, 'error')}, ${warnings} ${plural(warnings, 'warning')}) after editing roadmap/.`;
  process.stderr.write([summary, ...lines, ...ignored].join('\n') + '\n');
  return 2;
}

let code = 0;
try {
  code = main();
} catch {
  code = 0; // Even an unexpected internal error must not get in the way of the editing flow
}
process.exit(code);
