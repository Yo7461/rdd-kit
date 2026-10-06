import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseSource, type ParsedFile } from '../src/parse/parsed-file.js';
import { txt1 } from '../src/rules/txt-1.js';
import { txt2 } from '../src/rules/txt-2.js';
import { txt3 } from '../src/rules/txt-3.js';
import type { RuleDiagnostic, RuleModule } from '../src/rules/types.js';
import { lintDir } from '../src/testing/index.js';

function make(relPath: string, lines: string[]): ParsedFile {
  return parseSource(relPath, lines.join('\n') + '\n');
}

function run(
  rule: RuleModule,
  file: ParsedFile,
  options: Record<string, unknown> = {},
): RuleDiagnostic[] {
  return rule.check?.({ file, options: { ...rule.defaultOptions, ...options } }) ?? [];
}

const PATH = 'roadmap/research/R0001-x.md';

describe('TXT-1: garbled text and control characters (the deterministic check)', () => {
  it('reports nothing for ordinary text mixing Japanese and English (TAB included)', () => {
    const out = run(txt1, make(PATH, ['# R0001: x', '通常の text。\tタブは正常', '記号 ─ → ○']));
    expect(out).toEqual([]);
  });

  it('reports an error with a position for a single U+FFFD', () => {
    const out = run(txt1, make(PATH, ['# R0001: x', 'before \uFFFD after']));
    expect(out).toHaveLength(1);
    expect(out[0]?.anchor).toEqual({
      kind: 'range',
      file: PATH,
      range: { start: { line: 1, character: 7 }, end: { line: 1, character: 8 } },
    });
    expect(out[0]?.message).toContain('U+FFFD replacement character');
  });

  it('bundles a run of U+FFFD into one diagnostic', () => {
    const out = run(txt1, make(PATH, ['x\uFFFD\uFFFD\uFFFD y']));
    expect(out).toHaveLength(1);
    expect(out[0]?.message).toContain('3 consecutive U+FFFD replacement characters');
    expect(out[0]?.anchor).toMatchObject({
      range: { start: { line: 0, character: 1 }, end: { line: 0, character: 4 } },
    });
  });

  it('reports an error showing the code point for a C0 control character (NUL)', () => {
    const out = run(txt1, make(PATH, ['a\u0000b']));
    expect(out).toHaveLength(1);
    expect(out[0]?.message).toContain('C0 control character (U+0000)');
  });

  it('walks the front matter and the inside of a code fence too', () => {
    const out = run(
      txt1,
      make(PATH, ['---', 'id: R0001\uFFFD', '---', '', '```text', 'x\u0001', '```']),
    );
    expect(out).toHaveLength(2);
  });

  it('leaves the script-mixing heuristic off by default (even a long run of Cyrillic stays silent)', () => {
    const out = run(txt1, make(PATH, ['я'.repeat(30)]));
    expect(out).toEqual([]);
  });

  it('warns on a run outside the expected scripts once opted in (a run unbroken by whitespace)', () => {
    const out = run(txt1, make(PATH, ['кириллица'.repeat(3)]), {
      languageHeuristic: true,
    });
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((d) => d.severity === 'warning')).toBe(true);
    expect(out[0]?.message).toContain('possible language mixing');
  });

  it('does not report a run below the threshold (unexpectedRunLength)', () => {
    const short = run(txt1, make(PATH, ['кирилл']), { languageHeuristic: true });
    expect(short).toEqual([]);
    const lowered = run(txt1, make(PATH, ['кирилл']), {
      languageHeuristic: true,
      unexpectedRunLength: 3,
    });
    expect(lowered).toHaveLength(1);
  });

  it('applies an expectedScripts override (Latin alone brings a run of Japanese into scope)', () => {
    const out = run(txt1, make(PATH, ['これは日本語の長い連続でスクリプト外になる例です']), {
      languageHeuristic: true,
      expectedScripts: ['Latin'],
    });
    expect(out).toHaveLength(1);
  });

  it('turns the heuristic off for an unknown script name (never crashing, never a false positive)', () => {
    const out = run(txt1, make(PATH, ['я'.repeat(30)]), {
      languageHeuristic: true,
      expectedScripts: ['NoSuchScript'],
    });
    expect(out).toEqual([]);
  });

  it('validateOptions: drops an unknown script name on its own with a notice (once per name, shown escaped), and the other names still count', () => {
    const notices: string[] = [];
    const options = txt1.validateOptions?.(
      { languageHeuristic: true, unexpectedRunLength: 5, expectedScripts: ['Latin', 'Klingon', 'Hirigana', 'Klingon', 'x\nNote: TXT-1: forged'] },
      (m) => notices.push(m),
    );
    expect(options?.['expectedScripts']).toEqual(['Latin']);
    expect(notices).toEqual([
      'TXT-1: Ignored the unknown script `"Klingon"` in `expectedScripts` — it is not a Unicode script name the regular expression engine knows.',
      'TXT-1: Ignored the unknown script `"Hirigana"` in `expectedScripts` — it is not a Unicode script name the regular expression engine knows.',
      'TXT-1: Ignored the unknown script `"x\\nNote: TXT-1: forged"` in `expectedScripts` — it is not a Unicode script name the regular expression engine knows.',
    ]);
    expect(notices.some((n) => n.includes('\n'))).toBe(false);
    // With Latin kept, a run of Cyrillic is still reported
    expect(run(txt1, make(PATH, ['кирилл']), options ?? {})).toHaveLength(1);
  });

  it('validateOptions: says when no usable script is left (only while the heuristic is on), and replaces a run length it cannot use', () => {
    const notices: string[] = [];
    const options = txt1.validateOptions?.(
      { languageHeuristic: true, unexpectedRunLength: 1, expectedScripts: ['NoSuchScript'] },
      (m) => notices.push(m),
    );
    expect(options?.['expectedScripts']).toEqual([]);
    expect(options?.['unexpectedRunLength']).toBe(20);
    expect(notices).toEqual([
      'TXT-1: Ignored the unknown script `"NoSuchScript"` in `expectedScripts` — it is not a Unicode script name the regular expression engine knows.',
      'TXT-1: `expectedScripts` has no usable entry, so the script-mixing heuristic is off for this run.',
      'TXT-1: Ignored the invalid `unexpectedRunLength` value `1` — expected a whole number from 2 to 2147483647, so the default 20 is used.',
    ]);
    // The heuristic off: the unknown name is still reported, the "off for this run" line is not
    const off: string[] = [];
    txt1.validateOptions?.({ languageHeuristic: false, expectedScripts: ['NoSuchScript'] }, (m) => off.push(m));
    expect(off).toHaveLength(1);
    expect(off[0]).toContain('unknown script');
    // A fraction, and a length the quantifier cannot take (1e21 prints in exponent form), fall back too
    for (const bad of [5.5, 1e21, Number.MAX_VALUE]) {
      const heard: string[] = [];
      expect(txt1.validateOptions?.({ unexpectedRunLength: bad }, (m) => heard.push(m))?.['unexpectedRunLength'], String(bad)).toBe(20);
      expect(heard, String(bad)).toHaveLength(1);
    }
    // Valid options pass through untouched and silently
    const quiet: string[] = [];
    expect(txt1.validateOptions?.({ unexpectedRunLength: 2, expectedScripts: ['Han'] }, (m) => quiet.push(m))).toEqual({
      unexpectedRunLength: 2,
      expectedScripts: ['Han'],
    });
    expect(quiet).toEqual([]);
  });

  it('never crashes on a run length the pattern cannot take, even on a direct call that skips validateOptions (the default 20 applies)', () => {
    for (const bad of [1e21, 2147483648, Number.MAX_VALUE]) {
      const out = run(txt1, make(PATH, ['я'.repeat(30)]), { languageHeuristic: true, unexpectedRunLength: bad });
      expect(out, String(bad)).toHaveLength(1);
      expect(out[0]?.message, String(bad)).toContain('run of 30 characters');
    }
  });
});

