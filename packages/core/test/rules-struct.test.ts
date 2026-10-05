import { describe, expect, it } from 'vitest';
import { parseSource, type ParsedFile } from '../src/parse/parsed-file.js';
import { struct1 } from '../src/rules/struct-1.js';
import { struct2 } from '../src/rules/struct-2.js';
import { struct3 } from '../src/rules/struct-3.js';
import { struct4 } from '../src/rules/struct-4.js';
import type { RuleModule } from '../src/rules/types.js';

function make(relPath: string, lines: string[]): ParsedFile {
  return parseSource(relPath, lines.join('\n') + '\n');
}

function run(rule: RuleModule, file: ParsedFile) {
  return rule.check?.({ file, options: {} }) ?? [];
}

const SESSION_PATH = 'roadmap/phases/P0001-first/sessions/S0001.md';
const SESSION_FM = [
  '---',
  'session: S0001',
  'phase: P0001',
  'date: 2026-07-01',
  'state: closed',
  'base_commit: null',
  'commits: []',
  'artifacts: []',
  'roadmap_changed: false',
  '---',
];
const SESSION_BODY = ['', '# S0001', '', '## Plan', 'x', '## Did', 'x', '## Result', 'x', '## Learned / Decisions', 'x', '## Handoff', 'x'];

describe('STRUCT-1: a required heading is missing', () => {
  it('passes a file that follows the template', () => {
    expect(run(struct1, make(SESSION_PATH, [...SESSION_FM, ...SESSION_BODY]))).toEqual([]);
  });

  it('reports one diagnostic per missing required H2, on a file anchor', () => {
    const withoutHandoff = [...SESSION_FM, ...SESSION_BODY.slice(0, -2)];
    const out = run(struct1, make(SESSION_PATH, withoutHandoff));
    expect(out).toHaveLength(1);
    expect(out[0]?.anchor.kind).toBe('file');
    expect(out[0]?.message).toContain('`## Handoff`');
  });

  it('detects a missing H1 and one whose shape does not match', () => {
    const noH1 = [...SESSION_FM, '', '## Plan', 'x', '## Did', 'x', '## Result', 'x', '## Learned / Decisions', 'x', '## Handoff', 'x'];
    expect(run(struct1, make(SESSION_PATH, noH1))[0]?.message).toContain('Missing an H1 heading');

    const wrongH1 = [...SESSION_FM, '', '# Session S0001', ...SESSION_BODY.slice(2)];
    const out = run(struct1, make(SESSION_PATH, wrongH1));
    expect(out).toHaveLength(1);
    expect(out[0]?.message).toContain('Unexpected H1 heading');
    expect(out[0]?.anchor.kind).toBe('range');
  });
});

describe('STRUCT-2: duplicated and out-of-order fixed headings', () => {
  it('reports an error on the second occurrence of a duplicate', () => {
    const dup = [...SESSION_FM, ...SESSION_BODY, '## Did', 'y'];
    const out = run(struct2, make(SESSION_PATH, dup));
    expect(out).toHaveLength(1);
    expect(out[0]?.severity).toBeUndefined(); // Falls back to the rule default (error)
    expect(out[0]?.message).toContain('Duplicate fixed heading `## Did` (2 occurrences)');
  });

  it('warns on the first slip in the order (a per-diagnostic severity)', () => {
    const swapped = [...SESSION_FM, '', '# S0001', '', '## Plan', 'x', '## Result', 'x', '## Did', 'x', '## Learned / Decisions', 'x', '## Handoff', 'x'];
    const out = run(struct2, make(SESSION_PATH, swapped));
    expect(out).toHaveLength(1);
    expect(out[0]?.severity).toBe('warning');
    expect(out[0]?.message).toContain('Unexpected position for fixed heading `## Result`');
  });

  it('leaves an H2 outside the fixed set out of the duplicate and order checks', () => {
    const withUnknown = [...SESSION_FM, '', '# S0001', '', '## Plan', 'x', '## メモ', 'x', '## Did', 'x', '## Result', 'x', '## Learned / Decisions', 'x', '## メモ', 'x', '## Handoff', 'x'];
    expect(run(struct2, make(SESSION_PATH, withUnknown))).toEqual([]);
  });
});

