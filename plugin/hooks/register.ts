import type { EngineInterface, Register, ToolCallResult } from 'claude-code';
import {
  discoverConfigFile,
  formatJson,
  formatText,
  loadConfigFile,
  plural,
  resolveTarget,
  runLint,
  toJsonReport,
  type Host,
  type LintConfig,
  type LintResult,
} from '../lib/core/index.ts';
import path from '../lib/core/path.ts';

// The hooks module of rdd-kit: the lint core run inside Claude Code's own process, with no Node.js
// behind it. Everything the core reads reaches the machine through `$` (hostOf), and the module only
// reads — the files under roadmap/, the config beside it, and git with `--no-optional-locks`.
//
// Two things it does, both fail-open:
//  - after an Edit or Write under <working directory>/roadmap/, the records are linted and the report
//    joins the body of that tool call's result — only when there are diagnostics. Zero diagnostics, a
//    file elsewhere, and a lint that fails leave the result untouched; the edit itself is never
//    blocked, and a failure is said in one dim line of the transcript ($.ui.log)
//  - the tool `roadmap_lint` (listed to the model as mcp__rdd-kit__roadmap_lint) runs the same lint on
//    request, for the records check of the skill's doctor: the same text or JSON report the CLI prints
//
// The report of an Edit or Write cannot be put into the result from the tool.call hook itself (the
// engine keeps the text it renders for the model); it joins the result where the row is stored, in
// session.append, handed over by the call's id. The two hooks run within a millisecond of each other,
// so a module variable carries it.

/**
 * The tool's short name. The engine lists a registered tool as mcp__<plugin>__<name>, the plugin being
 * the `name` of .claude-plugin/plugin.json — so the matcher of the hook that serves it, below, spells
 * `mcp__rdd-kit__roadmap_lint` out in full (a literal, which `claude plugin validate` can read).
 */
const TOOL_NAME = 'roadmap_lint';
const TOOL_DESCRIPTION =
  'Runs roadmap-lint over the roadmap/ records of a roadmap-driven project — every rule, the same report as the CLI. ' +
  'Use it for the records check of /roadmap doctor and before a session closes. ' +
  'Input: `path` (optional: the directory that holds roadmap/, or roadmap/ itself, relative to the working directory or absolute; default: the working directory), ' +
  '`format` (optional: `text` or `json`; default `text`).';
const TOOL_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    path: { type: 'string', description: 'The directory that holds roadmap/, or roadmap/ itself. Default: the working directory.' },
    format: { type: 'string', enum: ['text', 'json'], description: 'The report format. Default: text.' },
  },
};

/** The report of an Edit or Write, handed from its tool.call hook to the session.append that stores its result row, by the call's id. */
const pending = new Map<string, string>();

/** Everything the core reads goes through here: the one place that touches `$`. */
function hostOf($: EngineInterface): Host {
  return {
    readText: (file) => $.fs.read(file),
    exists: (file) => $.fs.exists(file),
    listDir: async (dir) => (await $.fs.list(dir)).map((entry) => ({ name: entry.name, kind: entry.kind })),
    stat: async (file) => {
      try {
        return { kind: (await $.fs.stat(file)).kind };
      } catch {
        return null; // the engine rejects a missing path; the core reads that as "nothing there"
      }
    },
    run: (argv) => $.process.run(argv),
  };
}

