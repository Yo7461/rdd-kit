import { describe, expect, it } from 'vitest';
import { buildCorpusIndex, type CorpusEntry } from '../src/corpus/index.js';
import { file1 } from '../src/rules/file-1.js';
import type { RuleDiagnostic } from '../src/rules/types.js';

function run(entries: CorpusEntry[], options: Record<string, unknown> = {}): RuleDiagnostic[] {
  const corpus = buildCorpusIndex(entries, [], () => true);
  return file1.checkCorpus?.({ files: [], corpus, options }) ?? [];
}

describe('FILE-1: a file placed outside the conventions (a warning)', () => {
  it('leaves the canonical positions of the 8 known types, .gitkeep, and anything under assets/ out of scope', () => {
    const out = run([
      { relPath: 'roadmap/roadmap.md', type: 'roadmap' },
      { relPath: 'roadmap/research/.gitkeep', type: 'unknown' },
      { relPath: 'roadmap/assets/R0002/gen.py', type: 'unknown' },
      { relPath: 'roadmap/assets/E0001/data.csv', type: 'unknown' },
    ]);
    expect(out).toEqual([]);
  });

  it('reports a file outside the conventions as a warning (a file anchor)', () => {
    const out = run([
      { relPath: 'roadmap/notes.txt', type: 'unknown' },
      { relPath: 'roadmap/research/sub/R0009-deep.md', type: 'unknown' },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]?.anchor).toEqual({ kind: 'file', file: 'roadmap/notes.txt' });
    expect(file1.defaultSeverity).toBe('warning');
  });

  it('lets allowNames and allowPaths permit more', () => {
    const entries: CorpusEntry[] = [
      { relPath: 'roadmap/notes.txt', type: 'unknown' },
      { relPath: 'roadmap/attachments/spec.pdf', type: 'unknown' },
    ];
    expect(run(entries)).toHaveLength(2);
    expect(
      run(entries, { allowNames: ['.gitkeep', 'notes.txt'], allowPaths: ['roadmap/assets/', 'roadmap/attachments/'] }),
    ).toEqual([]);
  });
});
