import { describe, expect, it } from 'vitest';
import { buildCorpusIndex } from '../src/corpus/index.js';
import { parseSource, type ParsedFile } from '../src/parse/parsed-file.js';
import { bid1, bid2, bid3 } from '../src/rules/bid.js';
import type { RuleDiagnostic, RuleModule } from '../src/rules/types.js';

function make(relPath: string, lines: string[]): ParsedFile {
  return parseSource(relPath, lines.join('\n') + '\n');
}

function runCorpus(rule: RuleModule, files: ParsedFile[]): RuleDiagnostic[] {
  const entries = files.map((f) => ({ relPath: f.relPath, type: f.type }));
  const corpus = buildCorpusIndex(entries, files, () => true);
  return rule.checkCorpus?.({ files, corpus, options: {} }) ?? [];
}

/** artifacts is taken as a string in YAML flow form (for instance `[R0001, E0002]`). */
const session = (id: string, artifacts: string): ParsedFile =>
  make(`roadmap/phases/P0001-x/sessions/${id}.md`, [
    '---',
    `session: ${id}`,
    'phase: P0001',
    'date: 2026-07-01',
    'state: closed',
    'base_commit: abc1234',
    'commits: []',
    `artifacts: ${artifacts}`,
    'roadmap_changed: false',
    '---',
    '',
    `# ${id}`,
  ]);

const research = (id: string, created: string, completed: string): ParsedFile =>
  make(`roadmap/research/${id}-x.md`, [
    '---',
    `id: ${id}`,
    'type: research',
    `created: ${created}`,
    `completed: ${completed}`,
    'phase: P0001',
    'status: done',
    'superseded_by: null',
    '---',
    '',
    `# ${id}: x`,
  ]);

const experiment = (id: string, created: string, completed: string): ParsedFile =>
  make(`roadmap/experiments/${id}-x.md`, [
    '---',
    `id: ${id}`,
    'type: experiment',
    `created: ${created}`,
    `completed: ${completed}`,
    'phase: P0001',
    'status: planned',
    'superseded_by: null',
    '---',
    '',
    `# ${id}: x`,
  ]);

describe('BID-1: session artifacts checked against the R/E', () => {
  it('reports nothing when created points at that session', () => {
    const out = runCorpus(bid1, [session('S0001', '[R0001]'), research('R0001', 'S0001', 'null')]);
    expect(out).toEqual([]);
  });

  it('is fine when the match is on completed instead', () => {
    const out = runCorpus(bid1, [session('S0002', '[R0001]'), research('R0001', 'S0001', 'S0002')]);
    expect(out).toEqual([]);
  });

  it('reports an error at the ID token when neither created nor completed points at that session', () => {
    const out = runCorpus(bid1, [session('S0002', '[R0001]'), research('R0001', 'S0001', 'S0001')]);
    expect(out).toHaveLength(1);
    expect(out[0]?.anchor).toEqual({
      kind: 'range',
      file: 'roadmap/phases/P0001-x/sessions/S0002.md',
      range: { start: { line: 7, character: 12 }, end: { line: 7, character: 17 } },
    });
    expect(out[0]?.message).toContain('`created: S0001`, `completed: S0001`');
    expect(out[0]?.suggestion).toContain('from `artifacts`');
  });

  it('shows completed: null as the non-matching side (an E counts too)', () => {
    const out = runCorpus(bid1, [
      session('S0002', '[E0001]'),
      experiment('E0001', 'S0001', 'null'),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]?.message).toContain('`created: S0001`, `completed: null`');
  });

  it('leaves C#### out of scope', () => {
    const out = runCorpus(bid1, [session('S0001', '[C0001]')]);
    expect(out).toEqual([]);
  });

  it('ignores an element outside the ID format (that belongs to FM-2)', () => {
    const out = runCorpus(bid1, [session('S0001', '["R0001 (done)", R0001x]')]);
    expect(out).toEqual([]);
  });

  it('stays silent when the referenced R/E does not exist (that belongs to REF-1)', () => {
    const out = runCorpus(bid1, [session('S0001', '[R0009]')]);
    expect(out).toEqual([]);
  });
});

