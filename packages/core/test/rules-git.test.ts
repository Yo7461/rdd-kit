import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { UNCOMMITTED_HASH, type GitInfo, type LineHistory } from '../src/corpus/git.js';
import { buildCorpusIndex, type CorpusEntry } from '../src/corpus/index.js';
import { parseSource, type ParsedFile } from '../src/parse/parsed-file.js';
import { git1, git2, git3, git4, git5, git6 } from '../src/rules/git-rules.js';
import { git7 } from '../src/rules/git-7.js';
import { ref3 } from '../src/rules/ref-3.js';
import type { RuleDiagnostic, RuleModule } from '../src/rules/types.js';
import { lintDir, withTempGitRepo } from '../src/testing/index.js';

// The record text and the commit subjects below stay in Japanese on purpose: records and commit
// messages are written in the user's language, and only the test names and comments are English.
function make(relPath: string, lines: string[]): ParsedFile {
  return parseSource(relPath, lines.join('\n') + '\n');
}

const gitInfo = (over: Partial<GitInfo> = {}): GitInfo => ({
  trackedFiles: new Set<string>(),
  commits: [],
  uncommittedRoadmapPaths: [],
  ignoredTracked: [],
  headHashes: [],
  shallow: false,
  lineHistory: () => null,
  ...over,
});

function runCorpus(
  rule: RuleModule,
  files: ParsedFile[],
  git: GitInfo | null,
  options: Record<string, unknown> = {},
  pathProbe: (p: string) => boolean = () => true,
): { out: RuleDiagnostic[]; notices: string[] } {
  const entries: CorpusEntry[] = files.map((f) => ({ relPath: f.relPath, type: f.type }));
  const corpus = buildCorpusIndex(entries, files, pathProbe, git);
  const notices: string[] = [];
  const out =
    rule.checkCorpus?.({
      files,
      corpus,
      options: { ...rule.defaultOptions, ...options },
      notice: (m) => notices.push(m),
    }) ?? [];
  return { out, notices };
}

const rootStatus = (openSession: string): ParsedFile =>
  make('roadmap/status.md', [
    '---',
    'current_phase: P0001',
    `open_session: ${openSession}`,
    'last_session: S0001',
    'next_command: "/roadmap start — x"',
    'updated: 2026-07-01',
    '---',
    '',
    '# Status: x',
  ]);

const doneResearch = (methodLines: string[], status = 'done'): ParsedFile =>
  make('roadmap/research/R0001-x.md', [
    '---',
    'id: R0001',
    'type: research',
    'created: S0001',
    'completed: S0001',
    'phase: P0001',
    `status: ${status}`,
    'superseded_by: null',
    '---',
    '',
    '# R0001: x',
    '',
    '## Method',
    ...methodLines,
    '',
    '## Results',
    '- 結果',
    '',
    '## Conclusion',
    '- 結論(ここは REF-3 対象外): scratchpad/out-of-scope.py',
  ]);

describe('GIT-1: uncommitted changes under roadmap/', () => {
  it('stays silent when git is absent or nothing changed', () => {
    expect(runCorpus(git1, [rootStatus('null')], null).out).toEqual([]);
    expect(runCorpus(git1, [rootStatus('null')], gitInfo()).out).toEqual([]);
  });

  it('reports a warning per path when there are changes and open_session is null', () => {
    const { out, notices } = runCorpus(
      git1,
      [rootStatus('null')],
      gitInfo({ uncommittedRoadmapPaths: ['roadmap/status.md', 'roadmap/x.md'] }),
    );
    expect(out).toHaveLength(2);
    expect(out[0]?.anchor).toEqual({ kind: 'file', file: 'roadmap/status.md' });
    expect(notices).toEqual([]);
  });

  it('drops to a notice with no diagnostics when open_session is not null (mid-recording is normal)', () => {
    const { out, notices } = runCorpus(
      git1,
      [rootStatus('S0002')],
      gitInfo({ uncommittedRoadmapPaths: ['roadmap/status.md'] }),
    );
    expect(out).toEqual([]);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain('S0002');
  });
});

