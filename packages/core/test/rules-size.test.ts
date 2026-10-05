import { describe, expect, it } from 'vitest';
import { parseSource, type ParsedFile } from '../src/parse/parsed-file.js';
import { size1, size2, size7 } from '../src/rules/size-limits.js';
import { size4 } from '../src/rules/size-4.js';
import { size5 } from '../src/rules/size-5.js';
import type { RuleModule } from '../src/rules/types.js';

function make(relPath: string, lines: string[]): ParsedFile {
  return parseSource(relPath, lines.join('\n') + '\n');
}

function run(rule: RuleModule, file: ParsedFile, options: Record<string, unknown> = {}) {
  return rule.check?.({ file, options }) ?? [];
}

describe('SIZE-2/3/6 (the whole-file line count factory)', () => {
  const mapLines = (total: number) => {
    const base = ['---', 'updated: 2026-07-01', '---', '# Spec Map: x'];
    while (base.length < total) base.push(`- 行 ${base.length + 1}`);
    return base;
  };

  it('treats exactly the limit as normal and reports one diagnostic past it', () => {
    expect(run(size2, make('roadmap/spec/map.md', mapLines(80)))).toEqual([]);
    const out = run(size2, make('roadmap/spec/map.md', mapLines(81)));
    expect(out).toHaveLength(1);
    expect(out[0]?.message).toContain('too many lines (81)');
  });

  it('applies a maxLines override', () => {
    expect(run(size2, make('roadmap/spec/map.md', mapLines(81)), { maxLines: 100 })).toEqual([]);
  });

  it('falls back to the default on a maxLines that is not a number, and never puts NaN into a position', () => {
    // The engine drops such a value with a notice before the rule sees it; a direct call gets the same fallback
    for (const bad of ['abc', '80', null, -1, Number.NaN]) {
      const out = run(size2, make('roadmap/spec/map.md', mapLines(81)), { maxLines: bad });
      expect(out, String(bad)).toHaveLength(1);
      expect(out[0]?.message, String(bad)).toContain('Maximum allowed is 80.');
      expect(out[0]?.anchor.kind === 'range' && out[0].anchor.range.start.line, String(bad)).toBe(80);
    }
    // A fractional limit counts as given and anchors on a whole line
    const out = run(size2, make('roadmap/spec/map.md', mapLines(81)), { maxLines: 2.5 });
    expect(out[0]?.anchor.kind === 'range' && out[0].anchor.range.start.line).toBe(2);
  });

  it('does not fire on a file type it does not cover', () => {
    expect(run(size2, make('roadmap/spec/other.md', mapLines(81)))).toEqual([]);
  });
});

describe('SIZE-7: the line count of roadmap.md (the back horizon of the Intent layer)', () => {
  const roadmapLines = (total: number, unfoldedPhases = 0) => {
    const base = ['---', 'project: x', 'updated: 2026-08-07', '---', '# Roadmap: x', '', '## Phases'];
    for (let i = 1; i <= unfoldedPhases; i++) {
      base.push('', `### P${String(i).padStart(4, '0')}: 済んだフェーズ ${i} — done`, '- goal: x');
    }
    while (base.length < total) base.push(`- 補足 ${base.length + 1}`);
    return base;
  };

  it('treats exactly 200 lines as normal and reports one warning past it', () => {
    expect(run(size7, make('roadmap/roadmap.md', roadmapLines(200)))).toEqual([]);
    const out = run(size7, make('roadmap/roadmap.md', roadmapLines(201)));
    expect(out).toHaveLength(1);
    expect(out[0]?.message).toBe('roadmap.md has too many lines (201). Maximum allowed is 200.');
    expect(out[0]?.suggestion).toBe(
      'Fold the done phases into a heading and a one-line goal to fit within 200 lines.',
    );
    // Points from the first line past the limit to the end of the file
    expect(out[0]?.anchor).toMatchObject({
      kind: 'range',
      file: 'roadmap/roadmap.md',
      range: { start: { line: 200, character: 0 }, end: { line: 200 } },
    });
  });

  it('is a warning, so a project that keeps growing correctly is not an error', () => {
    expect(size7.defaultSeverity).toBe('warning');
  });

  it('applies a maxLines override in both directions', () => {
    expect(run(size7, make('roadmap/roadmap.md', roadmapLines(201)), { maxLines: 400 })).toEqual([]);
    const out = run(size7, make('roadmap/roadmap.md', roadmapLines(150)), { maxLines: 130 });
    expect(out).toHaveLength(1);
    expect(out[0]?.message).toContain('Maximum allowed is 130');
  });

  it('does not fire on a folded roadmap.md of the same phase count', () => {
    // 40 done phases folded to a heading plus a one-line goal stay well inside the limit
    expect(run(size7, make('roadmap/roadmap.md', roadmapLines(0, 40)))).toEqual([]);
  });

  it('does not fire on another file type that happens to be long', () => {
    expect(run(size7, make('roadmap/phases/P0001-first/status.md', roadmapLines(250)))).toEqual([]);
  });
});

