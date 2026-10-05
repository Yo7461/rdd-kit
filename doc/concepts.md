# Roadmap-driven development

Roadmap-driven development (RDD) is the method the `/roadmap` skill carries out. This page describes the idea and the rules that follow from it. The instructions the skill itself reads are in [plugin/skills/roadmap/](../plugin/skills/roadmap/SKILL.md) — that text is the source of truth, and this page is a guide to it.

## The premise

A specification finished before the work starts assumes that what to build can be stated in advance. In solo development, and in work with a lot of novelty in it, much of that only becomes clear through research, experiments, and the building itself.

RDD puts two files in the place of the up-front specification:

- **A roadmap** — phases in plan order, each with a goal, the reason it is there, the outcome the person will see, and acceptance criteria. It states intent, and it can be rewritten at any time
- **A current-position file** — where things stand and what the next session does

The spec still exists, but it is not written ahead of the code. It is maintained as an index of what the system guarantees now. The truth is in the code, the tests, and machine-verifiable artifacts; when the spec and reality disagree, reality wins and the spec is fixed.

## The four layers of records

Everything lives under `roadmap/` in the project, in four layers. Each layer has its own rule for how it changes.

| Layer | Files | Nature |
|---|---|---|
| Intent | `roadmap/roadmap.md` | What to do next. Rewritten freely, and it carries no history |
| Now | `roadmap/status.md` | Where things stand, written for the person. Rewritten in full every time |
| Spec | `roadmap/spec/` | What the system currently guarantees (map, contracts, invariants). Rewritten to follow reality |
| Fact | `roadmap/phases/`, `roadmap/research/`, `roadmap/experiments/`, `roadmap/assets/` | What happened and what was learned. Append-only, and immutable once closed |

```
roadmap/
├── roadmap.md                       # Intent
├── status.md                        # Now
├── spec/
│   ├── map.md                       # Map, invariants, index of the contract files
│   └── <domain>.md                  # Contracts, one file per domain
├── phases/
│   └── P0002-core-engine/
│       ├── status.md                # The phase's cumulative record
│       └── sessions/
│           └── S0013.md             # Session log
├── research/
│   └── R0001-<slug>.md
├── experiments/
│   └── E0001-<slug>.md
└── assets/
    └── R0002/                       # Scripts and data an R/E refers to
```

The split decides where each kind of information goes. What the plan looks like after a change goes in `roadmap.md`; why it changed goes in the log of the session that changed it. A finding worth reusing becomes a research or experiment file. A promise the system actually keeps becomes a contract in the spec. Because the reasoning always lands in the Fact layer, the Intent layer stays small and the history stays complete.

The records are read as a pyramid: `status.md` first, then the active phase in `roadmap.md` with the phase status and `spec/map.md`, and the session logs, research files, and contract files only when they are needed.

## Phases

A phase is a unit of the roadmap with a goal, a reason (`why` — what the finished product lacks without it), an outcome (what the person sees or can do once it is over), a type, and acceptance criteria. The goal, the reason, and the outcome are what the person approves; the acceptance criteria are the AI's checks. The type decides how its sessions proceed.

| Type | What it does |
|---|---|
| `build` | Implements. The first session starts with detailed design, the tests are written at the acceptance criteria and the contracts, and an independent review comes before the session closes |
| `research` | Takes in outside information. The questions are listed first, one file per question, and each is written through to its conclusion before the next one starts |
| `experiment` | Measures. The hypothesis is stated, the smallest thing that measures it is built, and the raw data stays in the record |
| `decision` | Chooses. Two to four candidates are compared in a table that shows the differences, a recommendation is stated, and the user chooses |

A point that cannot be settled when the roadmap is written does not block it. It is planned as a research, experiment, or decision phase, and the phases that depend on it name it in `depends`.

- **States** — `planned`, `active`, `blocked`, `done`, `dropped`. One phase is active at a time
- **The detailing horizon** — only the active phase and the next one or two are detailed down to an outcome and acceptance criteria. Farther phases keep a one-line goal, a reason, and a type. A phase that is done folds back to its heading and a one-line goal, and a dropped one stays as a heading — a tombstone, not a deletion
- **Acceptance criteria** — three to seven per phase, each an end state with the way to verify it and, when something must stay as it is, what must not change. At `phase close` a context that did not do the work verifies every criterion from its evidence, the closing session judges whether the outcome held and prints the verdicts, and the person is asked once: accept the outcome or change the plan, and approve the next phase's goal, reason, and outcome
- **Replanning** — `/roadmap replan <topic>` revisits the roadmap. The proposed change is shown before against after, the roadmap is edited only after the user agrees, and the reason goes in the session log

## Sessions

Every change, to the records and to the project's code, happens inside a session. One session is open at a time: the records assume a single writer.