describe('GIT-2: the [S####] prefix check', () => {
  it('stays silent on subjects that follow the convention ([S####] and [S####] post:)', () => {
    const { out } = runCorpus(
      git2,
      [],
      gitInfo({
        commits: [
          { hash: 'a'.repeat(40), subject: '[S0002] post: 誤字修正' },
          { hash: 'b'.repeat(40), subject: '[S0001] 実装' },
        ],
      }),
    );
    expect(out).toEqual([]);
  });

  it('does not accept a phase ID bracketed right behind the session ID (the concatenated form, [S####][P####])', () => {
    const { out } = runCorpus(
      git2,
      [],
      gitInfo({
        commits: [{ hash: 'c'.repeat(40), subject: '[S0003][P0002] build: フェーズ連結形' }],
      }),
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.message).toContain('[S0003][P0002] build: フェーズ連結形');
  });

  it('detects malformed subjects (a bare [P####], a concatenated form with no space, too few digits)', () => {
    const { out } = runCorpus(
      git2,
      [],
      gitInfo({
        commits: [
          { hash: 'd'.repeat(40), subject: '[P0002] フェーズのみ' },
          { hash: 'e'.repeat(40), subject: '[S0003][P0002]空白なし' },
          { hash: 'f'.repeat(40), subject: '[S003] 桁不足' },
        ],
      }),
    );
    expect(out).toHaveLength(3);
  });

  it('reports a repo-anchored warning carrying the subject when the prefix is missing', () => {
    const { out } = runCorpus(
      git2,
      [],
      gitInfo({
        commits: [
          { hash: '1234567abcdef'.padEnd(40, '0'), subject: 'fix typo' },
          { hash: 'b'.repeat(40), subject: '[S0001] 実装' },
        ],
      }),
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.anchor).toEqual({ kind: 'repo' });
    expect(out[0]?.message).toContain('1234567');
    expect(out[0]?.message).toContain('fix typo');
  });

  describe('sinceCommit (where the check starts)', () => {
    // commits is newest first (corpus/git.ts): new (a violation) -> boundary (from before the convention) -> old (from before the convention)
    const history = [
      { hash: 'f'.repeat(40), subject: 'newest without prefix' },
      { hash: 'abc1234'.padEnd(40, '0'), subject: '[S0003][P0002] build: 境界(旧規約の最後)' },
      { hash: 'e'.repeat(40), subject: '[S0001][P0001] research: 旧規約' },
    ];

    it('exempts sinceCommit itself and everything before it, checking only newer commits (an abbreviated hash matches by prefix)', () => {
      const { out, notices } = runCorpus(git2, [], gitInfo({ commits: history }), {
        sinceCommit: 'abc1234',
      });
      expect(out).toHaveLength(1);
      expect(out[0]?.message).toContain('newest without prefix');
      expect(notices).toEqual([]);
    });

    it('accepts a full 40-digit hash and upper-case hex', () => {
      const { out } = runCorpus(git2, [], gitInfo({ commits: history }), {
        sinceCommit: 'ABC1234'.padEnd(40, '0'),
      });
      expect(out).toHaveLength(1);
    });

    it('fails open when it cannot be found (everything is checked) and emits a notice', () => {
      const { out, notices } = runCorpus(git2, [], gitInfo({ commits: history }), {
        sinceCommit: '0123456789abcdef0123456789abcdef01234567',
      });
      expect(out).toHaveLength(3); // The 2 concatenated-form commits from before the boundary come back into scope
      expect(notices).toHaveLength(1);
      expect(notices[0]).toContain('Could not find `sinceCommit`');
    });

    it('fails open on a malformed value (not hex, too few digits) and emits a notice', () => {
      for (const bad of ['abc123', 'not-a-hash', 42]) {
        const { out, notices } = runCorpus(git2, [], gitInfo({ commits: history }), {
          sinceCommit: bad,
        });
        expect(out).toHaveLength(3);
        expect(notices).toHaveLength(1);
        expect(notices[0]).toContain('Ignored the invalid `sinceCommit` value');
      }
    });
  });
});

