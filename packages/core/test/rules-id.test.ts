import { describe, expect, it } from 'vitest';
import { buildCorpusIndex, type CorpusEntry } from '../src/corpus/index.js';
import { parseSource, type ParsedFile } from '../src/parse/parsed-file.js';
import { id1 } from '../src/rules/id-1.js';
import { id2 } from '../src/rules/id-2.js';
import { id3 } from '../src/rules/id-3.js';
import type { RuleDiagnostic, RuleModule } from '../src/rules/types.js';

function make(relPath: string, lines: string[]): ParsedFile {
  return parseSource(relPath, lines.join('\n') + '\n');
}

function runCorpus(
  rule: RuleModule,
  files: ParsedFile[],
  extraEntries: CorpusEntry[] = [],
  options: Record<string, unknown> = {},
): RuleDiagnostic[] {
  const entries = [
    ...files.map((f) => ({ relPath: f.relPath, type: f.type })),
    ...extraEntries,
  ];
  const corpus = buildCorpusIndex(entries, files, () => true);
  return rule.checkCorpus?.({ files, corpus, options }) ?? [];
}

const session = (id: string, phase = 'P0001'): ParsedFile =>
  make(`roadmap/phases/${phase}-x/sessions/${id}.md`, ['# ' + id]);

describe('ID-1: a duplicate definition and a gap in session numbers', () => {
  it('treats a gap in P, R, and C as normal — no diagnostics', () => {
    const out = runCorpus(id1, [
      make('roadmap/roadmap.md', ['## Phases', '### P0001: a — done', '### P0004: b — active']),
      make('roadmap/research/R0002-x.md', ['# R0002: x']),
      make('roadmap/spec/api.md', ['# Spec: api', '## C0003: x']),
    ]);
    expect(out).toEqual([]);
  });

  it('reports an error on the second (in sort order) of two R files with the same number, naming where it was defined first', () => {
    const out = runCorpus(id1, [
      make('roadmap/research/R0001-a.md', ['# R0001: a']),
      make('roadmap/research/R0001-b.md', ['# R0001: b']),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]?.anchor).toEqual({ kind: 'file', file: 'roadmap/research/R0001-b.md' });
    expect(out[0]?.message).toContain('Duplicate definition of R0001');
    expect(out[0]?.message).toContain('roadmap/research/R0001-a.md');
  });

  it('reports an error on the second heading line for a duplicate P heading', () => {
    const out = runCorpus(id1, [
      make('roadmap/roadmap.md', [
        '## Phases',
        '### P0001: a — done',
        '### P0001: a(再掲) — active',
      ]),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]?.anchor).toMatchObject({
      kind: 'range',
      file: 'roadmap/roadmap.md',
      range: { start: { line: 2 } },
    });
  });

  it('warns when a C is listed both in a domain file and in map.md Invariants', () => {
    const out = runCorpus(id1, [
      make('roadmap/spec/api.md', ['# Spec: api', '## C0001: 契約']),
      make('roadmap/spec/map.md', [
        '# Spec Map: x',
        '## Invariants',
        '- C0001 (since: S0001 / draft / verified: S0001): 約束 — verified_by: manual',
      ]),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]?.severity).toBe('warning');
    expect(out[0]?.anchor).toMatchObject({ file: 'roadmap/spec/map.md' });
    expect(out[0]?.message).toContain('no single source of truth');
  });

  it('warns on a repo anchor for a gap in session numbers, and drops it under warnSessionGaps: false', () => {
    const files = [session('S0001'), session('S0003')];
    const out = runCorpus(id1, files);
    expect(out).toHaveLength(1);
    expect(out[0]?.severity).toBe('warning');
    expect(out[0]?.anchor).toEqual({ kind: 'repo' });
    expect(out[0]?.message).toContain('S0002');
    expect(runCorpus(id1, files, [], { warnSessionGaps: false })).toEqual([]);
  });
});

