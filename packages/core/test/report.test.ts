import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../src/diagnostic.js';
import type { LintResult } from '../src/engine.js';
import { formatJson, toJsonReport } from '../src/report/json.js';
import { sortDiagnostics } from '../src/report/sort.js';
import { formatText } from '../src/report/text.js';

// A fixed input covering the three anchor kinds, both severities, several files, and two rules at the
// same position (deliberately out of order)
const UNSORTED: Diagnostic[] = [
  {
    rule: 'BBB-2',
    severity: 'error',
    anchor: {
      kind: 'range',
      file: 'roadmap/status.md',
      range: { start: { line: 60, character: 0 }, end: { line: 60, character: 10 } },
    },
    message: 'Rule B at the same position.',
    suggestion: 'Fix B.',
  },
  {
    rule: 'ZZZ-9',
    severity: 'warning',
    anchor: { kind: 'repo' },
    message: 'A repository-wide warning.',
    suggestion: 'Fix Z.',
  },
  {
    rule: 'AAA-1',
    severity: 'error',
    anchor: {
      kind: 'range',
      file: 'roadmap/status.md',
      range: { start: { line: 60, character: 0 }, end: { line: 60, character: 10 } },
    },
    message: 'Rule A at the same position.',
    suggestion: 'Fix A.',
  },
  {
    rule: 'CCC-3',
    severity: 'warning',
    anchor: { kind: 'file', file: 'roadmap/status.md' },
    message: 'A whole-file warning.',
    suggestion: 'Fix C.',
  },
  {
    rule: 'DDD-4',
    severity: 'error',
    anchor: {
      kind: 'range',
      file: 'roadmap/roadmap.md',
      range: { start: { line: 2, character: 4 }, end: { line: 2, character: 8 } },
    },
    message: 'An error in another file.',
    suggestion: 'Fix D.',
  },
];

const RESULT: LintResult = { diagnostics: sortDiagnostics(UNSORTED), filesChecked: 7, notices: [] };

describe('the stable sort (file -> line -> rule ID)', () => {
  it('orders repo first, then by file, and within a file by file anchor, line, and rule ID', () => {
    expect(RESULT.diagnostics.map((d) => d.rule)).toEqual([
      'ZZZ-9', // the repo anchor comes first
      'DDD-4', // roadmap/roadmap.md
      'CCC-3', // roadmap/status.md: a file anchor comes before one with a line
      'AAA-1', // the same position falls back to rule ID
      'BBB-2',
    ]);
  });

  it('does not depend on the input order (it is deterministic)', () => {
    const reversed = sortDiagnostics([...UNSORTED].reverse());
    expect(reversed).toEqual(RESULT.diagnostics);
  });
});

describe('the two reporters', () => {
  it('text: 1-based positions plus the summary line (golden)', () => {
    expect(formatText(RESULT)).toMatchSnapshot();
  });

  it('text: says No problems found when there are no diagnostics', () => {
    expect(formatText({ diagnostics: [], filesChecked: 3, notices: [] })).toBe(
      'No problems found in 3 files.\n',
    );
  });

  it('text: uses the singular for a count of 1', () => {
    expect(formatText({ diagnostics: [], filesChecked: 1, notices: [] })).toBe(
      'No problems found in 1 file.\n',
    );
  });

  it('puts the notices in a Note line at the end of text and in notices in json (they do not affect the exit code)', () => {
    const result: LintResult = { diagnostics: [], filesChecked: 3, notices: ['git is unavailable.'] };
    expect(formatText(result)).toBe('No problems found in 3 files.\nNote: git is unavailable.\n');
    const parsed = JSON.parse(formatJson(result)) as ReturnType<typeof toJsonReport>;
    expect(parsed.notices).toEqual(['git is unavailable.']);
  });

  it('json: version, summary, and 0-based ranges (golden)', () => {
    expect(formatJson(RESULT)).toMatchSnapshot();
  });

  it('json: parses, and the summary matches', () => {
    const parsed = JSON.parse(formatJson(RESULT)) as ReturnType<typeof toJsonReport>;
    expect(parsed.version).toBe(1);
    expect(parsed.summary).toEqual({ errors: 3, warnings: 2, filesChecked: 7 });
    expect(parsed.diagnostics).toHaveLength(5);
  });
});
