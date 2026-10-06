#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  CONFIG_FILE_NAME,
  ConfigError,
  discoverConfigFile,
  formatJson,
  formatText,
  loadConfigFile,
  resolveTarget,
  runLint,
  severityRank,
  type LintConfig,
  type Severity,
} from '@rdd-kit/core';
import { nodeHost } from './host.js';

const USAGE = `Usage: roadmap-lint [path] [options]

Lint the roadmap/ records of a roadmap-driven project.

Arguments:
  path                             Directory containing roadmap/, or roadmap/
                                   itself (default: current directory)

Options:
  --config <path>                  Path to a JSON config file
                                   (default: ${CONFIG_FILE_NAME} next to
                                   roadmap/, or built-in defaults)
  --format <text|json>             Output format (default: text)
  --fail-severity <error|warning>  Minimum severity that makes the exit code 1
                                   (default: error)
  --version                        Print the version and exit
  --help                           Print this help and exit

Exit codes:
  0  No diagnostics at or above --fail-severity
  1  Diagnostics at or above --fail-severity
  2  Execution error (invalid arguments, invalid config, missing target)
`;

/** Tells an error that comes from the arguments (exit 2 plus the usage text) apart from a runtime error. */
class UsageError extends Error {}

/** Injected at build time through esbuild's define (scripts/build-plugin.mjs). Not injected = a development run. */
declare const ROADMAP_LINT_VERSION: string | undefined;

/** The bundle uses the injected value; a development run (the dist built by tsc) reads the package.json next to it. */
function cliVersion(): string {
  if (typeof ROADMAP_LINT_VERSION === 'string') return ROADMAP_LINT_VERSION;
  const packageJson = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  ) as { version: string };
  return packageJson.version;
}

/**
 * The YAML parser the linter bundles prints its token stream to stdout when these variables are set
 * (its own debugging aid). On stdout they would corrupt `--format json` — the hook then sees no report
 * and stays silent — so the linter drops them from its own environment before anything is parsed.
 */
function dropParserDebugVariables(): void {
  delete process.env['LOG_TOKENS'];
  delete process.env['LOG_STREAM'];
}

async function main(): Promise<number> {
  dropParserDebugVariables();
  let parsed: ReturnType<typeof parseArgs<{
    options: {
      config: { type: 'string' };
      format: { type: 'string' };
      'fail-severity': { type: 'string' };
      version: { type: 'boolean' };
      help: { type: 'boolean' };
    };
    allowPositionals: true;
  }>>;
  try {
    parsed = parseArgs({
      allowPositionals: true,
      options: {
        config: { type: 'string' },
        format: { type: 'string' },
        'fail-severity': { type: 'string' },
        version: { type: 'boolean' },
        help: { type: 'boolean' },
      },
    });
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
  const { values, positionals } = parsed;

  if (values.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  if (values.version) {
    process.stdout.write(cliVersion() + '\n');
    return 0;
  }

  if (positionals.length > 1) {
    throw new UsageError(
      `Too many positional arguments: ${positionals.join(' ')}. The path argument may be given at most once.`,
    );
  }
  const format = values.format ?? 'text';
  if (format !== 'text' && format !== 'json') {
    throw new UsageError('The --format option must be either text or json.');
  }
  const failSeverity = values['fail-severity'] ?? 'error';
  if (failSeverity !== 'error' && failSeverity !== 'warning') {
    throw new UsageError('The --fail-severity option must be either error or warning.');
  }

  const inputPath = positionals[0] ?? '.';
  // The core knows no working directory of its own, so the argument is made absolute here
  const target = await resolveTarget(path.resolve(inputPath), nodeHost);
  if (target === null) {
    process.stderr.write(`Cannot find roadmap/ under ${inputPath}.\n`);
    return 2;
  }

  let config: LintConfig = {};
  if (values.config !== undefined) {
    config = await loadConfigFile(path.resolve(values.config), nodeHost);
  } else {
    const discovered = await discoverConfigFile(target.baseDir, nodeHost);
    if (discovered !== null) config = await loadConfigFile(discovered, nodeHost);
  }

  const result = await runLint(target, nodeHost, config);
  process.stdout.write(format === 'json' ? formatJson(result) : formatText(result));

  const threshold = severityRank(failSeverity as Severity);
  const failing = result.diagnostics.some((d) => severityRank(d.severity) >= threshold);
  return failing ? 1 : 0;
}

// A promise chain rather than a top-level await: the bundle is CJS (scripts/build-plugin.mjs), where
// a top-level await has no place
main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    if (error instanceof UsageError) {
      process.stderr.write(`${error.message}\n\n${USAGE}`);
    } else if (error instanceof ConfigError) {
      process.stderr.write(`Configuration error: ${error.message}\n`);
    } else {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`Execution error: ${message}\n`);
    }
    process.exitCode = 2;
  },
);
