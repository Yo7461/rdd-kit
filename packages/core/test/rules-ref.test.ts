import { describe, expect, it } from 'vitest';
import { buildCorpusIndex } from '../src/corpus/index.js';
import { parseSource, type ParsedFile } from '../src/parse/parsed-file.js';
import { ref1 } from '../src/rules/ref-1.js';
import { ref2 } from '../src/rules/ref-2.js';
import type { RuleDiagnostic, RuleModule } from '../src/rules/types.js';

function make(relPath: string, lines: string[]): ParsedFile {
  return parseSource(relPath, lines.join('\n') + '\n');
}

function runCorpus(
  rule: RuleModule,
  files: ParsedFile[],
  options: Record<string, unknown> = {},
  existingPaths: readonly string[] = [],
): RuleDiagnostic[] {
  const paths = new Set(existingPaths);
  const corpus = buildCorpusIndex(
    files.map((f) => ({ relPath: f.relPath, type: f.type })),
    files,
    (p) => paths.has(p),
  );
  return rule.checkCorpus?.({ files, corpus, options }) ?? [];
}

// Where the definitions come from: roadmap.md (P) plus a session (S) plus a research file (R).
// The sample record text stays in Japanese on purpose (records are written in the user's language).
const base = (): ParsedFile[] => [
  make('roadmap/roadmap.md', ['# Roadmap: x', '## Phases', '### P0001: 一 — active']),
  make('roadmap/phases/P0001-x/sessions/S0001.md', ['# S0001']),
  make('roadmap/research/R0001-t.md', ['# R0001: t']),
];

describe('REF-1: a referenced ID exists', () => {
  it('passes a reference to something defined (in the body and in the front matter)', () => {
    const files = [
      ...base(),
      make('roadmap/status.md', [
        '---',
        'current_phase: P0001',
        '---',
        '',
        '# Status: x',
        '本文でも P0001 と R0001 と S0001 を参照する。',
      ]),
    ];
    expect(runCorpus(ref1, files)).toEqual([]);
  });

  it('reports an error at the token position for an undefined P reference', () => {
    const files = [...base(), make('roadmap/status.md', ['P0009 を参照。'])];
    const out = runCorpus(ref1, files);
    expect(out).toHaveLength(1);
    expect(out[0]?.message).toContain('Cannot find a definition for P0009');
    expect(out[0]?.anchor).toEqual({
      kind: 'range',
      file: 'roadmap/status.md',
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
    });
  });

  it('an undefined B or C: an error with a note in the current layer, exempt in the Fact layer', () => {
    const current = runCorpus(ref1, [
      ...base(),
      make('roadmap/status.md', ['B0001 待ち。C0002 に依存。']),
    ]);
    expect(current).toHaveLength(2);
    expect(current[0]?.message).toContain('Not in the Blockers table');
    expect(current[1]?.message).toContain('Not in the spec');

    const fact = runCorpus(ref1, [
      ...base(),
      make('roadmap/phases/P0001-x/sessions/S0002.md', ['# S0002', 'B0001 を解消し C0002 を廃止した。']),
    ]);
    expect(fact).toEqual([]);
  });

  it('excludes code fences, inline code, and blockquotes (the config can bring them in)', () => {
    const files = [
      ...base(),
      make('roadmap/status.md', [
        '```text',
        'P0008 はフェンス内の例示',
        '```',
        'インラインの `P0008` も例示。',
        '> 引用内の P0008 も例示。',
      ]),
    ];
    expect(runCorpus(ref1, files)).toEqual([]);
    expect(
      runCorpus(ref1, files, { scanCodeFences: true, scanInlineCode: true, scanBlockquotes: true }),
    ).toHaveLength(3);
  });

  it('walks the contract yaml fence of a spec domain file but not an example fence', () => {
    const files = [
      ...base(),
      make('roadmap/spec/api.md', [
        '# Spec: api',
        '## C0001: 契約',
        '```yaml',
        'since: S0099',
        '```',
        '```yaml',
        'since: S0098(見出し直下でない例示フェンス)',
        '```',
      ]),
    ];
    const out = runCorpus(ref1, files);
    expect(out).toHaveLength(1);
    expect(out[0]?.message).toContain('S0099');
  });

  it('exempts a forward reference to the next session (the highest S plus 1), reports +2 or more, and exempts `S0001` when no session exists yet', () => {
    const handoff = (id: string) =>
      make('roadmap/status.md', [`next_command: 次は ${id} で作業する`]);
    expect(runCorpus(ref1, [...base(), handoff('S0002')])).toEqual([]); // max=`S0001`
    expect(runCorpus(ref1, [...base(), handoff('S0003')])).toHaveLength(1);
    expect(runCorpus(ref1, [...base(), handoff('S0002')], { allowNextSessionRef: false })).toHaveLength(1);
    const noSessions = [
      make('roadmap/roadmap.md', ['## Phases', '### P0001: 一 — active']),
      handoff('S0001'),
    ];
    expect(runCorpus(ref1, noSessions)).toEqual([]);
  });

  it('matches a D token as a whole (never reporting the P inside it twice) and does not walk an unknown file', () => {
    const out = runCorpus(ref1, [
      ...base(),
      make('roadmap/status.md', ['D-P0001-0099 に基づく。']),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]?.message).toContain('D-P0001-0099');

    const unknown = runCorpus(ref1, [
      ...base(),
      make('roadmap/assets/R0001/note.md', ['P0009 や R0009 の疑似 ID を含む生成データ']),
    ]);
    expect(unknown).toEqual([]);
  });
});