describe('GIT-4: the label vocabulary check', () => {
  it('stays silent on vocabulary labels, on subjects with no label, and on prose-like leads', () => {
    const { out } = runCorpus(
      git4,
      [],
      gitInfo({
        commits: [
          { hash: 'a'.repeat(40), subject: '[S0001] research: R0001 調査' },
          { hash: 'b'.repeat(40), subject: '[S0001] session-close: 記録を確定' },
          { hash: 'c'.repeat(40), subject: '[S0001] ラベルなしの実装' },
          { hash: 'd'.repeat(40), subject: '[S0001] R0001: 大文字始まりは散文であってラベルではない' },
        ],
      }),
    );
    expect(out).toEqual([]);
  });

  it('skips subjects without the [S####] prefix (those are GIT-2 findings) and stays silent without git', () => {
    expect(runCorpus(git4, [], null).out).toEqual([]);
    const { out } = runCorpus(
      git4,
      [],
      gitInfo({ commits: [{ hash: 'a'.repeat(40), subject: 'close: 接頭辞なし' }] }),
    );
    expect(out).toEqual([]);
  });

  it('reports a repo-anchored warning for an off-vocabulary label (`close:`, `phase:`)', () => {
    const { out } = runCorpus(
      git4,
      [],
      gitInfo({
        commits: [
          { hash: 'a'.repeat(40), subject: '[S0001] close: 旧称' },
          { hash: 'b'.repeat(40), subject: '[S0002] phase: 旧称' },
        ],
      }),
    );
    expect(out).toHaveLength(2);
    expect(out[0]?.anchor).toEqual({ kind: 'repo' });
    expect(out[0]?.message).toContain('[S0001] close: 旧称');
    expect(out[0]?.suggestion).toContain('session-close');
  });

  it('lets options.labels replace the vocabulary, and falls open to the defaults on an invalid value', () => {
    const commits = [{ hash: 'a'.repeat(40), subject: '[S0001] deploy: 独自ラベル' }];
    expect(runCorpus(git4, [], gitInfo({ commits }), { labels: ['deploy'] }).out).toEqual([]);
    const replaced = runCorpus(
      git4,
      [],
      gitInfo({ commits: [{ hash: 'b'.repeat(40), subject: '[S0001] build: 置換で語彙落ち' }] }),
      { labels: ['deploy'] },
    );
    expect(replaced.out).toHaveLength(1);
    const invalid = runCorpus(git4, [], gitInfo({ commits }), { labels: 'deploy' });
    expect(invalid.out).toHaveLength(1); // the defaults do not know 'deploy'
    expect(invalid.notices).toHaveLength(1);
    expect(invalid.notices[0]).toContain('Ignored the invalid `labels` value');
  });

  it('exempts sinceCommit itself and everything before it (the same semantics as GIT-2)', () => {
    const history = [
      { hash: 'f'.repeat(40), subject: '[S0003] close: 切替後に残った旧称' },
      { hash: 'abc1234'.padEnd(40, '0'), subject: '[S0002] close: 境界(旧称の最後)' },
      { hash: 'e'.repeat(40), subject: '[S0001] phase: 古い旧称' },
    ];
    const { out, notices } = runCorpus(git4, [], gitInfo({ commits: history }), {
      sinceCommit: 'abc1234',
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.message).toContain('切替後に残った旧称');
    expect(notices).toEqual([]);
  });
});

describe('GIT-5: the trailing-period check', () => {
  it('stays silent on subjects with no trailing period and skips non-prefixed subjects', () => {
    const { out } = runCorpus(
      git5,
      [],
      gitInfo({
        commits: [
          { hash: 'a'.repeat(40), subject: '[S0001] build: 終止符なし' },
          { hash: 'b'.repeat(40), subject: 'no prefix, with a period.' },
        ],
      }),
    );
    expect(out).toEqual([]);
    expect(runCorpus(git5, [], null).out).toEqual([]);
  });

  it('reports both the ASCII period and the Japanese full stop, repo-anchored', () => {
    const { out } = runCorpus(
      git5,
      [],
      gitInfo({
        commits: [
          { hash: 'a'.repeat(40), subject: '[S0001] build: implement the parser.' },
          { hash: 'b'.repeat(40), subject: '[S0002] build: パーサを実装。' },
        ],
      }),
    );
    expect(out).toHaveLength(2);
    expect(out[0]?.anchor).toEqual({ kind: 'repo' });
    expect(out[0]?.message).toContain('implement the parser.');
  });

  it('exempts sinceCommit itself and everything before it (the same semantics as GIT-2)', () => {
    const history = [
      { hash: 'f'.repeat(40), subject: '[S0003] build: 切替後の違反。' },
      { hash: 'abc1234'.padEnd(40, '0'), subject: '[S0002] build: 境界。' },
    ];
    const { out } = runCorpus(git5, [], gitInfo({ commits: history }), { sinceCommit: 'abc1234' });
    expect(out).toHaveLength(1);
    expect(out[0]?.message).toContain('切替後の違反');
  });
});

describe('GIT-3: a tracked file that matches .gitignore', () => {
  it('stays silent when there is no match or git is absent', () => {
    expect(runCorpus(git3, [], gitInfo()).out).toEqual([]);
    expect(runCorpus(git3, [], null).out).toEqual([]);
  });

  it('reports an error per matching file (pointing at git rm --cached)', () => {
    const { out } = runCorpus(git3, [], gitInfo({ ignoredTracked: ['dist/main.js'] }));
    expect(out).toHaveLength(1);
    expect(out[0]?.anchor).toEqual({ kind: 'file', file: 'dist/main.js' });
    expect(out[0]?.suggestion).toContain('git rm --cached dist/main.js');
  });
});

describe('REF-3(a): the volatile vocabulary plus a required following segment', () => {
  it('reports an error for a volatile path in the Method of a done file (showing the token)', () => {
    const result = runCorpus(ref3, [doneResearch(['- スクリプト: scratchpad/regen.py で再生成'])], null);
    expect(result.out).toHaveLength(1);
    expect(result.out[0]?.message).toContain('scratchpad/regen.py');
  });

  it('does not flag defining or mentioning the vocabulary (four ways a record does it)', () => {
    const lines = [
      '- 暫定解釈: 既定語彙 = scratchpad/・/tmp・%TEMP%・%TMP%・AppData/Local/Temp・C:\\Windows\\Temp・$TMPDIR。設定で追加・置換可能',
      '- 違反: scratchpad・OS 一時領域(/tmp、%TEMP%、AppData/Local/Temp 等)への参照',
      '- OSS はローカルクローン(scratchpad、揮発 — 出典はリポジトリ URL+ファイルパスで記録)',
      '- 出典: SKILL.md:44(「scratchpad 等の揮発領域」)',
    ];
    expect(runCorpus(ref3, [doneResearch(lines)], null).out).toEqual([]);
  });

  it('also detects %TEMP% with a backslash separator and $TMPDIR', () => {
    const { out } = runCorpus(
      ref3,
      [doneResearch(['- 生成先: %TEMP%\\bench.json と $TMPDIR/data.csv'])],
      null,
    );
    expect(out).toHaveLength(2);
  });

  it('leaves /tmp as an intermediate segment (build/tmp/x), a file that is not done, and anything outside Method and Results out of scope', () => {
    expect(
      runCorpus(ref3, [doneResearch(['- 生成先: build/tmp/cache.json'])], null).out,
    ).toEqual([]);
    expect(
      runCorpus(ref3, [doneResearch(['- scratchpad/x.py'], 'running')], null).out,
    ).toEqual([]);
    // Every test here also confirms that the scratchpad/out-of-scope.py in Conclusion (always present in doneResearch) goes undetected
  });

  it('drops an entry that is empty once its separators are gone — with a notice through validateOptions, silently on a direct call', () => {
    // "/" would otherwise become an empty root that matches every `/word` after a non-word character (a URL, say)
    const notices: string[] = [];
    const validated = ref3.validateOptions?.({ volatilePatterns: ['scratchpad', '/', '\\', '', '/'] }, (m) => notices.push(m));
    expect(validated?.['volatilePatterns']).toEqual(['scratchpad']);
    expect(notices).toEqual([
      'REF-3: Ignored the empty entry `"/"` in `volatilePatterns` — a root has to have something before its trailing separator.',
      'REF-3: Ignored the empty entry `"\\\\"` in `volatilePatterns` — a root has to have something before its trailing separator.',
      'REF-3: Ignored the empty entry `""` in `volatilePatterns` — a root has to have something before its trailing separator.',
    ]);
    const none: string[] = [];
    expect(ref3.validateOptions?.({ volatilePatterns: ['/'] }, (m) => none.push(m))?.['volatilePatterns']).toEqual([]);
    expect(none.at(-1)).toBe('REF-3: `volatilePatterns` has no usable entry, so the volatile-location check is off for this run.');
    const quiet: string[] = [];
    expect(ref3.validateOptions?.({ volatilePatterns: ['ramdisk/'] }, (m) => quiet.push(m))?.['volatilePatterns']).toEqual(['ramdisk/']);
    expect(quiet).toEqual([]);
    // The check itself never runs on an empty root
    const { out } = runCorpus(ref3, [doneResearch(['- 出典: https://example.com/page と scratchpad/y.py'])], null, {
      volatilePatterns: ['/'],
    });
    expect(out).toEqual([]);
  });

  it('lets volatilePatterns replace the vocabulary (the defaults drop out and a custom root comes into scope)', () => {
    const { out } = runCorpus(
      ref3,
      [doneResearch(['- ramdisk/x.bin と scratchpad/y.py'])],
      null,
      { volatilePatterns: ['ramdisk'] },
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.message).toContain('ramdisk/x.bin');
  });
});

describe('REF-3(b): the untracked check for a path reference inside roadmap/', () => {
  const research = doneResearch(['- 計測スクリプト: `roadmap/assets/R0001/gen.py`']);

  it('reports an error for a path that exists but is untracked', () => {
    const { out } = runCorpus(ref3, [research], gitInfo());
    expect(out).toHaveLength(1);
    expect(out[0]?.message).toContain('is not tracked by git');
    expect(out[0]?.message).toContain('roadmap/assets/R0001/gen.py');
  });

  it('stays silent when it is tracked, when it is missing (that belongs to REF-2), and when git is absent', () => {
    expect(
      runCorpus(ref3, [research], gitInfo({ trackedFiles: new Set(['roadmap/assets/R0001/gen.py']) }))
        .out,
    ).toEqual([]);
    expect(runCorpus(ref3, [research], gitInfo(), {}, () => false).out).toEqual([]);
    expect(runCorpus(ref3, [research], null).out).toEqual([]);
  });

  it('leaves a mention of a directory (no extension) and anything outside roadmap/ out of scope', () => {
    const file = doneResearch([
      '- 置き場: `roadmap/assets/R0001/`(ディレクトリ)',
      '- コード: `src/main.ts`',
    ]);
    expect(runCorpus(ref3, [file], gitInfo()).out).toEqual([]);
  });
});

describe('the GIT rules and REF-3 on a temporary git repository', () => {
  const MINIMAL_TREE = {
    'roadmap/status.md': [
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
    ].join('\n'),
  };
  const gitRules = (rules: string[]) => (d: { rule: string }) => rules.includes(d.rule);

  it('reports no GIT diagnostics on a clean repository that follows the convention', () => {
    withTempGitRepo(
      MINIMAL_TREE,
      (repoDir) => {
        const result = lintDir(repoDir);
        expect(result.diagnostics.filter(gitRules(['GIT-1', 'GIT-2', 'GIT-3', 'REF-3']))).toEqual([]);
        expect(result.notices).toEqual([]);
      },
      '[S0001] init',
    );
  });

  it('uncommitted changes: a GIT-1 warning once closed, a notice while a session is open', () => {
    withTempGitRepo(
      MINIMAL_TREE,
      (repoDir) => {
        writeFileSync(path.join(repoDir, 'roadmap', 'extra.md'), '# 追記\n');
        const closed = lintDir(repoDir);
        const git1Diagnostics = closed.diagnostics.filter(gitRules(['GIT-1']));
        expect(git1Diagnostics).toHaveLength(1);
        expect(git1Diagnostics[0]?.anchor).toEqual({ kind: 'file', file: 'roadmap/extra.md' });

        // Per-rule config: enabled:false and the severity override take effect on GIT-1
        const disabled = lintDir(repoDir, { rules: { 'GIT-1': { enabled: false } } });
        expect(disabled.diagnostics.filter(gitRules(['GIT-1']))).toEqual([]);
        const escalated = lintDir(repoDir, { rules: { 'GIT-1': { severity: 'error' } } });
        expect(escalated.diagnostics.filter(gitRules(['GIT-1']))[0]?.severity).toBe('error');

        const statusPath = path.join(repoDir, 'roadmap', 'status.md');
        writeFileSync(
          statusPath,
          MINIMAL_TREE['roadmap/status.md'].replace('open_session: null', 'open_session: S0002'),
        );
        const open = lintDir(repoDir);
        expect(open.diagnostics.filter(gitRules(['GIT-1']))).toEqual([]);
        expect(open.notices.some((n) => n.includes('S0002'))).toBe(true);
      },
      '[S0001] init',
    );
  });

  it('GIT-2: leaves everything before the boundary and the boundary commit itself out of scope, and detects anything off-convention after it, the concatenated form included', () => {
    withTempGitRepo(
      { 'src/setup.ts': 'export {};\n' },
      (repoDir) => {
        const git = (...args: string[]) =>
          execFileSync('git', ['-C', repoDir, ...args], { encoding: 'utf8' });
        // Adding roadmap/ with a subject that has no S#### = the boundary commit (the equivalent of init's first commit — out of scope)
        mkdirSync(path.join(repoDir, 'roadmap'), { recursive: true });
        writeFileSync(path.join(repoDir, 'roadmap', 'status.md'), MINIMAL_TREE['roadmap/status.md']);
        git('add', '-A');
        git('commit', '-q', '-m', '[init] roadmap 初期化');
        expect(lintDir(repoDir).diagnostics.filter(gitRules(['GIT-2']))).toEqual([]);

        // After the boundary: on top of off-convention subjects, the [S####][P####] concatenated form is detected too
        writeFileSync(path.join(repoDir, 'roadmap', 'extra.md'), '# x\n');
        git('add', '-A');
        git('commit', '-q', '-m', 'second without prefix');
        writeFileSync(path.join(repoDir, 'roadmap', 'extra.md'), '# y\n');
        git('add', '-A');
        git('commit', '-q', '-m', '[S0002][P0001] build: 連結形');
        const connectedHash = git('rev-parse', 'HEAD').trim();
        const result = lintDir(repoDir);
        const git2Diagnostics = result.diagnostics.filter(gitRules(['GIT-2']));
        expect(git2Diagnostics).toHaveLength(2); // The first 'fixture' commit (setup) is before the boundary and the boundary itself is out of scope, leaving the off-convention one plus the concatenated one
        expect(git2Diagnostics.map((d) => d.message).join('\n')).toContain('second without prefix');
        expect(git2Diagnostics.map((d) => d.message).join('\n')).toContain('[S0002][P0001] build: 連結形');

        // sinceCommit = the concatenated-form commit (the last one before the convention) -> everything before it is exempt, leaving only S-only subjects and no diagnostics
        writeFileSync(path.join(repoDir, 'roadmap', 'extra.md'), '# z\n');
        git('add', '-A');
        git('commit', '-q', '-m', '[S0003] build: 切替後は S 単独形');
        const withSince = lintDir(repoDir, {
          rules: { 'GIT-2': { options: { sinceCommit: connectedHash } } },
        });
        expect(withSince.diagnostics.filter(gitRules(['GIT-2']))).toEqual([]);
        expect(withSince.notices.filter((n) => n.includes('GIT-2'))).toEqual([]);

        // Per-rule config
        const disabled = lintDir(repoDir, { rules: { 'GIT-2': { enabled: false } } });
        expect(disabled.diagnostics.filter(gitRules(['GIT-2']))).toEqual([]);
        const escalated = lintDir(repoDir, { rules: { 'GIT-2': { severity: 'error' } } });
        expect(escalated.diagnostics.filter(gitRules(['GIT-2']))[0]?.severity).toBe('error');
      },
      'fixture',
    );
  });

  it('GIT-4 and GIT-5: detect an off-vocabulary label and a trailing period on a real repository, with sinceCommit and per-rule config', () => {
    withTempGitRepo(
      MINIMAL_TREE,
      (repoDir) => {
        const git = (...args: string[]) =>
          execFileSync('git', ['-C', repoDir, ...args], { encoding: 'utf8' });
        writeFileSync(path.join(repoDir, 'roadmap', 'extra.md'), '# x\n');
        git('add', '-A');
        git('commit', '-q', '-m', '[S0002] close: 旧称ラベル');
        const oldNameHash = git('rev-parse', 'HEAD').trim();
        writeFileSync(path.join(repoDir, 'roadmap', 'extra.md'), '# y\n');
        git('add', '-A');
        git('commit', '-q', '-m', '[S0003] build: 終止符つき。');

        const result = lintDir(repoDir);
        const git4Diagnostics = result.diagnostics.filter(gitRules(['GIT-4']));
        const git5Diagnostics = result.diagnostics.filter(gitRules(['GIT-5']));
        expect(git4Diagnostics).toHaveLength(1);
        expect(git4Diagnostics[0]?.message).toContain('close: 旧称ラベル');
        expect(git5Diagnostics).toHaveLength(1);
        expect(git5Diagnostics[0]?.message).toContain('終止符つき。');

        // sinceCommit exempts the commit with the off-vocabulary label and everything before it (per rule — GIT-5 still reports)
        const withSince = lintDir(repoDir, {
          rules: { 'GIT-4': { options: { sinceCommit: oldNameHash } } },
        });
        expect(withSince.diagnostics.filter(gitRules(['GIT-4']))).toEqual([]);
        expect(withSince.diagnostics.filter(gitRules(['GIT-5']))).toHaveLength(1);

        // Per-rule config (enabled / severity)
        const disabled = lintDir(repoDir, {
          rules: { 'GIT-4': { enabled: false }, 'GIT-5': { enabled: false } },
        });
        expect(disabled.diagnostics.filter(gitRules(['GIT-4', 'GIT-5']))).toEqual([]);
        const escalated = lintDir(repoDir, { rules: { 'GIT-5': { severity: 'error' } } });
        expect(escalated.diagnostics.filter(gitRules(['GIT-5']))[0]?.severity).toBe('error');
      },
      '[S0001] init',
    );
  });

  it('GIT-3: detects a tracked file that was ignored later', () => {
    withTempGitRepo(
      { ...MINIMAL_TREE, 'gen.log': 'generated\n' },
      (repoDir) => {
        const git = (...args: string[]) =>
          execFileSync('git', ['-C', repoDir, ...args], { encoding: 'utf8' });
        writeFileSync(path.join(repoDir, '.gitignore'), '*.log\n');
        git('add', '.gitignore');
        git('commit', '-q', '-m', '[S0002] ignore logs');
        const result = lintDir(repoDir);
        const git3Diagnostics = result.diagnostics.filter(gitRules(['GIT-3']));
        expect(git3Diagnostics).toHaveLength(1);
        expect(git3Diagnostics[0]?.anchor).toEqual({ kind: 'file', file: 'gen.log' });

        // Per-rule config
        const disabled = lintDir(repoDir, { rules: { 'GIT-3': { enabled: false } } });
        expect(disabled.diagnostics.filter(gitRules(['GIT-3']))).toEqual([]);
        const softened = lintDir(repoDir, { rules: { 'GIT-3': { severity: 'warning' } } });
        expect(softened.diagnostics.filter(gitRules(['GIT-3']))[0]?.severity).toBe('warning');
      },
      '[S0001] init',
    );
  });

  it('REF-3(b): detects a reference inside roadmap/ that exists but is untracked', () => {
    const tree = {
      ...MINIMAL_TREE,
      'roadmap/research/R0001-x.md': [
        '---',
        'id: R0001',
        'type: research',
        'created: S0001',
        'completed: S0001',
        'phase: P0001',
        'status: done',
        'superseded_by: null',
        '---',
        '',
        '# R0001: x',
        '',
        '## Method',
        '- 計測スクリプト: `roadmap/assets/R0001/gen.py`',
        '',
        '## Results',
        '- 結果',
        '',
        '## Conclusion',
        '- 結論',
        '',
      ].join('\n'),
    };
    withTempGitRepo(
      tree,
      (repoDir) => {
        mkdirSync(path.join(repoDir, 'roadmap', 'assets', 'R0001'), { recursive: true });
        writeFileSync(path.join(repoDir, 'roadmap', 'assets', 'R0001', 'gen.py'), 'print(1)\n');
        const result = lintDir(repoDir);
        const found = result.diagnostics.filter(gitRules(['REF-3']));
        expect(found).toHaveLength(1);
        expect(found[0]?.message).toContain('roadmap/assets/R0001/gen.py');
      },
      '[S0001] init',
    );
  });

  it('skips the GIT rules outside a git repository and emits one notice', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'roadmap-lint-nogit-'));
    try {
      mkdirSync(path.join(dir, 'roadmap'), { recursive: true });
      writeFileSync(path.join(dir, 'roadmap', 'status.md'), MINIMAL_TREE['roadmap/status.md']);
      const result = lintDir(dir);
      expect(result.diagnostics.filter(gitRules(['GIT-1', 'GIT-2', 'GIT-3']))).toEqual([]);
      expect(result.notices.filter((n) => n.includes('Skipped git-dependent checks'))).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    }
  });
});

