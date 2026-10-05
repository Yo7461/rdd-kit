#!/usr/bin/env node
// Regenerate the overlays of fixtures/violations (the minimal mutations from valid) and the goldens (expected.json).
//
// Usage:
//   pnpm run build && node scripts/regen-fixtures.mjs          # regenerate (overwrite)
//   pnpm run build && node scripts/regen-fixtures.mjs --check  # verify byte equality without writing (exit 1 on a difference)
//
// The source of truth for the overlays is MUTATIONS below (the transform functions applied to the valid base).
// After changing the valid corpus, run this script so the overlays and goldens follow (a mutation anchor that
// has disappeared from the base becomes an explicit error). The overlays that introduce a new file type and do
// not depend on the base (STATIC_FILES) are authoritative as checked in, and are not regenerated.
// The fixtures assume LF (the run aborts when CRLF is detected).

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const fixturesRoot = path.join(repoRoot, 'fixtures');
const validRoot = path.join(fixturesRoot, 'valid');

const testingDist = path.join(repoRoot, 'packages', 'core', 'dist', 'testing', 'index.js');
if (!existsSync(testingDist)) {
  console.error('Cannot find packages/core/dist. Run `pnpm run build` (or `pnpm test`) first.');
  process.exit(1);
}
const { listViolationCases, listValidVariants, materializeCase, lintDir, diagnosticsToJsonValue } =
  await import(pathToFileURL(testingDist).href);

// ---- Mutation helpers ----------------------------------------------------

function replaceOnce(text, from, to) {
  if (!text.includes(from)) {
    throw new Error(`Cannot find the mutation anchor in the base: ${JSON.stringify(from.slice(0, 60))}`);
  }
  return text.replace(from, () => to);
}
const removeLine = (text, line) => replaceOnce(text, `${line}\n`, '');
const insertAfter = (text, anchorLine, lines) =>
  replaceOnce(text, `${anchorLine}\n`, `${anchorLine}\n${lines.map((l) => `${l}\n`).join('')}`);
const appendLines = (text, lines) => text + lines.map((l) => `${l}\n`).join('');
const numbered = (count, pad, format) =>
  Array.from({ length: count }, (_, i) => format(String(i + 1).padStart(pad, '0')));

/** How a golden is formatted: take stringify(2) and fold only the start/end position objects of a range onto one
 * line (the shape of the existing goldens). A raw newline cannot appear inside a JSON string, so this never
 * matches the body of a message by mistake. */
const formatGolden = (diagnostics) =>
  `${JSON.stringify(diagnostics, null, 2).replace(
    /\{\n\s+"line": (\d+),\n\s+"character": (\d+)\n\s+\}/g,
    '{ "line": $1, "character": $2 }',
  )}\n`;

// ---- The mutation manifest (the source of truth for the overlays) --------
// Key: a path relative to the valid corpus (POSIX). Value: base content -> overlay content.
// The strings below are anchors into the fixture text, which stays in the user's language — don't translate them.