describe('REF-2: a referenced path exists', () => {
  const spec = (source: string, verifiedBy: string): ParsedFile =>
    make('roadmap/spec/api.md', [
      '# Spec: api',
      '## C0001: 契約',
      '```yaml',
      `source: ${source}`,
      `verified_by: ${verifiedBy}`,
      '```',
    ]);

  it('(a) source and verified_by: passes when they exist, reports an error on the key line when they do not, and excludes manual, a URL, and everything from :: on', () => {
    const ok = runCorpus(
      ref2,
      [...base(), spec('src/app.ts', 'tests/app.test.ts::契約, manual, https://example.com')],
      {},
      ['src/app.ts', 'tests/app.test.ts'],
    );
    expect(ok).toEqual([]);

    const missing = runCorpus(ref2, [...base(), spec('src/gone.ts', 'manual')], {}, []);
    expect(missing).toHaveLength(1);
    expect(missing[0]?.message).toContain('`src/gone.ts` (C0001 `source`');
    expect(missing[0]?.anchor).toMatchObject({ kind: 'range', range: { start: { line: 3 } } });
  });

  it('(a) the status column of Phase Index: checked relative to roadmap/, with — excluded', () => {
    const root = (statusCell: string) =>
      make('roadmap/status.md', [
        '# Status: x',
        '## Phase Index',
        '| Phase | 状態 | status |',
        '|-------|------|--------|',
        `| P0001 x | active | ${statusCell} |`,
        '| P0002 y | planned | — |',
      ]);
    expect(
      runCorpus(ref2, [...base(), root('phases/P0001-x/status.md')], {}, [
        'roadmap/phases/P0001-x/status.md',
      ]),
    ).toEqual([]);
    const out = runCorpus(ref2, [...base(), root('phases/P0009-gone/status.md')], {}, []);
    expect(out).toHaveLength(1);
    expect(out[0]?.message).toContain('`phases/P0009-gone/status.md` (Phase Index');
  });

  it('(b) a Markdown link: checked relative to where the file sits, excluding a URL, an absolute path, a #, and anything outside roadmap/ in the Fact layer', () => {
    const ok = runCorpus(
      ref2,
      [...base(), make('roadmap/spec/map.md', ['[契約](api.md) と [外部](https://example.com) と [節](#x)'])],
      {},
      ['roadmap/spec/api.md'],
    );
    expect(ok).toEqual([]);

    const broken = runCorpus(ref2, [
      ...base(),
      make('roadmap/spec/map.md', ['[契約](gone.md)']),
    ]);
    expect(broken).toHaveLength(1);
    expect(broken[0]?.message).toBe('Cannot find the linked path `gone.md`.');

    // A link out of roadmap/ from the Fact layer is not checked (code moves after a record is written)
    const fact = runCorpus(ref2, [
      ...base(),
      make('roadmap/research/R0001-t.md', ['# R0001: t', '[コード](../../src/gone.ts)']),
    ]);
    expect(fact).toEqual([]);
  });

  it('(c) a path-like token in inline code: an extension is required, the three criteria are OR-ed, and it is a warning', () => {
    const current = (token: string) =>
      make('roadmap/status.md', ['# Status: x', `検証は \`${token}\` を使う。`]);
    // It exists (relative to the repository root)
    expect(runCorpus(ref2, [...base(), current('packages/core/src/a.ts')], {}, ['packages/core/src/a.ts'])).toEqual([]);
    // It exists (completed relative to roadmap/)
    expect(
      runCorpus(ref2, [...base(), current('phases/P0001-x/status.md')], {}, [
        'roadmap/phases/P0001-x/status.md',
      ]),
    ).toEqual([]);
    // Missing -> a warning
    const missing = runCorpus(ref2, [...base(), current('src/gone.ts')]);
    expect(missing).toHaveLength(1);
    expect(missing[0]?.severity).toBe('warning');
    // No extension, a glob, a URL, and a placeholder are out of scope
    expect(runCorpus(ref2, [...base(), current('scripts/build/')])).toEqual([]);
    expect(runCorpus(ref2, [...base(), current('packages/*/test')])).toEqual([]);
    expect(runCorpus(ref2, [...base(), current('roadmap/assets/<ID>/x.py')])).toEqual([]);
    // Turned off through the config
    expect(runCorpus(ref2, [...base(), current('src/gone.ts')], { checkInlineCodePaths: false })).toEqual([]);
  });

  it('(c) the Fact layer checks only a token spelled out from roadmap/ (so a quoted path from another repository is not a false positive)', () => {
    const fact = (token: string) =>
      make('roadmap/research/R0001-t.md', ['# R0001: t', `出典コード: \`${token}\``]);
    expect(runCorpus(ref2, [...base().slice(0, 2), fact('docs/cli/validation.md')])).toEqual([]);
    const missing = runCorpus(ref2, [...base().slice(0, 2), fact('roadmap/assets/R0001/gen.py')]);
    expect(missing).toHaveLength(1);
    expect(
      runCorpus(ref2, [...base().slice(0, 2), fact('roadmap/assets/R0001/gen.py')], {}, [
        'roadmap/assets/R0001/gen.py',
      ]),
    ).toEqual([]);
  });
});

describe('REF-2 (a): the list form of source / verified_by (STRUCT-4 accepts it, so REF-2 walks it)', () => {
  const spec = (verifiedBy: string): ParsedFile =>
    make('roadmap/spec/api.md', [
      '# Spec: api',
      '## C0001: 契約',
      '```yaml',
      'source: src/app.ts',
      `verified_by: ${verifiedBy}`,
      '```',
    ]);

  it('checks every entry of a list, with manual and :: handled as in the string form', () => {
    expect(
      runCorpus(ref2, [...base(), spec('[tests/app.test.ts::契約, manual]')], {}, ['src/app.ts', 'tests/app.test.ts']),
    ).toEqual([]);
    const missing = runCorpus(ref2, [...base(), spec('[tests/gone.test.ts, manual]')], {}, ['src/app.ts']);
    expect(missing).toHaveLength(1);
    expect(missing[0]?.message).toContain('`tests/gone.test.ts` (C0001 `verified_by`');
  });
});