/** Whether the edited file is under <cwd>/roadmap. A Windows path compares without regard to case. */
function isUnderRoadmap(filePath: string, cwd: string): boolean {
  const fold = (p: string): string => (/^[A-Za-z]:\//.test(p) ? p.toLowerCase() : p);
  const root = fold(path.join(cwd, 'roadmap'));
  const target = fold(path.resolve(cwd, filePath));
  return target === root || target.startsWith(`${root}/`);
}

/** The project's config, discovered beside roadmap/ the way the CLI discovers it (an invalid one throws). */
async function configOf(baseDir: string, host: Host): Promise<LintConfig> {
  const found = await discoverConfigFile(baseDir, host);
  return found === null ? {} : loadConfigFile(found, host);
}

function location(anchor: LintResult['diagnostics'][number]['anchor']): string {
  if (anchor.kind === 'range') return `${anchor.file}:${anchor.range.start.line + 1}`;
  if (anchor.kind === 'file') return anchor.file;
  return 'roadmap/';
}

/**
 * The report after an edit, the same lines the command hook writes to stderr: a summary, one line per
 * diagnostic, and the notices about an option that was ignored or a `sinceCommit` that was not found —
 * the other notices stay out. Null when there is nothing to say. Control characters are shown escaped, so
 * a value from the config cannot forge a line of the report.
 */
function report(linted: LintResult): string | null {
  const { diagnostics, summary, notices } = toJsonReport(linted);
  if (diagnostics.length === 0) return null;
  const lines = diagnostics.map(
    (d) => `${location(d.anchor)} ${d.severity} ${d.rule} ${d.message}${d.suggestion ? ` [Fix: ${d.suggestion}]` : ''}`,
  );
  const ignored = notices
    .filter((n) => /^[A-Z]+-\d+: (Ignored|Could not find) /.test(n))
    .map((n) => `Note: ${n.replace(/[\u0000-\u001f\u007f]/g, (c) => JSON.stringify(c).slice(1, -1))}`);
  return [
    `roadmap-lint: ${diagnostics.length} ${plural(diagnostics.length, 'problem')} ` +
      `(${summary.errors} ${plural(summary.errors, 'error')}, ${summary.warnings} ${plural(summary.warnings, 'warning')}) after editing roadmap/.`,
    ...lines,
    ...ignored,
  ].join('\n');
}

/** An error in one line. */
function describe(error: unknown): string {
  const said = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return said.replace(/\s+/g, ' ').trim();
}

export const register: Register = (on) => {
  on('tool.call', { tool: ['Edit', 'Write'] }, async ($, e, next) => {
    const result = await next(e);
    if (result.deny !== undefined || result.isError === true) return result;
    const cwd = await $.session.cwd();
    if (!isUnderRoadmap(e.file_path, cwd)) return result;

    let text: string | null;
    try {
      const host = hostOf($);
      const target = await resolveTarget(cwd, host);
      if (target === null) return result; // roadmap/ is not a directory of the working directory after all
      text = report(await runLint(target, host, await configOf(target.baseDir, host)));
    } catch (error) {
      // Fail-open: the result stays as the tool made it, and the person sees why the check is missing
      $.ui.log(`roadmap-lint: the check after editing roadmap/ did not run — ${describe(error)}`);
      return result;
    }
    if (text === null) return result;

    $.ui.log(text);
    pending.set(e.tool_use_id, text);
    return result;
  });

  // The report joins the result's body here, where the row that holds the tool_result is stored
  on('session.append', { door: 'tool-result' }, async ($, e, next) => {
    if (pending.size === 0) return next(e);
    let isTouched = false;
    const content = e.message.content.map((block) => {
      const id = block['tool_use_id'];
      const extra = block.type === 'tool_result' && typeof id === 'string' ? pending.get(id) : undefined;
      if (extra === undefined || typeof id !== 'string') return block;
      pending.delete(id);
      isTouched = true;
      const body = block['content'];
      if (typeof body === 'string') return { ...block, content: `${body}\n\n${extra}` };
      return { ...block, content: [...(Array.isArray(body) ? body : []), { type: 'text', text: extra }] };
    });
    return isTouched ? next({ ...e, message: { ...e.message, content } }) : next(e);
  });

  on('session.start', async ($, e, next) => {
    try {
      await $.tool.register({ name: TOOL_NAME, description: TOOL_DESCRIPTION, inputSchema: TOOL_INPUT_SCHEMA });
    } catch (error) {
      $.ui.log(`roadmap-lint: the ${TOOL_NAME} tool could not be registered — ${describe(error)}`);
    }
    return next(e);
  });

  on('tool.call', { tool: 'mcp__rdd-kit__roadmap_lint' }, async ($, e): Promise<ToolCallResult> => {
    const format = e['format'] ?? 'text';
    if (format !== 'text' && format !== 'json') return { deny: 'The format must be either text or json.' };
    const asked = e['path'];
    if (asked !== undefined && typeof asked !== 'string') return { deny: 'The path must be a string.' };
    const cwd = await $.session.cwd();
    const inputPath = asked === undefined || asked === '' ? cwd : path.resolve(cwd, asked);
    try {
      const host = hostOf($);
      const target = await resolveTarget(inputPath, host);
      if (target === null) return { deny: `Cannot find roadmap/ under ${inputPath}.` };
      const linted = await runLint(target, host, await configOf(target.baseDir, host));
      return { result: format === 'json' ? formatJson(linted) : formatText(linted) };
    } catch (error) {
      return { deny: `roadmap-lint could not run: ${describe(error)}` };
    }
  });
};
