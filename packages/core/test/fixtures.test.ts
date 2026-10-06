import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  diagnosticsToJsonValue,
  lintDir,
  listValidVariants,
  listViolationCases,
  materializeCase,
  nodeHost,
  readExpectedDiagnostics,
} from '../src/testing/index.js';
import type { LintConfig } from '../src/config.js';
import { loadConfigFile } from '../src/config-file.js';

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const fixturesRoot = path.join(repoRoot, 'fixtures');
const validRoot = path.join(fixturesRoot, 'valid');
const violationCases = listViolationCases(fixturesRoot);
const validVariants = listValidVariants(fixturesRoot);

// The shared config for checking fixtures/valid as a corpus (the GIT rules are out of scope there)
const corpusConfig: LintConfig = await loadConfigFile(path.join(repoRoot, 'lint-corpus.config.json'), nodeHost);

async function lintCase(ruleId: string, config: LintConfig = {}) {
  const found = violationCases.find((c) => c.ruleId === ruleId);
  if (!found) throw new Error(`violations/${ruleId} does not exist`);
  const { dir, cleanup } = materializeCase(validRoot, found.overlayDir);
  try {
    return { result: await lintDir(dir, config), expected: readExpectedDiagnostics(found.expectedPath) };
  } finally {
    cleanup();
  }
}

describe('the fixture harness', () => {
  it('finds no false positives in the valid corpus (which includes a status.md at exactly 60 counted lines — the Phase Index is not counted)', async () => {
    // The GIT rules judge the host repository's git state, not the corpus, so a corpus check leaves them
    // out (lint-corpus.config.json is the shared source of truth for that, used by lint:corpus too). They are
    // held up instead by the temporary-git-repository tests in rules-git.test.ts
    expect((await lintDir(validRoot, corpusConfig)).diagnostics).toEqual([]);
  });

  it('has a SIZE-1 case under violations', async () => {
    expect(violationCases.map((c) => c.ruleId)).toContain('SIZE-1');
  });

  // A corpus shape the single valid corpus cannot hold at the same time as its own. The terminal state
  // (every phase done or dropped, so `current_phase` names a done phase) has no active phase left to
  // point at — a variant is the only durable carrier of it
  it('has a completion-state variant under valid-variants', async () => {
    expect(validVariants.map((v) => v.name)).toContain('complete');
  });

  for (const variant of validVariants) {
    it(`valid-variants/${variant.name}: stays free of diagnostics across all the rules`, async () => {
      const { dir, cleanup } = materializeCase(validRoot, variant.overlayDir);
      try {
        expect((await lintDir(dir)).diagnostics).toEqual([]);
      } finally {
        cleanup();
      }
    });
  }

  for (const violationCase of violationCases) {
    it(`violations/${violationCase.ruleId}: detects every violation and matches the golden exactly`, async () => {
      const { result, expected } = await lintCase(violationCase.ruleId);
      expect(diagnosticsToJsonValue(result)).toEqual(expected);
    });
  }

  it('merges the corpus rules and the single-file rules into one diagnostic list, stably sorted', async () => {
    const found = violationCases.find((c) => c.ruleId === 'BID-2');
    if (!found) throw new Error('violations/BID-2 does not exist');
    const { dir, cleanup } = materializeCase(validRoot, found.overlayDir);
    try {
      // Add one counted line to the status.md that sits at exactly 60 counted lines, so SIZE-1 (a single-file rule)
      // fires too (an appended line would land inside the Phase Index, which SIZE-1 leaves out of the count)
      const statusPath = path.join(dir, 'roadmap', 'status.md');
      writeFileSync(
        statusPath,
        readFileSync(statusPath, 'utf8').replace('\n## Phase Index', '補足: 上限超過用の追記行\n\n## Phase Index'),
      );
      const { diagnostics } = await lintDir(dir);
      expect(diagnostics.map((d) => [d.rule, d.anchor.kind === 'repo' ? '' : d.anchor.file])).toEqual([
        ['BID-2', 'roadmap/research/R0002-followup.md'],
        ['SIZE-1', 'roadmap/status.md'],
      ]);
    } finally {
      cleanup();
    }
  });
});

describe('per-rule config actually taking effect (every violations case)', () => {
  for (const violationCase of violationCases) {
    it(`${violationCase.ruleId}: enabled:false makes the diagnostics disappear (which also confirms the minimal mutation)`, async () => {
      const { result } = await lintCase(violationCase.ruleId, {
        rules: { [violationCase.ruleId]: { enabled: false } },
      });
      expect(result.diagnostics).toEqual([]);
    });

    it(`${violationCase.ruleId}: the severity override takes effect`, async () => {
      const { result } = await lintCase(violationCase.ruleId, {
        rules: { [violationCase.ruleId]: { severity: 'warning' } },
      });
      expect(result.diagnostics.length).toBeGreaterThan(0);
      expect(
        result.diagnostics.every(
          (d) => d.rule === violationCase.ruleId && d.severity === 'warning',
        ),
      ).toBe(true);
    });
  }

  it('applies an option override (SIZE-1 maxLines)', async () => {
    const { result } = await lintCase('SIZE-1', { rules: { 'SIZE-1': { options: { maxLines: 100 } } } });
    expect(result.diagnostics).toEqual([]);
  });

  it('applies an option override (SIZE-7 maxLines)', async () => {
    const { result } = await lintCase('SIZE-7', { rules: { 'SIZE-7': { options: { maxLines: 250 } } } });
    expect(result.diagnostics).toEqual([]);
  });

  it('applies an option override (FILE-1 allowNames)', async () => {
    const { result } = await lintCase('FILE-1', {
      rules: { 'FILE-1': { options: { allowNames: ['.gitkeep', 'notes.txt'] } } },
    });
    expect(result.diagnostics).toEqual([]);
  });
});