const MUTATIONS = [
  {
    rule: 'BID-1',
    files: {
      'roadmap/phases/P0002-second/sessions/S0002.md': (t) =>
        replaceOnce(t, 'artifacts: [R0004]', 'artifacts: [R0004, R0001]'),
    },
  },
  {
    rule: 'BID-2',
    files: {
      'roadmap/phases/P0001-first/sessions/S0001.md': (t) =>
        replaceOnce(t, 'artifacts: [R0001, R0002, E0002]', 'artifacts: [R0001, E0002]'),
    },
  },
  {
    // Both directions of the bijection in one overlay: the row dropped from its own phase (the
    // silent loss a merge can cause) lands in another phase's Session Log instead.
    rule: 'BID-3',
    files: {
      'roadmap/phases/P0002-second/status.md': (t) =>
        removeLine(t, '| S0002 | 07-01 | タスク整理と再計画(P0004/P0005 drop・P0006 blocked) | def5678 | R0004 |'),
      'roadmap/phases/P0001-first/status.md': (t) =>
        insertAfter(t, '| S0001 | 07-01 | 骨格実装を1本通した | abc1234 | R0001, R0002, E0002 |', [
          '| S0002 | 07-01 | タスク整理と再計画 | def5678 | R0004 |',
        ]),
    },
  },
  {
    rule: 'FM-1',
    files: { 'roadmap/status.md': (t) => removeLine(t, 'updated: 2026-07-01') },
  },
  {
    rule: 'FM-2',
    files: {
      'roadmap/phases/P0001-first/sessions/S0001.md': (t) =>
        replaceOnce(t, 'state: closed', 'state: opened'),
    },
  },
  {
    rule: 'FM-3',
    files: { 'roadmap/status.md': (t) => replaceOnce(t, 'open_session: null', 'open_session: S0001') },
  },
  {
    rule: 'FM-4',
    files: { 'roadmap/phases/P0001-first/status.md': (t) => removeLine(t, 'closed: 2026-07-01') },
  },
  {
    rule: 'ID-2',
    files: {
      'roadmap/status.md': (t) =>
        replaceOnce(
          t,
          '| P0002 second | active | phases/P0002-second/status.md |',
          '| P0002 second | planned | phases/P0002-second/status.md |',
        ),
    },
  },
  {
    rule: 'REF-1',
    files: {
      'roadmap/status.md': (t) =>
        replaceOnce(
          t,
          '- B0002: 社内権限申請の承認待ち(P0006 をブロック)',
          '- B0009: 承認待ち(P0006 をブロック — 誤記の例)',
        ),
    },
  },
  {
    rule: 'REF-2',
    files: {
      'roadmap/spec/sample.md': (t) =>
        replaceOnce(
          replaceOnce(t, 'source: src/sample.ts', 'source: src/missing.ts'),
          'サンプル契約。src/sample.ts が公開する値の存在を約束する(検証は manual)。',
          'サンプル契約。source のパスが実在しない(REF-2 の最小変異)。',
        ),
    },
  },
  {
    rule: 'REF-3',
    files: {
      'roadmap/research/R0002-followup.md': (t) =>
        replaceOnce(
          t,
          '- 計測スクリプト: `roadmap/assets/R0002/gen.py`(リポジトリ管理下の再現資産)',
          '- 計測スクリプト: scratchpad/gen.py(揮発領域に置いたまま done にした違反例)',
        ),
    },
  },
  {
    rule: 'SIZE-1',
    files: {
      'roadmap/status.md': (t) =>
        insertAfter(t, '- [ ] タスク41: src/sample.ts の TODO 41 を実装する', [
          '- [ ] タスク42: src/sample.ts の TODO 42 を実装する',
        ]),
    },
  },
  {
    rule: 'SIZE-2',
    files: {
      'roadmap/spec/map.md': (t) =>
        insertAfter(t, '## System Map', numbered(65, 2, (n) => `- 案内 ${n}: src/sample.ts を参照`)),
    },
  },
  {
    rule: 'SIZE-3',
    files: {
      'roadmap/spec/sample.md': (t) => appendLines(t, numbered(173, 3, (n) => `補足 ${n}: 運用メモ。`)),
    },
  },
  {
    rule: 'SIZE-4',
    files: {
      'roadmap/phases/P0001-first/status.md': (t) =>
        replaceOnce(
          t,
          '骨格実装が1本通った(src/sample.ts)。B0001(開発環境の権限)は S0001 で解消済み。\n',
          numbered(11, 2, (n) => `要約 ${n}`)
            .map((l) => `${l}\n`)
            .join(''),
        ),
    },
  },
  {
    rule: 'SIZE-5',
    files: {
      'roadmap/phases/P0001-first/status.md': (t) =>
        insertAfter(t, '| S0001 | 07-01 | 骨格実装を1本通した | abc1234 | R0001, R0002, E0002 |', [
          '| S0001 | 07-02 | 重複してしまった行 | def5678 | — |',
        ]),
    },
  },
  {
    rule: 'SIZE-6',
    files: {
      'roadmap/phases/P0001-first/status.md': (t) =>
        insertAfter(
          t,
          '- D-P0001-0001 (S0001): 骨格は素の TypeScript で書く(依存を増やさない) — 詳細: sessions/S0001.md',
          numbered(276, 3, (n) => `- 決定メモ ${n}`),
        ),
    },
  },
  {
    rule: 'SIZE-7',
    files: {
      'roadmap/roadmap.md': (t) =>
        insertAfter(
          t,
          '- 骨格は素の TypeScript で書く(D-P0001-0001)',
          numbered(141, 3, (n) => `- 方針 ${n}: 記録は小さく保つ`),
        ),
    },
  },
  {
    rule: 'STRUCT-1',
    files: {
      'roadmap/phases/P0001-first/sessions/S0001.md': (t) =>
        replaceOnce(t, '\n## Handoff\n- 次: S0002 で P0002(第二フェーズ)を開始する\n', ''),
    },
  },
  {
    rule: 'STRUCT-2',
    files: {
      'roadmap/phases/P0001-first/status.md': (t) => `${t}\n## Decisions\n(なし)\n`,
    },
  },
  {
    rule: 'STRUCT-3',
    files: {
      'roadmap/status.md': (t) =>
        replaceOnce(
          t,
          'next_command: "/roadmap start — S0003: P0002(第二フェーズ)続き"',
          'next_command: "/roadmap close — S0002: 記録の確定"',
        ),
    },
  },
  {
    // Both forms in one overlay: the first contract block loses its verified_by key, and the Invariants
    // line of map.md loses its folded `— verified_by:` tail
    rule: 'STRUCT-4',
    files: {
      'roadmap/spec/sample.md': (t) => removeLine(t, 'verified_by: manual'),
      'roadmap/spec/map.md': (t) => replaceOnce(t, ' — verified_by: manual', ''),
    },
  },
  {
    rule: 'TXT-1',
    files: {
      'roadmap/research/R0001-sample.md': (t) =>
        insertAfter(t, '- 旧結果。のちに R0002 で置き換えられた。', ['- 取り込み事故の例: �']),
    },
  },
  {
    // The leftover block of a botched hand resolution. To Markdown none of it is broken — here `<<<<<<<`
    // and `=======` read as continuation text of the list items above them, and `>>>>>>>` as a nested
    // blockquote — so no other rule objects, and all three marker lines land as TXT-3.
    rule: 'TXT-3',
    files: {
      'roadmap/research/R0001-sample.md': (t) =>
        insertAfter(t, '- 旧結果。のちに R0002 で置き換えられた。', [
          '<<<<<<< HEAD',
          '- 結果(ブランチA)',
          '=======',
          '- 結果(ブランチB)',
          '>>>>>>> feature',
        ]),
    },
  },
  {
    rule: 'TXT-2',
    files: {
      'roadmap/research/R0002-followup.md': (t) =>
        insertAfter(replaceOnce(t, 'created: S0001', 'created: [S0001'), '- 新しい結果。', [
          '| 項目 | 値 |',
          '|------|-----|',
          '| a | 1 | 余分 |',
        ]),
      'roadmap/spec/sample.md': (t) => `${t}\`\`\`text\n`,
    },
  },
];