1. `/roadmap start` reads the current position, the active phase, the spec map, and the lint configuration, creates the session, prints the start block — what the phase delivers, this session's plan of two to four items, and whether anything is asked — and proceeds. At that point it asks only when a point is waiting on the person, a contract draft forks observable behavior, or `doctor` left findings — and, before the session opens, when the last recommendation was a replan or a phase close
2. The work proceeds by the procedure for the phase type. The session log is appended to at every checkpoint, and every finished artifact gets a commit of its own — `[S0013] build: <summary>`
3. Once the work reaches a stopping point the session closes by itself: the session log is finalized, the phase status and `status.md` are updated, the linter and the tests run, the close commit lands, and the report goes out — the five frames, an appendix for checking, and the `Next` block

Writing as the work goes is what makes an interruption survivable. When a usage limit or the context window cuts a conversation off, whatever was committed is settled, and the next session resumes from the closed records. A session that was left open is reconstructed from its file and from what git holds since the commit it started at — its own commits and the diff — and closed after the fact before anything else happens.

## IDs and references

| ID | What it identifies |
|---|---|
| `P####` | Phase |
| `S####` | Session, counted across the whole project |
| `R####` | Research |
| `E####` | Experiment |
| `C####` | Contract or invariant |
| `B####` | Blocker |
| `D-P####-####` | Decision, numbered within its phase |

IDs are permanent: they are never reused, renumbered, or deleted. The references between records run both ways — a session lists the research and experiment files it created or finished, and each of those files names the sessions that created and finished it. A closed session log and a finished research or experiment file are not rewritten. When a conclusion is overturned, the older file points at the newer one through `superseded_by` and its prose stays as it was.

This is what lets the whole record be traced back: a decision has an ID, the ID leads to the session that made it, and the session log holds the reasoning and the evidence.

## The spec as an index of reality

`spec/map.md` holds the map of the system, its invariants, and an index of the contract files. A contract is an entry with fixed keys:

```yaml
kind: http-endpoint
stability: stable
source: src/api/sync.py
verified_by: tests/api/test_sync.py::test_post_sync_contract
since: S0021
verified: S0034
```

One to three lines of prose follow the block and state the observable promise — idempotency, boundary conditions, behavior on error — rather than what can be read out of the code.

- A contract is raised as `draft` when a build phase produces it and moves to `stable` once the implementation has settled
- Every contract names what holds it up in `verified_by`: a test, or `manual` when no test can cover it
- When observable behavior changes, the contract is updated in the same session
- A policy, a choice, or a non-goal is not a contract. It belongs to `Principles` in `roadmap.md`

## Decisions, and when the person is asked

The records settle what has been decided, measured, and promised. The moment a judgment touches one of them, it stops being the AI's to settle alone. The AI hands the decision to the user when acting would:

- overturn an existing decision, a contract, or an acceptance criterion already met
- contradict a measured result or a conclusion a closed session captured
- rank one of two irreconcilable records over the other
- pick between workable options that change observable behavior in different ways
- rest on a premise of the plan that turned out to be broken (when the break invalidates the plan itself rather than one judgment, that is a replan)
- consume an item a record reserves for confirmation

The points are collected and put to the user in one batch at the next checkpoint. Each point carries five lines under fixed labels, in a fixed order: the effect on the finished product, the records involved, what would be overturned, an option that overturns nothing, and a recommendation with its reason. A change of plan that itself overturns a record says so inside its own question instead. The material a decision rests on is printed in full before the question is asked, and in one shape: the questions and the recommendation first, then a block per question that ends with the options, then an appendix.

Reversible implementation details, naming, and how the tests are written stay with the AI, as long as nothing recorded is contradicted and the reason lands in the session log.

## What the person reads

`status.md` is the person's entry point, and its shape is fixed. `Now` is written in five frames:

1. Where things stand
2. On track?
3. Effect on the finished product
4. What is wrong
5. Compromise or replan needed?

The facts the AI needs — paths, IDs, counts, commands — are kept apart in `Next` and in the session log's `Handoff`.

What a command prints for the person keeps one shape too. Every printout is built from the same seven parts — a title, the five frames, the three lines of a phase (goal, why, outcome), a question block, the five lines of a held-back point, an appendix, and an end — and each scene has a fixed skeleton:

- **A session opens** with the same block: what the phase delivers, this session's plan, and whether anything is asked
- **A session ends** with the same report: the five frames, then an appendix for checking — what was decided, what was verified, which records changed, the commits. `init`, `status`, and `doctor` keep skeletons of their own, built from the same parts
- **A question** — a held-back point, a change of plan, a phase boundary, the choice in a decision phase — lists the questions and the recommendation first, then gives each question a block that ends with the options, and keeps the evidence in the appendix. The dialog asks under the same numbers and in the same words

IDs, paths, and counts stay in the appendix, and one thing has one word: a record key such as `goal` or `acceptance` is never printed as a label, and a state such as `draft` is printed as the word the skill gives for it, not copied from the record.