describe('STRUCT-3: within-file agreement', () => {
  const rootStatus = (nextCommand: string, recommendLine: string) =>
    make('roadmap/status.md', [
      '---',
      'current_phase: P0001',
      'open_session: null',
      'last_session: S0001',
      `next_command: "${nextCommand}"`,
      'updated: 2026-07-01',
      '---',
      '',
      '# Status: x',
      '',
      '## Next',
      recommendLine,
    ]);

  it('passes when they match once the backticks are stripped', () => {
    const file = rootStatus(
      '/roadmap start — S0002: 続き',
      'Recommended: `/roadmap start` — S0002: 続き',
    );
    expect(run(struct3, file)).toEqual([]);
  });

  it('reports an error on the next_command line when they disagree', () => {
    const file = rootStatus('/roadmap close — 記録確定', 'Recommended: `/roadmap start` — S0002: 続き');
    const out = run(struct3, file);
    expect(out).toHaveLength(1);
    expect(out[0]?.message).toContain('Inconsistent `next_command`');
    expect(out[0]?.anchor).toMatchObject({ range: { start: { line: 4 } } });
  });

  it('reports an error on the Next heading when the Recommended line is missing', () => {
    const file = rootStatus('/roadmap start — x', '- [ ] タスクだけがある');
    const out = run(struct3, file);
    expect(out).toHaveLength(1);
    expect(out[0]?.message).toContain('Missing the recommended-command line');
  });

  const session = (changed: boolean, extra: string[]) =>
    make(SESSION_PATH, [
      '---',
      'session: S0001',
      'phase: P0001',
      'date: 2026-07-01',
      'state: closed',
      'base_commit: null',
      'commits: []',
      'artifacts: []',
      `roadmap_changed: ${changed}`,
      '---',
      '',
      '# S0001',
      ...extra,
    ]);

  it('passes roadmap_changed: true with the section present, and reports an error without it', () => {
    expect(run(struct3, session(true, ['', '## Roadmap Changes', '- 変更した']))).toEqual([]);
    const out = run(struct3, session(true, []));
    expect(out).toHaveLength(1);
    expect(out[0]?.message).toContain('Missing the Roadmap Changes section');
  });

  it('warns on false with real content, and passes false with only a placeholder', () => {
    const substantive = run(struct3, session(false, ['', '## Roadmap Changes', '- 変更した']));
    expect(substantive).toHaveLength(1);
    expect(substantive[0]?.severity).toBe('warning');
    expect(run(struct3, session(false, ['', '## Roadmap Changes', '(なし)']))).toEqual([]);
    expect(run(struct3, session(false, []))).toEqual([]);
  });
});

