import type { Severity } from './diagnostic.js';

/** The config of a single rule (enabled / severity override / options). */
export interface RuleConfig {
  enabled?: boolean;
  severity?: Severity;
  options?: Record<string, unknown>;
}

export interface LintConfig {
  rules?: Record<string, RuleConfig>;
}

export interface ResolvedRuleConfig {
  enabled: boolean;
  /** The severity stated in the config (null = no override. It takes precedence over a per-diagnostic severity) */
  severityOverride: Severity | null;
  options: Record<string, unknown>;
}

export interface RuleDefaults {
  id: string;
  defaultOptions?: Record<string, unknown>;
}

/**
 * The shape an option value has to take, read from the rule's default for it. The defaults are the
 * one description of the options there is (the rule table of doc/roadmap-lint.md is checked against
 * them too), so the shape is what the default shows: a number, a boolean, a list of strings, or —
 * for a default of null (`sinceCommit`) — a string. What a rule then requires of the value itself
 * (a hex hash, a known script name) stays with the rule (RuleModule.validateOptions).
 */
type OptionShape = 'number' | 'boolean' | 'string' | 'string-list' | 'string-or-null';

function shapeOf(defaultValue: unknown): OptionShape | null {
  if (defaultValue === null) return 'string-or-null';
  if (typeof defaultValue === 'number') return 'number';
  if (typeof defaultValue === 'boolean') return 'boolean';
  if (typeof defaultValue === 'string') return 'string';
  if (Array.isArray(defaultValue)) return 'string-list';
  return null;
}

function fits(value: unknown, shape: OptionShape): boolean {
  switch (shape) {
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) && value >= 0;
    case 'boolean':
      return typeof value === 'boolean';
    case 'string':
      return typeof value === 'string';
    case 'string-list':
      return Array.isArray(value) && value.every((item) => typeof item === 'string');
    case 'string-or-null':
      return value === null || typeof value === 'string';
  }
}

const EXPECTED: Record<OptionShape, string> = {
  number: 'a non-negative number',
  boolean: 'true or false',
  string: 'a string',
  'string-list': 'an array of strings',
  'string-or-null': 'a string or null',
};

/** A value as it is shown in a notice — JSON (so `"80"` and `80` read apart), cut short when it is long. */
export function shownOptionValue(value: unknown): string {
  let text: string;
  if (typeof value === 'number' && !Number.isFinite(value)) {
    text = String(value); // Infinity and NaN have no JSON form
  } else {
    try {
      text = JSON.stringify(value) ?? String(value);
    } catch {
      text = String(value);
    }
  }
  return text.length > 40 ? `${text.slice(0, 37)}…` : text;
}

const shown = shownOptionValue;

/** An option key as it is shown in a notice — control characters escaped, cut short when it is long. */
function shownKey(key: string): string {
  const text = JSON.stringify(key).slice(1, -1);
  return text.length > 40 ? `${text.slice(0, 37)}…` : text;
}

function defaultShown(defaultValue: unknown): string {
  if (defaultValue === null) return 'the default (none) is used';
  if (Array.isArray(defaultValue)) return 'the default list is used';
  return `the default ${shown(defaultValue)} is used`;
}

/**
 * Resolves one rule's config against its defaults. A value inside `options` that does not fit the
 * shape of its default, and a key the rule has no default for, are left out with a notice — that option
 * keeps its default while the valid options beside it apply, and the run itself goes on (fail-open: a slip
 * in the config must not stop the lint; the default now in force can change what the rule reports). The
 * notice goes to the engine's notices; without a callback (a direct call from a test, say) the invalid
 * value is still dropped.
 */
export function resolveRuleConfig(
  rule: RuleDefaults,
  config: LintConfig,
  notice?: (message: string) => void,
): ResolvedRuleConfig {
  const ruleConfig = config.rules?.[rule.id] ?? {};
  const defaults = rule.defaultOptions ?? {};
  const enabled = ruleConfig.enabled ?? true;
  const options: Record<string, unknown> = { ...defaults };
  // A rule that is off is not looked at — its options are neither applied nor checked
  for (const [key, value] of Object.entries(enabled ? (ruleConfig.options ?? {}) : {})) {
    // Own keys only: `constructor` or `__proto__` in a config is not an option, and must never be assigned
    if (!Object.hasOwn(defaults, key)) {
      const known = Object.keys(defaults);
      notice?.(
        `${rule.id}: Ignored the unknown option \`${shownKey(key)}\` — ${
          known.length === 0
            ? 'this rule takes no options'
            : `the options of this rule are ${known.map((name) => `\`${name}\``).join(', ')}`
        }.`,
      );
      continue;
    }
    const shape = shapeOf(defaults[key]);
    if (shape !== null && !fits(value, shape)) {
      notice?.(
        `${rule.id}: Ignored the invalid \`${key}\` value \`${shown(value)}\` — expected ${EXPECTED[shape]}, so ${defaultShown(defaults[key])}.`,
      );
      continue;
    }
    options[key] = value;
  }
  return { enabled, severityOverride: ruleConfig.severity ?? null, options };
}