What the person approves is fixed as well, and it is a phase, not a session. At `init` the `Vision` — the finished product in a few lines, at the head of the roadmap — and the whole course are printed, with each phase's reason and the outcome of the next one or two, and approved once. At every `phase close` one question covers the acceptance of the outcome of the phase that ended (or a change of plan) and the goal, reason, and outcome of the next phase. The acceptance criteria are shown as an appendix: they are the AI's checks. Between these points the person reads the five frames and answers the points the AI holds back for them.

A command ends with a `Next` block that recommends exactly one command, printed once, when the command has ended. The recommendation is saved in `status.md`, and `/roadmap` with no argument follows it. The recommendation depends on where the work stands: `start` while the phase is on plan, `phase close` once every acceptance criterion of the phase has its evidence, and `replan` when the work contradicts a premise of the plan, a criterion turns out to be unreachable, a large blocker appears, or the scope has to change. When every criterion is met and a premise of a later phase has broken, `phase close` comes first — detailing the next phase is itself a chance to replan. For a session the person asked to leave open, the recommendation is `close`; once every phase is over, it is `replan`: the project is complete, and an extension phase is how it carries on.

```
─ Next ──────────────────────────────
Recommended: /roadmap start — S0015: continue the resolver implementation
```

A reply that ends while the command is still running — waiting for a reviewer, a verifier, or the person — ends with an in-progress notice instead: what it is waiting for, what the person has to do, and the command that picks the work up if the conversation is cut off. Nothing is added while a question dialog is open.

The records and the replies are written in the user's language. In the records, headings, front matter keys, IDs, and state values stay in English, because they are the file format. What is printed for the person — the labels, the words for the state of a phase or a contract, the options of the questions every project meets — follows the user's language, and the skill fixes the Japanese ones; a project that wants other words writes them in its CLAUDE.md.

## The two shelves

`roadmap.md` has two sections for what is not on the schedule. `Parking Lot` holds ideas, each with the condition for bringing it back. `Deferred` holds review findings and leftovers that were set aside, each with the session it came from and the condition for taking it up.

Both have a shelf life. The linter warns about an item that no commit has touched for more than 30 days, and `replan` and `phase close` decide for each such item: keep it (and rewrite the line), promote it to a phase, or drop it. A promotion or a drop changes the plan, so the person decides it; a keep is reported when the command ends.

## Verification

Four verifiers check the work, and each covers what the others cannot.

- **roadmap-lint** checks the structure of the records: front matter, the structure and placement of the files, references, IDs, sizes, text anomalies, and git state. It runs through the hook after every `Edit` or `Write` Claude makes to the records, before every close commit, and as the first step of `doctor`. See [roadmap-lint.md](roadmap-lint.md)
- **`/roadmap doctor`** adds the checks of meaning, which stay with the AI: whether a contract's prose agrees with the implementation, and whether the latest verification a record claims can be reproduced. A green lint means the records are well-formed, not that they are true
- **An independent review** comes before a build session closes. A context that did not write the changes reads the diff and returns numbered findings, each backed by command output, a test, or a reproduction. Every finding is recorded as adopted, rejected, or deferred. The review passes when every finding is triaged, not when the findings reach zero
- **The verification of the acceptance criteria** comes at `phase close`. A context that did not do the work checks every criterion of the phase against its evidence — running the tests first of all — and returns numbered verdicts, which the closing session records and the person reads before accepting the outcome

## Commands

| Command | What it does |
|---|---|
| `/roadmap init` | Interview, then an outline of the whole course, then the generated `roadmap/`. It also appends a section to the project's `CLAUDE.md` and, under git, creates or extends its `.gitignore` |
| `/roadmap start` | Opens a session, prints the start block, runs the work by the procedure for the phase type, and closes it at a stopping point |
| `/roadmap close` | Ends the session. It normally runs at the end of `start`, and is called alone only after an interruption |
| `/roadmap replan <topic>` | Revisits the roadmap |
| `/roadmap phase close` | Has the acceptance criteria verified by a context that did not do the work, drafts the next phase, asks once (accept the outcome or change the plan, and approve the next phase), summarizes the phase, and activates the next one |
| `/roadmap status` | Reads back the current position (read-only) |
| `/roadmap doctor` | Checks the consistency of the records (read-only) |
| `/roadmap` | Follows the recommendation the last command saved |

## Defaults and the project's configuration

Every number and vocabulary the skill states is a default.

| What | Default |
|---|---|
| `status.md` | 60 lines, not counting the `Phase Index` section |
| `spec/map.md` | 80 lines |
| A contract file | 200 lines |
| `roadmap.md` | 200 lines |
| `Outcome Summary` of a phase | 10 lines |
| `Session Log` | One line per session (fixed — no option changes it) |
| Shelf life of a `Parking Lot` or `Deferred` item | 30 days |

When the project has a `.roadmap-lint.json` beside `roadmap/`, the options it sets replace the matching defaults — for the linter and for the skill alike. The skill reads the file at the start of a session and writes the records to the effective value, so the two halves of the kit never disagree about a limit. A value the linter reports as ignored (the wrong shape, an entry it cannot use) counts for neither half. The file format is in [roadmap-lint.md](roadmap-lint.md#configuration).
