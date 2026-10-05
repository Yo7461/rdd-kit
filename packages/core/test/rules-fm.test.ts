import { describe, expect, it } from 'vitest';
import { buildCorpusIndex } from '../src/corpus/index.js';
import { parseSource, type ParsedFile } from '../src/parse/parsed-file.js';
import { fm1 } from '../src/rules/fm-1.js';
import { fm2 } from '../src/rules/fm-2.js';
import { fm3 } from '../src/rules/fm-3.js';
import { fm4 } from '../src/rules/fm-4.js';
import type { RuleModule } from '../src/rules/types.js';

function make(relPath: string, lines: string[]): ParsedFile {
  return parseSource(relPath, lines.join('\n') + '\n');
}

function run(rule: RuleModule, file: ParsedFile) {
  return rule.check?.({ file, options: {} }) ?? [];
}

const SESSION_PATH = 'roadmap/phases/P0001-first/sessions/S0001.md';
function sessionLines(overrides: Partial<Record<string, string>> = {}): string[] {
  const fm: Record<string, string> = {
    session: 'S0001',
    phase: 'P0001',
    date: '2026-07-01',
    state: 'closed',
    base_commit: 'null',
    commits: '[]',
    artifacts: '[]',
    roadmap_changed: 'false',
    ...overrides,
  };
  return ['---', ...Object.entries(fm).map(([k, v]) => `${k}: ${v}`), '---', '', '# S0001'];
}

describe('FM-1: a required key is missing', () => {
  it('passes complete front matter', () => {
    expect(run(fm1, make(SESSION_PATH, sessionLines()))).toEqual([]);
  });

  it('reports one diagnostic on a file anchor when there is no front matter at all', () => {
    const out = run(fm1, make(SESSION_PATH, ['# S0001', '', '本文だけ']));
    expect(out).toHaveLength(1);
    expect(out[0]?.anchor.kind).toBe('file');
    expect(out[0]?.message).toContain('Missing front matter');
  });

  it('reports one diagnostic per missing required key', () => {
    const lines = sessionLines();
    const withoutArtifacts = lines.filter((l) => !l.startsWith('artifacts:'));
    const out = run(fm1, make(SESSION_PATH, withoutArtifacts));
    expect(out).toHaveLength(1);
    expect(out[0]?.message).toContain('front matter key `artifacts`');
  });

  it('does not report a missing conditional key (closed in a phase status)', () => {
    const file = make('roadmap/phases/P0001-first/status.md', [
      '---',
      'phase: P0001',
      'state: active',
      'started: 2026-07-01',
      '---',
      '',
      '# P0001: X — Status',
    ]);
    expect(run(fm1, file)).toEqual([]);
  });

  it('leaves an unknown file type out of scope', () => {
    expect(run(fm1, make('roadmap/notes.md', ['# メモ']))).toEqual([]);
  });

  it('skips front matter that cannot be parsed as YAML (that belongs to TXT-2)', () => {
    const out = run(fm1, make(SESSION_PATH, ['---', 'a: [', '---', '', '# S0001']));
    expect(out).toEqual([]);
  });
});

describe('FM-2: a value outside the allowed set', () => {
  it('reports one diagnostic anchored at the key line for a state outside the enum', () => {
    const out = run(fm2, make(SESSION_PATH, sessionLines({ state: 'opened' })));
    expect(out).toHaveLength(1);
    expect(out[0]?.message).toContain('for front matter key `state`');
    expect(out[0]?.anchor).toEqual({
      kind: 'range',
      file: SESSION_PATH,
      range: { start: { line: 4, character: 0 }, end: { line: 4, character: 13 } },
    });
  });

  it('detects violations of the date format, the ID format, and an ID list', () => {
    const out = run(
      fm2,
      make(SESSION_PATH, sessionLines({ date: '2026/07/01', phase: 'P1', artifacts: '[S0001]' })),
    );
    expect(out.map((d) => d.message)).toEqual([
      expect.stringContaining('for front matter key `phase`. Allowed: P####.'),
      expect.stringContaining('for front matter key `date`. Allowed: YYYY-MM-DD.'),
      expect.stringContaining('for front matter key `artifacts`. Allowed: a list containing only R####/E####/C####.'),
    ]);
  });

  it('roadmap.md: the state in a phase heading and the - type: line (excluding what is inside a fence)', () => {
    const file = make('roadmap/roadmap.md', [
      '---',
      'project: x',
      'updated: 2026-07-01',
      '---',
      '',
      '# Roadmap: x',
      '',
      '## Phases',
      '',
      '### P0001: A — active',
      '- type: build',
      '',
      '### P0002: B — finished',
      '- type: coding',
      '',
      '```',
      '- type: fenced-example',
      '```',
    ]);
    const out = run(fm2, file);
    expect(out).toHaveLength(2);
    expect(out[0]?.message).toContain('Unexpected phase state `finished`');
    expect(out[1]?.message).toContain('Unexpected phase type `coding`');
  });

  it('checks the stability of a contract file (in the yaml fence)', () => {
    const file = make('roadmap/spec/cli.md', [
      '---',
      'domain: cli',
      'updated: 2026-07-01',
      '---',
      '',
      '# Spec: cli',
      '',
      '## C0001: X',
      '```yaml',
      'kind: cli',
      'stability: bogus',
      '```',
      '',
      '## C0002: Y',
      '```yaml',
      'kind: file-format',
      'stability: stable',
      '```',
    ]);
    const out = run(fm2, file);
    expect(out).toHaveLength(1);
    expect(out[0]?.message).toContain('Unexpected contract stability `"bogus"`');
    expect(out[0]?.anchor).toMatchObject({ kind: 'range', file: 'roadmap/spec/cli.md' });
  });
});