// ---- GIT-6: session records against git history ----

const fullHash = (prefix: string): string => prefix + 'f'.repeat(40 - prefix.length);

const sessionFile = (id: string, baseCommit: string, commits: string): ParsedFile =>
  make(`roadmap/phases/P0001-x/sessions/${id}.md`, [
    '---',
    `session: ${id}`,
    'phase: P0001',
    'date: 2026-07-01',
    'state: closed',
    `base_commit: ${baseCommit}`,
    `commits: ${commits}`,
    'artifacts: []',
    'roadmap_changed: false',
    '---',
    '',
    `# ${id}`,
  ]);

describe('GIT-6: session records against git history', () => {
  it('skips everything when git is absent', () => {
    expect(runCorpus(git6, [sessionFile('S0001', 'deadbee', '[deadbee]')], null).out).toEqual([]);
  });

  it('warns on a subject that names a session with no record, leniently about the lead form', () => {
    const { out } = runCorpus(
      git6,
      [sessionFile('S0001', 'null', '[]')],
      gitInfo({
        commits: [
          { hash: fullHash('aaaaaaa'), subject: '[S9999] build: 架空のセッション' },
          { hash: fullHash('bbbbbbb'), subject: '[S0001][P0001] build: 旧連結形は定義済みなら素通し' },
          { hash: fullHash('ccccccc'), subject: 'chore: prefix なしは GIT-2 の領分' },
        ],
        headHashes: [fullHash('aaaaaaa'), fullHash('bbbbbbb'), fullHash('ccccccc')].sort(),
      }),
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.severity).toBe('warning');
    expect(out[0]?.message).toContain('S9999');
  });

  it('exempts subjects at and before sinceCommit (same semantics as GIT-2)', () => {
    const { out } = runCorpus(
      git6,
      [],
      gitInfo({
        commits: [{ hash: fullHash('aaaaaaa'), subject: '[S9999] build: 免除される' }],
        headHashes: [fullHash('aaaaaaa')],
      }),
      { sinceCommit: 'aaaaaaa' },
    );
    expect(out).toEqual([]);
  });

  it('reports a base_commit and a commits entry that are not in the history', () => {
    const { out } = runCorpus(
      git6,
      [sessionFile('S0001', '0123456', '[deadbee]')],
      gitInfo({ headHashes: [fullHash('abc1234')] }),
    );
    expect(out).toHaveLength(2);
    expect(out[0]?.message).toContain('`base_commit` 0123456');
    expect(out[1]?.message).toContain('deadbee');
    expect(out[1]?.anchor).toMatchObject({ kind: 'range', file: 'roadmap/phases/P0001-x/sessions/S0001.md' });
  });

  it('reads the hash as written even when YAML would parse it as a number or a float', () => {
    const info = gitInfo({ headHashes: [fullHash('0795427'), fullHash('592e497')].sort() });
    expect(runCorpus(git6, [sessionFile('S0001', '592e497', '[0795427]')], info).out).toEqual([]);
  });

  it('accepts null base_commit and hashes that resolve by prefix', () => {
    const info = gitInfo({
      commits: [{ hash: fullHash('def5678'), subject: '[S0001] build: 正しい帰属' }],
      headHashes: [fullHash('abc1234'), fullHash('def5678')].sort(),
    });
    expect(runCorpus(git6, [sessionFile('S0001', 'null', '[abc1234, def5678]')], info).out).toEqual([]);
  });

  it('flags a commits entry whose subject belongs to another session (over-attribution)', () => {
    const info = gitInfo({
      commits: [
        { hash: fullHash('abc1234'), subject: '[S0002] build: 別セッションのコミット' },
        { hash: fullHash('def5678'), subject: '[S0001] build: 正しい帰属' },
      ],
      headHashes: [fullHash('abc1234'), fullHash('def5678')].sort(),
    });
    const { out } = runCorpus(
      git6,
      [sessionFile('S0001', 'def5678', '[abc1234, def5678]'), sessionFile('S0002', 'null', '[]')],
      info,
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.message).toContain('S0002');
    expect(out[0]?.severity).toBeUndefined();
  });

  it('skips the attribution check for a hash outside the collected range (a base-era commit)', () => {
    const { out } = runCorpus(
      git6,
      [sessionFile('S0001', 'null', '[abc1234]')],
      gitInfo({ headHashes: [fullHash('abc1234')] }),
    );
    expect(out).toEqual([]);
  });

  it('fails open on an unborn HEAD (headHashes empty), while the subject check still runs', () => {
    const { out } = runCorpus(
      git6,
      [sessionFile('S0001', 'deadbee', '[deadbee]')],
      gitInfo({ commits: [{ hash: fullHash('aaaaaaa'), subject: '[S9999] x' }] }),
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.severity).toBe('warning');
  });
});