// ---- The variant manifest (the source of truth for fixtures/valid-variants) ----
// Same overlay approach as MUTATIONS, but the expected result is zero diagnostics: a corpus shape that the
// single valid corpus cannot hold at the same time. There is no golden to regenerate — the check is that the
// composed corpus lints clean.

const VARIANTS = [
  {
    // The terminal state: every phase done or dropped, so `current_phase` names a done phase.
    // `P0006` and `P0007` have no phases/ directory, so they can only end as dropped (ID-2). `B0002` stays open —
    // a blocker that never cleared is exactly why `P0006` was dropped.
    name: 'complete',
    files: {
      'roadmap/roadmap.md': (t) =>
        replaceOnce(
          replaceOnce(
            replaceOnce(t, '### P0002: 第二フェーズ — active', '### P0002: 第二フェーズ — done'),
            '### P0006: ブロック中 — blocked',
            '### P0006: ブロック中 — dropped',
          ),
          '### P0007: 第三フェーズ — planned',
          '### P0007: 第三フェーズ — dropped',
        ),
      'roadmap/status.md': (t) => {
        const command = '/roadmap replan 拡張フェーズの追加';
        const reason = '全フェーズ done/dropped で完成。継続するなら拡張フェーズを起こす';
        let out = replaceOnce(
          t,
          'next_command: "/roadmap start — S0003: P0002(第二フェーズ)続き"',
          `next_command: "${command} — ${reason}"`,
        );
        out = replaceOnce(
          out,
          'P0002 進行中。P0001 done・P0004/P0005 dropped・P0006 は B0002 でブロック中。',
          '完成。P0001/P0002 done・P0004/P0005/P0006/P0007 dropped(P0006 は B0002 が解けないままドロップ)。',
        );
        // The Next section collapses to the recommendation alone — there is no task left to pick up
        const oldNextBody = [
          'Recommended: `/roadmap start` — S0003: P0002(第二フェーズ)続き',
          ...numbered(41, 2, (n) => `- [ ] タスク${n}: src/sample.ts の TODO ${n} を実装する`),
        ].join('\n');
        out = replaceOnce(out, oldNextBody, `Recommended: \`${command}\` — ${reason}`);
        return replaceOnce(
          replaceOnce(
            replaceOnce(
              out,
              '| P0002 second | active | phases/P0002-second/status.md |',
              '| P0002 second | done | phases/P0002-second/status.md |',
            ),
            '| P0006 blocked-one | blocked | — |',
            '| P0006 blocked-one | dropped | — |',
          ),
          '| P0007 third | planned | — |',
          '| P0007 third | dropped | — |',
        );
      },
      'roadmap/phases/P0002-second/status.md': (t) =>
        replaceOnce(
          replaceOnce(t, 'state: active\nstarted: 2026-07-01', 'state: done\nstarted: 2026-07-01\nclosed: 2026-07-01'),
          '- [ ] AC1: 残タスクがゼロになる — 検証: —',
          '- [x] AC1: 残タスクがゼロになる — 検証: status.md の Next が空 — verified: S0002',
        ),
    },
  },
  {
    // The at-rest open state (mid-session): `S0002` is open, so its Session Log row is not written
    // yet (BID-3 exempts an open session) and `open_session` points at it (FM-3). The GIT rules
    // are off in the corpus config, so the fake hashes stay inert.
    name: 'open-session',
    files: {
      'roadmap/status.md': (t) => {
        let out = replaceOnce(t, 'open_session: null', 'open_session: S0002');
        out = replaceOnce(out, 'last_session: S0002', 'last_session: S0001');
        out = replaceOnce(
          out,
          'next_command: "/roadmap start — S0003: P0002(第二フェーズ)続き"',
          'next_command: "/roadmap start — S0002: P0002(第二フェーズ)開始"',
        );
        return replaceOnce(
          out,
          'Recommended: `/roadmap start` — S0003: P0002(第二フェーズ)続き',
          'Recommended: `/roadmap start` — S0002: P0002(第二フェーズ)開始',
        );
      },
      'roadmap/phases/P0002-second/status.md': (t) =>
        removeLine(t, '| S0002 | 07-01 | タスク整理と再計画(P0004/P0005 drop・P0006 blocked) | def5678 | R0004 |'),
      'roadmap/phases/P0002-second/sessions/S0002.md': (t) =>
        replaceOnce(t, 'state: closed', 'state: open'),
    },
  },
];

