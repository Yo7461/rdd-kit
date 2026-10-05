# schemas.md — the source of truth for generated schemas and templates

This file defines the format of every file the skill creates or edits in the target project. Check the matching template here before creating or editing any file.

The format is Markdown with YAML front matter. Structure (IDs, states, dates, commits) lives in the front matter and the fixed headings; the content itself is free prose. Headings and keys stay in English; the prose inside them goes in the user's language. Inside a table cell, write a pipe as `\|` — an unescaped one splits the row, and roadmap-lint (TXT-2) reports the uneven column count. A section with nothing in it holds one line in parentheses rather than an empty heading — `(none)`, in the user's language — unless its template gives its own wording (`(no open blockers)`) or says to drop the section (`Roadmap Changes` in a session log).

## Contents

- [Directory layout (target project)](#directory-layout-target-project)
- [IDs and naming](#ids-and-naming)
- [Where each kind of information goes](#where-each-kind-of-information-goes)
- [Size limits](#size-limits)
- [Template: roadmap.md](#template-roadmapmd)
- [Template: status.md (root)](#template-statusmd-root)
- [Template: phase status.md](#template-phase-statusmd)
- [Template: session log](#template-session-log)
- [Template: research and experiment files](#template-research-and-experiment-files)
- [Template: spec/map.md](#template-specmapmd)
- [Template: contract file](#template-contract-file)
- [Template: CLAUDE.md snippet](#template-claudemd-snippet)
- [Template: .gitignore](#template-gitignore)
- [Commit convention](#commit-convention)
- [Working without git (degraded mode)](#working-without-git-degraded-mode)

## Directory layout (target project)

```
roadmap/
├── roadmap.md                       # Intent layer (the only planning file)
├── status.md                        # Now layer (60 lines or fewer, Phase Index not counted)
├── spec/                            # Spec layer (a snapshot of the present, rewritten to follow reality)
│   ├── map.md                       # Entry point: map, invariants, index (80 lines or fewer)
│   └── api.md                       # Contract ledger, one file per domain (api / cli / storage, …)
├── phases/
│   └── P0002-core-engine/           # P#### plus a kebab-case slug
│       ├── status.md                # The phase's cumulative record
│       └── sessions/
│           └── S0013.md             # Session log (immutable once closed)
├── research/
│   └── R0001-vector-db-comparison.md
├── experiments/
│   └── E0001-sync-latency-bench.md
└── assets/
    └── R0002/                       # Scripts and reproduction assets an R/E Method refers to, one directory per ID
        └── tokenize_compare.py
```

Read in a three-step pyramid: `status.md` (small), then the relevant part of roadmap.md plus the phase `status.md` plus `spec/map.md`, then session logs, artifacts, and contract files (only when needed). `research/`, `experiments/`, and `spec/` sit outside `phases/` because several phases refer to them — the link is made through front matter or `since` instead. Create `research/` and `experiments/` during `init` with a `.gitkeep` in each (git does not track empty directories). Create `assets/` in the session that puts the first asset there, and split its contents by ID — R/E IDs for reproduction assets, and a session's `S####` for a review reply, or the verdicts of a `phase close` verification, saved verbatim when they outgrow `Result` (§ Template: session log).

## IDs and naming

| ID | What it identifies | Form | How it is assigned |
|---|---|---|---|
| P#### | Phase | Four digits, zero-padded | The highest already in roadmap.md, plus 1 |
| S#### | Session | Four digits, zero-padded. Counts across the whole project (never resets per phase) | The highest in `roadmap/phases/*/sessions/S*.md`, plus 1 |
| R#### | Research | Four digits, zero-padded | The highest in `roadmap/research/R*.md`, plus 1 |
| E#### | Experiment | Four digits, zero-padded | The highest in `roadmap/experiments/E*.md`, plus 1 |
| C#### | Contract or invariant | Four digits, zero-padded | The highest anywhere, including deleted ones and session logs, plus 1. A number freed by a retirement is never reused |
| B#### | Blocker | Four digits, zero-padded | The highest anywhere, including session logs, plus 1. A number freed by a resolution is never reused |
| D-P####-#### | Decision | Sequential within the phase (each part four digits, zero-padded) | The highest in that phase status's `Decisions`, plus 1 |

- IDs are permanent. Don't reuse, renumber, or delete them. Retire a phase as `dropped` — a tombstone, not a deletion. Contracts (`C####`) are the one exception: delete the entry of a contract that no longer exists in reality (the number stays vacant, and the reasoning stays in the session log)
- File-name slugs are short, lower-case kebab-case (`P0002-core-engine`, `R0001-vector-db-comparison`)
- **Order and numbers are independent** — the order of entries inside the `Phases` section of roadmap.md is the plan order, and the number is a permanent ID in the order it was handed out. To insert a phase, give it the next vacant number and write it at its place in the plan order (P0007 may sit between P0002 and P0003)
- **Write example IDs as code** — put an ID in backticks (or a code fence) whenever prose mentions one that does not exist yet — a sample, a placeholder, or an ID a later step will create (a contract the first build session is going to raise, say; the next session number is the one exception, below) — because roadmap-lint's reference check (REF-1) does not treat an ID inside code as a reference. The same goes for anything else that would become a finding of its own, such as a violation example or a sample of garbled text — keep it out of the record's prose, or put it in code
- **A forward reference to the next session number is allowed** — mentioning the session number that would be "the highest plus 1" before it exists (the `next_command` `S0025: …` and Handoff `S0025 starts with …` conventions) is normal, and roadmap-lint exempts it in every file
- **Three words that look alike** — `verified` (a key of the contract's YAML block, folded into an `Invariants` line as `verified: S####`) is the session that last checked the contract against reality; `verified_by` (the same block, or the tail of an `Invariants` line) is the test that holds the contract up, or `manual`; `verified:` on an `Acceptance Progress` line is the evidence a criterion was judged on (a test reference, an `S####`, an `E####`, an `R####`), followed at `phase close` by the verdict that checked it (`verification S#### #n`). Read the word by where it sits: in a contract it names a session; on a criterion it names evidence, and from `phase close` on also the verdict that checked it. A test reference goes in `verified_by`, never in `verified`

### Changing phase numbers

Permanent numbers have one purpose — keeping the meaning of every `P####` reference in the append-only Fact layer (session logs, R/E files) intact. The test for which case applies is always the same: **does this change what a past record meant when it mentioned that phase?**

- **A change to a `planned` phase falls into one of three cases:** 1. same purpose, different wording (rephrasing the `goal`, adjusting the `acceptance`) — keep the number and rewrite in place, consuming no number. 2. reordering (a different order of execution) — keep the number and move only its position inside `Phases`. 3. a replaced purpose (it becomes a different thing, so what past records meant changes) — set the old phase to `dropped` and open a new phase with the next vacant number
- **A tombstone may collapse to one line** — a `dropped` phase needs nothing but its heading (`### P####: <phase name> — dropped`); drop the `type`, `goal`, and other details
- **A `done` phase folds to its heading plus a one-line `goal`** — drop the `type`, `why`, `outcome`, `acceptance`, `depends`, `blockers`, and `notes` at `phase close` (workflows.md § phase close step 4). From then on the criteria live in the phase status's `Acceptance Progress`, with the evidence the roadmap.md copy never had, and the phase status's `Outcome Summary` says whether the outcome held; what stays in the Intent layer is the one line that keeps a past `P####` reference legible. The heading is not optional — ID-2 reads it
- **Don't put the reasoning in a tombstone, in `Parking Lot`, or in `Deferred`** — no history, no rationale, no mention of an old number (history belongs in that session log's `Roadmap Changes`, per ground rule 3). Write only what lies ahead and the condition for bringing it back
- **A number is a permanent ID; the order of entries is the plan order** — don't read an order of execution out of the numbers, and don't write one into them. Only the order of entries inside `Phases` carries the plan order (see "Order and numbers are independent" above)

## Where each kind of information goes

| Information | Where it goes |
|---|---|
| What to do next, and what the plan looks like after a change | roadmap.md (overwritten) |
| Why the plan changed | That session log's `Roadmap Changes` (collapsed to one line in the phase status) |
| What to do right now, and the recommended command | `status.md` (rewritten in full) |
| The facts and the evidence of the work | The session log |
| Findings worth reusing (research, experiments) | An `R####` / `E####` file |
| The promises the system actually keeps (map, contracts, invariants) | `spec/` (rewritten to follow reality — the code and tests are the truth) |
| A decision that generalizes | The phase status `Decisions`, promoted to roadmap.md `Principles` |
| Scripts and reproduction assets an R/E `Method` refers to | `roadmap/assets/<ID>/` (in place before it goes `done`) |
| The reviewer's full reply, when it outgrows the session `Result` | `roadmap/assets/<S####>/` (verbatim; `Result` keeps the numbered triage summary and the reference) |
| Why a phase exists, and what the person sees once it is over | That phase's `why:` and `outcome:` in roadmap.md — what the person approves at `init`, at `phase close`, or in a `replan` (folded away with the rest when the phase is done; the phase status says whether the outcome held) |
| The verdicts of the acceptance-criteria verification at `phase close` | The `Result` of the session that ran `phase close`, numbered (verbatim under `roadmap/assets/<S####>/` when long), and `verification S#### #n` after the evidence in `Acceptance Progress` |
| A caveat or review angle that matters in a future phase | That phase's `notes:` in roadmap.md (promoted to `acceptance` when the phase is detailed) |
| An idea that is off the schedule | roadmap.md `Parking Lot` — one line with the condition for bringing it back |
| A review finding or a leftover set aside for later | roadmap.md `Deferred` — one line with the session it came from (`S####`) and the condition for taking it up. The reviewer's full reply stays in the session `Result` or under `roadmap/assets/<S####>/`; the shelf holds the item, not the history |

The line between `Principles` and the spec: **a promise that can be verified by testing the artifact** belongs to a contract in the spec, and **a policy, a choice, or a non-goal that guides future judgment** belongs to `Principles`. For example, "use PostgreSQL" is a Principle, while "migrations stay compatible one version back" is a contract in the spec.

## Size limits

- `status.md` (root): 60 lines or fewer, not counting the `Phase Index` section (the index grows by one row per phase for the life of the project, so the limit measures the human entry point above it). Narrow the `Next` tasks when it grows past that
- `spec/map.md`: 80 lines or fewer. Split a contract file (`spec/<domain>.md`) into domains once it passes 200 lines
- The phase status `Outcome Summary`: 10 lines or fewer (the only section that may be rewritten as it rolls forward)
- `Session Log`: exactly one line per session
- A phase status past 300 lines is a sign the phase is too large — propose splitting it with `replan`
- roadmap.md: 200 lines or fewer. The detailing horizon runs both ways — **ahead**, detail (down to `outcome` and `acceptance`) only the active phase and the next one or two, and everything beyond keeps a one-line `goal`, a one-line `why`, and a `type`; **behind**, a `done` phase folds to its heading plus a one-line `goal` and a `dropped` one to its heading alone (§ Changing phase numbers). Without the backward half the Intent layer fills up with phases that are already over — the horizon ahead alone does not keep this file small
- **One sentence, one fact.** A limit is met by leaving detail out, not by packing it in — don't chain facts with commas to stay inside a line count. A `Session Log` row is one sentence on what the result means plus the IDs it rests on; a `Now` frame is one or two sentences; the first line of an `Outcome Summary` is one sentence on what the phase's result means. When a limit bites, move the detail to the session log or to the phase status, and leave the sentence readable

Every limit here is a default. When the project has a `.roadmap-lint.json`, the `maxLines` it sets under a rule's `options` is the effective limit to write to (SKILL.md ground rule 10). `Session Log` is the one that takes no option — one line per session is a structural rule, not a threshold.

---

## Template: roadmap.md

```markdown
---
project: <project name>
updated: <YYYY-MM-DD>
---

# Roadmap: <one-line description>

## Vision
<2–5 lines: what is being built, why, and what finished means. A direction, not a specification>

## Principles
<- Settled technical choices, constraints, and non-goals. Promoted from decision phases and from session decisions>

## Phases

### P0001: <phase name> — active
- type: research
- goal: <one sentence>
- why: <one sentence: what the finished product lacks without this phase, in terms of the Vision>
- outcome: <one or two sentences: what the person sees or can do once the phase is over — what the person accepts at phase close>
- acceptance:
  - <an end state that can be checked, with the way to verify it — and what must not change, when something must stay as it is>
- depends: —
- blockers: —

### P0002: <phase name> — planned
- type: decision
- goal: <one sentence>
- why: <one sentence>
- outcome: <what the person sees or can do once it is over>
- acceptance:
  - <a condition>
- depends: P0001
- notes: <caveats and review angles that matter in this phase, with R#### references. Optional>

### P0003: <phase name> — planned
- type: build
- goal: <one line only — detail it at phase close>
- why: <one line>

## Blockers
| ID | blocks | Description | State |
|----|--------|-------------|-------|
| B0001 | P0002 | <description> | open |

## Parking Lot
- <An idea that is not on the schedule, with the condition for bringing it back — so the roadmap stays honest>

## Deferred
- <A review finding or a leftover set aside: one line each, with the session it came from (S####) and the condition for taking it up>
```

**How to fill it in:**

- A phase's state goes at the end of its heading, as one of `planned | active | done | dropped | blocked`
- The order of entries in `Phases` is the plan order, and the number is a permanent ID in the order it was handed out. For rewriting, reordering, dropping, tombstones, and folding a `done` phase, follow § Changing phase numbers
- `type` is one of `build | research | experiment | decision`
- `goal`, `why`, and `outcome` are what the person approves — at `init` for the whole course (the `Vision`, then `goal` and `why` for every phase and `outcome` for the next one or two), at `phase close` for the next phase (or phases), or in the agreement of a `replan` that adds or details a phase. `why` says what the finished product lacks without the phase, in terms of the `Vision`; `outcome` says what the person sees or can do once the phase is over, in the person's words, and it is what the person accepts when the phase closes. Of the three, a distant phase carries `goal` and `why`; `outcome` arrives when the phase is detailed, and a folded `done` phase keeps `goal` alone (the phase status says whether the outcome held). A phase written before these keys existed needs no rewrite — while it is active it is printed, judged, and accepted on its `goal` — and it gains its `why` and `outcome` when it is next put to the person for approval
- Write 3–7 acceptance criteria, each an end state that can be checked, carrying the way to verify it and — when something must stay as it is — what must not change, as **plain bullets** — not checkboxes. They are the AI's checks: shown to the person as an appendix under `outcome`, not approved. The phase status `Acceptance Progress` is the source of truth for what is met, and it is the only place a checkbox appears (this keeps the state in one place)
- **A build phase that changes code carries a review criterion by default** — when detailing one (at `init`, or at `phase close` for the next phase), include the stock form "the independent review's findings are triaged — verified: the session `Result`" (workflows.md § build) among its acceptance criteria, and leave it out only with the reason recorded in the session log. Triaged is the pass condition, not zero findings — a criterion that demands zero findings never closes against a reviewer that over-reports. Like every criterion it is checked at `phase close` — a session's part ends at recording the findings and their triage in `Result`, so don't expect the checkbox to move inside the session
- `notes` is optional. Put a caveat or review angle that has to survive across phases (an implementation pitfall, something that needs manual verification) in the `notes` of the phase it belongs to instead of `status.md`, which is rewritten in full every time, and promote it to `acceptance` when that phase is detailed
- `Principles` holds intent only — policies, choices, and non-goals. A verifiable promise the artifact actually keeps goes to a contract (`C####`) in `spec/`
- `updated` carries the date of the last edit and nothing else. **Don't record change history, or the reason for a change, in this file** — it goes in the session log (a phase's `why:` is intent, why the phase exists, not why the plan changed — § Where each kind of information goes)
- The `Blockers` table keeps only the open ones. Delete a row once it is resolved (the reasoning stays in the log of the session that resolved it). When nothing is open, drop the table and write one line: `(no open blockers)`
- `Parking Lot` and `Deferred` are the two shelves off the schedule — ideas on the first, review findings and leftovers set aside on the second (one line each, with the session it came from). Both have a shelf life: roadmap-lint (GIT-7) warns about an item that no commit has touched for more than 30 days (the default `maxAgeDays`), and the `replan` and `phase close` procedures decide keep / promote / drop for it — rewriting the line is what resets the clock. When the leftovers are many, freeze the list as a file under `roadmap/assets/<S####>/` of the session that set them aside and point at it from one `Deferred` line — that line is what GIT-7 dates and what keep / promote / drop acts on. Write `(none)` when a shelf is empty

## Template: status.md (root)

```markdown
---
current_phase: P0002
open_session: null
last_session: S0013
next_command: "/roadmap start — <one line: why, and what it covers>"
updated: <YYYY-MM-DD>
---

# Status: <project name>

## Now
- **Where things stand**: <one or two sentences — the state of the work, as the person would say it>
- **On track?**: <yes / no, and against what — the plan, the acceptance criteria>
- **Effect on the finished product**: <how this phase's work moves, or fails to move, what the user is building>
- **What is wrong**: <what is broken, unclear, or waiting on someone — or "nothing">
- **Compromise or replan needed?**: <no / yes, with what would be given up or changed>

## Next
Recommended: `/roadmap start` — <one line: why, and what it covers. The same command as next_command>
- [ ] <a concrete task for following the recommendation, with file paths and referenced IDs — ones that exist; an ID a later session will create goes in code, and `init` writes goals here, not file layouts>

## Open Blockers / Risks
- B0001: <what it is and what it affects>

## Phase Index
| Phase | State | status |
|-------|-------|--------|
| P0001 <slug> | done | phases/P0001-<slug>/status.md |
| P0002 <slug> | active | phases/P0002-<slug>/status.md |
| P0003 <slug> | planned | — |
```

**How to fill it in:**

- Don't append — **rewrite the whole file every time**, and stay within 60 lines (the `Phase Index` section is not counted)
- **`Now` is written for the person, `Next` for the next session.** `Now` keeps its five frames as five bullets in that order, labelled in the user's language (the bold labels above are the English form, and this template is the one place the five frames are defined — the skeletons in workflows.md copy these labels; the Japanese labels are fixed in workflows.md § What the person reads; the `## Now` heading itself stays as it is), one or two sentences each and one sentence one fact. Paths, IDs, counts, and commands — the facts the AI needs — go to `Next` (and to the session `Handoff`), and appear in `Now` only when the person needs that one fact to decide. roadmap-lint checks the heading, not the frames (the content of prose is a non-goal of the lint)
- `open_session` holds `S####` from `start` and `null` from `close`. It is what detects a crash
- `last_session` names the session that closed last. `init` writes `null`, and it stays `null` until the first `close`
- `current_phase` names the phase that is `active`. Once every phase is `done` or `dropped` there is no active phase left, so it stays on the phase that closed last (workflows.md § phase close)
- `next_command` is the exact string that follows `Recommended: ` in the Next block (`<command> — <one line: why, and what it covers>`). Don't trim it down to the command alone. The `Recommended:` line of the body carries the same string, with the command in backticks as the template shows — the backticks are not part of the string
- Write the `Next` tasks at a grain the next session can pick up as they stand
- Don't write values that a close commit makes stale immediately, such as a commit hash — refer to a session as `S####` and to code by file path

## Template: phase status.md

`phases/P####-<slug>/status.md`

```markdown
---
phase: P0002
state: active
started: <YYYY-MM-DD>
---

# P0002: <phase name> — Status

## Outcome Summary
<First line: one sentence on what the phase's result means so far — once the phase closes, whether its `outcome` held. Then what the phase has produced, in 5–10 lines in all, rolled forward as it goes (the only section that may be rewritten). On creation, write pointers to the material it starts from — the integrating R#### and the Handoff of the session that led here>

## Acceptance Progress
- [ ] AC1: <condition> — verified: —
- [x] AC2: <condition> — verified: tests/core/test_sync.py::test_resume / S0012 / verification S0014 #2

## Session Log
| S# | date | summary (one line, strictly) | commits | artifacts |
|----|------|------------------------------|---------|-----------|
| S0012 | 07-18 | <one-line summary> | a1b2c3..d4e5f6 | E0003 |

## Decisions
- D-P0002-0001 (S0013): <the decision and why, in brief> — details: sessions/S0013.md

## Roadmap Changes
- S0013: <one line on what changed and why> — details: sessions/S0013.md
```

**How to fill it in:**

- `state` is one of `active | done | dropped`. Add `closed: <YYYY-MM-DD>` to the front matter when it goes `done`
- Append one line to `Session Log` at close. The details live in the session log, so the summary stays strictly one line — one sentence on what the session's result means, plus the IDs it rests on, not a list of everything done. A pipe inside the summary is written `\|` (it would split the row). The `commits` column carries work commits only (never the close commit; write `—` when there were none) — the one hash, or the first and the last as `first..last`, both included. The `date` column is the month and day of the session's `date` (`MM-DD`); the session log holds the full date
- Always attach evidence to a checked AC. Prefer evidence that can be run (a test reference: `path::name`), and fall back to `E####` / `R####` / `S####`. At `phase close`, append the verdict of the context that verified the criterion — the session whose `Result` holds the verdicts, and the verdict's number: `verification S#### #n` (the word follows the user's language; the IDs stay) — so the line names both the evidence and the verdict that checked it
- `Roadmap Changes` collects every roadmap change made during this phase — it is the way in when someone traces the reasoning later

## Template: session log

`phases/P####-<slug>/sessions/S####.md`

```markdown
---
session: S0013
phase: P0002
date: <YYYY-MM-DD>
state: open
base_commit: <HEAD at the start. null without git>
commits: []
artifacts: []
roadmap_changed: false
---

# S0013

## Plan
<2–4 items this session is going for (one, for a light session — workflows.md § Common rules). Not a specification>

## Did
<What actually happened. Appended at every checkpoint>

## Result
<Evidence: test results, numbers, what was confirmed by running it. The independent review's findings and their triage (workflows.md § build) land here, and so do the numbered verdicts of the acceptance-criteria verification at `phase close` (workflows.md § phase close) — when either outgrows this section, save the reply verbatim under `roadmap/assets/<S####>/` and keep the numbered summary here with the reference>

## Learned / Decisions
<What was learned. What was adopted or rejected, and why>

## Roadmap Changes
<What changed and why. Drop the whole section when nothing did>

## Handoff
<What the next session — the AI — needs to know: paths, IDs, commands, the state of the tree, the points still waiting on the user. Copied into the root status.md Next at close. The person reads Now, not this — so the facts Now leaves out belong here>
```

**How to fill it in:**

- `state` is one of `open | closed`. Don't rewrite it once it is `closed` — the only exception is a typo fix that doesn't change the meaning (say so explicitly when a recovery closes it after the fact)
- `commits` holds the short hashes of the **work commits** this session made. Don't record the close commit itself — `git log --grep "\[S####\]"` finds it
- `artifacts` lists the `R####` / `E####` / `C####` IDs this session created (`planned`) or finished (`done`) — one half of the bidirectional reference
- Don't save `Did` and `Result` for close — append at every checkpoint, at the end of that section: an append at the end of the file lands under `Handoff`, the last section, and the lint does not notice
- Name the destination (a phase number, for instance) for anything in `Learned / Decisions` that should feed back into a future phase or into the skill itself — then a later review only has to search for destinations

## Template: research and experiment files

`research/R####-<slug>.md`, `experiments/E####-<slug>.md`

```markdown
---
id: E0004
type: experiment
created: S0012
completed: S0014
phase: P0002
status: done
superseded_by: null
---

# E0004: <title>

## Question
<What is to be found out. State the hypothesis explicitly for an experiment>

## Method
<Enough to reproduce it: commands, environment, versions, data conditions. For research, the sources — URL, date accessed, version covered>

## Results
<Keep the raw data and the tables. Don't reduce them to the conclusion — being able to reinterpret them later is the value>

## Conclusion
<The conclusion, and what it implies for the roadmap and the acceptance criteria>
```

**How to fill it in:**

- `type` is one of `research | experiment` (matching the R/E prefix of the ID)
- `created` is the session that generated the manifest entry (made it `planned`), and `completed` is the session that made it `done` (filled in at that point, `null` until then). `phase` is the phase it mainly serves. When creating and finishing fall in different sessions, list it in the `artifacts` of both — the other half of the bidirectional reference
- `status` is one of `planned | running | done`. Don't rewrite it once it is `done` (only a typo fix that doesn't change the meaning, or a cross-reference added to the front matter — `superseded_by`, `see_also`)
- Put the measurement scripts and data-generation steps the `Method` refers to under `roadmap/assets/<ID>/` before it goes `done` (SKILL.md ground rule 8). For large data that can be regenerated (a benchmark corpus and the like), keep the generation script, the reproduction command, and the data conditions instead of the data itself
- Run these as checkpoints: create it `planned` before starting, move it to `running` when work begins, append to `Method` and `Results` as the work goes (don't save the writing for the end, and append inside the section — the end of the file is `Conclusion`), then write the `Conclusion` and mark it `done`. Even after an interruption, `done` is a settled result, `running` is a partial one, and `planned` is what is left to do
- When a later study overturns a conclusion, put the newer ID in the older one's `superseded_by` and leave the prose alone
- `see_also` is an optional front matter key — a list of related `R####` / `E####` IDs (`see_also: [R0003, E0002]`) for a study that builds on or sits beside another without superseding it. roadmap-lint checks that the IDs exist (REF-1) and nothing more. Adding or extending it on a `done` file is allowed — a cross-reference, like `superseded_by`, does not change the meaning (SKILL.md ground rule 5)

## Template: spec/map.md

The entry point of the Spec layer.

```markdown
---
updated: <YYYY-MM-DD>
---

# Spec Map: <project name>

## System Map
<Components, responsibilities, entry points, and the main data flows in 10–30 lines. With file paths, so it answers "where do I read to learn what?" on the spot. Don't write implementation details>

## Invariants
- C0001 (since: S0004 / stable / verified: S0021): <one line on a promise the whole system always keeps> — verified_by: tests/test_time.py::test_utc_only

## Spec Index
| file | Domain | Summary |
|------|--------|---------|
| api.md | HTTP API | <one line> |
```

**How to fill it in:**

- The Spec layer is a snapshot of the present. Like `status.md`, it is **rewritten to follow reality** and carries no history (the reasoning stays in the session logs and in git)
- 80 lines or fewer. `System Map` is a signpost, not the truth — the truth is in the code and the tests
- `Invariants` holds cross-cutting promises only, one line each with a `C####`. The contract of a specific interface goes to a domain file. The line takes the form `- C#### (since: S#### / <stability> / verified: S####): <promise> — verified_by: ...`, folding the contract template's three fields into one line so the `stable` judgment is readable from map.md as well
- Keep `Spec Index` in step whenever a domain file is added or removed

## Template: contract file

`spec/<domain>.md`

````markdown
---
domain: <domain name>
updated: <YYYY-MM-DD>
---

# Spec: <domain name>

## C0012: POST /sync
```yaml
kind: http-endpoint
stability: stable
source: src/api/sync.py
verified_by: tests/api/test_sync.py::test_post_sync_contract
since: S0021
verified: S0034
```
Idempotent. A resend with the same `client_token` returns 200 and has no side effects. (The observable promise, in 1–3 lines of prose)
````

**How to fill it in:**

- One entry per contract. `C####: <name>` in the heading, then a YAML block with fixed keys and 1–3 lines of prose directly below it
- `kind` is free vocabulary, used consistently for the same thing (`http-endpoint` / `cli` / `file-format` / `data-schema` / `event` / `invariant`)
- `stability` is one of `draft` (under construction, don't depend on it), `stable` (safe to depend on), or `deprecated` (going away). Delete the entry once it is retired (the C number stays vacant and is never reused)
- `source` is the code that implements the contract, or a machine-verifiable source of truth (`openapi.yaml`, a `*.proto`, a type definition, a JSON Schema). **When a source of truth exists elsewhere, don't restate its content** — keep the prose to the essentials plus the reference
- `verified_by` is the test that holds the contract up (`path::name`, several allowed). Write `manual` when no test can cover it, which makes a weak contract visible. Only a test that actually goes through **the contract's own surface and behaviour** counts — a test that calls an internal API directly, without passing through the observable surface (the CLI, the file format), does not hold anything up
- Don't make an environment-dependent measurement (a performance number, say) into a contract — put it in an `E####` and refer to that. A contract is limited to a promise whose verification can be repeated (whether a `verified_by` can be written and kept is the test)
- `since` is the session that produced the contract, and `verified` is the last session that checked it against reality (updated at `phase close`)
- Don't write anything in the prose that can be read mechanically out of the code or the types — prefer the promises that cannot be written in code, such as idempotency, boundary conditions, compatibility guarantees, and behaviour on error

## Template: CLAUDE.md snippet

Appended to the project's CLAUDE.md during `init`. Like every other generated record, write it in the user's language.

```markdown
## Roadmap-driven development
This project manages its roadmap under `roadmap/` (the /roadmap skill).
- At the start of work, always read `roadmap/status.md`, then the active phase's `status.md`, then `roadmap/spec/map.md` (map and invariants), in that order. Don't write code before that. Individual contracts live in the domain files under `roadmap/spec/`.
- All work happens inside a session (`S####`). Start with `/roadmap start` when none is open.
- A session closes automatically when the work reaches a stopping point (at the end of `/roadmap start`). Run `/roadmap close` before ending the conversation, or before the context grows long, if one is still open.
- The numbers and vocabularies the skill states are defaults. When `.roadmap-lint.json` sets a rule's `options`, the effective value is what a record has to satisfy — read it at the start of work and write to that, not to the default.
- roadmap.md is intent only. Rewrite it freely, but leave the reason in the current session log. Don't record history in roadmap.md.
- After changing anything observable from the outside (an API, a file format, a CLI, an invariant), update the spec contract (`C####`) in the same session. The code and the tests are the truth and the spec is an index — when they disagree, the code wins.
- Keep the findings of research and experiments in `R####` / `E####` files, cross-referenced with the session. Keep the raw data and the sources, not just the conclusion. Put reproduction assets such as measurement scripts under `roadmap/assets/<ID>/` before marking the file `done`.
- Prefix commit messages with `[S####]`. Keep the subject within a display width of 72 and put the why in the body — forward-looking notes and acceptance declarations live in the records, not in commits.
- How to run the tests: <fill this in once it is settled>
- Follow the recommended next action offered at the end of every command. Leave the reason in the session log when not following it.
```

## Template: .gitignore

Created during `init`, only when the project is under git.

```gitignore
# Odds and ends the OS and editors create
Thumbs.db
desktop.ini
.DS_Store
*.swp
*~

# Local-only settings (not shared)
.claude/settings.local.json

# Temporary work — a file that a record relies on goes to roadmap/assets/<ID>/ instead
scratchpad/

# Build output of the language toolchain (add what is needed once the stack is settled)
__pycache__/
*.pyc
.venv/
node_modules/
target/
```

**How to fill it in:**

- In a project that already has a `.gitignore`, don't overwrite it — append only the missing lines
- Add the language toolchain's build output for real once the stack is settled (a decision phase). When running a measurement script produces something that should stay untracked (`__pycache__/`, for instance), append it on the spot, before the commit
- After appending a pattern, check that no tracked file matches it (`git ls-files -i -c --exclude-standard` lists them) — roadmap-lint (GIT-3) reports a tracked file that `.gitignore` matches. Either `git rm --cached` the file or narrow the pattern

## Commit convention

Under git, shape the commit subject as `[S####] <label>: <summary>`, keep the subject within a display width of 72, and put what does not fit into the body.

- `[S####]` (the session at hand) is required, and this prefix is machine-checked — roadmap-lint (GIT-2) passes only a subject that starts with `[S####] `. The path from a commit to a phase runs through the session log's front matter (`phase`) and the phase status's `Session Log`
- `<label>: ` is a recommended prefix and optional. Use the same word for the same thing: `init` / `research` / `experiment` / `build` / `spec` / `decision` / `session-close` / `phase-close` / `post` / `wip` (`research` and `experiment` for an R/E going `done`, `spec` for a contract update, `session-close` for a session's close commit, `phase-close` for recording a phase transition, and `post` / `wip` for the dedicated routes in § Common rules and § Recovery procedure of `references/workflows.md`). The labels name the RDD step, not the product impact — they are not Conventional Commits types, and with `[S####]` ahead of them the CC ecosystem's tooling does not apply anyway. This list is the default vocabulary, and GIT-4's `labels` option replaces it (SKILL.md ground rule 10)
- **The 72 is a soft limit in display width** (a CJK character counts as 2), chosen so the subject survives `git log`'s indentation in an 80-column terminal. Going a few characters over for a clearer sentence is fine — but a subject that keeps growing is a sign its detail belongs in the body or in the records
- **The body carries the why** — what was wrong, why this approach, what was tried and dropped. Put a blank line between the subject and the body, and wrap the body at a display width of 72. A commit whose story is fully told by the subject and the diff needs no body
- **Don't write what the records own.** A forward-looking note ("next is …") belongs to `Next` in `status.md` and `Handoff` in the session log — a commit message is immutable, so a stale "next" misleads every later reader. Declaring an acceptance criterion met belongs to `Acceptance Progress` in the phase status. Naming an AC or an ID (`S####` / `R####` / `C####` …) as an identifier is fine, in the subject prose as it stands — no machine interprets these IDs, so a footer would buy nothing
- Don't end the subject with a period (neither `.` nor `。`), and don't narrate the commit itself ("this commit …", "this patch …") — describe the change
- Structural tokens stay in English — `[S####]`, the label, trailer keys. `<summary>` and the body follow the user's language, like every generated record, and their mood is not regulated (the imperative-subject rule of English-language projects is an English-grammar norm that does not carry across languages). Encode in UTF-8
- Trailers go in the last paragraph: a blank line before the block, no blank line inside it, `key: value` per line, a key with no spaces and only its first letter capitalized (`Co-authored-by`, `Signed-off-by`)
- The one exception is `init`'s first commit: sessions do not exist yet, so it goes as `[init] <message>` (roadmap-lint leaves the commit that first tracked `roadmap/` out of GIT-2)
- In a repository whose history predates the convention (the skill arriving partway into an existing project), don't rewrite the existing history — set the `sinceCommit` option in `.roadmap-lint.json` to the hash of the commit just before the switch, which takes that commit and everything before it out of the rule's scope. Each commit rule reads its own: GIT-2 for the prefix, and GIT-4 / GIT-5 / GIT-6 for the label, the period, and the session ID when those should skip the same history (a project may cut them over at different commits, so there is no shared value)

An example (in a Japanese-language project the summary and body would be Japanese):

```
[S0034] build: add corpus index for cross-file rules

The per-file pass cannot see an ID defined in another file, so
duplicate detection missed every cross-file case. An index of all
ID definitions now builds once and the corpus rules read it.

Co-authored-by: Ada Lovelace <ada@example.com>
```

## Working without git (degraded mode)

When the target project is not under git:

- Run with `base_commit: null` and `commits: []` in every session
- Skip the commit steps (the commit at `close`, the `[S####]` prefix)
- Crash recovery cannot fall back on `git diff`, so **hold the discipline of recording at every checkpoint especially tightly**
- Take the small-fix route right after `close` (§ Common rules of `references/workflows.md`) without a commit, leaving only the one-line record in the next session's `Did`
- When `init` detects that git is missing, add a note that adopting git is worth it eventually — it cross-references sessions with code changes and makes recovery stronger