describe('TXT-1: invalid UTF-8 bytes (generated at run time)', () => {
  it('detects a file with broken bytes as U+FFFD', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'roadmap-lint-txt1-'));
    try {
      const fileDir = path.join(dir, 'roadmap', 'research');
      mkdirSync(fileDir, { recursive: true });
      writeFileSync(
        path.join(fileDir, 'R0001-broken.md'),
        Buffer.concat([
          Buffer.from('---\nid: R0001\n---\n\n# R0001: x\n\nbroken: ', 'utf8'),
          Buffer.from([0xff, 0xfe, 0x80]),
          Buffer.from('\n', 'utf8'),
        ]),
      );
      const diagnostics = (await lintDir(dir)).diagnostics.filter((d) => d.rule === 'TXT-1');
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.message).toContain('U+FFFD replacement character');
      expect(diagnostics[0]?.message).toContain('3 consecutive U+FFFD replacement characters');
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    }
  });
});

describe('TXT-2: broken Markdown (enumerated)', () => {
  const valid = make(PATH, [
    '---',
    'id: R0001',
    '---',
    '',
    '# R0001: x',
    '',
    '```text',
    'フェンス内',
    '```',
    '',
    '| 列A | 列B |',
    '|-----|-----|',
    '| 1 | 2 |',
  ]);

  it('reports nothing for a closed fence, sound front matter, and an even table', () => {
    expect(run(txt2, valid)).toEqual([]);
  });

  it('reports an error on the opening line of an unclosed fence', () => {
    const out = run(txt2, make(PATH, ['---', 'id: R0001', '---', '', '```text', '閉じない']));
    expect(out).toHaveLength(1);
    expect(out[0]?.message).toBe('Missing the closing code fence.');
    expect(out[0]?.anchor).toMatchObject({ range: { start: { line: 4 } } });
  });

  it('detects a marker mismatch (trying to close ~~~ with ```) as unclosed', () => {
    const out = run(txt2, make(PATH, ['~~~text', 'x', '```']));
    expect(out).toHaveLength(1);
  });

  it('leaves an indented code block out of scope', () => {
    const out = run(txt2, make(PATH, ['本文', '', '    indented code', '', '続き']));
    expect(out).toEqual([]);
  });

  it('reports an error on the first line when the front matter --- is not closed', () => {
    const out = run(txt2, make(PATH, ['---', 'id: R0001', '', '# 本文']));
    expect(out).toHaveLength(1);
    expect(out[0]?.message).toBe('Missing the closing `---` delimiter for front matter.');
    expect(out[0]?.anchor).toMatchObject({ range: { start: { line: 0 } } });
  });

  it('reports an error when the front matter cannot be parsed as YAML (delegated from FM-1)', () => {
    const out = run(txt2, make(PATH, ['---', 'created: [S0001', '---', '', '# x']));
    expect(out).toHaveLength(1);
    expect(out[0]?.message).toContain('Cannot parse front matter as YAML');
  });

  it('warns on the offending row of an uneven table (carrying the header and row column counts)', () => {
    const out = run(
      txt2,
      make(PATH, ['| a | b |', '|---|---|', '| 1 | 2 | 3 |', '| 4 | 5 |']),
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.severity).toBe('warning');
    expect(out[0]?.message).toContain('header has 2, this row has 3');
    expect(out[0]?.anchor).toMatchObject({ range: { start: { line: 2 } } });
  });

  it('does not count a | inside inline code or an escaped one', () => {
    const out = run(
      txt2,
      make(PATH, ['| a | b |', '|---|---|', '| `x|y` | c |', '| d\\|e | f |']),
    );
    expect(out).toEqual([]);
  });

  it('leaves a pipe line with no delimiter row and table-like text inside a fence out of scope', () => {
    const out = run(
      txt2,
      make(PATH, ['| 表ではない |', '', '```text', '| a | b |', '|---|---|', '| 1 |', '```']),
    );
    expect(out).toEqual([]);
  });
});