const ROADMAP_OK = [
  '# Roadmap: x',
  '## Phases',
  '### P0001: 一 — done',
  '### P0002: 二 — active',
  '### P0003: 三 — planned',
];

function rootStatus(rows: string[], currentPhase = 'P0002'): ParsedFile {
  return make('roadmap/status.md', [
    '---',
    `current_phase: ${currentPhase}`,
    'open_session: null',
    'last_session: S0001',
    'next_command: "x"',
    'updated: 2026-07-01',
    '---',
    '',
    '# Status: x',
    '',
    '## Phase Index',
    '| Phase | 状態 | status |',
    '|-------|------|--------|',
    ...rows,
  ]);
}

function phaseStatus(dir: string, phase: string, state: string): ParsedFile {
  return make(`roadmap/phases/${dir}/status.md`, [
    '---',
    `phase: ${phase}`,
    `state: ${state}`,
    'started: 2026-07-01',
    ...(state === 'done' ? ['closed: 2026-07-01'] : []),
    '---',
    '',
    `# ${phase}: x — Status`,
  ]);
}

const INDEX_OK = [
  '| P0001 one | done | phases/P0001-one/status.md |',
  '| P0002 two | active | phases/P0002-two/status.md |',
  '| P0003 three | planned | — |',
];

function consistentFiles(): ParsedFile[] {
  return [
    make('roadmap/roadmap.md', ROADMAP_OK),
    rootStatus(INDEX_OK),
    phaseStatus('P0001-one', 'P0001', 'done'),
    phaseStatus('P0002-two', 'P0002', 'active'),
  ];
}

