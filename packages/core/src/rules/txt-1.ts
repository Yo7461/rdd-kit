import { shownOptionValue } from '../config.js';
import type { RuleDiagnostic, RuleModule } from './types.js';

/**
 * A run of U+FFFD and C0 control characters (TAB excluded. LF and CR do not appear in a line after normalization).
 * Invalid UTF-8 bytes surface as U+FFFD through Node's lossy decoding, so this walk
 * doubles as the detection of "cannot be decoded".
 */
const BAD_RUN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFD]+/gu;

const REPLACEMENT = '\uFFFD';

const DEFAULT_EXPECTED_SCRIPTS = ['Latin', 'Hiragana', 'Katakana', 'Han', 'Common', 'Inherited'];

function codeLabel(char: string): string {
  return `U+${(char.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}`;
}

function describeRun(run: string): string {
  const replacements = [...run].filter((c) => c === REPLACEMENT).length;
  const control = [...run].find((c) => c !== REPLACEMENT);
  const replacementText =
    replacements > 1
      ? `${replacements} consecutive U+FFFD replacement characters`
      : 'a U+FFFD replacement character';
  if (replacements > 0 && control) {
    return `Unexpected ${replacementText} and a C0 control character (${codeLabel(control)}).`;
  }
  if (control) {
    return `Unexpected C0 control character (${codeLabel(control)}).`;
  }
  return `Unexpected ${replacementText} — a trace of invalid UTF-8 bytes or garbled text.`;
}

const DEFAULT_RUN_LENGTH = 20;

/** The largest run length a quantifier accepts — above it the pattern would not compile (the engine's own limit). */
const MAX_RUN_LENGTH = 0x7fffffff;

/** Whether a name is a Unicode script the regular expression engine knows (`\p{Script=…}`). */
function isKnownScript(name: string): boolean {
  if (!/^[A-Za-z_]+$/.test(name)) return false;
  try {
    new RegExp(`\\p{Script=${name}}`, 'u');
    return true;
  } catch {
    return false;
  }
}

function isUsableRunLength(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 2 && value <= MAX_RUN_LENGTH;
}

/**
 * The content check of the heuristic's options (their shape has been checked by the engine): a script
 * name the engine does not know is dropped on its own, so the other names still count, and a run length
 * that is not a whole number between 2 and the engine's limit falls back to the default — each with a
 * notice. Whether the heuristic is on does not matter for the names (a wrong name is wrong either
 * way); that no usable name is left is said only when the heuristic would have run.
 */
function validateOptions(
  options: Record<string, unknown>,
  notice: (message: string) => void,
): Record<string, unknown> {
  const out = { ...options };
  const configured = options['expectedScripts'];
  if (Array.isArray(configured)) {
    const known = configured.filter((s): s is string => typeof s === 'string' && isKnownScript(s));
    const unknown = new Set(configured.filter((s): s is string => typeof s === 'string' && !known.includes(s)));
    for (const s of unknown) {
      notice(
        `TXT-1: Ignored the unknown script \`${shownOptionValue(s)}\` in \`expectedScripts\` — it is not a Unicode script name the regular expression engine knows.`,
      );
    }
    if (known.length === 0 && options['languageHeuristic'] === true) {
      notice('TXT-1: `expectedScripts` has no usable entry, so the script-mixing heuristic is off for this run.');
    }
    out['expectedScripts'] = known;
  }
  const length = options['unexpectedRunLength'];
  if (length !== undefined && !isUsableRunLength(length)) {
    notice(
      `TXT-1: Ignored the invalid \`unexpectedRunLength\` value \`${shownOptionValue(length)}\` — expected a whole number from 2 to ${MAX_RUN_LENGTH}, so the default ${DEFAULT_RUN_LENGTH} is used.`,
    );
    out['unexpectedRunLength'] = DEFAULT_RUN_LENGTH;
  }
  return out;
}

/** The pattern of the script-mixing heuristic. null when no usable script is left (which turns the check off). */
function unexpectedRunPattern(options: Record<string, unknown>): RegExp | null {
  const configured = options['expectedScripts'];
  // A direct call may skip validateOptions, so the same filtering happens here, silently
  const scripts = (Array.isArray(configured) ? configured : DEFAULT_EXPECTED_SCRIPTS).filter(
    (s): s is string => typeof s === 'string' && isKnownScript(s),
  );
  const length = options['unexpectedRunLength'];
  const runLength = isUsableRunLength(length) ? length : DEFAULT_RUN_LENGTH;
  if (scripts.length === 0) return null;
  try {
    const expected = scripts.map((s) => `\\p{Script=${s}}`).join('');
    return new RegExp(`[^${expected}\\s]{${runLength},}`, 'gu');
  } catch {
    return null; // Whatever slipped past the checks above — a mistake in the config must not crash the lint
  }
}

/**
 * TXT-1: garbled text and control characters.
 * Only the deterministic check (U+FFFD and C0 control characters) is on by default, as an error.
 * The script-mixing heuristic is an opt-in warning.
 * The front matter and code fences are walked too (nothing is excluded, because this checks the soundness of the bytes).
 */
export const txt1: RuleModule = {
  id: 'TXT-1',
  description: 'Replacement characters and control characters (the script-mixing heuristic is opt-in)',
  defaultSeverity: 'error',
  defaultOptions: {
    languageHeuristic: false,
    unexpectedRunLength: DEFAULT_RUN_LENGTH,
    expectedScripts: DEFAULT_EXPECTED_SCRIPTS,
  },
  validateOptions,
  check({ file, options }) {
    const out: RuleDiagnostic[] = [];
    const heuristic = options['languageHeuristic'] === true ? unexpectedRunPattern(options) : null;
    for (let line = 0; line < file.lines.length; line++) {
      const text = file.lines[line] ?? '';
      for (const match of text.matchAll(BAD_RUN)) {
        out.push({
          anchor: {
            kind: 'range',
            file: file.relPath,
            range: {
              start: { line, character: match.index },
              end: { line, character: match.index + match[0].length },
            },
          },
          message: describeRun(match[0]),
          suggestion: 'Fix the text — re-fetch it from the original source and save the file as UTF-8.',
        });
      }
      if (!heuristic) continue;
      for (const match of text.matchAll(heuristic)) {
        out.push({
          severity: 'warning',
          anchor: {
            kind: 'range',
            file: file.relPath,
            range: {
              start: { line, character: match.index },
              end: { line, character: match.index + match[0].length },
            },
          },
          message: `Unexpected run of ${[...match[0]].length} characters outside the expected scripts (possible language mixing).`,
          suggestion:
            'Check that the text is intended. Change `expectedScripts` or `unexpectedRunLength` in the config if it is.',
        });
      }
    }
    return out;
  },
};