describe('SIZE-4: the non-empty line count of Outcome Summary', () => {
  const phaseStatus = (summaryLines: string[]) =>
    make('roadmap/phases/P0001-first/status.md', [
      '---',
      'phase: P0001',
      'state: active',
      'started: 2026-07-01',
      '---',
      '',
      '# P0001: X — Status',
      '',
      '## Outcome Summary',
      ...summaryLines,
      '',
      '## Acceptance Progress',
      '- [ ] AC1: x — 検証: —',
    ]);

  it('treats up to 10 non-empty lines as normal (blank lines are not counted)', () => {
    const ten = Array.from({ length: 10 }, (_, i) => `要約 ${i + 1}`);
    expect(run(size4, phaseStatus(ten))).toEqual([]);
    const withBlanks = [...ten.slice(0, 5), '', '', ...ten.slice(5)];
    expect(run(size4, phaseStatus(withBlanks))).toEqual([]);
  });

  it('reports one diagnostic at 11 non-empty lines, anchored at the 11th', () => {
    const eleven = Array.from({ length: 11 }, (_, i) => `要約 ${i + 1}`);
    const out = run(size4, phaseStatus(eleven));
    expect(out).toHaveLength(1);
    expect(out[0]?.message).toContain('(11 non-empty)');
    expect(out[0]?.anchor).toMatchObject({
      kind: 'range',
      range: { start: { line: 19, character: 0 } },
    });
  });
});

describe('SIZE-5: one line per session in Session Log', () => {
  const phaseStatus = (rows: string[]) =>
    make('roadmap/phases/P0001-first/status.md', [
      '---',
      'phase: P0001',
      'state: active',
      'started: 2026-07-01',
      '---',
      '',
      '# P0001: X — Status',
      '',
      '## Session Log',
      '| S# | date | summary(1行厳守) | commits | artifacts |',
      '|----|------|------------------|---------|-----------|',
      ...rows,
      '',
      '## Decisions',
      '(なし)',
    ]);

  it('is normal when every S# is unique (the header and the separator row are not counted)', () => {
    expect(
      run(size5, phaseStatus(['| S0001 | 07-01 | a | — | — |', '| S0002 | 07-02 | b | — | — |'])),
    ).toEqual([]);
  });

  it('reports one diagnostic for two rows with the same S#, anchored at the second', () => {
    const out = run(
      size5,
      phaseStatus(['| S0001 | 07-01 | a | — | — |', '| S0001 | 07-02 | b | — | — |']),
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.message).toContain('for session S0001 (2 rows)');
    expect(out[0]?.anchor).toMatchObject({ range: { start: { line: 12 } } });
  });

  it('still reports one diagnostic for three rows with the same S# (reporting the row count)', () => {
    const out = run(
      size5,
      phaseStatus([
        '| S0001 | 07-01 | a | — | — |',
        '| S0001 | 07-02 | b | — | — |',
        '| S0001 | 07-03 | c | — | — |',
      ]),
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.message).toContain('(3 rows)');
  });
});