// The overlays that introduce a new file type and do not depend on the base (authoritative as checked in, never regenerated)
const STATIC_FILES = {
  'FILE-1': ['roadmap/notes.txt'],
  'ID-1': ['roadmap/research/R0001-duplicate.md'],
  'ID-3': ['roadmap/phases/P008-bad/status.md'],
};

// ---- Run ------------------------------------------------------------------

const checkMode = process.argv.includes('--check');
const problems = [];
let updated = 0;

function readLf(filePath) {
  const text = readFileSync(filePath, 'utf8');
  if (text.includes('\r')) {
    throw new Error(`Detected CRLF (the fixtures assume LF): ${path.relative(repoRoot, filePath)}`);
  }
  return text;
}

function listFilesRecursive(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true })
    .map((p) => String(p).replaceAll('\\', '/'))
    .filter((p) => statSync(path.join(dir, p)).isFile())
    .sort();
}

/** Writes the expected content (write) or compares it byte for byte with what is there (check). Returns whether they differ. */
function emit(targetPath, content, label) {
  const current = existsSync(targetPath) ? readFileSync(targetPath, 'utf8') : null;
  if (current === content) return false;
  if (checkMode) {
    problems.push(`${label}: does not match the regenerated result${current === null ? ' (the file is missing)' : ''}`);
  } else {
    mkdirSync(path.dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, content);
    updated += 1;
    console.log(`updated: ${label}`);
  }
  return true;
}

const cases = listViolationCases(fixturesRoot);
const manifestRules = new Set([...MUTATIONS.map((m) => m.rule), ...Object.keys(STATIC_FILES)]);
for (const c of cases) {
  if (!manifestRules.has(c.ruleId)) {
    problems.push(`violations/${c.ruleId}: not registered in the manifest (add it to MUTATIONS or STATIC_FILES)`);
  }
}
for (const rule of manifestRules) {
  if (!cases.some((c) => c.ruleId === rule)) {
    problems.push(`No violations/ directory for ${rule} in the manifest`);
  }
}

