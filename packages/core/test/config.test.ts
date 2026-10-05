import { describe, expect, it } from 'vitest';
import { resolveRuleConfig } from '../src/config.js';
import { severityRank } from '../src/diagnostic.js';
import type { Anchor, Diagnostic } from '../src/diagnostic.js';

const sizeRule = {
  id: 'SIZE-1',
  defaultOptions: { maxLines: 60 },
} as const;

describe('the diagnostic model', () => {
  it('expresses the three anchor kinds (range / file / repo)', () => {
    const anchors: Anchor[] = [
      {
        kind: 'range',
        file: 'roadmap/status.md',
        range: { start: { line: 0, character: 0 }, end: { line: 1, character: 2 } },
      },
      { kind: 'file', file: 'roadmap/roadmap.md' },
      { kind: 'repo' },
    ];
    const diagnostics: Diagnostic[] = anchors.map((anchor) => ({
      rule: 'SIZE-1',
      severity: 'error',
      anchor,
      message: 'a message',
      suggestion: 'a suggestion',
    }));
    expect(diagnostics.map((d) => d.anchor.kind)).toEqual(['range', 'file', 'repo']);
  });

  it('has two severity levels, with error above warning', () => {
    expect(severityRank('error')).toBeGreaterThan(severityRank('warning'));
  });
});

describe('resolving the config of a rule', () => {
  it('falls back to the defaults when nothing is set (no severity override)', () => {
    expect(resolveRuleConfig(sizeRule, {})).toEqual({
      enabled: true,
      severityOverride: null,
      options: { maxLines: 60 },
    });
  });

  it('overrides severity (the options keep their defaults)', () => {
    const resolved = resolveRuleConfig(sizeRule, { rules: { 'SIZE-1': { severity: 'warning' } } });
    expect(resolved.severityOverride).toBe('warning');
    expect(resolved.enabled).toBe(true);
    expect(resolved.options).toEqual({ maxLines: 60 });
  });

  it('turns a rule off', () => {
    const resolved = resolveRuleConfig(sizeRule, { rules: { 'SIZE-1': { enabled: false } } });
    expect(resolved.enabled).toBe(false);
  });

  it('merges the options with the defaults (a partial override)', () => {
    const rule = { id: 'X-1', defaultOptions: { a: 1, b: 2 } } as const;
    const resolved = resolveRuleConfig(rule, { rules: { 'X-1': { options: { b: 3 } } } });
    expect(resolved.options).toEqual({ a: 1, b: 3 });
  });

  it('is not affected by the config of another rule', () => {
    const resolved = resolveRuleConfig(sizeRule, { rules: { 'OTHER-1': { enabled: false } } });
    expect(resolved).toEqual({ enabled: true, severityOverride: null, options: { maxLines: 60 } });
  });
});