describe('ID-2: the three-way phase check', () => {
  it('reports nothing when all three agree (a planned phase has no directory)', () => {
    expect(runCorpus(id2, consistentFiles())).toEqual([]);
  });

  it('reports an error on the Phase Index heading when a row is missing', () => {
    const files = consistentFiles();
    files[1] = rootStatus(INDEX_OK.slice(0, 2)); // Drop the `P0003` row
    const out = runCorpus(id2, files);
    expect(out).toHaveLength(1);
    expect(out[0]?.message).toContain('Missing a Phase Index row for P0003');
  });

  it('reports an error on the row when roadmap.md has no matching heading', () => {
    const files = consistentFiles();
    files[1] = rootStatus([...INDEX_OK, '| P0009 nine | active | — |']);
    const out = runCorpus(id2, files);
    expect(out.map((d) => d.message)).toEqual([
      'Missing a heading for P0009 in the roadmap.md Phases section.',
    ]);
  });

  it('reports an error on the row when the states disagree', () => {
    const files = consistentFiles();
    files[1] = rootStatus([
      INDEX_OK[0] as string,
      '| P0002 two | planned | phases/P0002-two/status.md |',
      INDEX_OK[2] as string,
    ]);
    const out = runCorpus(id2, files);
    expect(out).toHaveLength(1);
    expect(out[0]?.message).toContain('roadmap.md says `active`, Phase Index says `planned`');
  });

  it('reports an error on the roadmap.md heading when an active or done phase has no directory (dropped and blocked do not)', () => {
    const files = [
      make('roadmap/roadmap.md', [
        '## Phases',
        '### P0001: 一 — done',
        '### P0002: 二 — dropped',
        '### P0003: 三 — blocked',
      ]),
      rootStatus(
        ['| P0001 one | done | — |', '| P0002 two | dropped | — |', '| P0003 three | blocked | — |'],
        'P0001',
      ),
    ];
    const out = runCorpus(id2, files).filter((d) => d.message.includes('Missing a phases/ directory'));
    expect(out).toHaveLength(1);
    expect(out[0]?.message).toContain('directory for P0001 (roadmap.md says `done`)');
  });

  it('reports an error on the status.md of a directory that roadmap.md does not list', () => {
    const files = [...consistentFiles(), phaseStatus('P0008-ghost', 'P0008', 'active')];
    const out = runCorpus(id2, files);
    expect(out).toHaveLength(1);
    expect(out[0]?.message).toContain('Missing a phase heading in roadmap.md for phases/P0008-ghost');
  });

  it('reports an error when current_phase points at a phase that is not active', () => {
    const files = consistentFiles();
    files[1] = rootStatus(INDEX_OK, 'P0001');
    const out = runCorpus(id2, files);
    expect(out).toHaveLength(1);
    expect(out[0]?.message).toContain('Unexpected state `done` for `current_phase` P0001');
  });

  it('accepts a done current_phase in the terminal state, where every phase is done or dropped', () => {
    const files = [
      make('roadmap/roadmap.md', [
        '## Phases',
        '### P0001: 一 — done',
        '### P0002: 二 — done',
        '### P0003: 三 — dropped',
      ]),
      rootStatus(
        [
          '| P0001 one | done | phases/P0001-one/status.md |',
          '| P0002 two | done | phases/P0002-two/status.md |',
          '| P0003 three | dropped | — |',
        ],
        'P0002',
      ),
      phaseStatus('P0001-one', 'P0001', 'done'),
      phaseStatus('P0002-two', 'P0002', 'done'),
    ];
    expect(runCorpus(id2, files)).toEqual([]);

    // The relaxation covers done only — a current_phase naming a dropped phase stays an error
    const dropped = [...files];
    dropped[1] = rootStatus(
      [
        '| P0001 one | done | phases/P0001-one/status.md |',
        '| P0002 two | done | phases/P0002-two/status.md |',
        '| P0003 three | dropped | — |',
      ],
      'P0003',
    );
    const out = runCorpus(id2, dropped);
    expect(out).toHaveLength(1);
    expect(out[0]?.message).toContain('Unexpected state `dropped` for `current_phase` P0003');
  });

  it('keeps reporting a done current_phase while an active phase still exists (the relaxation is not a blanket one)', () => {
    // consistentFiles() has `P0002` active, so the terminal-state exception must not apply
    const files = consistentFiles();
    files[1] = rootStatus(INDEX_OK, 'P0001');
    const out = runCorpus(id2, files);
    expect(out).toHaveLength(1);
    expect(out[0]?.message).toContain('Unexpected state `done` for `current_phase` P0001');

    // A planned phase left over means the project is not finished either
    const planned = [
      make('roadmap/roadmap.md', ['## Phases', '### P0001: 一 — done', '### P0002: 二 — planned']),
      rootStatus(
        ['| P0001 one | done | phases/P0001-one/status.md |', '| P0002 two | planned | — |'],
        'P0001',
      ),
      phaseStatus('P0001-one', 'P0001', 'done'),
    ];
    const plannedOut = runCorpus(id2, planned).filter((d) => d.message.includes('current_phase'));
    expect(plannedOut).toHaveLength(1);
    expect(plannedOut[0]?.message).toContain('Unexpected state `done` for `current_phase` P0001');
  });

  it('reports an error when the phase key and the directory name disagree', () => {
    const files = consistentFiles();
    files[3] = phaseStatus('P0002-two', 'P0001', 'active');
    const out = runCorpus(id2, files);
    expect(out).toHaveLength(1);
    expect(out[0]?.message).toContain('Inconsistent `phase`: the front matter says `P0001`, the directory name says `P0002-two`');
  });

  it('reports an error when a directory state disagrees with roadmap.md (done against active), while blocked against active is normal', () => {
    const mismatch = consistentFiles();
    mismatch[2] = phaseStatus('P0001-one', 'P0001', 'active');
    const out = runCorpus(id2, mismatch);
    expect(out).toHaveLength(1);
    expect(out[0]?.message).toContain('the phase status.md says `active`, roadmap.md says `done`');

    const blocked = [
      make('roadmap/roadmap.md', ['## Phases', '### P0001: 一 — blocked']),
      rootStatus(['| P0001 one | blocked | phases/P0001-one/status.md |'], 'P0001'),
      phaseStatus('P0001-one', 'P0001', 'active'),
    ];
    // Filter down to the state check, since current_phase pointing at a blocked phase is a separate matter
    const stateDiags = runCorpus(id2, blocked).filter((d) => d.message.includes('Inconsistent state for the phase'));
    expect(stateDiags).toEqual([]);
  });
});

