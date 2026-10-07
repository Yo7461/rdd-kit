# workflows.md — procedures by subcommand

Check the template of every file to be created or edited in schemas.md before running any of these procedures.

## Contents

- [Common rules](#common-rules) — every change inside a session / a session left open is checked first / a light session for a small piece of work / record as you go / living with the automatic lint / the close commit and small fixes after close / changing the development environment / what the person reads / defer to the user / show, then ask / the Next block / projects without git
- [init](#init)
- [start](#start) (with the recovery procedure)
- [Procedures by phase type](#procedures-by-phase-type) — build / research / experiment / decision
- [close](#close)
- [replan \<topic\>](#replan-topic)
- [phase close](#phase-close)
- [status](#status-read-only)
- [doctor](#doctor-a-read-only-consistency-check)

## Common rules

### Every change inside a session
Change anything under `roadmap/` or in the project's code only inside an open session (`S####`). When no session is open at the point `replan` or `phase close` runs, open a short one automatically (with a `Plan` such as "replan: `<topic>`" or "phase close: P####") and run a normal `close` when it is done. There are two exceptions: `init` (it generates before sessions exist, so it runs without one) and the small fix right after `close` (see § The close commit, and small fixes after close below).

### A session left open is checked first
Every subcommand that writes (`start`, `close`, `replan`, `phase close`) reads `open_session` in `status.md` before doing anything else. A session opened in the current conversation is simply the one to keep working in, or to `close`. A session left open by an earlier conversation — the context is gone — is closed after the fact first, through § Recovery procedure steps 1–6 (under start), and only then does the subcommand open its own session and run its own steps. The one exception is `close` called on that very session: it runs steps 1–4 (the reconstruction) and then its own steps, writing the recovery note at its step 1 (§ close).

### A light session for a small piece of work
A small change (a typo in code, a one-line fix in a document, a dependency bump) still runs inside a session, but a light one: a one-item `Plan` taken straight from `Next` (the start block of start step 6 keeps its four parts, with that one item under `This session`, and the same conditions decide whether anything is asked), only the tests that cover what changed in place of the full suite the close notes call for, `Did` and `Result` in a line each, no separate work commit (the change lands in the close commit, so `commits` stays `[]` and the `Session Log` `commits` column reads `—`), and a report in the skeleton of close step 6 with the five frames at one line each. What it never skips: the `[S####]` close commit, the lint run at `close`, the `Session Log` row, and — for a change that touches code — the independent review of § build (a change to a document or a record alone needs none). The `post` route (§ The close commit, and small fixes after close) is narrower still — one line right after a `close`, with no session at all.

### Record as you go
Don't save the writing for `close` — append to the session log's `Did` and `Result` at every checkpoint (right after a commit, right after an artifact is finished, right after an important judgment). Append **at the end of that section**, not at the end of the file: the last section of a session log is `Handoff` (of an R/E, `Conclusion`), so an append past the end lands there, and the lint does not notice — it checks the headings, not which section a line sits in. Update the contracts and invariants in the spec at the moment they change too, instead of collecting them at `close`. The same goes for `R####` / `E####` files: append as the work proceeds rather than writing everything up once it is over (see the procedures for the research and experiment phase types). With git, stack the commits as you go as well — make a `[S####]` commit right after an `R####` / `E####` goes `done` and at every completed build task, instead of loading a session's whole output onto a single close commit. It is the insurance against a crash or a missed close. Check `git status --short` for anything unintended (a temporary file, build output) before committing — don't reach for `git add -A` blindly.

### Living with the automatic lint (hook)
With the automatic lint after each edit (the hook) in place, a sequence of edits that spans several files will temporarily surface diagnostics that the rest of the sequence resolves — FM-3 between creating the session file and updating `open_session`, BID-2 between adding an R/E and listing it in `artifacts`, GIT-1 and ID-2 during a `close` or a `phase close`, and GIT-1 with ID-2 / REF-2 while `init` is still generating its set (nothing is committed before the first commit). These are **true positives that pass** — don't stop at each one; finish the sequence of edits and confirm at the checkpoint (right before the commit) that nothing is left. Handle a diagnostic that the rest of the sequence will not resolve on the spot, before going further — with one exception: a GIT-7 warning (a `Parking Lot` / `Deferred` item past its shelf life) is raised by time, not by an edit, and waits for the keep / promote / drop step of the next `replan` or `phase close`. Don't rewrite the line just to silence it.

### The close commit, and small fixes after close
The session front matter's `commits` and the phase status's `Session Log` record **work commits only**. The close commit itself lands after the session file is finalized, so it cannot be recorded there, and it isn't — `git log --grep "\[S####\]"` is the way to find it.
Don't change anything after `close` as a rule; do it in the next session instead. Only a one-line fix noticed right afterwards — a typo, removing a value that went stale — goes in as `[S####] post: <what>`, recorded as one line at the top of the next session's `Did`. Never add an outcome or change a conclusion through this route.

### Changing the development environment, and blockers that come from it
- Get the user's explicit agreement before any operation that changes the development machine (installing a tool, changing a setting, changing permissions), even a reversible one, and record what and why in a `D-P####-####` or in the session log's `Learned / Decisions` — the side effects outlive the project
- **File a `B####`** for an environment requirement only the user can clear (elevated permissions, an internal approval, physical work), listing the phases it blocks, and ask for it with the concrete steps attached. Set the phase to **blocked** in roadmap.md when the whole phase cannot move and the work goes elsewhere (the next bullet), and delete the `Blockers` row once it clears (the reasoning stays in the log of the session that cleared it). When a workaround carries the work forward instead, record that judgment in a `D-P####-####`
- **`blocked` is the state of a phase that work has left** — `current_phase` has to name an `active` phase (roadmap-lint's ID-2), so a phase goes `blocked` in roadmap.md only when the work moves to another phase. When another phase can run (its `depends` are met), move through a short `replan`: set that phase `active` — detailing it first as at phase close step 5 when it has no `outcome` yet (a coarse entry, or one written before `outcome` existed; the person approves its `goal`, `why`, and `outcome` in the replan's agreement at § replan step 4, not in a phase close question), and giving it its directory and `status.md` as at phase close step 6 — and point `current_phase` and the Next at it. The blocked phase's own `status.md` keeps `state: active` (`blocked` lives in roadmap.md and the `Phase Index` only, which is what ID-2 expects). When no other phase can run, the phase stays `active` with its `B####` row and the work waits
- **When the blocker clears** — a phase that stayed `active` just loses its row; a phase that went `blocked` becomes `planned` at that moment and returns to `active`, with `current_phase` on it, at the next `replan` or `phase close` — not in the middle of another phase's session, and never as a second `active` beside it
- **Leaving a phase without a blocker** — a `replan` that moves the work away from the active phase without a blocker uses the same shape: the phase goes back to `planned` in roadmap.md and the `Phase Index` while its directory and `status.md` (`state: active`) stay, and it returns to `active` at a later `replan` or `phase close` (ID-2 does not check a `planned` heading against a directory)

### What the person reads (the shape of every printout)
A printout is anything a command prints for the person to read and act on: the block that opens a session, the material before a question, the report that ends a command, a notice. The person meets these every session, so each keeps **one shape** — the same parts, in the same order, under the same words. A printout that changes its look from run to run, or silently goes missing, costs the reader effort every time. (The narration between tool calls is not a printout and is not regulated here.)

**Seven parts.** Every printout is built from these, together with the lines and tables its own skeleton names (the items under `This session`, the `What changes` table, a comparison table, the table of findings) — and from nothing beyond that skeleton. The skeleton of each scene sits in the step that prints it, as a fenced sample for the scenes met most, and says which parts it takes and in what order.

| Part | Shape | Where it appears |
|---|---|---|
| Title | One heading line: `<what happened> — <what it is about> (<ID>)`; when something is asked, `<scene> — <n> questions` | The first line of every printout |
| Five frames | The five labels of `Now`, in their order (schemas.md § Template: status.md (root)) | A report, the result of a phase that ended, `status` |
| Phase lines | `Goal` / `Why` / `Outcome` — a phase that is not detailed yet has the first two | Wherever a phase is shown: `init`, `replan`, `phase close` |
| Question block | The questions as a numbered list and the recommendation, then one block per question in the same shape, each ending with `Your options` | Whenever the person is asked (§ Show, then ask) |
| Held-back point | Five lines: `Effect on the finished product` / `Records involved` / `What would be overturned` / `An option that overturns nothing` / `Recommendation` | A point put to the person under § Defer to the user |
| Appendix | Below a rule, under `Appendix (only if you want to check)`: one line per item, or the table or list its skeleton shows | Before a question, and in a report |
| End | The Next block when the command has ended, the in-progress notice when the reply ends before that, nothing while the question tool is asking | The last lines of every reply (§ The Next block) |

**How a printout is written:**

- **Three levels, and no more** — the title is a second-level heading (`##`), the block of one question a third-level heading (`###`), and a label is bold text — followed by a colon when its content sits on the same line, alone on its line when a list or a table follows. Two labelled lines are never adjacent lines of plain text: make them list items or put a blank line between them, or they run together when rendered. The appendix sits below a horizontal rule
- **The body is for the person** — in their words and their language, one sentence one fact. A record key (`goal`, `why`, `outcome`, `acceptance`, `depends`), a path, and a command do not appear in the body; a phase or a session is called by its name, and its ID may follow in parentheses; the one count or fact the person needs to decide stays in the body as well. The exceptions are the ones a skeleton names: the place of a finding and its rule ID in `doctor`, the command a question or a note is about (the guard rail of `start`, the notes of `status`), and CLAUDE.md in the report of `init`
- **The appendix is for checking** — IDs, paths, counts, commits, and the full text a decision rests on (or a pointer to it) go there: one line per item, or the table or list its skeleton shows. Before a question its items are lettered `A`, `B`, …, set apart by a blank line, and each says which question it serves (`Material for 1`) — except an item its skeleton gives a name of its own, which carries that name alone (the items of `init`, the three of a design review — § build — and the `Shelf review` of a replan); in the report that ends a session they are the four lines of close step 6
- **One word per thing** — print the label the tables below give, and no synonym of it, in the body and in the appendix alike. The tables also give the word for what a record spells in English — the state of a phase (`done`, `active`, `planned`) and of a contract (`draft`, `stable`), the name of a section (`Principles`, `Parking Lot`): print the word the tables give, not a copy of the record. A state word shows where a thing stands; a sentence that tells a change of state says what happened, in the person's words (a phase was closed, the next one started). The options of the questions every project meets in the same form — at `init`, in a `replan`, at `phase close`, for a shelf item — are fixed words too, listed in the tables: an option that does not apply is left out (`Accept and close` while a check has failed), and one the scene adds is said in the person's words. Where the tables have no word — another state (a `blocked` or `dropped` phase, a `deprecated` contract, the `status` of a research or experiment file), the candidates of a decision, the options of a held-back point, of the guard rail of `start`, of the findings `doctor` left, or of several shelf items at once — say it in the person's words. The records keep their keys, headings, and state values in English (SKILL.md § Language and format); only what is printed changes
- **Nothing outside the skeleton** — a printout takes no section its skeleton does not have. What does not fit goes into a frame (a correction belongs to `What is wrong`), into the appendix, or into the records

**The words.** The first table maps what the skill and the record keys call a thing to the label printed for it; the second lists the labels the parts and the skeletons use. The middle column is the English form — print it in the user's language. The Japanese column is fixed, so that every Japanese-language project reads the same words from its first printout on. In another language, translate the English form once and keep to it — the labels a project's `status.md` and earlier records already use are the ones to keep. A project that wants other words writes them in its CLAUDE.md, and those win. A scene the tables do not name — a change to the development machine, a blocker only the person can clear, a wait other than the two the tables name — takes a plain phrase for its title; the parts and their labels stay the same.

| In the skill and the record keys | Printed label | Japanese |
|---|---|---|
| `goal` / `why` / `outcome` | Goal / Why / Outcome | 目的 / 理由 / 成果 |
| `acceptance` (acceptance criteria) | Checks | 検査項目 |
| a criterion met / unmet | passed / failed | 合格 / 不合格 |
| the verification of the criteria at `phase close` / the context that runs it | verification / verifier | 検証 / 検証者 |
| `depends` | Depends on | 前提のフェーズ |
| `type`: `research` / `decision` / `build` / `experiment` | research / decision / build / experiment | 調査 / 決定 / 実装 / 実験 |
| a phase's state: `done` / `active` / `planned` | done / now / ahead | 済み / いま / これから |
| a contract's `stability`: `draft` / `stable` | contract draft / settled | 契約の案 / 確定 |
| `Vision` | The finished product | 完成の姿 |
| `Principles` | Principles | 方針 |
| `Parking Lot` / `Deferred` | The shelves: parked ideas / deferred findings | 棚: 計画の外の案 / 先送りした指摘 |
| keep / promote / drop (a shelf item) | keep / promote / drop | 保持 / 昇格 / 削除 |
| adopted / rejected / deferred (a finding) | adopted / rejected / deferred | 採用 / 却下 / 先送り |
| triaged | all handled | すべて処置済み |
| the session's `Plan` | This session | 今回の予定 |
| the roadmap | The plan | 計画 |
| roadmap-lint, `doctor` | Records check | 記録の点検 |
| the five frames of `Now` | the labels of the `Now` template | 状況 / 順調か / 完成品への影響 / 問題 / 妥協・計画変更の要否 |

| Where | Printed label | Japanese |
|---|---|---|
| A question block | `<scene> — <n> questions` (`no questions`) / Recommendation / Your options / (recommended) | <場面> — 伺うことは n つです(伺うことはありません)/ 推奨 / 選べること / (推奨) |
| A held-back point | Effect on the finished product / Records involved / What would be overturned / An option that overturns nothing / Recommendation | 完成品への影響 / 関わる記録 / 覆るもの / 覆さない案 / 推奨 |
| The titles of a held-back point | Design check / Before closing / Mid-session check | 設計の確認 / 閉じる前の確認 / 途中の確認 |
| The guard rail of `start` | Before starting | 始める前の確認 |
| The appendix | Appendix (only if you want to check) | 付録(確かめたいときだけ) |
| The appendix before a question | Grounds for `<n>` / Records for `<n>` / Material for `<n>` / Checks for `<n>` (what the AI verifies) | n の根拠 / n の記録 / n の材料 / n の検査項目(AI が確かめる条件) |
| The verification table | Check / Verdict / Grounds | 検査項目 / 判定 / 根拠 |
| The appendix of a report | Decided / Verified / Records / Commits | 決めたこと / 確かめたこと / 記録 / コミット |
| The start block | `S#### opened` / This phase's outcome (This phase's goal) / This session / Questions: none (`<n>` follow) | S#### を開きました / このフェーズの成果(このフェーズの目的)/ 今回の予定 / 伺うこと: ありません(n つあります) |
| The titles of a report | `S#### closed` / Plan revised / Phase closed / Plan created | S#### を閉じました / 計画を見直しました / フェーズを閉じました / 計画を作りました |
| `init` | The whole plan / The proposed plan / Phases (in this order) / Checks for the first two phases / Principles, and ideas kept off the plan / What gets generated / What was made / Working rules | 全体の計画 / 計画の案 / フェーズ(この順に進めます)/ 最初の 2 フェーズの検査項目 / 方針と、計画の外に置く案 / 作るもの / 作ったもの / 運用のきまり |
| The options of `init` | Start with this plan / Adjust | この内容で始める / 直す |
| `replan` | Plan review / What changes / Until now / This proposal / Proposed new phase | 計画の見直し / 変わること / これまで / この案 / 新しいフェーズの案 |
| The options of `replan` | Change the plan as proposed / Leave the plan as it is | この案で計画を直す / 直さない |
| `phase close` | Phase boundary / The phase that ended / What was promised / Result — the outcome holds (does not hold) / Not verified / The next phase / Proposal | フェーズの区切り / 終わったフェーズ / 約束していたこと / 結果 — 成果は成り立っています(成り立っていません)/ 確かめていないこと / 次のフェーズ / 案 |
| The options of `phase close`: the phase that ended | Accept and close / Change the plan / Carry the phase on | 受け入れて閉じる / 計画を変える / このフェーズを続ける |
| The options of `phase close`: the next phase | Start as proposed / Adjust | この内容で始める / 直す |
| The review of the shelves (`replan`, `phase close`) | Shelf review | 棚の見直し |
| The options of a shelf question on one item (the proposed action first, then the others in this order) | Drop / Keep / Promote | 削除する / 保持する / 昇格する |
| A decision phase | Decision / Angle (the first column of the comparison table) | 決めること / 比べる点 |
| A design review | What it will do / Contract drafts / File layout / Settled without asking | 出来上がるものの振る舞い / 契約の案 / ファイルの構成 / 問わずに決めること |
| The in-progress notice | In progress (not finished yet) / Waiting for / Your action / If the conversation ends | 途中(まだ終わっていません)/ 待っているもの / あなたの操作 / 会話が切れたら |
| The titles of a wait | Independent review — waiting for the reply / Phase boundary — waiting for the verification | 独立レビュー — 返事を待っています / フェーズの区切り — 検証を待っています |
| `status` | Where the project stands / Stopped or worrying / Phases: done, now, ahead | いまの状況 / 止まっているもの・気がかり / フェーズ: 済み・いま・これから |
| `doctor` | Records check — `<n>` findings need action (nothing needs action) / Where / What is happening / What to do / Breakdown: mechanical check, meaning check / What happens to this result | 記録の点検 — 対応が要るものは n 件です(対応が要るものはありません)/ 場所 / 起きていること / どうするか / 内訳: 機械の点検・意味の点検 / この結果の扱い |
| A recovery | `S####` was left open — now closed (from an earlier conversation) / What the records showed / Uncommitted work / What could not be told | 開いたままだった S#### を閉じました(前の会話の続き)/ 記録から分かったこと / コミットされていなかった作業 / 分からなかったこと |

### Defer to the user (when to ask)
The records settle what has already been decided, measured, and promised. The moment a judgment turns out to touch one of them, it stops being Claude's to settle — hand the decision to the user when acting would:

- overturn an existing decision (`D-P####-####`), a contract (`C####`), or an acceptance criterion already met
- contradict what the Fact layer records — a measured result, a rule derived from one, or a conclusion a closed session captured
- resolve two records that turn out to be irreconcilable, by ranking one over the other
- pick between two or more workable options that change observable behavior or generated output in different ways
- rest on a premise of the plan that turned out to be broken (when the break invalidates the plan itself rather than one judgment, that is `replan` — see § The Next block)
- consume an item a record explicitly reserves for confirmation or a final check

Don't stop at every discovery — write the point down as it comes up (with the IDs it collides with) and present the collected points in one batch at the next checkpoint (the start block printed at `start`, a design or draft review, right before `close`; at `start`, a held-back point is one of the conditions that turn its `Questions` line into a question — § start step 6). Ask on the spot only when continuing would bake the judgment in — a commit, a publication, an edit that is expensive to unwind.

Each point presented carries five lines, under these labels and in this order: **Effect on the finished product** (how each way of settling it changes what the user is building — this comes first, because it is the level the user decides at), **Records involved** (what it collides with, said in words — the ID goes to the appendix; say so when nothing collides), **What would be overturned** (or "nothing"), **An option that overturns nothing** (at least one; when the point is a fork that overturns nothing, the options themselves), and **Recommendation** (with the reason). An example, when one helps, goes under the line it illustrates. Put the question as "this overturns X — proceed?", not as a set of options that all assume X is already overturned — a solved multiple-choice leaves the user no room to refuse the overturning itself.

The points go out as a question block (§ Show, then ask), one block per point — except what a `replan`'s own proposal overturns, which is asked inside the question of that proposal (replan step 3). The title says where in the session the person is being asked — `Design check` at a design or draft review, `Before closing` at the flush of `close`, `Mid-session check` when asked on the spot — and at `start` the blocks follow the `Questions` line of the start block (start step 6) instead of a title of their own:

```markdown
## Before closing — 1 question
1. Widen the "near-identical" threshold from 6 to 10? (This changes a value decided earlier.)

**Recommendation**: "Don't widen it."

### 1. The "near-identical" threshold
- **Effect on the finished product**: Widening it misses fewer near-duplicates. In exchange, groups that contain a different photo go from 0 to 3 of the 20 groups checked by eye.
- **Records involved**: The threshold was decided as 6 when the method was chosen. Widening it collides with that decision.
- **What would be overturned**: The value in that decision.
- **An option that overturns nothing**: Keep 6, and hand the missed examples to the performance-check phase.
- **Recommendation**: The option that overturns nothing — the finished product puts "safe to tidy up" first, so don't let more wrong photos in.

**Your options**: Overturn the decision and widen it / Don't widen it (recommended)

---
**Appendix** (only if you want to check)

**A. Records for 1**: decision D-P0002-0002 / the eye check is in the session log of S0011
```

What Claude may settle alone: reversible implementation details, naming, how tests are written, notation cleanups, an interpretation that follows a recorded rule, filling a gap no record regulates, writing down what already happens, and declining a Handoff suggestion — as long as nothing recorded is contradicted and the reason lands in the session log. A conflict nobody has noticed cannot trigger this rule — surfacing those is the job of the lint, `doctor`, and reviews.

### Show, then ask (how to use AskUserQuestion)
Before asking the user to decide, **print the material the decision rests on in full as ordinary output** — the outline, the comparison table, the diff, the list of acceptance criteria. AskUserQuestion is a selection device, not a display device — the question and the options carry a summary and a pointer to that output, and never the material itself (what the dialog shows does not survive into the conversation log once it is answered). Where candidates are being compared (a decision phase, for instance), the `preview` field of an option may help, but it does not replace printing the material.
**Order the material from the goal down:** first what the decision means for the finished product, then how each option changes it, and last the implementation facts (file paths, rule IDs, numbers) as an appendix — the user decides at the first level and reads the last only to check. When the decision is about the shape of a record or a report (a template, a format, the frames of a summary), print a worked sample of each candidate on a fictional case — a comparison table alone does not show what the person will end up reading.
**The shape of a question.** Whatever is asked — a held-back point, a change of plan, a phase boundary, the choice in a decision phase, the guard rail of `start` — goes out in one shape: the title (`<scene> — <n> questions`); then the question block — the questions as a numbered list, each a full sentence that calls what it is about by name, `Recommendation` in one line, and one block per question (`### <n>. <its name>`), in the shape its scene fixes and ending with `Your options`, the recommended one marked; then, below a rule, the appendix, each item saying which question it serves or carrying the name its skeleton gives it (§ What the person reads). The interview of `init` is the one exception — it collects what the plan will be made from, so there is nothing to print before it. The dialog asks the same questions under the same numbers and in the same words, with the options of `Your options` as its choices and the recommended one first. A note that needs no decision does not go before a question — it belongs to the report that ends the command (the exceptions are appendix items a skeleton names itself: the `Shelf review` of a replan (replan step 2), and the named items of a design review that no question is about (§ build)).
**Required:** the whole of the material is already printed in the immediately preceding output at the moment AskUserQuestion is called. Don't call it before that (show, then ask — an option's `description` or `preview` is not a substitute).

### The Next block (how a command ends, and how a reply that ends earlier is marked)
A command ends with exactly one recommended command, printed **once, as the last thing the command prints, inside a code fence** (the fence keeps its two lines apart and makes the command easy to copy):

```
─ Next ──────────────────────────────
Recommended: <command> — <one line: why, and what it covers>
```

Save the full text after `Recommended: ` (`<command> — <one line: why, and what it covers>`) to `next_command` in the `status.md` front matter (`status` and `doctor` display it without saving). When saving, **update the `Recommended: ` line in the body of the `status.md` Next section to the same string at the same time** — the body line shows the command in backticks, as its template does, and is otherwise the same string. Updating only the front matter and leaving a stale recommendation in the body is an inconsistency, and roadmap-lint reports it as STRUCT-3.

**A reply is not a command.** A command can take several replies — it waits for a reviewer, a verifier, or the person — and the Next block belongs to the last of them. How a reply ends:

| The reply ends because | Its last lines |
|---|---|
| The command has ended (the session is closed, or the person said explicitly to leave it open) | The Next block |
| The command is waiting for a reviewer's or a verifier's reply | The in-progress notice — `Your action`: none |
| The command is waiting for the person and the question tool is not asking (a question put in prose, work only the person can do) | The in-progress notice — `Your action`: what is needed |
| The question tool is asking | Nothing — the dialog shows the state |

The in-progress notice goes in a code fence like the Next block, with its heading and labels in the user's language:

```
─ In progress (not finished yet) ────
Waiting for: <what>
Your action: <none — this conversation carries on when it arrives | what is needed>
If the conversation ends: <the command that picks the work up> (<what it resumes>)
```

A reply that ends mid-command prints a title (`<scene> — <what it is waiting for> (S####)` — the words tables give the titles of the two waits the skill itself sets up, for the independent review and for the verification), a sentence or two on what was done and what comes next, and the notice. It prints no Next block **and saves nothing to `next_command`** — a recommendation written mid-command (`/roadmap close`, say) would cut the command short if followed. Leave the resume point in the open session's `Handoff` before the reply ends (with no session open yet — at `init`, or before start step 5 — the notice alone carries it).

A `close` that runs inside another command — the after-the-fact close of a session left open, or the `close` of a session this conversation opened before a new `start` (start step 3) — writes its records in full, `next_command` included, and prints what it has to say **without** the Next block: its report, or, for a session recovered after the fact, the recovery notice (§ Recovery procedure step 6). The command it runs inside prints the one Next block, at its own end. The recommendation that `close` saved is not lost on the way: at `start`, the guard rail reads it before the new session opens (start step 3). A `replan` that runs inside a session already open is part of that session's command in the same way: it prints no Next block of its own (replan step 7).

How to decide (evaluate from the top):

| Condition | Recommend |
|---|---|
| The command ended with the session still open, because the person said explicitly to leave it open | `/roadmap close` |
| Research, an experiment, or the implementation contradicts a premise of the plan / an acceptance criterion turns out to be unreachable / a large new blocker appeared / the scope has to change | `/roadmap replan <one-line topic>` |
| Every acceptance criterion of the active phase is checked (judged from the phase status's `Acceptance Progress`; the review criterion counts as checked once a session's `Result` shows every finding triaged, though its checkbox may stay unchecked until `phase close` — schemas.md § Template: roadmap.md) | `/roadmap phase close` |
| Anything else (on plan) | `/roadmap start — <one line on the next session>` |

Two notes: when every criterion is met *and* a premise of a later phase has broken, prefer `phase close` — detailing the next phase is itself a chance to replan. When the broken premise invalidates **an acceptance criterion of the current phase**, prefer `replan`. The first row applies only when the person asked for the session to stay open: a session that is open because the command is waiting ends its reply with the in-progress notice, and one that `close` has closed starts the decision from the second row.

### Projects without git
Follow schemas.md § Working without git (degraded mode) and skip the commit steps.

---

## init

Stop when `roadmap/status.md` already exists — the project is initialized; point at `/roadmap status`. When `roadmap/` exists without a `status.md` (an interrupted `init`, or a directory used for something else), list what is in it and ask the user whether to move it aside and generate, or to stop — don't overwrite anything there.

1. **Interview** — ask in one batch (don't interrogate the user; collect the items that suit a choice into a single AskUserQuestion):
   what is being built / who it is for / the must-have experience / the constraints (time, environment, budget) / technology preferences and existing assets / the willingness to adopt something not yet in use (whether the best fit is worth adopting, or the work should stay inside what is already there — promote the answer to `Principles`) / what "finished" means
   Don't re-ask anything the argument or the first prompt already answered; confirm only what is missing or ambiguous. Don't try to fill an item marked "undecided" with a question — work it into the plan as a research or decision phase
2. **Propose an outline of the whole course** — rough out **every phase** through to the end of the project: the `Vision` drafted from the interview and, for every phase, its name, `type`, one-line `goal`, `why` (what the finished product lacks without this phase, in terms of the `Vision`), and `depends`. Nothing is printed yet — the outline goes out in the one printout that step 3 ends with. The point is to put the user in a position to see the whole shape:
   - Somewhere that needs outside information → plan it as a `type: research` phase
   - Somewhere that needs a measurement or a proof of concept → plan it as a `type: experiment` phase
   - **Aligning on the stack, the framework, and the language → include a `type: decision` phase as a matter of course** (put a research phase right before it when the decision needs material)
   - Keep distant phases coarse, at a one-line `goal`, a one-line `why`, and a `type`. Express the ordering through `depends`
3. **Detail only the next one or two phases, then ask once** — down to `outcome` (what the person sees or can do once the phase is over, in the person's words — what the person accepts at `phase close`), `acceptance` (the AI's checks — an end state that can be checked, the way to verify it, and, when something must stay as it is, what must not change; 3–7 of them), `depends`, and `blockers`. Don't detail the third phase onward (they get detailed one at a time at `phase close`, each with its `outcome`). A build phase that changes code takes the review criterion by default — the stock form in schemas.md § Template: roadmap.md — and leaving it out takes a recorded reason. Then print the whole plan in the skeleton below and ask whether to generate `roadmap/` from it or adjust it (§ Show, then ask): the person approves the `Vision`, the `goal` and `why` of every phase, and the `outcome` of the next one or two; the acceptance criteria are shown, not approved.

   ```markdown
   ## The whole plan — 1 question
   1. Start with this plan (the finished product, the 6 phases, and the outcomes of the first two)?

   **Recommendation**: "Start with this plan."

   ### 1. The proposed plan

   **The finished product**: A desktop tool that finds duplicate and near-duplicate photos in a folder and lets you compare them before deleting, so tidying up is safe. Candidates for a 10,000-photo folder appear within a minute, and a deleted photo always goes through the recycle bin.

   **Phases** (in this order)
   1. **Hashing-method survey** (P0001 · research)
      - **Goal**: Line up the candidate methods for finding duplicates and near-duplicates, with a rough speed for each.
      - **Why**: Know first whether any method makes "10,000 photos within a minute" possible.
      - **Outcome**: A table says, per method, roughly how many seconds 10,000 photos take and how far near-duplicates are caught.
   2. **Stack and method choice** (P0002 · decision)
      - **Goal**: Choose the language, the UI base, and the method.
      - **Why**: Settle the base of the compare screen and of the distribution in one go.
      - **Outcome**: The language, the UI base, and the method are chosen, with the reasons kept in three lines.
   3. **Scan and candidate grouping** (P0003 · build)
      - **Goal**: Scan a folder and group duplicate and near-duplicate photos.
      - **Why**: "Compare before deleting" needs candidate groups before anything else.
   4. **Compare-and-delete screen** (P0004 · build)
      - **Goal**: Compare the photos of a group and send the chosen ones to the recycle bin.
      - **Why**: This is the core of the tool, and "always through the recycle bin" is kept here.
   5. **Performance check** (P0005 · experiment)
      - **Goal**: Measure that 10,000 photos really take under a minute.
      - **Why**: The number in the finished product has to hold on a real machine.
   6. **Distribution** (P0006 · build)
      - **Goal**: Build the installer.
      - **Why**: A tool that only runs here is not one other people can use.

   The first two phases carry an outcome. From the third on, each gets its outcome when the phase before it closes, and is put to you then.

   **Your options**: Start with this plan (recommended) / Adjust

   ---
   **Appendix** (only if you want to check)

   **A. Checks for the first two phases** (what the AI verifies)
   1. Hashing-method survey: a comparison table of three or more candidates exists / the sources are kept
   2. Stack and method choice: the choice is made from the comparison table, with the reasons kept

   **B. Principles, and ideas kept off the plan**: 3 principles (desktop only / a deleted photo always goes to the recycle bin / 10,000 photos is the upper bound) / 1 parked idea (finding duplicate videos)

   **C. What gets generated**: the records under roadmap/, and the working rules appended to CLAUDE.md. No code
   ```

   Every phase is listed the same way — its name, with its ID and `type` in parentheses, and its phase lines: `Goal` and `Why` for all, `Outcome` for the one or two that are detailed. The plan order is the order of the list; `Depends on` goes to the appendix only where it differs from that order.
4. **Generate the files** following the schemas.md templates:
   - `roadmap/roadmap.md` (P0001 `active`, everything else `planned`)
   - `roadmap/status.md` (`current_phase: P0001`, `open_session: null`, `last_session: null`, the first task of P0001 in `Next`)
   - `roadmap/phases/P0001-<slug>/status.md` (`state: active`)
   - `roadmap/spec/map.md` (the frame only: a placeholder saying `System Map` gets filled in during the first build phase, and empty `Invariants` / `Spec Index`)
   - `roadmap/research/` and `roadmap/experiments/` (the directories only, each with a `.gitkeep` — git does not track empty directories)
   - `.gitignore` (only under git. Generate the minimal form from the schemas.md template. Append only the missing lines when a `.gitignore` already exists)
5. **Append to CLAUDE.md** — append the schemas.md snippet to the project's CLAUDE.md (create it when there is none). Tell the user it was appended
6. **Lint, then the first commit** — run roadmap-lint once over the generated set before committing: nothing is committed yet, so GIT-1 is the one diagnostic that may remain, and anything else (a `Next` task naming an ID that does not exist yet, say) is fixed here rather than after the `[init]` commit. Then, under git, commit the whole generated set (`roadmap/`, CLAUDE.md, `.gitignore`) on the spot as `[init] <message>` (`[init] initialize roadmap`, for instance). `init` is the one exception that has no `S####`, because it runs before sessions exist — roadmap-lint (GIT-2) leaves the commit that first tracked `roadmap/` out of scope as well (schemas.md § Commit convention). When the commit fails because git has no identity (`user.name` / `user.email`), ask the user to set one — don't set a placeholder identity in the user's repository. Skip this without git
7. **Report, then the Next** — a light report, without the five frames (nothing has happened yet) and with three lines in its appendix (`Verified`, `Records`, `Commits`), then the Next block with its reason in the user's language:

   ```markdown
   ## Plan created — photo-tidy

   - **What was made**: the plan, the current position, the first phase's record, and the frame of the spec. No code yet.
   - **Working rules**: appended to CLAUDE.md.

   ---
   **Appendix** (only if you want to check)
   - **Verified**: records check clean
   - **Records**: roadmap/roadmap.md, roadmap/status.md, and 4 more
   - **Commits**: fb2b7c9
   ```

   ```
   ─ Next ──────────────────────────────
   Recommended: /roadmap start — S0001: start P0001 (<phase name>)
   ```

### What init must not do
- Don't write or generate code
- Don't do detailed design such as file layout or API design (that happens at the start of each build phase) — the `Next` tasks name goals, not file layouts or IDs that a later session will create
- Don't carry out research — planning the necessary research as a research phase is `init`'s job

### A typical outline (a new application)
P0001 requirements and a survey of candidate technologies (research) → P0002 choosing the stack (decision) → P0003 the skeleton (build) → P0004 the core MVP (build) → P0005 performance verification (experiment) → P0006 release preparation (build)

---

## start

1. Read `roadmap/status.md`. Point at `init` and stop when there is none
2. **Guard rail** — when `start` is called while `next_command` points at `replan` or `phase close`, ask once, under the title `Before starting` (§ Show, then ask): "Last time, `<command>` was recommended because `<reason>`. Run that first?" Its one block gives that reason in a line and ends with `Your options` — run it first (recommended), or carry on with a new session. Record the fact and the reason in the new session's `Plan` when carrying on regardless. When `open_session` is set, this check waits for step 3 and is made once, on the recommendation that `close` saves
3. **Recovery check** — when `open_session` is not null, it splits two ways. **A session opened in the current conversation** (the context is alive and the state of the records is known) is not a recovery — run a normal `close` first, then carry on with `start`. **Leftovers from an earlier conversation** (the context is gone) go through the recovery procedure below first. Either way the `close` runs inside this `start`: what it prints — its report, or for a recovery the notice of § Recovery procedure step 6 — goes out without a Next block, the start block of the new session follows it, and the one Next block comes when this `start` ends (§ The Next block). The recommendation that `close` saved is the one the guard rail of step 2 reads: when it points at `replan` or `phase close`, ask before the new session is created
4. **Orientation** — read the active phase in roadmap.md (`goal`, `why`, `outcome`, `type`, `acceptance`, `Principles`, related `Blockers`), the phase `status.md`, and `spec/map.md` (map and invariants), then `.roadmap-lint.json` when the project has one — what it sets under `options` is the effective limit or vocabulary this session writes to (SKILL.md ground rule 10). Read the `R####` / `E####` / `C####` (contract files) and the most recent session logs the `Next` tasks refer to, as needed
5. **Create the session** — create `S####` (the next in the project-wide sequence) under `phases/P####-<slug>/sessions/`, with `state: open` and the current HEAD in `base_commit` (`null` without git). Update `open_session` in `status.md`
6. **Print the start block, then proceed** — gather what this session is going for into 2–4 items from the `Next` in `status.md` (narrowed to what one session's worth of work can finish; a light session — § Common rules — takes its one item), and print the block below as ordinary output, **every time**. Writing the Plan into the session file is not printing it, and a session log does not say the Plan was printed unless this block went out in the conversation:

   ```markdown
   ## S0013 opened — Scan and candidate grouping (P0003)

   **This phase's outcome**: Point it at a folder and it shows the groups of the same photo — 10,000 photos in under a minute, with few wrong photos in a group.

   **This session**
   1. Put near-identical photos in the same group
   2. Make a 10,000-photo test folder that can be rebuilt
   3. Prepare the speed measurement

   **Questions**: none (0 held-back points, no contract draft that forks behavior, nothing left by the records check). Proceeding.
   ```

   The four parts always appear, in this order: the title; the active phase's `outcome` under `This phase's outcome` (for a phase detailed before `outcome` existed, its `goal` under `This phase's goal`); the items, in the person's words — the paths and IDs they carry in `Next` stay in the session file's `Plan`; and the `Questions` line. Don't ask for confirmation: the user approved the phase, and the items are the `Next` the last session (or `init`) wrote. Before the work begins, `start` asks under four conditions and no others — the guard rail of step 2, asked there before the session exists, and three that turn the `Questions` line into a question: **a point held back for the user** (§ Defer to the user) is waiting, **a contract draft that forks observable behavior** (§ build — two or more workable shapes that change what is observable in different ways) is on the table, or **`doctor` ran just before and left findings unaddressed** (ask whether they belong in the `Plan`). When one of the three holds, the line says how many questions follow, and right under it come the question block and, below a rule, the appendix — the printout of § Show, then ask without its title. A held-back point and a contract draft that forks take the five lines of § Defer to the user; findings `doctor` left are listed one to a line, with `Your options` to take them into this session or to leave them. The question is asked once (§ Show, then ask), with everything bundled; when none holds, the line says so as above — how many points are held back, whether there is a draft, whether the records check left anything — and the work proceeds (what the work itself asks later — a decision phase's choice, an operation that changes the machine, the flush at `close` — follows SKILL.md ground rule 11)
7. **Run the work with the procedure for the phase type** (below). Record as you go at every checkpoint
8. **The automatic close (the end of start)** — once the work reaches a stopping point, the end of the conversation is near, or the context has grown long, run `close` (below) and close the session without waiting for the user to call it. `close` opens by flushing the points held back for the user (§ Defer to the user) — one printed batch, one AskUserQuestion — before its step 1, because the close commit bakes in whatever is still unasked. With the start block printed rather than confirmed at step 6, that block and this flush are the two fixed points inside a session where a held-back point reaches the person. `close` is part of the `start` workflow, and close step 6 makes the closing decision for the Next block. `phase close` stays a user call — never run it automatically; recommend it in the Next after `close` when every criterion is met. The automatic close may be held back in only two cases: the user said explicitly to leave the session open, and the work is interrupted waiting for the user to decide. When the user said to leave it open, the command ends there and its Next is always `/roadmap close` (the first row of the decision table — don't recommend `start`, `phase close`, or `replan` with a session still open). When the work is waiting for the user to decide, the command has not ended — and neither has it while a reviewer's or a verifier's reply is awaited, which is no stopping point at all: the reply ends as § The Next block says (the in-progress notice, or nothing while the question tool is asking), and no Next is printed or saved

### Recovery procedure
When `open_session` was left behind:

1. Read the session file that is still there
2. With git, check what actually changed with `git diff <base_commit>...HEAD` (three dots — with another branch checked out, the side HEAD has left is not reported as undone) and `git log --oneline <base_commit>..HEAD`, and reconstruct `Did` and `Result` as far as they can be told. The diff is not this session's share alone: a merge, a fast-forward, or a rebase brings other work into it, and a rebase can reach back before `base_commit`. The session's own commits are the ones that carry its ID — `git log --oneline --grep '^\[S####\]' <base_commit>..HEAD` lists them, and `git log --all --oneline --grep '^\[S####\]'` finds them on another branch when that lists nothing
3. An `R####` / `E####` left at `status: running` is interrupted research or an interrupted experiment. Keep whatever `Method` / `Results` were written as a partial outcome, and carry what is unfinished (the rest of the `running` one and the `planned` ones) into the new session's `Plan`
4. Decide what happens to uncommitted work left in the working tree — 1. carry it as it is (the next session picks it up; this is the default), 2. commit it as `[S####] wip: <one line on its state>` so the next interruption cannot lose it, or 3. discard it (only when it is plainly worthless). State the choice, the reason, and the state of the diff (whether the tests are red, for instance) in the `Handoff` of the after-the-fact close
5. Write "Note: closed after the fact (recovery)" in the session file and set `state: closed`
6. Append one line to the phase status's `Session Log`, bring `status.md` into agreement, and tell the person, in three lines and nothing more:

   ```markdown
   ## S0011 was left open — now closed (from an earlier conversation)

   - **What the records showed**: The grouping of near-identical photos was implemented (2 commits).
   - **Uncommitted work**: Carried into the next session as it is. The tests pass.
   - **What could not be told**: How far the speed measurement had been prepared.
   ```

   The notice stands in for the report in five frames — the context that could write one is gone — and takes no Next block, because the command that found the session carries on
7. Then carry on with a normal `start`

---

## Procedures by phase type

This is the content of start step 7. How a session proceeds depends on the active phase's `type`.

### build (implementation)
- **The first build session of a phase starts with detailed design** — file layout, interfaces, data flow. When a contract observable from the outside comes out of it, raise it in the spec's domain file as a `C####` (`stability: draft`) and print it at the next checkpoint — a design review inside the session, when there is one (SKILL.md ground rule 9), or the start block of start step 6 when the design was done before it. Ask the user only when the draft forks observable behavior — two or more workable shapes that change what is observable in different ways (one of the conditions of start step 6, and a trigger of § Defer to the user); a draft with one workable shape is printed and carried forward, and the independent review and `phase close` are what verify it. A design review prints under the title `Design check`, in this order: the questions and the recommendation, when something is asked (§ Defer to the user); `What it will do` — a bold label, and under it the behavior the design produces, in the person's words; the block of each question; and the appendix — first the items the questions need (§ Defer to the user), in the order of the questions, then three items under fixed names, in this order: `Contract drafts`, `File layout`, and `Settled without asking` (what Claude settled alone). A draft that a question is about moves up among that question's items, named as its material (`Material for 1 — contract drafts`); the other named items carry their name alone. With nothing to ask, the title reads `Design check — no questions` and the work proceeds
- Implement the tasks in the `Plan`. Write the tests at the acceptance criteria and the contracts (`C####`), and make them pass. Fill in "How to run the tests" in CLAUDE.md as soon as the command is settled for the first time
- When a contract or an invariant appears or changes during the work, update the spec at that moment (don't collect them at `close`). The code and the tests are the truth — fix the spec when it disagrees
- Stack small commits as `[S####] <message>`, shaped per schemas.md § Commit convention
- When a small piece of evidence is needed mid-implementation (a quick benchmark of two approaches, say), it is fine to create an `E####` on the spot, run it, and record it
- When research or an experiment on the scale of hours turns out to be necessary, don't do it here — `close`, then propose making it a phase with `replan`
- Run the full test suite before `close` and record the outcome (pass / fail, the numbers) in `Result`
- **An independent review comes before `close`** — after the full test suite, have the session's changes reviewed by a context that did not write them. The base form is a fresh-context review — a subagent, or a new conversation, that only reads the diff — asked to return **numbered findings** (#1, #2, …), each naming the file and line it is about and carrying the grounds the **grounding** condition below calls for; the environment's review command is an acceptable alternative when it has one. The reviewer only reads and replies; the records stay with the session — write the triage into `Result` numbered to match, and when the findings outgrow `Result`, save the reviewer's reply verbatim under `roadmap/assets/<S####>/` with the summary and the reference in `Result` (schemas.md § Template: session log). Review a large diff in bounded slices, writing each slice's result through before requesting the next — a single pass over everything can die with nothing written. Three conditions make a review a verifier: **independence** (the writer doesn't judge its own work), **grounding** (a finding counts only when it is backed by command output, a test, or a reproduction — not by the reviewer's say-so), and **triage** (reviews over-report by nature — record each finding as adopted, rejected, or deferred — set aside as one line in `Deferred` of roadmap.md with its source session and return condition — with the reason, in `Result`). The review passes when every finding is triaged, not when findings reach zero. While the reviewer's reply is awaited, a reply that ends does so with the in-progress notice (§ The Next block). In the records the three words of the triage follow the user's language like any prose — § What the person reads gives them

### research

Research is the phase that takes in a large amount of outside information. Make "written through to a file" the unit of progress, so that an interruption (a usage limit, a crash) cannot wipe out unsaved work.

1. **The manifest comes first** — list the questions the acceptance criteria call for, and create the `R####` file for every one of them before starting any research (`status: planned`, only `Question` filled in; the numbering is settled here too). When a decision phase comes next, **include the integrating question (comparing and narrowing the candidates) as the last `R####` in the manifest**, as the question that depends on all the others. Add another `planned` `R####` whenever research turns up a new question
2. **Write one question through at a time** — move one `R####` to `status: running`, research that question, write it through to its `Conclusion`, set `status: done`, and only then move to the next. With git, commit `[S####] research: R#### <one line>` at every `done`. Don't research across questions in parallel (which includes handing several questions to subagents at once), and don't save the writing until every question is researched
3. **Append per source** — every time one web page, paper, piece of OSS code, or official document is examined, append the source (URL, date accessed, version covered) to `Method` and the essentials of the primary information to `Results`, right then. Don't let fetched results pile up in the context to be written up later. **Don't limit the number of sources** — read as many as the conclusion needs
4. **A `Conclusion` per question** — write that question's conclusion and what it implies for the roadmap before moving to the next question
5. **Measuring during research** — when a small measurement on real hardware becomes necessary along the way (checking the environment, a microbenchmark), it is fine to run it on the spot and record it in the `R####`'s `Method` / `Results` at the same standard of reproducibility as an experiment (commands, environment, versions, data conditions). Put the measurement script under `roadmap/assets/<R####>/` before it goes `done` (SKILL.md ground rule 8). When a measurement on the scale of hours is needed, don't do it here — `close`, then propose making it an experiment phase with `replan`
6. **Keep the sessions small** — aim for two or three questions per session, and `close` even with questions left, carrying on in the next session (the `planned` / `running` `R####` files are the resumption point as they stand)
7. **Start the integrating `R####` only once every question is `done`** — arrange the material for comparing candidates (the differences, angle by angle) in its `Conclusion` as the handover to the decision phase. Even if the work stops before reaching this point, every question's `Conclusion` should stand on its own
8. **Keep environment cost apart from fitness** — when something specific to this environment (not yet installed, needs an update, missing permissions) is the reason a candidate drops in priority or drops out, record it separately from the assessment of fitness, and leave the assessment-if-adopted and the condition for bringing it back in the `Conclusion`. Keep environment cost out of the pre-filter — a candidate must not disappear before it reaches the decision

Save on input per source rather than by reading fewer of them: tell WebFetch exactly which angles to pull out (don't ask for a summary of the whole page) / judge from a paper's abstract and conclusion whether it is worth going deeper / for OSS code, `git clone --depth 1` and search locally instead of walking individual pages on the web.

### experiment
- State the hypothesis in `Question` → build the smallest thing that measures it → measure
- Create the `E####` before the measurement starts (`status: planned` with `Question` and `Method` filled in → `running` when work begins → `done` once the `Conclusion` is written). With git, commit `[S####] experiment: E#### <one line>` on the spot once it is `done`
- Write `Method` so it can be reproduced (commands, environment, versions, data conditions). Put the measurement code and the data-generation steps under `roadmap/assets/<E####>/` and refer to them by path from the `E####` (don't let a reference to a volatile location survive into a `done` file — SKILL.md ground rule 8). For large data that can be regenerated (a benchmark corpus and the like), keep the generation script and the reproduction command instead of the data itself
- Keep the raw data and the tables in `Results` (don't reduce them to the conclusion). Append after each measurement rather than writing everything up at the end
- Check the `Conclusion` against the acceptance criteria. When a target is missed, the Next decision goes to `replan`
- When the measurement doubles as verification of an existing contract (`C####`), add the measurement test to that contract's `verified_by`

### decision (aligning and choosing)
1. Read the `R####` files of the research phase that came before. When there is none, do a light survey at the start of the session and create an `R####`
2. Present 2–4 candidates in **a comparison table that shows the differences** (performance, learning cost, ecosystem, fit with the user's constraints, longevity) — one row per angle and one column per candidate, the recommended candidate in the first candidate column and marked. **The cost of adopting it in this environment (not yet installed, needs an update) is one row of that table, not a pre-filter.** State the condition for bringing back anything dropped for an environment reason (and follow the `Principle` on adoption when there is one)
3. **State the recommendation and why**, and print the whole as a question block under the title `Decision` (§ Show, then ask): in the block of each question, `Effect on the finished product` first, then the comparison table, then `Your options`; the sources go to the appendix. Then present the options with AskUserQuestion (the recommendation first, marked "(recommended)" in the user's language). **The user chooses**
4. Record the decision as a `D-P####-####` in the phase status's `Decisions` and promote it to `Principles` in roadmap.md. Don't write it in the spec — a contract comes into being once a build phase implements it and it is real
5. When the decision affects the premises or the scope of a later phase, propose `replan` on the spot (reflected in the Next decision)
6. Don't write code here — proof-of-concept runs belong to an experiment phase

---

## close

When `close` is called on its own after an interruption (a new conversation, the context gone), go through § Recovery procedure steps 1–4 first — read the session file, reconstruct `Did` / `Result` from the session's own commits and the diff (step 2), settle the running R/E and the uncommitted work — and then run the steps below on what it reconstructed, adding "Note: closed after the fact (recovery)" to the session file at step 1. A `close` in the same conversation that opened the session starts at step 1.

**Before step 1, flush what was held back for the user** — the points collected under § Defer to the user that no checkpoint has asked yet go to the user in one batch: printed in full as a question block under the title `Before closing`, then one AskUserQuestion. The close commit bakes in whatever is still unasked, so this comes first whichever route called `close` (the automatic close of `start`, a direct call, `replan`, `phase close`). With nothing held back, print nothing here — the `Decided` line of the report says so.

1. **Finalize the session log** — fill in `Did`, `Result`, `Learned / Decisions`, and `Handoff` (tidy them up when they were recorded as the work went). Finalize `Roadmap Changes`, `commits`, and `artifacts`, and set `state: closed`. From the close commit on, this file is not rewritten
2. **Update the phase status** — append one line to `Session Log`. Check the acceptance criteria whose evidence is now in place (attaching the evidence: a test reference, an `S####`, an `E####`). Roll the `Outcome Summary` forward when there was meaningful progress (10 lines or fewer)
3. **Consistency check** — confirm that roadmap.md and `spec/` do not disagree with reality. Resolve a roadmap disagreement in the direction of "the status is the fact, fix roadmap.md" and a spec disagreement in the direction of "the code and the tests are the fact, fix the spec", and record it in `Roadmap Changes` when roadmap.md was the one fixed. Self-check this session's artifacts at the same time — whether the paths and IDs they refer to exist, whether an R/E went `done` while its `Method` still refers to a volatile location such as scratchpad, and whether an obvious text anomaly (an unintended language, garbled text) crept in. The mechanical half of this self-check is the roadmap-lint run between step 4 and step 5 (required — see the notes below); keep the reading by eye here to the semantic disagreements between roadmap.md, the spec, and reality
4. **Rewrite the root `status.md` in full** — `Now` for the person, in the five fixed frames (their labels: schemas.md § Template: status.md (root) — one or two sentences each, one sentence one fact, and no paths, IDs, or counts unless the person needs that one to decide), `Next` for the next session (the concrete tasks for following the recommendation, with file paths and referenced IDs — the AI-facing facts belong here and in `Handoff`, not in `Now`), `Open Blockers / Risks`, `Phase Index`. `open_session: null`, `last_session: S####`
5. **Commit** — `[S####] session-close: <summary>`, including the changes under `roadmap/` (skip without git). This commit is recorded neither in `commits` nor in `Session Log` (§ The close commit, and small fixes after close). The summary states what this session's records now hold, not what comes next — the forward-looking part is exactly what `Handoff` and `Next` own (schemas.md § Commit convention)
6. **Report, then decide and show the Next** — report to the person in the skeleton below, and in nothing else:

   ```markdown
   ## S0013 closed — Scan and candidate grouping (P0003)

   - **Where things stand**: Near-identical photos now land in the same group, and a 10,000-photo test folder produces groups.
   - **On track?**: Yes. All three checks of this phase have their evidence.
   - **Effect on the finished product**: The candidates that "compare before deleting" needs come out of real photos.
   - **What is wrong**: Nothing. The threshold for "near-identical" is provisional and can be revisited at the performance check.
   - **Compromise or replan needed?**: No.

   ---
   **Appendix** (only if you want to check)
   - **Decided**: nothing (0 questions)
   - **Verified**: 14 tests pass / records check clean / independent review: 9 findings, all handled (6 adopted, 2 rejected, 1 deferred)
   - **Records**: contract C0002 (the candidate file) added / measurement E0001 done (48 s for 10,000 photos)
   - **Commits**: work a1b2c3d, d4e5f6a / close 9f8e7d6
   ```

   The title names the session and its phase (`replan` and `phase close` give the report their own title — replan step 7, phase close step 7). The five frames are the sentences just written to `Now` at step 4 — the person's view, in their language. The appendix has four lines, in this order: `Decided` (the questions asked and their answers, the decisions recorded — this line always appears, and reads `nothing (0 questions)` when there were none), `Verified` (the tests, the records check, a review, a verification), `Records` (what changed in the records — contracts, the roadmap, the shelves, R/E files), and `Commits`. Of the last three, a line with nothing to report is left out; don't rename, reorder, or add one. Nothing else goes into the report: a correction belongs to `What is wrong`, and what the next session needs belongs to `Handoff`. Then end with the Next block: the recommendation settled from the decision table in § Common rules, the one written to `next_command` and to the `Recommended:` line when `status.md` was rewritten at step 4 (a `close` that runs inside another command ends without the block — § The Next block)

Notes:

- **An invariant holds when the records are at rest.** Updating the records always spans several files, so this procedure necessarily passes through a window where a diagnostic is true and unavoidable — FM-3 between steps 1 and 4, GIT-1 from step 4 until the commit in step 5, BID-1 / BID-2 whenever an R/E and a session file move together. Don't react to a diagnostic inside the window; finish the procedure and confirm at the checkpoint that nothing is left (a GIT-7 warning is the one that may remain — it belongs to the review step of `replan` / `phase close`, not to the close). The records are at rest on a clean working tree and while a session is open, and those are the two states the invariant is about
- **Run roadmap-lint (step 1 of § doctor) and the full test suite between step 4 and step 5 — the lint run is required, not optional** — after the root `status.md` is rewritten and before the close commit. That is the one point where the records are complete and the tree is not yet committed: the only diagnostics that may remain are the GIT-1 window and a GIT-7 warning waiting for its keep / promote / drop, anything else is real and is fixed before the commit, and a green run means the close is safe to land. When neither route of § doctor step 1 can run it (the plugin not enabled, the CLI not installed or not built), don't substitute reading by eye — say so in `Result` (the session file is still uncommitted) and put installing it first in `Next`
- Propose splitting the phase (`replan`) separately from the Next when the phase status has passed 300 lines
- Run `close` even when the session produced nothing (one line in the summary saying so, with the reason)

---

## replan \<topic\>

1. Do this inside the open session. Open a new one when none is open (`Plan`: "replan: `<topic>`") — after § A session left open is checked first
2. Read `status.md`, then the whole of roadmap.md (every phase, `Blockers`, `Parking Lot`, `Deferred`). **Search the Fact layer for what already bears on the topic** — grep the session logs' `Learned / Decisions` and `Handoff`, the titles and `Question` of the `R####` / `E####` files, and the `Deferred` lines for the topic's keywords and the phase IDs it touches, and read what turns up — so the proposal starts from what is recorded, not from memory. **Review the shelves** — for every `Parking Lot` / `Deferred` item (at the least every one roadmap-lint reports as past its shelf life, GIT-7), write one line: keep (rewrite the line with its return condition brought up to date — the rewrite is what resets its clock), promote (into a phase), or drop, with the reason — in the session log's `Result`. A `promote` or a `drop` changes the plan, so it becomes a row of the proposal in step 3; a `keep` is not asked — the appendix of step 3 says how many were kept (its `Shelf review` item: a note that goes before a question without serving it, so that the person sees what the proposal leaves on the shelves), and the `Records` line of the report repeats it (how many were kept, and how many of those had their line rewritten)
3. Analyse the topic and print the proposed change in the skeleton below — `Effect on the finished product` first, then `What changes`: a table of what is there now against what the proposal makes of it, one row per change (a phase added, split, or dropped, an amended `acceptance`, changed `depends`, an updated principle, a shelf item promoted or dropped, an earlier decision or a contract the proposal overturns):

   ```markdown
   ## Plan review — 1 question
   1. Also measure the rate of wrong photos in a group, in the performance-check phase?

   **Recommendation**: "Change the plan as proposed."

   ### 1. Add a measurement to the performance check
   **Effect on the finished product**: "A different photo rarely gets into a group" becomes a number instead of an impression. The performance check takes about half a day longer.

   **What changes**

   | | Until now | This proposal |
   |---|---|---|
   | What the performance check measures | Speed | Speed, and the rate of wrong photos in a group |
   | The order of the phases | — | Unchanged |

   **Your options**: Change the plan as proposed (recommended) / Leave the plan as it is

   ---
   **Appendix** (only if you want to check)

   **A. Material for 1 — the text that goes into the plan**: one check added to the performance check (P0005). Full text: roadmap/assets/S0014/replan-draft.md

   **B. Shelf review**: 3 kept (lines untouched)
   ```

   A proposal that adds or details a phase shows it under `What changes` as `Proposed new phase — <name> (P####)` with its phase lines — `Goal`, `Why`, `Outcome`, what the person approves — and its checks and `Depends on` go to the appendix. When the full text of the change (the entries as they would stand in roadmap.md) is longer than the printout should carry, write it under `roadmap/assets/<S####>/` first and point the appendix at it: the agreement comes before the edit, so the records do not hold that text yet. A proposal that itself overturns an earlier decision or a contract says so inside its own question, not in a second one (two questions that bind each other cannot be answered apart): the question's sentence names what it changes (`… (This changes what was decided earlier.)`), `What changes` carries it as a row, and the records it collides with go to the appendix (`Records for <n>`). That one question already gives what § Defer to the user asks of a point — the effect (`Effect on the finished product`), what is overturned (the question's sentence and its row), the records (the appendix), the recommendation, and an option that overturns nothing (`Leave the plan as it is`, which is how the person refuses the overturning) — so the proposal takes no five-line block of its own
4. Ask once (§ Show, then ask), and edit roadmap.md only after agreeing with the user. For phase numbers, the order of entries, and tombstones, follow schemas.md § Changing phase numbers — whether a change is a rewrite that keeps the number (same purpose, or reordering) or a drop plus a new number (a replaced purpose) is judged by "does this change what a past record meant?"
5. Record the change and the reason in the session log's `Roadmap Changes` (`roadmap_changed: true`). Collapse it to one line in the phase status
6. Bring the phase status's `Acceptance Progress` into step when the current phase's `acceptance` changed
7. Run a normal `close` when this command opened a new session; its report takes the title `Plan revised — <what changed, in a phrase> (S####)`. The Next is normally `/roadmap start`. A replan that ran inside a session already open does not close it: it prints that title and, below a rule, the `Decided` and `Records` lines of the appendix — no five frames, because `Now` is not rewritten until that session closes. It prints no Next block of its own: the session's work resumes, and its `close` prints the one Next block. A reply that ends before that ends as § The Next block says — with the in-progress notice while the work waits, with the Next block `/roadmap close` when the person asked for the session to stay open

---

## phase close

1. Open a short session **on the phase being closed** when none is open (`Plan`: "phase close: P####") — after § A session left open is checked first
2. **Have the acceptance criteria verified, then ask once** — three moves, in this order, with the two checks listed after them settled before the second, so that a shelf question is part of the printout:
   - **Verify** — a context that did not do the work verifies every criterion from its evidence: a subagent, or a new conversation, that reads the phase status, the criteria, and the evidence they name, runs the tests first of all and otherwise opens the `E####` / `R####` / `S####`, and returns **numbered verdicts** (#1, #2, …: the criterion, met or unmet, and what it checked). It is the same base form as the independent review of § build and stands under the same three conditions — **independence** (the writer does not judge its own work), **grounding** (a verdict counts only when it is backed by command output, a test, or a record the verifier opened), and **triage** (the session running `phase close` writes every verdict into its `Result`, numbered to match — verbatim under `roadmap/assets/<S####>/` when they outgrow it — and says where it disagrees and why; a criterion already checked (`[x]`) that the verifier finds unmet goes back to `[ ]`, since the phase status is the source of truth). In the records the verdicts read `passed` / `failed` in the user's language (§ What the person reads). While the verdicts are awaited, a reply that ends does so with the in-progress notice (§ The Next block)
   - **Judge and print** — judge whether the phase's `outcome` holds — the session's judgment, made from the verified criteria and the evidence; say what was not measured — and print the skeleton below as ordinary output (§ Show, then ask):

     ```markdown
     ## Phase boundary — 2 questions
     1. Accept the outcome of the phase that ended, "Scan and candidate grouping", and close it?
     2. Start the next phase, "Compare-and-delete screen", as proposed?

     **Recommendation**: 1 — "Accept and close". 2 — "Start as proposed".

     ### 1. The phase that ended — Scan and candidate grouping (P0003)

     **What was promised**
     - **Goal**: Scan a folder and group duplicate and near-duplicate photos.
     - **Why**: "Compare before deleting" needs candidate groups before anything else.
     - **Outcome**: Point it at a folder and it shows the groups of the same photo — 10,000 photos in under a minute, with few wrong photos in a group.

     **Result — the outcome holds**
     - **Where things stand**: Grouping works, and real photos produce groups.
     - **On track?**: Yes. A verifier that did not do the work passed all three checks.
     - **Effect on the finished product**: What the compare screen needs is in place — 48 seconds for 10,000 photos.
     - **What is wrong**: The rate of wrong photos in a group has only been checked by eye.
     - **Compromise or replan needed?**: No.

     **Not verified**: the rate of wrong photos as a number (no error in 20 groups checked by eye).

     **Your options**: Accept and close (recommended) / Change the plan / Carry the phase on

     ### 2. The next phase — Compare-and-delete screen (P0004)

     **Proposal**
     - **Goal**: Compare the photos of a group and send the chosen ones to the recycle bin.
     - **Why**: This is the core of the tool, and "a deleted photo always goes through the recycle bin" is kept here.
     - **Outcome**: Each group shows its photos side by side; pick the one to keep and the rest go to the recycle bin, from which a mistake can be undone.

     **Your options**: Start as proposed (recommended) / Adjust

     ---
     **Appendix** (only if you want to check)

     **A. Grounds for 1 — the verification of the checks** (the verdicts of a verifier that did not do the work)

     | # | Check | Verdict | Grounds |
     |---|---|---|---|
     | 1 | 10,000 photos within 60 s and 1 GB | passed | re-measured: 48.2 s, 640 MB |
     | 2 | Exact and near duplicates land in one group | passed | 14 tests pass |
     | 3 | The review's findings are all handled | passed | 9 findings (6 adopted, 2 rejected, 1 deferred) |

     **B. Checks for 2** (what the AI verifies)
     1. The photos of a group are shown side by side
     2. A photo not chosen goes to the recycle bin and is never deleted outright
     3. 10,000 candidates do not stall the screen
     4. The review's findings are all handled

     Depends on: P0003
     ```

     The order is fixed: the questions and the recommendation; the phase that ended — what was promised, the result (whether the outcome holds, in its heading, and the five frames of `close` under it, now about the phase), what was not verified, the options; the next phase — the proposal (step 5) and the options; the shelf review, when it has a question, as the last block; and the appendix — the verification table for the first question, the next phase's checks and `Depends on` for the second. Notes that need no decision are kept for the report of step 7. A phase detailed before `outcome` existed is judged and accepted on its `goal`, and `What was promised` is then that one line; when no phase is left to detail, the second block is absent
   - **Ask once** — one AskUserQuestion that asks the questions of the printout, under the same numbers and in the same words: whether to **accept the outcome and close the phase, or change the plan** — when a criterion is unmet, amend, defer, or drop **that criterion** (each of the three is `replan` — the criterion changes, the `[x]` / `[ ]` notation does not) or carry the phase on to meet it (the Next is `start`); when every criterion is met and the outcome still does not hold, add or amend a criterion that captures what is missing (`replan`) or carry the phase on — and whether the **next phase's (or phases') `goal`, `why`, and `outcome`** stand (when no phase is left to detail, the second question is absent; a `promote` or a `drop` from the GIT-7 review below joins as one more numbered question). Don't walk the criteria one at a time with the user, and don't ask again for what the printout already shows. The evidence goes in `verified:`, followed by the session whose `Result` holds the verdicts and the verdict's number (`verification S#### #n`, with the word the words tables give for the verification — schemas.md § Template: phase status.md)
   - On a build phase, confirm at the same time that the independent review before `close` ran (§ build) — the findings and their triage in a session's `Result` are the evidence. When no session ran it, run it now before closing, or record why it is skipped in the session log (a review criterion the phase carries stays subject to the unmet rule above)
   - When roadmap-lint reports GIT-7 warnings, review those `Parking Lot` / `Deferred` items here as well — keep (rewrite the line) / promote / drop, one line of reason each; the items it does not report can wait for the next `replan`. A `promote` or a `drop` changes the plan, so the person decides it: fold it into the same single question, as one more numbered question with a block of its own (`### <n>. Shelf review — <the item>`: `Proposal`, with the action and its reason in a line, then `Your options` — the proposed action first, then the other two). Several such items still make one numbered question: the block is `### <n>. Shelf review`, `Proposal` takes one line per item, and the options are to follow the proposal, to keep them all, or to adjust. A `keep` is not asked — it goes to the `Records` line of the report (how many were kept, and how many of those had their line rewritten)
3. **Settle the contracts** — 1. review the contracts this phase produced or touched, and move the ones whose implementation has settled from `draft` to `stable`, updating `verified: S####`. **Re-read the contract's prose before raising it to `stable` and confirm that it does not disagree with the implementation in `source`** (the same angle as doctor check 8 — the prose can be out of date even when the tests pass). 2. promote any met criterion that is a promise to keep from here on and is not yet a contract into the spec as a `C####` (with the verifying test in `verified_by`, or `manual` when there is none). 3. rewrite `spec/map.md` (`System Map`, `Invariants`, `Spec Index`) to match reality when the structure changed
4. **Summarize, and fold the entry** — settle the phase status's `Outcome Summary` (10 lines or fewer; its first line says whether the phase's `outcome` held, as judged at step 2) and set `state: done`. Update the phase's heading in roadmap.md to `done`, and **fold the entry down to the heading plus a one-line `goal`**: the `type`, `why`, `outcome`, `acceptance`, `depends`, `blockers`, and `notes` of a phase that is over have done their work, and the phase status carries the same criteria with the evidence attached and says whether the outcome held (the copy in roadmap.md is the one without the evidence). **Keep the heading** — the three-way check (ID-2) reads it, and it is what keeps a past `P####` reference legible. Fold the phase in the same edit that sets it `done`, not later; roadmap-lint (SIZE-7) reports roadmap.md past 200 lines, which is what a backlog of unfolded phases looks like
5. **Detail the next phase** — to keep the detailing horizon (the active phase and the next one or two), take the next phase (and the one after it when needed) from its `goal` and `why` down to `outcome`, `acceptance`, and `depends` (as at init step 3). An entry written before `why` and `outcome` existed gets them here (a coarse one along with the rest of its detail; a detailed one keeping its `acceptance` unless it has to change), so that the question of step 2 has them to put to the person. The person approves the `goal`, `why`, and `outcome` in the single question of step 2 — printed before it, with the `acceptance` and `depends` below as an appendix — and when the person adjusts them, fix the entry and go on. Record the changes in `Roadmap Changes` (a build phase that changes code takes the review criterion by default — the stock form in schemas.md § Template: roadmap.md, left out only with the reason recorded)
6. **Activate the next phase** — set the next phase to `active` in roadmap.md, create the phase directory and its `status.md`, and update `current_phase` and `Phase Index` in the root `status.md`. Write pointers to the material the new phase starts from (the integrating `R####`, the `Handoff` of the session that led here) as the initial content of its `Outcome Summary`. Land the three places a phase's state lives (the heading in roadmap.md, the `phases/` directory, `Phase Index`) in the same commit, so roadmap-lint's three-way check (ID-2) passes per commit as well. Work the three into step by **what is left**, not by memorizing an order of edits — roadmap-lint keeps listing whatever is still inconsistent whichever order the edits go in (at every edit, with the hook in place), so the transition is done when nothing is left
7. Close the session (the normal procedure). The report is the skeleton of close step 6 under the title `Phase closed — <the phase that ended> done, <the next phase> started (S####)` (`… done — every phase is over`, when none is left). Its five frames are not a repeat of step 2's: those were about the phase that ended, and these are the `Now` just written — where the project stands with the next phase started. The answers the person gave go to the `Decided` line of the appendix. The close commit takes the `phase-close` label, since it records the transition (schemas.md § Commit convention). The Next is normally `/roadmap start — S####: start P#### (<next phase name>)`

When every phase has gone `done` or `dropped`: the project is complete. Step 5 and step 6 have nothing to detail or activate, and the rest goes as follows.

- **Leave `current_phase` on the phase that just closed** — it is a required key and it holds a `P####`, so there is nothing else it could name once no phase is active. roadmap-lint accepts a `done` `current_phase` in this state, and only in this state (ID-2 keeps reporting it while any phase is still `active`, `planned`, or `blocked`)
- **Present a final summary** that puts the `Vision` against every phase's `Outcome Summary` — inside the report of step 7, not beside it: its five frames are then about the whole project (`Effect on the finished product` says what of the `Vision` the phases delivered and what they did not), and the `Records` line of the appendix lists the phases, each with the first line of its `Outcome Summary`
- **The Next is `/roadmap replan <topic>`** — the recommendation reads as complete, with carrying on as an extension phase behind it (`Recommended: /roadmap replan <topic> — complete: every phase is done or dropped; raise an extension phase to carry on`). The Next block always names a command, so "complete" is the reason, not the command
- Completion is not an end state the records lock in. A defect or an improvement found in real use comes back as an extension phase through `replan`, and `current_phase` starts moving again the moment one goes `active`

---

## status (read-only)

1. Read `roadmap/status.md` and print, in this order: the title `Where the project stands — <project name>`; the five frames of `Now` as they are written; `Stopped or worrying` — the `Open Blockers / Risks` that matter to the person, in a line or two, or "nothing" (the note of step 2 and the pointer of step 5 are lines here, when they apply); and `Phases` — how many are done, the active one by name, how many are ahead. The tasks of `Next` are for the next session and are not printed
2. When `open_session` is still set, say so under `Stopped or worrying`, in the person's words: a session is still open, and `/roadmap close` closes it
3. Don't change any file
4. Show the saved `next_command` in the Next block as it stands
5. When the records themselves (references, IDs, size limits) are to be checked as well, point at the records check (`/roadmap doctor`) in the same place

---

## doctor (a read-only consistency check)

Check the whole of `roadmap/` and report what turns up under the title `Records check — <n> findings need action`, as a table with one row per finding: where (the file and the line), what is happening (in the user's language, with the rule ID in parentheses — or `meaning check` for a finding of checks 8 and 9), and what to do about it. The mechanical checks (checks 1–7 — references, bidirectional references, front matter, size limits, ID discipline, text anomalies, git) are **delegated to roadmap-lint**, and Claude runs the lint, reads the diagnostics across, and carries out the semantic checks (8 and 9). Don't change anything under `roadmap/`, in the project's source, or in the git state (point out that the fixes belong in the next session's `Plan`). Running a safe verification command such as the test suite is allowed — untracked output (`__pycache__` and the like) appearing is acceptable. Use it before a `phase close`, when picking the project up after a while, and whenever the records are suspected of having drifted. A green lint means the records are well-formed, not that they are true — what the frames, the conclusions, and the contracts say is tested by the semantic checks (8, 9), the reviews, and the user, not by the lint.

### Step 1: run roadmap-lint (checks 1–7, delegated)

Run it over the directory that contains `roadmap/` (normally the project root), by the first of these two routes that is there:

1. **The plugin's tool** — `mcp__rdd-kit__roadmap_lint`, which the rdd-kit plugin registers (it is in the tool list while the plugin is enabled). Both of its inputs are optional: `path` (the directory that holds `roadmap/`, or `roadmap/` itself — relative to the project root, or absolute; the default is the project root) and `format` (`text` or `json`; the default is `text`). It returns the same report the CLI prints, and an error result when it cannot find `roadmap/`, the format is wrong, or the lint itself fails — read the error, fix the path, and call it again
2. **The CLI** — where the plugin is not installed:

   ```
   roadmap-lint [path] [--config <path>] [--format text|json] [--fail-severity error|warning]
   ```

   - `path` defaults to the current directory. The config is found automatically as `.roadmap-lint.json` next to `roadmap/` (override it explicitly with `--config`). Use `--format json` for machine processing
   - **How to read the exit code:** 0 = no diagnostics at or above `--fail-severity` (`error` by default). **Warnings can still be there — always read the output itself.** 1 = there are some. 2 = an execution error (invalid arguments, invalid config, a missing target — not a lint result; fix the command, the path, or the config and run it again)
   - **How the CLI is resolved:** 1. the `ROADMAP_LINT_BIN` environment variable when it is set (the program to run — a `.js` / `.cjs` / `.mjs` file runs under `node`), 2. `roadmap-lint` on the PATH (an npm install), 3. in a checkout of the linter's own repository, `node <checkout>/packages/cli/bundle/roadmap-lint.cjs`. The plugin carries no CLI, so there is nothing to look for in a plugin folder. Don't conclude "not installed" from the absence of one of them alone

The tool and the CLI run the same rules with the same config and print the same report. Report the situation and the installation steps when neither route can run it (the plugin not enabled, the CLI not installed or not built). Don't substitute reading checks 1–7 by eye

How the checks map to the rules (roadmap-lint runs all 35 rules — the ones under checks 1–7 and, on top of them, the structural ones in the last row):

| Check | Rules |
|---|---|
| 1 References | REF-1 (a referenced ID exists, judged by layer — a resolved `B####` or a retired `C####` may be named only in the Fact layer), REF-2 (a referenced path exists — the `source` / `verified_by` of a contract and the `status` column of `Phase Index`, a relative Markdown link, and a path-like token in inline code), REF-3 (a `done` R/E referring to a volatile or untracked path) |
| 2 Bidirectional references | BID-1, BID-2 (a session's `artifacts` against an R/E's `created` / `completed`), BID-3 (session files against Session Log rows, per phase — a closed session with no row, a row whose session is in another phase) |
| 3 Front matter | FM-1–FM-4 (required keys, allowed values, `open_session` against the real session, a conditional key against another key or against the file name or location — an R/E's `completed` against `status` and its `id` / `type` against its file name, a phase status's `closed` against `state` and its `phase` against its directory, a session's `session` against its file name and its `phase` against its directory) |
| 4 Size limits | SIZE-1 status 60 lines (the Phase Index section is not counted) / SIZE-2 map 80 lines / SIZE-3 a contract 200 lines / SIZE-4 `Outcome Summary` 10 lines / SIZE-5 `Session Log` one line / SIZE-6 a phase status 300 lines / SIZE-7 roadmap.md 200 lines |
| 5 ID discipline | ID-1 (a duplicate ID — including a `C####` defined both in a domain file and in map.md `Invariants` — and a gap in the session numbers — `warnSessionGaps`), ID-2 (the three-way phase check), ID-3 (the naming conventions) |
| 6 Text anomalies | TXT-1 (garbled text, control characters; the mixed-language check is opt-in), TXT-2 (broken Markdown — an unclosed code fence, front matter that is unclosed or that YAML cannot parse, an uneven table column count), TXT-3 (merge conflict markers left in a file) |
| 7 git | GIT-1 (uncommitted changes under `roadmap/`), GIT-2 (a commit without the `[S####]` prefix — the commit that first tracked `roadmap/` and everything at or before an optional `sinceCommit` are out of scope), GIT-3 (a tracked file matching `.gitignore`), GIT-4 (a commit label outside the vocabulary), GIT-5 (a subject ending with a period — GIT-4 and GIT-5 take a `sinceCommit` exemption with the same meaning as GIT-2's, each read from its own rule's `options`), GIT-6 (session records against git history — `base_commit` and `commits` entries must exist in it, and a subject's `[S####]` must name a real session; the subject check takes its own `sinceCommit` too — there is no shared value, so set it under every rule that should skip the old history), GIT-7 (a `Parking Lot` or `Deferred` item in roadmap.md that no commit has touched for more than 30 days — `maxAgeDays`. Each item is dated by `git blame` from the last commit that changed its lines, so the result depends on the day the lint runs; a warning like GIT-1, cleared by the keep / promote / drop step of `replan` or `phase close`) |
| (on top) | STRUCT-1–STRUCT-4 (the H1 and the required headings, duplicated or out-of-order fixed headings, `next_command` against the Next section and `roadmap_changed` against the `Roadmap Changes` section, a contract without a `verified_by`), FILE-1 (a file outside the conventions) |

The numbers in checks 4 and 7 and the vocabularies in checks 6 and 7 are the defaults. An `options` entry in `.roadmap-lint.json` replaces one, for what the lint accepts and for what the records are written to alike (SKILL.md ground rule 10) — this table is where a rule ID is matched to the default it carries.

### Step 2: read the diagnostics

- Every diagnostic is "file:line, rule ID, what it is, what to do about it (`suggestion`)". The rule for responding: **suspect the records first and bring them in line with the conventions**. The Fact layer (a closed session, a `done` R/E) takes only notation fixes that don't change the meaning — use `superseded_by` when a conclusion or a number is being overturned (SKILL.md ground rule 5)
- GIT-1 drops to a notice while a session is open (`open_session` not null) and stays out of the diagnostic list. The warning during a `close` (between setting `open_session` to null and the close commit) is a **true positive** — don't suppress it; it clears when the close commit lands
- GIT-7 (a `Parking Lot` or `Deferred` item past its shelf life) is a warning of the same kind — a true positive that the keep / promote / drop step of the next `replan` or `phase close` clears. Rewriting the item's line is what resets its clock; leaving it as it is keeps the warning
- The notices at the end of the output are not diagnostics, and they come in three kinds. A skip that is normal — the GIT rules skipped when git is absent, GIT-1 dropped to a notice while a session is open, GIT-7 skipped in a shallow clone, on an untracked roadmap.md, or in a repository with no commits yet — needs no action. A setting the lint could not use — a value of the wrong shape (a `maxLines` written as a string, a `labels` value that is not a list), an option key the rule does not have, a `sinceCommit` that is not a commit hash, an entry of a list the rule cannot use (a script name it does not know, an empty volatile root) — means the lint left that value out: the option fell back to its default, or that entry was dropped while the rest of its list applied (and a check whose list has no entry left is off for the run). Fix the value in `.roadmap-lint.json` — until then the records are held to the default, not to the value written. Two notices ask for a look rather than a fix: a `sinceCommit` the lint could not find is normal when the hash points at or before the commit that first tracked `roadmap/` (everything up to that commit is out of scope anyway, so the setting may go) and a typo otherwise; a GIT-7 skip because `git blame` and the parser disagree on the line count points at a lone CR in roadmap.md (normalize its line endings) or at a file that changed while the lint ran (run it again)
- When a false positive is suspected (a diagnostic on a record that follows the conventions), judge it against the matching schemas.md template. When it genuinely cannot be made to fit in practice, adjust `enabled` / `severity` / `options` per rule in `.roadmap-lint.json` and leave the reason for the adjustment in the session log

### Step 3: the semantic checks (Claude does these — not delegated)

8. **Contracts against the implementation** — whether a `C####`'s prose and `verified_by` disagree in meaning with the implementation in `source` (sampling the main ones is enough when there are many contracts). Report a disagreement with the response "the code is right, fix the spec"
9. **Records against measurements** — back up the most recent verification a record claims (a test count, pass / fail) with a single run, but only when it can be run safely

End with two lines: `Breakdown` — how many findings came from the mechanical check (the lint diagnostics) and how many from the meaning check (the semantic checks) — and `What happens to this result`. **A doctor finding is left in no file** (this is read-only), so say so there when at least one finding needs action, and point out that it belongs in the next `start`'s `Plan` when the conversation continues, or that the output should be saved and carried into the next conversation (or the check run again) when the conversation is ending. With nothing to act on, the title reads `Records check — nothing needs action` and the table is absent. Show the saved `next_command` in the Next block as it stands (`doctor` does not save one).