describe('checking the options against their defaults (fail-open with a notice)', () => {
  const rule = {
    id: 'X-1',
    defaultOptions: {
      maxLines: 60,
      flag: false,
      names: ['.gitkeep'],
      sinceCommit: null as string | null,
    },
  };

  function resolve(options: Record<string, unknown>, enabled = true) {
    const notices: string[] = [];
    const resolved = resolveRuleConfig(
      rule,
      { rules: { 'X-1': { enabled, options } } },
      (message) => notices.push(message),
    );
    return { options: resolved.options, notices };
  }

  it('accepts values of the shape the default shows', () => {
    const { options, notices } = resolve({ maxLines: 0.5, flag: true, names: [], sinceCommit: 'abc1234' });
    expect(options).toEqual({ maxLines: 0.5, flag: true, names: [], sinceCommit: 'abc1234' });
    expect(notices).toEqual([]);
    expect(resolve({ sinceCommit: null }).options['sinceCommit']).toBeNull();
  });

  it('drops a value of the wrong shape with a notice that names the value, the shape, and the default in force', () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ maxLines: 'abc' }, 'X-1: Ignored the invalid `maxLines` value `"abc"` — expected a non-negative number, so the default 60 is used.'],
      [{ maxLines: -1 }, 'X-1: Ignored the invalid `maxLines` value `-1` — expected a non-negative number, so the default 60 is used.'],
      [{ maxLines: Number.NaN }, 'X-1: Ignored the invalid `maxLines` value `NaN` — expected a non-negative number, so the default 60 is used.'],
      [{ flag: 'true' }, 'X-1: Ignored the invalid `flag` value `"true"` — expected true or false, so the default false is used.'],
      [{ names: 'scratchpad' }, 'X-1: Ignored the invalid `names` value `"scratchpad"` — expected an array of strings, so the default list is used.'],
      [{ names: ['a', 3] }, 'X-1: Ignored the invalid `names` value `["a",3]` — expected an array of strings, so the default list is used.'],
      [{ sinceCommit: 123 }, 'X-1: Ignored the invalid `sinceCommit` value `123` — expected a string or null, so the default (none) is used.'],
    ];
    for (const [options, expected] of cases) {
      const result = resolve(options);
      expect(result.notices).toEqual([expected]);
      expect(result.options).toEqual(rule.defaultOptions);
    }
  });

  it('drops a key the rule has no default for, naming the options it does have', () => {
    const { options, notices } = resolve({ maxLine: 100 });
    expect(options).toEqual(rule.defaultOptions);
    expect(notices).toEqual([
      'X-1: Ignored the unknown option `maxLine` — the options of this rule are `maxLines`, `flag`, `names`, `sinceCommit`.',
    ]);
    const bare = { id: 'Y-1', defaultOptions: {} };
    const heard: string[] = [];
    resolveRuleConfig(bare, { rules: { 'Y-1': { options: { maxLines: 1 } } } }, (m) => heard.push(m));
    expect(heard).toEqual(['Y-1: Ignored the unknown option `maxLines` — this rule takes no options.']);
  });

  it('keeps the valid options of a config that also has invalid ones', () => {
    const { options, notices } = resolve({ maxLines: 100, flag: 'yes' });
    expect(options).toEqual({ ...rule.defaultOptions, maxLines: 100 });
    expect(notices).toHaveLength(1);
  });

  it('cuts a long value short in the notice, and shows a number without a JSON form as it is', () => {
    const { notices } = resolve({ names: 'x'.repeat(100) });
    // 37 characters of the JSON text (the opening quote and 36 x's), then an ellipsis
    expect(notices[0]).toContain('`"' + 'x'.repeat(36) + '…`');
    expect(notices[0]).not.toContain('x'.repeat(37));
    expect(resolve({ maxLines: Number.POSITIVE_INFINITY }).notices[0]).toContain('value `Infinity`');
  });

  it('treats a key inherited from Object.prototype as unknown, and never assigns it', () => {
    const { options, notices } = resolve(
      JSON.parse('{"constructor": 1, "toString": "x", "hasOwnProperty": 2, "__proto__": {"injected": true}}') as Record<string, unknown>,
    );
    expect(notices.map((n) => n.split(' — ')[0])).toEqual([
      'X-1: Ignored the unknown option `constructor`',
      'X-1: Ignored the unknown option `toString`',
      'X-1: Ignored the unknown option `hasOwnProperty`',
      'X-1: Ignored the unknown option `__proto__`',
    ]);
    expect(Object.keys(options)).toEqual(Object.keys(rule.defaultOptions));
    expect(Object.getPrototypeOf(options)).toBe(Object.prototype);
    expect((options as { injected?: unknown }).injected).toBeUndefined();
  });

  it('shows an unknown key with its control characters escaped and cut short', () => {
    const { notices } = resolve({ 'maxLine\nNote: X-1: all good': 1, ['k'.repeat(60)]: 2 });
    expect(notices[0]).toContain('`maxLine\\nNote: X-1: all good`');
    expect(notices[0]).not.toContain('\n');
    expect(notices[1]).toContain('`' + 'k'.repeat(37) + '…`');
  });

  it('does not look at the options of a rule that is off', () => {
    const { options, notices } = resolve({ maxLines: 'abc', maxLine: 1 }, false);
    expect(options).toEqual(rule.defaultOptions);
    expect(notices).toEqual([]);
  });

  it('drops an invalid value even when nobody listens for the notice', () => {
    const resolved = resolveRuleConfig(rule, { rules: { 'X-1': { options: { maxLines: 'abc' } } } });
    expect(resolved.options['maxLines']).toBe(60);
  });
});
