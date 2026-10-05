import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * What a command prints for the person keeps one shape (SKILL.md ground rule 12): seven parts, a
 * fixed skeleton per scene, one word per thing. None of that is a lint rule — the lint reads the
 * records, not the conversation — so the only thing a test can hold still is the prose that fixes
 * the shape. These tests pin the places where that prose is easy to break by accident: the parts
 * table, every row of the words tables, the single definition of the five frames, the skeleton of
 * the block that opens a session, and the way a reply ends — and what a through-run found still
 * varying from run to run: the words for a state value and a stock option, the named items of a
 * design check's appendix, and the question of a plan review that overturns a decision.
 */

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));

function read(...rel: string[]): string {
  // A checkout with autocrlf on reads the prose back with CRLF — the section anchors below assume LF
  return readFileSync(path.join(repoRoot, ...rel), 'utf8').replace(/\r\n/g, '\n');
}

const skill = read('plugin', 'skills', 'roadmap', 'SKILL.md');
const workflows = read('plugin', 'skills', 'roadmap', 'references', 'workflows.md');
const schemas = read('plugin', 'skills', 'roadmap', 'references', 'schemas.md');

/** One line of prose, for the presence checks that follow. */
function lineOf(text: string, startsWith: string, where: string): string {
  const line = text.split('\n').find((l) => l.startsWith(startsWith));
  if (!line) throw new Error(`No line starting with ${JSON.stringify(startsWith)} in ${where}`);
  return line;
}

/**
 * One `##` or `###` section of workflows.md, heading line included. It ends at the next `##` / `###`
 * heading outside a code fence — the skeletons are fenced samples that carry headings of their own.
 */