describe('FM-3: open_session against the real session state (corpus)', () => {
  const root = (openSession: string) =>
    make('roadmap/status.md', [
      '---',
      'current_phase: P0001',
      `open_session: ${openSession}`,
      'last_session: S0001',
      'next_command: "x"',
      'updated: 2026-07-01',
      '---',
      '',
      '# Status: x',
    ]);
  const session = (id: string, state: string) =>
    make(`roadmap/phases/P0001-first/sessions/${id}.md`, sessionLines({ session: id, state }));

  function runCorpus(files: ParsedFile[]) {
    const corpus = buildCorpusIndex(
      files.map((f) => ({ relPath: f.relPath, type: f.type })),
      files,
      () => true,
    );
    return fm3.checkCorpus?.({ files, corpus, options: {} }) ?? [];
  }

  it('passes when they agree (an S#### with an open session, or null with everything closed)', () => {
    expect(runCorpus([root('S0001'), session('S0001', 'open')])).toEqual([]);
    expect(runCorpus([root('null'), session('S0001', 'closed')])).toEqual([]);
  });

  it('reports one diagnostic on the root when open_session points at a closed session', () => {
    const out = runCorpus([root('S0001'), session('S0001', 'closed')]);
    expect(out).toHaveLength(1);
    expect(out[0]?.anchor).toMatchObject({ file: 'roadmap/status.md' });
    expect(out[0]?.message).toContain('`state: closed`');
  });

  it('reports one diagnostic on the session when open_session is null but a session is open', () => {
    const out = runCorpus([root('null'), session('S0001', 'open')]);
    expect(out).toHaveLength(1);
    expect(out[0]?.anchor).toMatchObject({
      file: 'roadmap/phases/P0001-first/sessions/S0001.md',
    });
  });

  it('reports one diagnostic on an open session that open_session does not point at', () => {
    const out = runCorpus([
      root('S0001'),
      session('S0001', 'open'),
      session('S0002', 'open'),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]?.message).toContain('S0002');
  });
});

describe('FM-4: conditional keys and agreement with the location', () => {
  const research = (overrides: Partial<Record<string, string>> = {}, relPath = 'roadmap/research/R0001-sample.md') => {
    const fm: Record<string, string> = {
      id: 'R0001',
      type: 'research',
      created: 'S0001',
      completed: 'S0001',
      phase: 'P0001',
      status: 'done',
      superseded_by: 'null',
      ...overrides,
    };
    return make(relPath, ['---', ...Object.entries(fm).map(([k, v]) => `${k}: ${v}`), '---', '', '# R0001: t']);
  };

  it('passes an R file whose keys agree', () => {
    expect(run(fm4, research())).toEqual([]);
  });

  it('reports one diagnostic for completed: null while the status is done', () => {
    const out = run(fm4, research({ completed: 'null' }));
    expect(out).toHaveLength(1);
    expect(out[0]?.message).toContain('Missing `completed`');
  });

  it('reports one diagnostic for a completed value while the status is not done', () => {
    const out = run(fm4, research({ status: 'planned' }));
    expect(out).toHaveLength(1);
    expect(out[0]?.message).toContain('while `status` is `planned`');
  });

  it('reports one diagnostic when id and the file name disagree', () => {
    const out = run(fm4, research({ id: 'R0002' }));
    expect(out).toHaveLength(1);
    expect(out[0]?.message).toContain('R0002');
    expect(out[0]?.message).toContain('R0001');
  });

  it('reports one diagnostic when type disagrees with the location and the ID prefix', () => {
    const out = run(
      fm4,
      research({ id: 'E0001', type: 'research' }, 'roadmap/experiments/E0001-sample.md'),
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.message).toContain('the front matter says `research`');
  });

  it('a phase status: done against closed in both directions, plus phase against the directory', () => {
    const phaseStatus = (fmLines: string[]) =>
      make('roadmap/phases/P0001-first/status.md', ['---', ...fmLines, '---', '', '# P0001: X — Status']);
    const doneWithoutClosed = run(fm4, phaseStatus(['phase: P0001', 'state: done', 'started: 2026-07-01']));
    expect(doneWithoutClosed).toHaveLength(1);
    expect(doneWithoutClosed[0]?.message).toContain('Missing `closed` (the completion date)');

    const activeWithClosed = run(
      fm4,
      phaseStatus(['phase: P0001', 'state: active', 'started: 2026-07-01', 'closed: 2026-07-02']),
    );
    expect(activeWithClosed).toHaveLength(1);
    expect(activeWithClosed[0]?.message).toContain('Unexpected `closed`');

    const phaseMismatch = run(
      fm4,
      phaseStatus(['phase: P0002', 'state: active', 'started: 2026-07-01']),
    );
    expect(phaseMismatch).toHaveLength(1);
    expect(phaseMismatch[0]?.message).toContain('the directory says `P0001`');
  });

  it('a session log: disagreement with the file name and with the phase directory', () => {
    const nameMismatch = run(fm4, make(SESSION_PATH, sessionLines({ session: 'S0002' })));
    expect(nameMismatch).toHaveLength(1);
    expect(nameMismatch[0]?.message).toContain('the file name says `S0001`');

    const phaseMismatch = run(fm4, make(SESSION_PATH, sessionLines({ phase: 'P0009' })));
    expect(phaseMismatch).toHaveLength(1);
    expect(phaseMismatch[0]?.message).toContain('the phase directory says `P0001`');
  });
});
