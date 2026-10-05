import { describe, expect, it } from 'vitest';
import { classifyFile } from '../src/files.js';
import {
  FILE_TYPE_SCHEMAS,
  validateValue,
  type KnownFileType,
} from '../src/schema/file-types.js';

describe('classifyFile: the 8 types plus unknown', () => {
  it.each([
    ['roadmap/roadmap.md', 'roadmap'],
    ['roadmap/status.md', 'root-status'],
    ['roadmap/phases/P0001-first/status.md', 'phase-status'],
    ['roadmap/phases/P0001-first/sessions/S0001.md', 'session'],
    ['roadmap/research/R0001-sample.md', 'research'],
    ['roadmap/experiments/E0001-sample.md', 'experiment'],
    ['roadmap/spec/map.md', 'spec-map'],
    ['roadmap/spec/cli.md', 'spec-domain'],
    ['roadmap/research/.gitkeep', 'unknown'],
    ['roadmap/assets/R0001/tool.py', 'unknown'],
    ['roadmap/notes.md', 'unknown'],
    ['roadmap/phases/P0001-first/extra.md', 'unknown'],
  ] as const)('%s → %s', (relPath, expected) => {
    expect(classifyFile(relPath)).toBe(expected);
  });

  it('classifies by position even when the naming is broken (checking the naming belongs to ID-3)', () => {
    expect(classifyFile('roadmap/phases/p001-bad/status.md')).toBe('phase-status');
    expect(classifyFile('roadmap/phases/P0001-first/sessions/note.md')).toBe('session');
    expect(classifyFile('roadmap/research/memo.md')).toBe('research');
  });
});

describe('agreement of the file type schemas', () => {
  const entries = Object.entries(FILE_TYPE_SCHEMAS) as [KnownFileType, (typeof FILE_TYPE_SCHEMAS)[KnownFileType]][];

  it('defines all 8 types, each matching its type key', () => {
    expect(entries.map(([k]) => k).sort()).toEqual(
      [
        'experiment',
        'phase-status',
        'research',
        'roadmap',
        'root-status',
        'session',
        'spec-domain',
        'spec-map',
      ].sort(),
    );
    for (const [key, schema] of entries) expect(schema.type).toBe(key);
  });

  it('carries the line limits (60 / 80 / 200), plus roadmap.md at 200', () => {
    expect(FILE_TYPE_SCHEMAS['root-status'].maxLines).toBe(60);
    expect(FILE_TYPE_SCHEMAS['spec-map'].maxLines).toBe(80);
    expect(FILE_TYPE_SCHEMAS['spec-domain'].maxLines).toBe(200);
    // The back horizon of the Intent layer — SIZE-7
    expect(FILE_TYPE_SCHEMAS['roadmap'].maxLines).toBe(200);
    // A phase status has no schema limit: SIZE-6's 300 is a sign to split, held in the rule itself
    expect(FILE_TYPE_SCHEMAS['phase-status'].maxLines).toBeUndefined();
  });

  it('defines required H2 headings for every type but spec-domain', () => {
    for (const [key, schema] of entries) {
      if (key === 'spec-domain') expect(schema.requiredH2).toEqual([]);
      else expect(schema.requiredH2.length).toBeGreaterThan(0);
    }
  });
});

describe('validateValue (the source of truth for FM-2)', () => {
  it.each([
    [{ kind: 'string' } as const, 'x', null],
    [{ kind: 'string' } as const, '', 'ng'],
    [{ kind: 'date' } as const, '2026-07-31', null],
    [{ kind: 'date' } as const, '2026/07/31', 'ng'],
    [{ kind: 'enum', values: ['a', 'b'] } as const, 'a', null],
    [{ kind: 'enum', values: ['a', 'b'] } as const, 'c', 'ng'],
    [{ kind: 'id', prefix: 'P' } as const, 'P0001', null],
    [{ kind: 'id', prefix: 'P' } as const, 'P001', 'ng'],
    [{ kind: 'id-or-null', prefix: 'S' } as const, null, null],
    [{ kind: 'id-or-null', prefix: 'S' } as const, 'S0011', null],
    [{ kind: 'id-or-null', prefix: 'S' } as const, 'X0011', 'ng'],
    [{ kind: 're-id-or-null' } as const, 'R0002', null],
    [{ kind: 're-id-or-null' } as const, 'C0001', 'ng'],
    [{ kind: 'bool' } as const, false, null],
    [{ kind: 'bool' } as const, 'false', 'ng'],
    [{ kind: 'scalar-or-null' } as const, 'd4e797f', null],
    [{ kind: 'scalar-or-null' } as const, 1111111, null],
    [{ kind: 'scalar-or-null' } as const, null, null],
    [{ kind: 'scalar-or-null' } as const, ['x'], 'ng'],
    [{ kind: 'list' } as const, [], null],
    [{ kind: 'list' } as const, 'x', 'ng'],
    [{ kind: 'id-list', prefixes: ['R', 'E', 'C'] } as const, ['R0001', 'C0002'], null],
    [{ kind: 'id-list', prefixes: ['R', 'E', 'C'] } as const, ['R0001', 'S0001'], 'ng'],
    [{ kind: 'id-list', prefixes: ['R', 'E', 'C'] } as const, ['R0001', 7], 'ng'],
  ])('%o against %o', (spec, value, expected) => {
    const result = validateValue(spec, value);
    if (expected === null) expect(result).toBeNull();
    else expect(result).not.toBeNull();
  });
});