describe('SIZE-1: the root status.md line count, not counting the Phase Index section', () => {
  const FM = [
    '---',
    'current_phase: P0001',
    'open_session: null',
    'last_session: S0001',
    'next_command: "/roadmap start — x"',
    'updated: 2026-07-01',
    '---',
    '',
    '# Status: x',
    '',
  ];
  /** counted lines (front matter and prose) followed by a Phase Index of rows lines. */
  const status = (counted: number, rows: number, indexFirst = false) => {
    const prose: string[] = ['## Now'];
    while (FM.length + prose.length < counted) prose.push(`- 行 ${FM.length + prose.length + 1}`);
    const index = ['## Phase Index', '| Phase | 状態 | status |', '|-------|------|--------|'];
    for (let i = 1; i <= rows; i++) {
      index.push(`| P${String(i).padStart(4, '0')} x | done | phases/P${String(i).padStart(4, '0')}-x/status.md |`);
    }
    return make('roadmap/status.md', indexFirst ? [...FM, ...index, ...prose] : [...FM, ...prose, ...index]);
  };

  it('treats exactly 60 counted lines as normal however long the Phase Index is', () => {
    expect(run(size1, status(60, 3))).toEqual([]);
    expect(run(size1, status(60, 80))).toEqual([]);
    expect(status(60, 80).lineCount).toBe(143);
  });

  it('reports one diagnostic at 61 counted lines, anchored from the overflowing counted line to the last counted line', () => {
    const out = run(size1, status(61, 5));
    expect(out).toHaveLength(1);
    expect(out[0]?.message).toBe(
      'The root status.md has too many lines (61, not counting the Phase Index section). Maximum allowed is 60.',
    );
    expect(out[0]?.suggestion).toBe(
      'Remove detail from the Next tasks to fit within 60 lines (the Phase Index section is not counted).',
    );
    expect(out[0]?.anchor).toEqual({
      kind: 'range',
      file: 'roadmap/status.md',
      range: { start: { line: 60, character: 0 }, end: { line: 60, character: '- 行 61'.length } },
    });
  });

  it('anchors a multi-line overflow from the first overflowing counted line to the last counted line with content', () => {
    const out = run(size1, status(62, 5));
    expect(out[0]?.anchor).toMatchObject({
      range: { start: { line: 60, character: 0 }, end: { line: 61, character: '- 行 62'.length } },
    });
    // The counted region usually ends with the blank separator above the Phase Index — the anchor collapses onto the last line with content
    const lines = status(60, 5).lines;
    const trailingBlank = make('roadmap/status.md', [...lines.slice(0, 60), '', ...lines.slice(60)]);
    const collapsed = run(size1, trailingBlank);
    expect(collapsed[0]?.message).toContain('(61, not counting');
    expect(collapsed[0]?.anchor).toMatchObject({
      range: { start: { line: 59, character: 0 }, end: { line: 59, character: '- 行 60'.length } },
    });
  });

  it('skips the section wherever it sits — with the Phase Index first, the counted lines continue after it', () => {
    expect(run(size1, status(60, 40, true))).toEqual([]);
    const out = run(size1, status(61, 40, true));
    expect(out).toHaveLength(1);
    // 10 front matter lines, then 43 index lines (8 + 3 + 40 = lines 10..52), then the prose from line 53: the 61st counted line is index 60 + 43
    expect(out[0]?.anchor).toMatchObject({ range: { start: { line: 103 } } });
  });

  it('counts every line when there is no Phase Index section, and applies a maxLines override', () => {
    const plain = make('roadmap/status.md', [...FM, ...Array.from({ length: 51 }, (_, i) => `- 行 ${i + 11}`)]);
    expect(plain.lineCount).toBe(61);
    expect(run(size1, plain)).toHaveLength(1);
    expect(run(size1, plain, { maxLines: 61 })).toEqual([]);
    expect(run(size1, status(61, 5), { maxLines: 90 })).toEqual([]);
  });

  it('does not fire on a phase status of the same shape', () => {
    expect(run(size1, make('roadmap/phases/P0001-x/status.md', status(90, 5).lines))).toEqual([]);
  });
});