describe('TXT-3: merge conflict markers', () => {
  const run3 = (lines: string[]): RuleDiagnostic[] => run(txt3, make(PATH, lines));

  it('reports each of the four marker kinds at line start', () => {
    const out = run3([
      '# R0001: x',
      '<<<<<<< HEAD',
      '本文A',
      '||||||| base',
      '本文0',
      '=======',
      '本文B',
      '>>>>>>> feature',
    ]);
    expect(out.map((d) => d.anchor)).toMatchObject([
      { kind: 'range', range: { start: { line: 1, character: 0 }, end: { line: 1, character: 7 } } },
      { kind: 'range', range: { start: { line: 3, character: 0 } } },
      { kind: 'range', range: { start: { line: 5, character: 0 } } },
      { kind: 'range', range: { start: { line: 7, character: 0 } } },
    ]);
    expect(out[0]?.message).toContain('<<<<<<<');
  });

  it('reports a bare marker with no label at the end of the line', () => {
    expect(run3(['<<<<<<<'])).toHaveLength(1);
    expect(run3(['>>>>>>>'])).toHaveLength(1);
  });

  it('requires exactly seven characters (six or eight do not match)', () => {
    expect(run3(['<<<<<< HEAD', '<<<<<<<< HEAD', '======', '========', '>>>>>> x', '>>>>>>>> x'])).toEqual([]);
  });

  it('requires the line start and a bare separator line', () => {
    expect(run3([' <<<<<<< HEAD', '  =======', '======= x', 'a ======='])).toEqual([]);
  });

  it('does not exclude code fences (a merge leaves markers inside them too)', () => {
    const out = run3(['```', '<<<<<<< HEAD', '```']);
    expect(out).toHaveLength(1);
  });

  it('leaves ordinary table and quote syntax alone', () => {
    expect(run3(['| a | b |', '> 引用', '=== 区切りではない ===', '<<<<<<<変数'])).toEqual([]);
  });
});