// The minimal tree and the rule filter of the temporary-repository block above, for the GIT-7 block below
const STATUS_TREE = {
  'roadmap/status.md': [
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
  ].join('\n'),
};
const ofRule = (rules: string[]) => (d: { rule: string }) => rules.includes(d.rule);

describe('GIT-7: Parking Lot and Deferred items not revisited within maxAgeDays', () => {
  const NOW = new Date('2026-09-15T00:00:00Z');
  const day = (iso: string): number => Math.floor(new Date(iso).getTime() / 1000);
  const roadmap = (lines: string[]): ParsedFile =>
    make('roadmap/roadmap.md', [
      '---',
      'project: x',
      'updated: 2026-09-01',
      '---',
      '',
      '# Roadmap: x',
      '',
      '## Parking Lot',
      ...lines,
    ]);
  interface Stamp {
    hash: string;
    iso: string;
    tz?: string;
  }
  /** A history where every line of the file carries the same hash and date, then per-line overrides (0-based). */
  const historyOf = (
    file: ParsedFile,
    base: Stamp,
    overrides: Record<number, Stamp | 'uncommitted'> = {},
  ): LineHistory[] =>
    file.lines.map((_, line) => {
      const over = overrides[line];
      if (over === 'uncommitted') return { hash: UNCOMMITTED_HASH, committerTime: 0, committerTz: '' };
      const entry = over ?? base;
      return { hash: entry.hash, committerTime: day(entry.iso), committerTz: entry.tz ?? '+0000' };
    });
  const runGit7 = (
    file: ParsedFile,
    history: LineHistory[] | null,
    options: Record<string, unknown> = {},
    over: Partial<GitInfo> = {},
  ) => {
    const entries: CorpusEntry[] = [{ relPath: file.relPath, type: file.type }];
    const corpus = buildCorpusIndex(
      entries,
      [file],
      () => true,
      gitInfo({ lineHistory: () => history, ...over }),
    );
    const notices: string[] = [];
    const out =
      git7.checkCorpus?.({
        files: [file],
        corpus,
        options: { ...git7.defaultOptions, ...options },
        notice: (m) => notices.push(m),
        now: NOW,
      }) ?? [];
    return { out, notices };
  };
  const old: Stamp = { hash: 'a'.repeat(40), iso: '2026-07-01T00:00:00Z' }; // 76 days before NOW
  const fresh: Stamp = { hash: 'b'.repeat(40), iso: '2026-09-10T00:00:00Z' }; // 5 days before NOW
  const aged40: Stamp = { hash: 'd'.repeat(40), iso: '2026-08-06T00:00:00Z' }; // 40 days before NOW

  it('warns once per item older than maxAgeDays, dated by the newest line of the item, and stays silent under the limit', () => {
    const file = roadmap(['- 古い案(復帰条件: x)', '- 新しい案(復帰条件: y)']);
    const { out, notices } = runGit7(file, historyOf(file, old, { 9: fresh }));
    expect(notices).toEqual([]);
    expect(out).toHaveLength(1);
    expect(out[0]?.message).toBe(
      'This Parking Lot item has not been revisited for 76 days (last changed in aaaaaaa on 2026-07-01).',
    );
    expect(out[0]?.anchor).toEqual({
      kind: 'range',
      file: 'roadmap/roadmap.md',
      range: { start: { line: 8, character: 0 }, end: { line: 8, character: 14 } },
    });
    expect(out[0]?.suggestion).toContain('keep it');
    expect(git7.defaultSeverity).toBe('warning');
  });

  it('exactly maxAgeDays is normal, a partial day rounds down, and options.maxAgeDays moves the limit', () => {
    const file = roadmap(['- 案']);
    const at30: Stamp = { hash: 'c'.repeat(40), iso: '2026-08-16T00:00:00Z' }; // 30 days before NOW
    expect(runGit7(file, historyOf(file, at30)).out).toEqual([]);
    // 30 days and 18 hours is still 30 days
    const at30h: Stamp = { hash: 'c'.repeat(40), iso: '2026-08-15T06:00:00Z' };
    expect(runGit7(file, historyOf(file, at30h)).out).toEqual([]);
    const at31: Stamp = { hash: 'c'.repeat(40), iso: '2026-08-14T23:00:00Z' }; // 31 days and 1 hour
    expect(runGit7(file, historyOf(file, at31)).out[0]?.message).toContain('for 31 days');
    expect(runGit7(file, historyOf(file, old), { maxAgeDays: 100 }).out).toEqual([]);
    expect(runGit7(file, historyOf(file, at30), { maxAgeDays: 10 }).out).toHaveLength(1);
  });

  it("prints the date in the committer's own zone, and the singular for one day", () => {
    const file = roadmap(['- 案']);
    // 2026-06-30T23:30Z is already 2026-07-01 at +09:00 — what `git log --date=short` shows
    const late: Stamp = { hash: 'e'.repeat(40), iso: '2026-06-30T23:30:00Z', tz: '+0900' };
    expect(runGit7(file, historyOf(file, late)).out[0]?.message).toContain('on 2026-07-01)');
    const west: Stamp = { hash: 'e'.repeat(40), iso: '2026-07-01T02:00:00Z', tz: '-0500' };
    expect(runGit7(file, historyOf(file, west)).out[0]?.message).toContain('on 2026-06-30)');
    const oneDay: Stamp = { hash: 'e'.repeat(40), iso: '2026-09-14T00:00:00Z' };
    expect(runGit7(file, historyOf(file, oneDay), { maxAgeDays: 0 }).out[0]?.message).toContain(
      'for 1 day (',
    );
  });

  it('treats an item with a line changed in the working tree as revisited (0 days), and anchors a multi-line item on all its lines', () => {
    const file = roadmap([
      '- 古い案の 1 行目',
      '  続きの行(作業ツリーで書き直し中)',
      '- 別の古い案',
      '  - 入れ子の箇条書きは継続行(こちらは新しい)',
      '- 三つ目の古い案',
      '  続きも古い',
    ]);
    const { out } = runGit7(file, historyOf(file, old, { 9: 'uncommitted', 11: fresh }));
    expect(out).toHaveLength(1);
    expect(out[0]?.anchor).toMatchObject({
      range: { start: { line: 12, character: 0 }, end: { line: 13, character: '  続きも古い'.length } },
    });
  });

  it('delimits items the way Markdown does: a one-space-indented bullet is a sibling, a later paragraph belongs to its item, a bullet inside an HTML comment is not an item', () => {
    const file = roadmap([
      '- A(古い)',
      ' - B(1 字下げ = 同じ階層の別項目・新しい)',
      '',
      '- C(古い)',
      '',
      '  C の 2 段落目(作業ツリーで書き直し中)',
      '<!--',
      '- コメント内の箇条書き(古い)',
      '-->',
    ]);
    const { out } = runGit7(file, historyOf(file, old, { 9: fresh, 13: 'uncommitted' }));
    expect(out).toHaveLength(1);
    expect(out[0]?.anchor).toMatchObject({ range: { start: { line: 8 }, end: { line: 8 } } });
  });

  it('skips a placeholder bullet and a code block, and reads the Deferred section too', () => {
    const file = make('roadmap/roadmap.md', [
      '---',
      'project: x',
      'updated: 2026-09-01',
      '---',
      '',
      '# Roadmap: x',
      '',
      '## Parking Lot',
      '- (なし)',
      '```',
      '- フェンス内は対象外',
      '```',
      '',
      '## Deferred',
      '- (D) 見送った指摘(出所 S0001 / 復帰条件: z)',
    ]);
    const { out } = runGit7(file, historyOf(file, old));
    expect(out).toHaveLength(1);
    expect(out[0]?.message).toContain('This Deferred item');
    expect(out[0]?.anchor).toMatchObject({ range: { start: { line: 14 } } });
  });

  it('skips with a notice when the file has no history, when the repository is shallow, or when blame does not line up with the file; stays silent without git or without roadmap.md', () => {
    const file = roadmap(['- 案']);
    const untracked = runGit7(file, null);
    expect(untracked.out).toEqual([]);
    expect(untracked.notices).toHaveLength(1);
    expect(untracked.notices[0]).toContain('no git history');
    const shallow = runGit7(file, historyOf(file, old), {}, { shallow: true });
    expect(shallow.out).toEqual([]);
    expect(shallow.notices[0]).toContain('shallow clone');
    const short = runGit7(file, historyOf(file, old).slice(0, -1));
    expect(short.out).toEqual([]);
    expect(short.notices[0]).toContain('reports 8 lines');
    expect(runCorpus(git7, [file], null).out).toEqual([]);
    expect(runCorpus(git7, [rootStatus('null')], gitInfo()).out).toEqual([]);
  });

  it('falls open to the default on an invalid maxAgeDays and emits a notice', () => {
    const file = roadmap(['- 案']);
    // 40 days old: past the default 30, but inside what a lenient reading of the invalid value would accept
    for (const bad of ['100', -1, Number.NaN]) {
      const { out, notices } = runGit7(file, historyOf(file, aged40), { maxAgeDays: bad });
      expect(out, String(bad)).toHaveLength(1);
      expect(notices).toHaveLength(1);
      expect(notices[0]).toContain('Ignored the invalid `maxAgeDays` value');
    }
  });

  it('on a real repository: dates an item by its last commit, resets on a rewrite, and takes per-rule config', () => {
    const roadmapText = (item: string) =>
      [
        '---',
        'project: x',
        'updated: 2026-08-01',
        '---',
        '',
        '# Roadmap: x',
        '',
        '## Vision',
        'x',
        '## Principles',
        '- x',
        '## Phases',
        '### P0001: x — active',
        '- type: build',
        '- goal: x',
        '## Blockers',
        '(none)',
        '## Parking Lot',
        item,
        '## Deferred',
        '- (none)',
        '',
      ].join('\n');
    withTempGitRepo(
      STATUS_TREE,
      (repoDir) => {
        const git = (args: string[], date?: string) =>
          execFileSync('git', ['-C', repoDir, ...args], {
            encoding: 'utf8',
            env: date
              ? { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }
              : process.env,
          });
        const roadmapPath = path.join(repoDir, 'roadmap', 'roadmap.md');
        writeFileSync(roadmapPath, roadmapText('- 古い案(復帰条件: x)'));
        // Untracked: skipped with a notice
        const untracked = lintDir(repoDir, {}, { now: NOW });
        expect(untracked.diagnostics.filter(ofRule(['GIT-7']))).toEqual([]);
        expect(untracked.notices.some((n) => n.startsWith('GIT-7'))).toBe(true);

        git(['add', '-A']);
        git(['commit', '-q', '-m', '[S0002] build: 案を追加'], '2026-07-01T00:00:00+00:00');
        const hash = git(['rev-parse', '--short=7', 'HEAD']).trim();
        const aged = lintDir(repoDir, {}, { now: NOW });
        const found = aged.diagnostics.filter(ofRule(['GIT-7']));
        expect(found).toHaveLength(1);
        expect(found[0]?.severity).toBe('warning');
        expect(found[0]?.message).toBe(
          `This Parking Lot item has not been revisited for 76 days (last changed in ${hash} on 2026-07-01).`,
        );
        expect(found[0]?.anchor).toMatchObject({
          kind: 'range',
          file: 'roadmap/roadmap.md',
          range: { start: { line: 18 } },
        });

        // Rewriting the line in the working tree = revisited now
        writeFileSync(roadmapPath, roadmapText('- 古い案(復帰条件を見直した: y)'));
        expect(lintDir(repoDir, {}, { now: NOW }).diagnostics.filter(ofRule(['GIT-7']))).toEqual([]);
        // ... and once committed, the clock runs from that commit
        git(['add', '-A']);
        git(['commit', '-q', '-m', '[S0003] build: 案を見直し'], '2026-09-10T00:00:00+00:00');
        expect(lintDir(repoDir, {}, { now: NOW }).diagnostics.filter(ofRule(['GIT-7']))).toEqual([]);
        const later = new Date('2026-11-01T00:00:00Z');
        expect(
          lintDir(repoDir, {}, { now: later }).diagnostics.filter(ofRule(['GIT-7']))[0]?.message,
        ).toContain('52 days');

        // Per-rule config: enabled / severity / options
        const disabled = lintDir(repoDir, { rules: { 'GIT-7': { enabled: false } } }, { now: later });
        expect(disabled.diagnostics.filter(ofRule(['GIT-7']))).toEqual([]);
        const escalated = lintDir(repoDir, { rules: { 'GIT-7': { severity: 'error' } } }, { now: later });
        expect(escalated.diagnostics.filter(ofRule(['GIT-7']))[0]?.severity).toBe('error');
        const widened = lintDir(
          repoDir,
          { rules: { 'GIT-7': { options: { maxAgeDays: 60 } } } },
          { now: later },
        );
        expect(widened.diagnostics.filter(ofRule(['GIT-7']))).toEqual([]);
      },
      '[S0001] init',
    );
  });
});