for (const c of cases) {
  const mutation = MUTATIONS.find((m) => m.rule === c.ruleId);
  const expectedFiles = mutation ? Object.keys(mutation.files).sort() : (STATIC_FILES[c.ruleId] ?? []);

  // Whether the file set of the overlay matches the manifest (this catches an unregistered file that crept in).
  // A missing file of a mutation case is created by emit (and reported under --check), so the first generation
  // of a new case goes through with an empty overlay/ directory — a static case has nothing to generate it from
  const actualFiles = listFilesRecursive(c.overlayDir);
  const extraFiles = actualFiles.filter((f) => !expectedFiles.includes(f));
  const missingFiles = expectedFiles.filter((f) => !actualFiles.includes(f));
  if (extraFiles.length > 0 || (!mutation && missingFiles.length > 0)) {
    problems.push(
      `violations/${c.ruleId}: the overlay file set does not match the manifest (actual: ${actualFiles.join(', ') || 'none'} / expected: ${expectedFiles.join(', ')})`,
    );
    continue;
  }

  // Regenerate the overlay (mutation cases only. A static one is authoritative as checked in)
  if (mutation) {
    for (const [relPath, mutate] of Object.entries(mutation.files)) {
      const basePath = path.join(validRoot, ...relPath.split('/'));
      if (!existsSync(basePath)) {
        problems.push(`violations/${c.ruleId}: the base does not exist: fixtures/valid/${relPath}`);
        continue;
      }
      try {
        const mutated = mutate(readLf(basePath));
        emit(
          path.join(c.overlayDir, ...relPath.split('/')),
          mutated,
          `violations/${c.ruleId}/overlay/${relPath}`,
        );
      } catch (err) {
        problems.push(`violations/${c.ruleId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // Regenerate the golden (compose valid plus the overlay -> lint -> serialize to JSON)
  const { dir, cleanup } = materializeCase(validRoot, c.overlayDir);
  try {
    const diagnostics = diagnosticsToJsonValue(lintDir(dir));
    if (!Array.isArray(diagnostics) || diagnostics.length === 0) {
      problems.push(`violations/${c.ruleId}: no diagnostics for a violation case (the overlay is broken)`);
      continue;
    }
    emit(c.expectedPath, formatGolden(diagnostics), `violations/${c.ruleId}/expected.json`);
  } finally {
    cleanup();
  }
}

// ---- The valid variants (expected: zero diagnostics, so there is no golden) ----

const variantCases = listValidVariants(fixturesRoot);
for (const c of variantCases) {
  if (!VARIANTS.some((v) => v.name === c.name)) {
    problems.push(`valid-variants/${c.name}: not registered in the manifest (add it to VARIANTS)`);
  }
}

for (const variant of VARIANTS) {
  const overlayDir = path.join(fixturesRoot, 'valid-variants', variant.name, 'overlay');
  const expectedFiles = Object.keys(variant.files).sort();
  // Only an unregistered file that crept in is a problem here — a missing one is created by emit (and
  // reported by emit under --check), which also lets the first generation of a new variant go through
  const extraFiles = listFilesRecursive(overlayDir).filter((f) => !expectedFiles.includes(f));
  if (extraFiles.length > 0) {
    problems.push(
      `valid-variants/${variant.name}: the overlay holds files that are not in the manifest (${extraFiles.join(', ')})`,
    );
    continue;
  }

  let failed = false;
  for (const [relPath, mutate] of Object.entries(variant.files)) {
    const basePath = path.join(validRoot, ...relPath.split('/'));
    if (!existsSync(basePath)) {
      problems.push(`valid-variants/${variant.name}: the base does not exist: fixtures/valid/${relPath}`);
      failed = true;
      continue;
    }
    try {
      emit(
        path.join(overlayDir, ...relPath.split('/')),
        mutate(readLf(basePath)),
        `valid-variants/${variant.name}/overlay/${relPath}`,
      );
    } catch (err) {
      problems.push(`valid-variants/${variant.name}: ${err instanceof Error ? err.message : String(err)}`);
      failed = true;
    }
  }
  if (failed) continue;

  // A variant is only meaningful while it stays clean (the same assertion the fixture test makes)
  const { dir, cleanup } = materializeCase(validRoot, overlayDir);
  try {
    const diagnostics = lintDir(dir).diagnostics;
    if (diagnostics.length > 0) {
      problems.push(
        `valid-variants/${variant.name}: expected zero diagnostics, got ${diagnostics.length} (${diagnostics
          .map((d) => d.rule)
          .join(', ')})`,
      );
    }
  } finally {
    cleanup();
  }
}

console.log(
  `${checkMode ? 'Verified' : 'Regenerated'}: ${cases.length} cases (${MUTATIONS.length} mutation, ${Object.keys(STATIC_FILES).length} static) + ${VARIANTS.length} valid variants` +
    (checkMode ? '' : ` / ${updated} updated`),
);
if (problems.length > 0) {
  console.error(`\n${problems.length} problems:`);
  for (const p of problems) console.error(`- ${p}`);
  process.exit(1);
}