describe('STRUCT-4: a contract without a verified_by', () => {
  const DOMAIN_PATH = 'roadmap/spec/api.md';
  const domain = (yamlLines: string[], second: string[] = []) =>
    make(DOMAIN_PATH, [
      '---',
      'domain: api',
      'updated: 2026-07-01',
      '---',
      '',
      '# Spec: api',
      '',
      '## C0001: 契約',
      '```yaml',
      ...yamlLines,
      '```',
      '約束の散文。',
      ...second,
    ]);
  const base = ['kind: cli', 'stability: draft', 'source: src/x.ts', 'since: S0001', 'verified: S0001'];

  it('passes a path, a `path::name` list, several paths, `manual`, and the list form', () => {
    for (const value of [
      'verified_by: tests/x.test.ts',
      'verified_by: tests/x.test.ts::case_a, tests/y.test.ts',
      'verified_by: manual',
      'verified_by: [tests/x.test.ts, manual]',
      'verified_by: ["", tests/x.test.ts]',
    ]) {
      expect(run(struct4, domain([...base, value])), value).toEqual([]);
    }
  });

  it('reports a missing key on the contract heading, and an empty or wrong-typed value on the key line', () => {
    const missing = run(struct4, domain(base));
    expect(missing).toHaveLength(1);
    expect(missing[0]?.message).toBe('C0001 has no `verified_by`.');
    expect(missing[0]?.anchor).toMatchObject({ kind: 'range', file: DOMAIN_PATH, range: { start: { line: 7 } } });
    expect(missing[0]?.suggestion).toContain('`manual`');

    for (const empty of [
      'verified_by:',
      'verified_by: ""',
      'verified_by: []',
      'verified_by: [""]',
      'verified_by: ","',
      'verified_by: " :: "',
    ]) {
      const out = run(struct4, domain([...base, empty]));
      expect(out, empty).toHaveLength(1);
      expect(out[0]?.message).toBe('C0001 has an empty `verified_by`.');
      expect(out[0]?.anchor).toMatchObject({ range: { start: { line: 14 } } });
    }

    for (const wrong of ['verified_by: 123', 'verified_by: true', 'verified_by: [1]', 'verified_by: {a: b}']) {
      const out = run(struct4, domain([...base, wrong]));
      expect(out, wrong).toHaveLength(1);
      expect(out[0]?.message).toBe(
        'C0001 has a `verified_by` of the wrong type — a string or a list of strings is expected.',
      );
      expect(out[0]?.anchor).toMatchObject({ range: { start: { line: 14 } } });
    }
  });

  it('finds the key line inside a uniformly indented block', () => {
    const out = run(
      struct4,
      domain(['  kind: cli', '  stability: draft', '  source: src/x.ts', '  verified_by: ""', '  since: S0001']),
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.message).toBe('C0001 has an empty `verified_by`.');
    expect(out[0]?.anchor).toMatchObject({ range: { start: { line: 12 } } });
  });

  it('checks every contract block, and leaves a yaml fence that is not directly under a C#### heading alone', () => {
    const out = run(
      struct4,
      domain(
        [...base, 'verified_by: manual'],
        [
          '',
          '## C0002: 二つ目',
          '```yaml',
          ...base,
          '```',
          '散文。',
          '',
          '例(見出し直下でない yaml は契約ではない):',
          '',
          '```yaml',
          'kind: example',
          '```',
        ],
      ),
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.message).toBe('C0002 has no `verified_by`.');
  });

  it('reports a C#### heading without a block on the line right below it, and a block that does not parse', () => {
    const out = run(
      struct4,
      domain(
        [...base, 'verified_by: manual'],
        [
          '',
          '## C0002: 空行を挟んだ契約',
          '',
          '```yaml',
          ...base,
          'verified_by: manual',
          '```',
          '散文。',
          '',
          '## C0003: ブロック無し',
          '散文だけ。',
          '',
          '## C0004: 壊れた yaml',
          '```yaml',
          ...base,
          'verified_by: manual (reason: no harness)',
          '```',
          '散文。',
        ],
      ),
    );
    expect(out.map((d) => d.message)).toEqual([
      'C0002 has no contract block — the ```yaml fence has to start on the line right after the heading.',
      'C0003 has no contract block — the ```yaml fence has to start on the line right after the heading.',
      expect.stringContaining("C0004's contract block cannot be parsed as YAML ("),
    ]);
    expect(out[0]?.anchor).toMatchObject({ range: { start: { line: 18 } } });
    expect(out[2]?.anchor).toMatchObject({ range: { start: { line: 34 } } });
  });

  it('checks the folded form of an Invariants line in spec/map.md', () => {
    const map = (lines: string[]) =>
      make('roadmap/spec/map.md', [
        '---',
        'updated: 2026-07-01',
        '---',
        '',
        '# Spec Map: x',
        '',
        '## System Map',
        'x',
        '',
        '## Invariants',
        ...lines,
        '',
        '## Spec Index',
        '| file | 領域 | 概要 |',
        '|------|------|------|',
      ]);
    expect(
      run(struct4, map(['- C0004 (since: S0002 / draft / verified: S0002): 約束 — verified_by: manual'])),
    ).toEqual([]);
    const out = run(
      struct4,
      map([
        '- C0004 (since: S0002 / draft / verified: S0002): verified_by の無い約束',
        '- C0005 (since: S0002 / draft / verified: S0002): 空の verified_by — verified_by: ',
        '- C0006 (since: S0002 / draft / verified: S0002): 区切りだけ — verified_by: , ',
        '- 契約 ID で始まらない行は対象外',
      ]),
    );
    expect(out).toHaveLength(3);
    expect(out[0]?.message).toBe('C0004 (an Invariants line) has no `verified_by`.');
    expect(out[0]?.anchor).toMatchObject({ kind: 'range', range: { start: { line: 10 } } });
    expect(out[1]?.message).toBe('C0005 (an Invariants line) has an empty `verified_by`.');
    expect(out[2]?.message).toBe('C0006 (an Invariants line) has an empty `verified_by`.');
  });

  it('does not fire on other file types', () => {
    expect(run(struct4, make(SESSION_PATH, [...SESSION_FM, ...SESSION_BODY]))).toEqual([]);
  });
});