describe('BID-2: the created and completed of an R/E checked against the session artifacts', () => {
  it('reports nothing when both directions line up', () => {
    const out = runCorpus(bid2, [session('S0001', '[R0001]'), research('R0001', 'S0001', 'S0001')]);
    expect(out).toEqual([]);
  });

  it('reports an error on the created key line when the artifacts of the session it points at do not carry the ID', () => {
    const out = runCorpus(bid2, [session('S0001', '[]'), research('R0001', 'S0001', 'null')]);
    expect(out).toHaveLength(1);
    expect(out[0]?.anchor).toMatchObject({
      kind: 'range',
      file: 'roadmap/research/R0001-x.md',
      range: { start: { line: 3, character: 0 } },
    });
    expect(out[0]?.message).toBe('Missing R0001 in the `artifacts` of S0001 (pointed to by `created`).');
    expect(out[0]?.suggestion).toContain('First check `created` in R0001 for a typo');
  });

  it('bundles it into one diagnostic when created and completed point at the same session and both are missing', () => {
    const out = runCorpus(bid2, [session('S0001', '[]'), research('R0001', 'S0001', 'S0001')]);
    expect(out).toHaveLength(1);
    expect(out[0]?.message).toBe('Missing R0001 in the `artifacts` of S0001 (pointed to by `created / completed`).');
  });

  it('reports two diagnostics when created and completed point at different sessions and both are missing (an E counts too)', () => {
    const out = runCorpus(bid2, [
      session('S0001', '[]'),
      session('S0002', '[]'),
      experiment('E0001', 'S0001', 'S0002'),
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]?.message).toContain('of S0001 (pointed to by `created`)');
    expect(out[1]?.message).toContain('of S0002 (pointed to by `completed`)');
  });

  it('reports an error on the completed key line when only completed is missing', () => {
    const out = runCorpus(bid2, [
      session('S0001', '[R0001]'),
      session('S0002', '[]'),
      research('R0001', 'S0001', 'S0002'),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]?.anchor).toMatchObject({ range: { start: { line: 4, character: 0 } } });
    expect(out[0]?.message).toBe('Missing R0001 in the `artifacts` of S0002 (pointed to by `completed`).');
  });

  it('stays silent when created names an undefined session (a forward reference or a typo — that belongs to REF-1)', () => {
    const out = runCorpus(bid2, [research('R0001', 'S0009', 'null')]);
    expect(out).toEqual([]);
  });

  it('does not check completed: null', () => {
    const out = runCorpus(bid2, [session('S0001', '[R0001]'), research('R0001', 'S0001', 'null')]);
    expect(out).toEqual([]);
  });

  it('stays silent when the session has no artifacts key (that belongs to FM-1)', () => {
    const noArtifacts = make('roadmap/phases/P0001-x/sessions/S0001.md', [
      '---',
      'session: S0001',
      'phase: P0001',
      '---',
      '',
      '# S0001',
    ]);
    const out = runCorpus(bid2, [noArtifacts, research('R0001', 'S0001', 'null')]);
    expect(out).toEqual([]);
  });
});

// ---- BID-3: session files against Session Log rows, per phase ----

const phaseStatus = (dir: string, phase: string, rows: string[]): ParsedFile =>
  make(`roadmap/phases/${dir}/status.md`, [
    '---',
    `phase: ${phase}`,
    'state: active',
    'started: 2026-07-01',
    '---',
    '',
    `# ${phase}: x — Status`,
    '',
    '## Session Log',
    '| S# | date | summary | commits | artifacts |',
    '|----|------|---------|---------|-----------|',
    ...rows,
  ]);

const sessionIn = (dir: string, id: string, state: string): ParsedFile =>
  make(`roadmap/phases/${dir}/sessions/${id}.md`, [
    '---',
    `session: ${id}`,
    'phase: P0001',
    'date: 2026-07-01',
    `state: ${state}`,
    'base_commit: abc1234',
    'commits: []',
    'artifacts: []',
    'roadmap_changed: false',
    '---',
    '',
    `# ${id}`,
  ]);

describe('BID-3: session files against Session Log rows', () => {
  it('reports a closed session that has no row, anchored at the Session Log heading', () => {
    const status = phaseStatus('P0001-x', 'P0001', [
      '| S0001 | 07-01 | 一行目 | abc1234 | — |',
    ]);
    const out = runCorpus(bid3, [status, sessionIn('P0001-x', 'S0001', 'closed'), sessionIn('P0001-x', 'S0002', 'closed')]);
    expect(out).toHaveLength(1);
    expect(out[0]?.message).toContain('S0002');
    expect(out[0]?.anchor).toMatchObject({ kind: 'range', file: 'roadmap/phases/P0001-x/status.md' });
  });

  it('exempts an open session (its row is written at close)', () => {
    const status = phaseStatus('P0001-x', 'P0001', []);
    expect(runCorpus(bid3, [status, sessionIn('P0001-x', 'S0001', 'open')])).toEqual([]);
  });

  it('leaves a state outside open/closed to FM-2', () => {
    const status = phaseStatus('P0001-x', 'P0001', []);
    expect(runCorpus(bid3, [status, sessionIn('P0001-x', 'S0001', 'opened')])).toEqual([]);
  });

  it('reports a row whose session file lives in another phase, on the row line', () => {
    const here = phaseStatus('P0001-x', 'P0001', [
      '| S0002 | 07-01 | 他フェーズの行 | def5678 | — |',
    ]);
    const there = phaseStatus('P0002-y', 'P0002', [
      '| S0002 | 07-01 | 本来の行 | def5678 | — |',
    ]);
    const out = runCorpus(bid3, [here, there, sessionIn('P0002-y', 'S0002', 'closed')]);
    expect(out).toHaveLength(1);
    expect(out[0]?.message).toContain('another phase');
    expect(out[0]?.anchor).toMatchObject({ kind: 'range', file: 'roadmap/phases/P0001-x/status.md' });
  });

  it('leaves a row with no session file anywhere to REF-1', () => {
    const status = phaseStatus('P0001-x', 'P0001', [
      '| S0009 | 07-01 | 参照先なし | — | — |',
    ]);
    expect(runCorpus(bid3, [status])).toEqual([]);
  });

  it('stays silent when file and row match, and leaves duplicate rows to SIZE-5', () => {
    const status = phaseStatus('P0001-x', 'P0001', [
      '| S0001 | 07-01 | 一行目 | abc1234 | — |',
      '| S0001 | 07-01 | 重複行 | abc1234 | — |',
    ]);
    expect(runCorpus(bid3, [status, sessionIn('P0001-x', 'S0001', 'closed')])).toEqual([]);
  });

  it('leaves a missing Session Log heading to STRUCT-2', () => {
    const status = make('roadmap/phases/P0001-x/status.md', [
      '---',
      'phase: P0001',
      'state: active',
      'started: 2026-07-01',
      '---',
      '',
      '# P0001: x — Status',
    ]);
    expect(runCorpus(bid3, [status, sessionIn('P0001-x', 'S0001', 'closed')])).toEqual([]);
  });
});
