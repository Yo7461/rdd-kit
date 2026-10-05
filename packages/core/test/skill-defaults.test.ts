import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { allRules } from '../src/rules/registry.js';

/**
 * The skill prose keeps stating every threshold in words (the mechanism is the prose
 * rule in SKILL.md ground rule 10, not a CLI that prints effective values), so an author still has
 * the defaults with no `.roadmap-lint.json` and no CLI installed. The cost of that choice is a
 * default written twice: once here in the implementation, once there in the prose.
 *
 * `references/workflows.md` § doctor is the one place that pairs every SIZE rule ID with the default
 * it carries, so it is the anchor these tests hold the implementation against. A
 * default changed on one side and not the other fails `pnpm test` instead of drifting unnoticed.
 */

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const skillDir = path.join(repoRoot, 'plugin', 'skills', 'roadmap');

function read(...rel: string[]): string {
  // A checkout with autocrlf on reads the prose back with CRLF — the section anchors below assume LF
  return readFileSync(path.join(skillDir, ...rel), 'utf8').replace(/\r\n/g, '\n');
}

/** The SIZE defaults the implementation actually applies (`maxLines` in a rule's `defaultOptions`). */
function implementedSizeLimits(): Map<string, number> {
  const out = new Map<string, number>();
  for (const rule of allRules) {
    if (!rule.id.startsWith('SIZE-')) continue;
    const maxLines = rule.defaultOptions['maxLines'];
    if (typeof maxLines === 'number') out.set(rule.id, maxLines);
  }
  return out;
}

/** The `| 4 Size limits | … |` row of the doctor table — the prose's rule ID to default mapping. */
function doctorSizeRow(): string {
  const row = read('references', 'workflows.md')
    .split('\n')
    .find((line) => line.startsWith('| 4 Size limits |'));
  if (!row) throw new Error('The `4 Size limits` row is missing from workflows.md § doctor');
  return row;
}

/** `SIZE-6 a phase status 300 lines` → `SIZE-6` => 300. A rule stated without a number is skipped. */
function documentedSizeLimits(row: string): Map<string, number> {
  const out = new Map<string, number>();
  // `[^/]*?` cannot cross the `/` that separates two rules, so a rule with no `N lines` (SIZE-5)
  // cannot borrow the number of the rule after it
  for (const m of row.matchAll(/SIZE-(\d+)[^/]*?(\d+) lines/g)) {
    out.set(`SIZE-${m[1]}`, Number(m[2]));
  }
  return out;
}

/** One line or one section of prose, for the presence checks that follow. */
function skillLine(file: string[], startsWith: string): string {
  const line = read(...file)
    .split('\n')
    .find((l) => l.startsWith(startsWith));
  if (!line) throw new Error(`No line starting with ${JSON.stringify(startsWith)} in ${file.join('/')}`);
  return line;
}

function sizeLimitsSection(): string {
  const text = read('references', 'schemas.md');
  const start = text.indexOf('\n## Size limits\n');
  if (start < 0) throw new Error('§ Size limits is missing from schemas.md');
  const rest = text.slice(start + 1);
  const end = rest.indexOf('\n---\n');
  return end < 0 ? rest : rest.slice(0, end);
}

describe('the skill prose against the implemented defaults', () => {
  const implemented = implementedSizeLimits();

  it('the implementation carries a maxLines default for every SIZE rule but SIZE-5', () => {
    expect([...implemented.keys()].sort()).toEqual([
      'SIZE-1',
      'SIZE-2',
      'SIZE-3',
      'SIZE-4',
      'SIZE-6',
      'SIZE-7',
    ]);
    // SIZE-5 takes no option at all — one line per session is structural, not a threshold, and
    // schemas.md § Size limits says so where it tells an author which limits a project can set
    expect(allRules.find((r) => r.id === 'SIZE-5')?.defaultOptions).toEqual({});
    expect(sizeLimitsSection()).toContain('`Session Log` is the one that takes no option');
  });

  it('the doctor table pairs each rule ID with the number the implementation applies', () => {
    expect(documentedSizeLimits(doctorSizeRow())).toEqual(implemented);
  });

  it('the doctor table states SIZE-5 without a number', () => {
    expect(doctorSizeRow()).toContain('SIZE-5 `Session Log` one line');
  });

  it('SKILL.md ground rule 6 prints the numbers it summarizes', () => {
    const rule6 = skillLine(['SKILL.md'], '6. **Size limits**');
    // SIZE-6 is not among them on purpose: a phase status past its limit is the sign to split the
    // phase, not a budget to write to, so schemas.md § Size limits is where it belongs
    for (const id of ['SIZE-1', 'SIZE-2', 'SIZE-3', 'SIZE-4', 'SIZE-7']) {
      expect(rule6).toContain(`${implemented.get(id)} lines`);
    }
  });

  it('schemas.md § Size limits prints every number', () => {
    const section = sizeLimitsSection();
    for (const [, maxLines] of implemented) {
      expect(section).toContain(`${maxLines} lines`);
    }
  });

  it('states the Phase Index exception of SIZE-1 wherever the limit is stated', () => {
    expect(doctorSizeRow()).toContain('Phase Index');
    expect(skillLine(['SKILL.md'], '6. **Size limits**')).toContain('Phase Index');
    expect(sizeLimitsSection()).toContain('Phase Index');
  });

  it('ground rule 10 makes the configured value the one to write to', () => {
    const rule10 = skillLine(['SKILL.md'], '10. **The project');
    expect(rule10).toContain('.roadmap-lint.json');
    expect(rule10).toContain('rules.<RULE-ID>.options');
    // The read that makes the rule operational, and the pointer the rule hands the reader
    expect(skillLine(['SKILL.md'], '1. **Read before writing**')).toContain('.roadmap-lint.json');
    expect(rule10).toContain('§ doctor');
  });
});

describe('the commit label vocabulary against GIT-4', () => {
  it('§ Commit convention lists exactly the labels GIT-4 accepts by default', () => {
    const labels = allRules.find((r) => r.id === 'GIT-4')?.defaultOptions['labels'];
    expect(Array.isArray(labels)).toBe(true);
    const bullet = skillLine(['references', 'schemas.md'], '- `<label>: ` is a recommended prefix');
    // The prose spells them as `` `init` / `research` / … `` and names some of them a second time
    // when it explains the dedicated routes, so the comparison is by set, not by sequence
    const documented = [...bullet.matchAll(/`([a-z][a-z-]*)`(?= \/ | \(| is)/g)].map((m) => m[1]);
    expect(new Set(documented)).toEqual(new Set(labels as string[]));
  });
});

describe('the GIT-7 shelf life against the doctor table', () => {
  it('the `7 git` row states the maxAgeDays default the implementation applies', () => {
    const maxAgeDays = allRules.find((r) => r.id === 'GIT-7')?.defaultOptions['maxAgeDays'];
    expect(typeof maxAgeDays).toBe('number');
    const row = read('references', 'workflows.md')
      .split('\n')
      .find((line) => line.startsWith('| 7 git |'));
    if (!row) throw new Error('The `7 git` row is missing from workflows.md § doctor');
    // `[^|]*?` keeps the match inside the row's cell, and `(\d+) days` is the number the prose states
    expect(/GIT-7[^|]*?(\d+) days/.exec(row)?.[1]).toBe(String(maxAgeDays));
  });
});
