import { describe, expect, it } from 'vitest';
import { buildCorpusIndex, layerOf, type CorpusEntry } from '../src/corpus/index.js';
import { parseSource, type ParsedFile } from '../src/parse/parsed-file.js';

// The sample record text below stays in Japanese on purpose: records are written in the user's
// language (the same reason fixtures/valid does), and only the test names and comments are English.
function make(relPath: string, lines: string[]): ParsedFile {
  return parseSource(relPath, lines.join('\n') + '\n');
}

function build(files: ParsedFile[], extraEntries: CorpusEntry[] = []) {
  const entries = [
    ...files.map((f) => ({ relPath: f.relPath, type: f.type })),
    ...extraEntries,
  ];
  return buildCorpusIndex(entries, files, () => true);
}

describe('layerOf: which layer a path is in', () => {
  it('puts phases, research, experiments, and assets in the fact layer', () => {
    expect(layerOf('roadmap/phases/P0001-x/status.md')).toBe('fact');
    expect(layerOf('roadmap/research/R0001-x.md')).toBe('fact');
    expect(layerOf('roadmap/experiments/E0001-x.md')).toBe('fact');
    expect(layerOf('roadmap/assets/R0001/gen.py')).toBe('fact');
  });

  it('puts roadmap.md, status.md, and spec/ in the current layer', () => {
    expect(layerOf('roadmap/roadmap.md')).toBe('current');
    expect(layerOf('roadmap/status.md')).toBe('current');
    expect(layerOf('roadmap/spec/map.md')).toBe('current');
    expect(layerOf('roadmap/spec/cli.md')).toBe('current');
  });
});

describe('buildCorpusIndex: the ID definition table', () => {
  it('picks P up from the ### headings of roadmap.md (not from inside a fence, not from an H2)', () => {
    const index = build([
      make('roadmap/roadmap.md', [
        '# Roadmap: x',
        '## Phases',
        '### P0001: 最初 — active',
        '### P0004: 途中挿入 — planned',
        '```text',
        '### P0009: フェンス内の例示 — planned',
        '```',
      ]),
    ]);
    expect([...index.definitions.keys()].filter((k) => k.startsWith('P'))).toEqual([
      'P0001',
      'P0004',
    ]);
    expect(index.definitions.get('P0001')?.[0]).toMatchObject({
      kind: 'P',
      file: 'roadmap/roadmap.md',
      line: 2,
      via: 'heading',
    });
  });

  it('picks S, R, and E up leniently from the head of the file name (how strictly they are named belongs to ID-3)', () => {
    const index = build([
      make('roadmap/phases/P0001-x/sessions/S0001.md', ['# S0001']),
      make('roadmap/phases/P0001-x/sessions/S0002-notes.md', ['# x']),
      make('roadmap/research/R0001-topic.md', ['# R0001: t']),
      make('roadmap/experiments/E0003-bench.md', ['# E0003: t']),
      make('roadmap/research/memo.md', ['# メモ']),
    ]);
    expect(index.definitions.has('S0001')).toBe(true);
    expect(index.definitions.has('S0002')).toBe(true);
    expect(index.definitions.has('R0001')).toBe(true);
    expect(index.definitions.has('E0003')).toBe(true);
    expect(index.definitions.get('S0001')?.[0]).toMatchObject({ via: 'path', line: 0 });
    expect([...index.definitions.keys()].some((k) => k.includes('memo'))).toBe(false);
  });

  it('picks C up from both an H2 in a spec domain file and an Invariants line in map.md (telling the via apart)', () => {
    const index = build([
      make('roadmap/spec/api.md', ['# Spec: api', '## C0001: エンドポイント', '本文']),
      make('roadmap/spec/map.md', [
        '# Spec Map: x',
        '## Invariants',
        '- C0002 (since: S0001 / stable / verified: S0001): 約束 — verified_by: manual',
        '## Spec Index',
      ]),
    ]);
    expect(index.definitions.get('C0001')?.[0]).toMatchObject({ via: 'heading', kind: 'C' });
    expect(index.definitions.get('C0002')?.[0]).toMatchObject({ via: 'invariant-line', line: 2 });
  });

  it('picks B up from a row of the Blockers table in roadmap.md (a B#### in the header row is assumed not to occur in real data)', () => {
    const index = build([
      make('roadmap/roadmap.md', [
        '# Roadmap: x',
        '## Blockers',
        '| ID | blocks | 内容 | 状態 |',
        '|----|--------|------|------|',
        '| B0002 | P0006 | 権限申請 | open |',
        '## Parking Lot',
      ]),
    ]);
    expect(index.definitions.get('B0002')?.[0]).toMatchObject({
      kind: 'B',
      via: 'table-row',
      line: 4,
    });
  });

  it('picks D up from a Decisions entry in a phase status', () => {
    const index = build([
      make('roadmap/phases/P0002-y/status.md', [
        '# P0002: y — Status',
        '## Decisions',
        '- D-P0002-0001 (S0003): 決定の要約 — 詳細: sessions/S0003.md',
        '## Roadmap Changes',
      ]),
    ]);
    expect(index.definitions.get('D-P0002-0001')?.[0]).toMatchObject({
      kind: 'D',
      via: 'list-item',
      line: 2,
    });
  });

  it('keeps every duplicate definition in ascending (file, line) order (the evidence for ID-1)', () => {
    const index = build([
      make('roadmap/research/R0001-b.md', ['# R0001: b']),
      make('roadmap/research/R0001-a.md', ['# R0001: a']),
    ]);
    expect(index.definitions.get('R0001')?.map((d) => d.file)).toEqual([
      'roadmap/research/R0001-a.md',
      'roadmap/research/R0001-b.md',
    ]);
  });

  it('sets maxSession to the highest S defined (null when there is none)', () => {
    const withSessions = build([
      make('roadmap/phases/P0001-x/sessions/S0001.md', ['# S0001']),
      make('roadmap/phases/P0001-x/sessions/S0007.md', ['# S0007']),
    ]);
    expect(withSessions.maxSession).toBe(7);
    expect(build([make('roadmap/roadmap.md', ['# Roadmap: x'])]).maxSession).toBeNull();
  });

  it('holds every file in entries including non-.md ones, and uses the injected probe for pathExists', () => {
    const files = [make('roadmap/roadmap.md', ['# Roadmap: x'])];
    const entries = [
      { relPath: 'roadmap/roadmap.md', type: 'roadmap' as const },
      { relPath: 'roadmap/research/.gitkeep', type: 'unknown' as const },
    ];
    const index = buildCorpusIndex(entries, files, (p) => p === 'src/app.ts');
    expect(index.entries).toHaveLength(2);
    expect(index.pathExists('src/app.ts')).toBe(true);
    expect(index.pathExists('src/missing.ts')).toBe(false);
  });
});