describe('ID-3: ID format and naming conventions', () => {
  it('reports nothing for names that follow the conventions', () => {
    const out = runCorpus(id3, [
      make('roadmap/roadmap.md', ['## Phases', '### P0001: 一 — active', '## Blockers', '| B0001 | P0001 | x | open |']),
      make('roadmap/phases/P0001-first-phase/sessions/S0001.md', ['# S0001']),
      make('roadmap/research/R0001-topic-2.md', ['# R0001: x']),
      make('roadmap/spec/api.md', ['# Spec: api', '## C0001: 契約']),
      make('roadmap/phases/P0001-first-phase/status.md', [
        '## Decisions',
        '- D-P0001-0001 (S0001): 決定',
      ]),
    ]);
    expect(out).toEqual([]);
  });

  it('reports an error for a phase directory slug that breaks the conventions (digits, upper case, separators)', () => {
    const out = runCorpus(id3, [
      make('roadmap/phases/P001-short/status.md', ['# x']),
      make('roadmap/phases/P0002_Bad/status.md', ['# x']),
      make('roadmap/phases/P0003/status.md', ['# x']),
    ]);
    expect(out).toHaveLength(3);
    expect(out.every((d) => d.message.includes('lowercase-kebab'))).toBe(true);
  });

  it('reports an error for a session or R/E file name that breaks the conventions', () => {
    const out = runCorpus(id3, [
      make('roadmap/phases/P0001-x/sessions/S0001-wip.md', ['# x']),
      make('roadmap/phases/P0001-x/sessions/S001.md', ['# x']),
      make('roadmap/research/R0001.md', ['# x']),
      make('roadmap/experiments/E0001-Big.md', ['# x']),
    ]);
    expect(out.map((d) => (d.anchor.kind === 'file' ? d.anchor.file : ''))).toEqual([
      'roadmap/phases/P0001-x/sessions/S0001-wip.md',
      'roadmap/phases/P0001-x/sessions/S001.md',
      'roadmap/research/R0001.md',
      'roadmap/experiments/E0001-Big.md',
    ]);
  });

  it('reports an error for a malformed phase heading in the Phases section (an H3 outside it is out of scope)', () => {
    const out = runCorpus(id3, [
      make('roadmap/roadmap.md', [
        '## Vision',
        '### 補足の見出し',
        '## Phases',
        '### P001: 桁不足 — active',
        '### P0002: 状態なし',
        '### P0003: 正常 — active',
      ]),
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]?.message).toContain('P001: 桁不足');
    expect(out[1]?.message).toContain('P0002: 状態なし');
  });

  it('reports an error when a contract heading or a blocker ID has the wrong number of digits', () => {
    const out = runCorpus(id3, [
      make('roadmap/spec/api.md', ['# Spec: api', '## C001: 桁不足', '## C0002: 正常']),
      make('roadmap/roadmap.md', ['## Blockers', '| B001 | P0001 | x | open |']),
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]?.message).toContain('C001');
    expect(out[1]?.message).toContain('B001');
  });

  it('reports an error for a malformed D and for one recorded under the wrong phase', () => {
    const out = runCorpus(id3, [
      make('roadmap/phases/P0001-x/status.md', [
        '## Decisions',
        '- D-P001-1: 桁不足',
        '- D-P0002-0001 (S0001): 別フェーズの決定',
        '- D-P0001-0001 (S0001): 正常',
      ]),
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]?.message).toContain('D-P001-1');
    expect(out[1]?.message).toContain('Inconsistent P part in D-P0002-0001: the phase it is recorded under is P0001');
  });
});