function subsection(headingStart: string): string {
  const lines = workflows.split('\n');
  const start = lines.findIndex((l) => l.startsWith(headingStart));
  if (start < 0) throw new Error(`No subsection starting with ${JSON.stringify(headingStart)} in workflows.md`);
  let fenced = false;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (/^\s*```/.test(line)) fenced = !fenced;
    else if (!fenced && /^#{2,3} /.test(line)) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

/** The cells of every body row of the tables in a block of prose — header and separator rows left out. */
function bodyRows(block: string): string[][] {
  const lines = block.split('\n');
  return lines
    .filter((line, i) => line.startsWith('| ') && !/^\|\s*-/.test(lines[i + 1] ?? ''))
    .map((line) => line.split('|').slice(1, -1).map((cell) => cell.trim()));
}

/**
 * The options the fenced skeleton between two anchors offers: its `**Your options**:` lines, in
 * their order, without the mark on the recommended one.
 */
function fencedOptions(from: string, to: string): string[] {
  const start = workflows.indexOf(from);
  if (start < 0) throw new Error(`No ${JSON.stringify(from)} in workflows.md`);
  const end = workflows.indexOf(to, start);
  if (end < 0) throw new Error(`No ${JSON.stringify(to)} after ${JSON.stringify(from)} in workflows.md`);
  return [...workflows.slice(start, end).matchAll(/^ *\*\*Your options\*\*: (.+)$/gm)].map((m) =>
    (m[1] ?? '').replace(' (recommended)', ''),
  );
}

/** The five labels of `Now`, read from the one place that defines them: the root status.md template. */
function frameLabels(): string[] {
  const start = schemas.indexOf('\n## Now\n');
  if (start < 0) throw new Error('The status.md template has no `## Now` in schemas.md');
  const body = schemas.slice(start + 1).split('\n## Next')[0] ?? '';
  return [...body.matchAll(/^- \*\*(.+?)\*\*:/gm)].map((m) => m[1] ?? '');
}

/** Japanese text: kana, ideographs, and the punctuation and full-width forms that come with them. */
const range = (from: number, to: number): string => `${String.fromCodePoint(from)}-${String.fromCodePoint(to)}`;
const JAPANESE = new RegExp(`[${range(0x3000, 0x9fff)}${range(0xf900, 0xfaff)}${range(0xff00, 0xffef)}]`);

describe('the shape of what the person reads', () => {
  const section = subsection('### What the person reads');
  const [partsBlock = '', wordsBlock = ''] = section.split('**The words.**');

  it('workflows.md names the seven parts every printout is built from', () => {
    expect(bodyRows(partsBlock).map((cells) => cells[0])).toEqual([
      'Title',
      'Five frames',
      'Phase lines',
      'Question block',
      'Held-back point',
      'Appendix',
      'End',
    ]);
  });

  it('the words tables fix every printed label and its Japanese word', () => {
    // Printed label → Japanese, row by row over both tables. The words were chosen with the user,
    // so a changed row fails here until the change is made on purpose
    expect(bodyRows(wordsBlock).map((cells) => [cells[1], cells[2]])).toEqual([
      ['Goal / Why / Outcome', '目的 / 理由 / 成果'],
      ['Checks', '検査項目'],
      ['passed / failed', '合格 / 不合格'],
      ['verification / verifier', '検証 / 検証者'],
      ['Depends on', '前提のフェーズ'],
      ['research / decision / build / experiment', '調査 / 決定 / 実装 / 実験'],
      ['done / now / ahead', '済み / いま / これから'],
      ['contract draft / settled', '契約の案 / 確定'],
      ['The finished product', '完成の姿'],
      ['Principles', '方針'],
      ['The shelves: parked ideas / deferred findings', '棚: 計画の外の案 / 先送りした指摘'],
      ['keep / promote / drop', '保持 / 昇格 / 削除'],
      ['adopted / rejected / deferred', '採用 / 却下 / 先送り'],
      ['all handled', 'すべて処置済み'],
      ['This session', '今回の予定'],
      ['The plan', '計画'],
      ['Records check', '記録の点検'],
      ['the labels of the `Now` template', '状況 / 順調か / 完成品への影響 / 問題 / 妥協・計画変更の要否'],
      ['`<scene> — <n> questions` (`no questions`) / Recommendation / Your options / (recommended)', '<場面> — 伺うことは n つです(伺うことはありません)/ 推奨 / 選べること / (推奨)'],
      ['Effect on the finished product / Records involved / What would be overturned / An option that overturns nothing / Recommendation', '完成品への影響 / 関わる記録 / 覆るもの / 覆さない案 / 推奨'],
      ['Design check / Before closing / Mid-session check', '設計の確認 / 閉じる前の確認 / 途中の確認'],
      ['Before starting', '始める前の確認'],
      ['Appendix (only if you want to check)', '付録(確かめたいときだけ)'],
      ['Grounds for `<n>` / Records for `<n>` / Material for `<n>` / Checks for `<n>` (what the AI verifies)', 'n の根拠 / n の記録 / n の材料 / n の検査項目(AI が確かめる条件)'],
      ['Check / Verdict / Grounds', '検査項目 / 判定 / 根拠'],
      ['Decided / Verified / Records / Commits', '決めたこと / 確かめたこと / 記録 / コミット'],
      ['`S#### opened` / This phase\'s outcome (This phase\'s goal) / This session / Questions: none (`<n>` follow)', 'S#### を開きました / このフェーズの成果(このフェーズの目的)/ 今回の予定 / 伺うこと: ありません(n つあります)'],
      ['`S#### closed` / Plan revised / Phase closed / Plan created', 'S#### を閉じました / 計画を見直しました / フェーズを閉じました / 計画を作りました'],
      ['The whole plan / The proposed plan / Phases (in this order) / Checks for the first two phases / Principles, and ideas kept off the plan / What gets generated / What was made / Working rules', '全体の計画 / 計画の案 / フェーズ(この順に進めます)/ 最初の 2 フェーズの検査項目 / 方針と、計画の外に置く案 / 作るもの / 作ったもの / 運用のきまり'],
      ['Start with this plan / Adjust', 'この内容で始める / 直す'],
      ['Plan review / What changes / Until now / This proposal / Proposed new phase', '計画の見直し / 変わること / これまで / この案 / 新しいフェーズの案'],
      ['Change the plan as proposed / Leave the plan as it is', 'この案で計画を直す / 直さない'],
      ['Phase boundary / The phase that ended / What was promised / Result — the outcome holds (does not hold) / Not verified / The next phase / Proposal', 'フェーズの区切り / 終わったフェーズ / 約束していたこと / 結果 — 成果は成り立っています(成り立っていません)/ 確かめていないこと / 次のフェーズ / 案'],
      ['Accept and close / Change the plan / Carry the phase on', '受け入れて閉じる / 計画を変える / このフェーズを続ける'],
      ['Start as proposed / Adjust', 'この内容で始める / 直す'],
      ['Shelf review', '棚の見直し'],
      ['Drop / Keep / Promote', '削除する / 保持する / 昇格する'],
      ['Decision / Angle (the first column of the comparison table)', '決めること / 比べる点'],
      ['What it will do / Contract drafts / File layout / Settled without asking', '出来上がるものの振る舞い / 契約の案 / ファイルの構成 / 問わずに決めること'],
      ['In progress (not finished yet) / Waiting for / Your action / If the conversation ends', '途中(まだ終わっていません)/ 待っているもの / あなたの操作 / 会話が切れたら'],
      ['Independent review — waiting for the reply / Phase boundary — waiting for the verification', '独立レビュー — 返事を待っています / フェーズの区切り — 検証を待っています'],
      ['Where the project stands / Stopped or worrying / Phases: done, now, ahead', 'いまの状況 / 止まっているもの・気がかり / フェーズ: 済み・いま・これから'],
      ['Records check — `<n>` findings need action (nothing needs action) / Where / What is happening / What to do / Breakdown: mechanical check, meaning check / What happens to this result', '記録の点検 — 対応が要るものは n 件です(対応が要るものはありません)/ 場所 / 起きていること / どうするか / 内訳: 機械の点検・意味の点検 / この結果の扱い'],
      ['`S####` was left open — now closed (from an earlier conversation) / What the records showed / Uncommitted work / What could not be told', '開いたままだった S#### を閉じました(前の会話の続き)/ 記録から分かったこと / コミットされていなかった作業 / 分からなかったこと'],
    ]);
  });

  it('a record key is never a printed label, from the entry point down', () => {
    const rule12 = lineOf(skill, '12. **What the person reads keeps one shape**', 'SKILL.md');
    expect(rule12).toContain('never printed as a label');
    expect(rule12).toContain('§ What the person reads');
    expect(skill).toContain('is a key, not a label');
    expect(section).toContain(
      'A record key (`goal`, `why`, `outcome`, `acceptance`, `depends`), a path, and a command do not appear in the body',
    );
    expect(section).toContain('**One word per thing**');
    expect(section).toContain('**Nothing outside the skeleton**');
  });

  it('a state value, a section name, and a stock option take the word the tables give', () => {
    // Where the tables had no word, two runs of the same skill printed different ones
    expect(section).toContain(
      'The tables also give the word for what a record spells in English — the state of a phase (`done`, `active`, `planned`) and of a contract (`draft`, `stable`), the name of a section (`Principles`, `Parking Lot`): print the word the tables give, not a copy of the record',
    );
    expect(section).toContain(
      "A state word shows where a thing stands; a sentence that tells a change of state says what happened, in the person's words",
    );
    expect(section).toContain(
      "The options of the questions every project meets in the same form — at `init`, in a `replan`, at `phase close`, for a shelf item — are fixed words too, listed in the tables: an option that does not apply is left out (`Accept and close` while a check has failed), and one the scene adds is said in the person's words",
    );
    expect(section).toContain(
      "Where the tables have no word — another state (a `blocked` or `dropped` phase, a `deprecated` contract, the `status` of a research or experiment file), the candidates of a decision, the options of a held-back point, of the guard rail of `start`, of the findings `doctor` left, or of several shelf items at once — say it in the person's words",
    );
    expect(skill).toContain("A state value (`draft`, `active`) is the record's spelling in the same way");
  });

  it('the rows for a state, a stock option, and a wait say what they stand for', () => {
    // The first column ties a printed word to the record value or the scene it belongs to
    const rows = bodyRows(wordsBlock);
    for (const row of [
      ['the verification of the criteria at `phase close` / the context that runs it', 'verification / verifier', '検証 / 検証者'],
      ["a phase's state: `done` / `active` / `planned`", 'done / now / ahead', '済み / いま / これから'],
      ["a contract's `stability`: `draft` / `stable`", 'contract draft / settled', '契約の案 / 確定'],
      ['The options of `init`', 'Start with this plan / Adjust', 'この内容で始める / 直す'],
      ['The options of `replan`', 'Change the plan as proposed / Leave the plan as it is', 'この案で計画を直す / 直さない'],
      ['The options of `phase close`: the phase that ended', 'Accept and close / Change the plan / Carry the phase on', '受け入れて閉じる / 計画を変える / このフェーズを続ける'],
      ['The options of `phase close`: the next phase', 'Start as proposed / Adjust', 'この内容で始める / 直す'],
      ['The options of a shelf question on one item (the proposed action first, then the others in this order)', 'Drop / Keep / Promote', '削除する / 保持する / 昇格する'],
      ['A design review', 'What it will do / Contract drafts / File layout / Settled without asking', '出来上がるものの振る舞い / 契約の案 / ファイルの構成 / 問わずに決めること'],
      ['The titles of a wait', 'Independent review — waiting for the reply / Phase boundary — waiting for the verification', '独立レビュー — 返事を待っています / フェーズの区切り — 検証を待っています'],
    ]) {
      expect(rows).toContainEqual(row);
    }
  });

  it('the stock options in the tables are the ones the fenced skeletons offer', () => {
    // The rows were copied from the fences, so a change to one side alone fails here
    const options = new Map(
      bodyRows(wordsBlock)
        .filter((cells) => (cells[0] ?? '').startsWith('The options of'))
        .map((cells): [string, string] => [cells[0] ?? '', cells[1] ?? '']),
    );
    expect(fencedOptions('3. **Detail only the next one or two phases, then ask once**', '\n4. **Generate the files**')).toEqual([
      options.get('The options of `init`'),
    ]);
    expect(fencedOptions('3. Analyse the topic and print the proposed change', '\n4. Ask once')).toEqual([
      options.get('The options of `replan`'),
    ]);
    expect(fencedOptions('   - **Judge and print**', '   - **Ask once**')).toEqual([
      options.get('The options of `phase close`: the phase that ended'),
      options.get('The options of `phase close`: the next phase'),
    ]);
  });

  it('an appendix item says which question it serves, or carries the name its skeleton gives it', () => {
    expect(section).toContain(
      'except an item its skeleton gives a name of its own, which carries that name alone (the items of `init`, the three of a design review — § build — and the `Shelf review` of a replan)',
    );
    const ask = subsection('### Show, then ask');
    expect(ask).toContain('each item saying which question it serves or carrying the name its skeleton gives it');
    expect(ask).toContain(
      'the exceptions are appendix items a skeleton names itself: the `Shelf review` of a replan (replan step 2), and the named items of a design review that no question is about (§ build)',
    );
    const build = subsection('### build');
    expect(build).toContain(
      'then three items under fixed names, in this order: `Contract drafts`, `File layout`, and `Settled without asking` (what Claude settled alone)',
    );
    expect(build).toContain(
      "A draft that a question is about moves up among that question's items, named as its material (`Material for 1 — contract drafts`); the other named items carry their name alone",
    );
    expect(subsection('## replan')).toContain('(its `Shelf review` item: a note that goes before a question without serving it,');
  });

  it('the word for the verification is the same in a printout and in the records', () => {
    expect(subsection('## phase close')).toContain(
      '(`verification S#### #n`, with the word the words tables give for the verification — schemas.md § Template: phase status.md)',
    );
  });

  it('Japanese sits in one column of the words tables and nowhere else in the skill', () => {
    expect(skill.split('\n').filter((line) => JAPANESE.test(line))).toEqual([]);
    // schemas.md has carried one ideographic full stop since the commit convention was written: the
    // rule against ending a subject with a period names both characters
    expect(schemas.split('\n').filter((line) => JAPANESE.test(line.replace('`。`', '')))).toEqual([]);
    const wordsRows = new Set(
      wordsBlock.split('\n').filter((line, i, lines) => line.startsWith('| ') && !/^\|\s*-/.test(lines[i + 1] ?? '')),
    );
    expect(workflows.split('\n').filter((line) => JAPANESE.test(line) && !wordsRows.has(line))).toEqual([]);
    for (const cells of bodyRows(wordsBlock)) {
      expect(cells.slice(0, 2).filter((cell) => JAPANESE.test(cell))).toEqual([]);
    }
  });
});

describe('the five frames are defined once', () => {
  const labels = frameLabels();

  it('the status.md template carries the five labels', () => {
    expect(labels).toEqual([
      'Where things stand',
      'On track?',
      'Effect on the finished product',
      'What is wrong',
      'Compromise or replan needed?',
    ]);
  });

  it('the skill does not paraphrase them anywhere else', () => {
    for (const text of [skill, workflows, schemas]) {
      const lower = text.toLowerCase();
      expect(lower).not.toContain('on track or not');
      expect(lower).not.toContain('what it means for the finished product');
      expect(lower).not.toContain('whether a compromise or a replan is needed');
    }
  });

  it('the skeletons in workflows.md copy the labels in their order', () => {
    // A frame is printed as a list item, so the label run of a fenced skeleton shows up as five
    // consecutive `- **label**:` lines — the report of `close` and the result block of `phase close`
    const runs = [...workflows.matchAll(/(?:^[ ]*- \*\*[^*\n]+\*\*:.*\n){5,}/gm)]
      .map((m) => [...m[0].matchAll(/- \*\*([^*\n]+)\*\*:/g)].map((l) => l[1] ?? ''))
      .filter((run) => run[0] === labels[0]);
    expect(runs.length).toBe(2);
    for (const run of runs) expect(run).toEqual(labels);
  });

  it('README.md and doc/concepts.md name them in the same order', () => {
    const lower = labels.map((l) => l.toLowerCase());
    // The README lists them inside a sentence, so the comparison ignores case
    expect(read('README.md').toLowerCase()).toContain(`(${lower.join(', ')})`);
    const concepts = read('doc', 'concepts.md');
    expect(concepts).toContain(labels.map((l, i) => `${i + 1}. ${l}`).join('\n'));
  });
});

describe('the block that opens a session', () => {
  const start = workflows.indexOf('6. **Print the start block, then proceed**');
  const step6 = workflows.slice(start, workflows.indexOf('\n7. **Run the work', start));

  it('start step 6 prints the block every time, and says that writing the Plan is not printing it', () => {
    expect(start).toBeGreaterThan(0);
    expect(step6).toContain('**every time**');
    expect(step6).toContain('Writing the Plan into the session file is not printing it');
  });

  it('the skeleton has its four parts in their order', () => {
    const parts = [...step6.matchAll(/^ *(## S\d{4} opened|\*\*This phase's outcome\*\*|\*\*This session\*\*|\*\*Questions\*\*)/gm)];
    expect(parts.map((m) => m[1])).toEqual([
      '## S0013 opened',
      "**This phase's outcome**",
      '**This session**',
      '**Questions**',
    ]);
  });
});

describe('the shelves are put to the person when the plan changes', () => {
  it('a promote and a drop are both asked, at phase close and in a replan', () => {
    expect(workflows).toContain('A `promote` or a `drop` changes the plan, so the person decides it');
    expect(workflows).toContain('a `promote` or a `drop` from the GIT-7 review below joins as one more numbered question');
    expect(workflows).toContain('A `promote` or a `drop` changes the plan, so it becomes a row of the proposal in step 3');
  });
});

describe('a plan review that overturns a decision asks it in one question', () => {
  const start = workflows.indexOf('3. Analyse the topic and print the proposed change');
  const step3 = workflows.slice(start, workflows.indexOf('\n4. Ask once', start));

  it('replan step 3 keeps the overturning inside the question of the proposal', () => {
    expect(start).toBeGreaterThan(0);
    expect(step3).toContain('A proposal that itself overturns an earlier decision or a contract says so inside its own question, not in a second one');
    // The three places the decision names: the question's sentence, a row of the table, the appendix
    expect(step3).toContain("the question's sentence names what it changes (`… (This changes what was decided earlier.)`)");
    expect(step3).toContain('`What changes` carries it as a row');
    expect(step3).toContain('the records it collides with go to the appendix (`Records for <n>`)');
    expect(step3).toContain('a shelf item promoted or dropped, an earlier decision or a contract the proposal overturns):');
  });

  it('the one question stands in for the five lines of a held-back point', () => {
    expect(step3).toContain(
      'an option that overturns nothing (`Leave the plan as it is`, which is how the person refuses the overturning) — so the proposal takes no five-line block of its own',
    );
    expect(subsection('### Defer to the user')).toContain(
      "one block per point — except what a `replan`'s own proposal overturns, which is asked inside the question of that proposal (replan step 3)",
    );
  });
});

describe('how a reply ends', () => {
  const section = subsection('### The Next block');

  it('the Next block and the in-progress notice are both shown fenced', () => {
    expect(section).toMatch(/```\n─ Next ─+\nRecommended: <command> — /);
    expect(section).toMatch(/```\n─ In progress \(not finished yet\) ─+\nWaiting for: <what>\nYour action: /);
    expect(section).toContain('If the conversation ends: ');
  });

  it('the two waits the skill sets up take their titles from the words tables', () => {
    expect(section).toContain(
      'the words tables give the titles of the two waits the skill itself sets up, for the independent review and for the verification',
    );
    expect(subsection('### What the person reads')).toContain(
      'a wait other than the two the tables name — takes a plain phrase for its title',
    );
  });

  it('a reply that ends mid-command saves no recommendation', () => {
    expect(section).toContain('saves nothing to `next_command`');
    expect(section).toContain('| The question tool is asking | Nothing');
    const rule7 = lineOf(skill, '7. **A Next block ends every command', 'SKILL.md');
    expect(rule7).toContain('in-progress notice');
    expect(rule7).toContain('saves nothing');
    expect(rule7).toContain('while the question tool is asking');
  });

  it('`close` is recommended for an open session only when the person asked to leave it open', () => {
    expect(workflows).not.toContain('`close` has not run');
    expect(workflows).not.toContain('End every output');
    expect(skill).not.toContain('a session left open → `close`');
    const decision = bodyRows(section.split('How to decide (evaluate from the top):')[1] ?? '');
    expect(decision[0]?.[0]).toContain('because the person said explicitly to leave it open');
    expect(decision[0]?.[1]).toBe('`/roadmap close`');
  });
});
