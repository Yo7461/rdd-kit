# rdd-kit

The /roadmap skill for roadmap-driven development, plus roadmap-lint — a CLI linter that makes its records tool-verifiable.

- **The skill (/roadmap)** — runs the development loop from a revisable roadmap and a current-position file, and keeps a living spec that follows the implementation
- **roadmap-lint** — checks the structure of the records the skill writes (front matter, the structure and placement of the files, reference integrity, ID discipline, size limits, text anomalies, git state — 35 rules in all), from the command line and from a hook that runs right after an edit

Both come in one Claude Code plugin.

## Roadmap-driven development

Roadmap-driven development (RDD) does not finish a specification before the work starts. The work runs from a roadmap that can be rewritten at any time and from a file that holds the current position. The spec is maintained as a record of what the system guarantees now — the code and the tests are the truth, and the spec follows them.

- **A roadmap of typed phases** — every phase has a type (`build`, `research`, `experiment`, or `decision`), a goal, and the reason it is there, and, once it is detailed, the outcome the person will see and acceptance criteria of its own. A point that cannot be settled yet goes onto the roadmap as a research, experiment, or decision phase instead of being guessed at up front
- **Work in sessions** — `/roadmap start` opens a session, the records are written as the work goes, and the session closes with a commit. The next session resumes from what the last one left behind
- **Records in four layers** — each layer has its own rule for how it changes

| Layer | Files | Nature |
|---|---|---|
| Intent | `roadmap/roadmap.md` | What to do next. Rewritten freely, and it carries no history |
| Now | `roadmap/status.md` | Where things stand, written for the person. Rewritten in full every time |
| Spec | `roadmap/spec/` | What the system currently guarantees (map, contracts, invariants). Rewritten to follow reality |
| Fact | `roadmap/phases/`, `roadmap/research/`, `roadmap/experiments/`, `roadmap/assets/` | What happened and what was learned. Append-only, and immutable once closed |

The idea in full is in [doc/concepts.md](doc/concepts.md).

## What rdd-kit is for

A method that asks for a full statement of what to build before building starts can be hard to choose for solo development and for work with a lot of novelty in it. rdd-kit is a kit for that situation. It leaves whatever cannot be decided yet on the roadmap as research, experiment, and decision phases, and it runs agile-style development — deciding as you build — as a loop in which the roles of the AI and the person are fixed (loop engineering).

### Strengths

The loop comes built in, and the records take a shape an AI can work in.

- **A command is enough to move the work forward** — after `init`, a session needs no instructions of its own. `/roadmap start` reads where the project stands and what the last command left to do next, sets this session's plan from it, does the work by the procedure for the phase type, and closes the session with a commit. Every command ends by recommending exactly one next command, and `/roadmap` with no argument follows it. Inside a session the plan is printed and the work proceeds; the person is asked when a judgment collides with the records, forks observable behavior, or would change the development machine, and when `doctor` left findings — and also for the choice in a decision phase, a replan, and a blocker only they can clear
- **The AI proposes, and the person approves phase by phase** — the roadmap is the AI's draft, aimed at the finished product: the whole course at `init`, from one interview, and the next phase at every `phase close`. When the work breaks a premise of the roadmap, the next recommendation is a replan — the change is shown before against after, and the roadmap is edited only after the person agrees. What the person approves is a phase, not a session: its goal, its reason, and its outcome — what they will see or be able to do once it is over — at `init` (the `Vision` and the whole course, with the outcomes of the next one or two phases) and at every `phase close`, where the outcome of the phase that ended is accepted in the same question. The acceptance criteria are the AI's checks, verified at `phase close` by a context that did not do the work
- **The whole record can be traced back and verified** — four layers of records (intent, now, spec, fact) are tied together by IDs and bidirectional references, and the fact layer (session logs, research, experiments) is append-only. Every decision stays under an ID of its own, and the reasoning behind it can be followed from the session logs
- **A lint over the records runs at every edit** — roadmap-lint (35 rules) runs from a hook and checks IDs, references, bidirectional references, size limits, states, and git history. The parts an AI miscounts are pinned down deterministically. Checking what the records mean stays with the AI and the person
- **Sessions are cut with usage limits in mind** — a session runs from `start` to `close`, the records are written as the work goes, and every finished artifact gets a commit of its own. When a usage limit or the context window cuts a conversation off, the next session resumes from the closed records and the `Next` block, and a session that was left open has a recovery procedure
- **The person's entry point is fixed** — the current position is written for the person in five fixed frames (where things stand, on track?, effect on the finished product, what is wrong, compromise or replan needed?). The facts the AI needs (paths, IDs, counts) are kept apart in `Next` and `Handoff`. What a command prints for the person keeps one shape as well — the block that opens a session, the report that closes it, a question, a notice ([doc/concepts.md](doc/concepts.md#what-the-person-reads))
- **A minimal kit** — one skill and one CLI, Node.js only, and the kit's own code sends nothing off the machine. It can join a project partway through: the history from before can be left out of the checks

### Where it fits

rdd-kit fits solo development where what to build comes into view only through research, experiments, and decisions — where the plan, the judgments, and the reasoning are to live in one roadmap and an append-only record, checked by machine, over a long run of work with an AI.

Other situations call for another kind of method:

- Team development that routes specs and documents through owners and approvals (the records here assume a single writer)
- Feature work where the requirements are put into words first and the implementation is derived from the spec
- Product development that wants a full set of documents from the planning stage on, written from role-by-role viewpoints
- Work that one round of design can state in full and that only has to be finished unattended once it is approved

## Requirements

- Node.js **>= 24**
- Claude Code
- git (recommended — without it the git rules are skipped and the skill leaves the commit steps out); the git rules need 2.15 or later

## Installation

```
claude plugin marketplace add Yo7461/rdd-kit
claude plugin install rdd-kit@rdd-kit
```

Inside a Claude Code session one command covers both steps (Claude Code v2.1.275 or later). It asks before adding the marketplace, then opens the plugin's details to install from:

```
/plugin install rdd-kit --marketplace Yo7461/rdd-kit
```

- Without `--scope` the install is user-wide (every project). To limit it to one project, run it in that project's directory with `--scope project` (shared with the team) or `--scope local` (personal)
- What it installs: the `/roadmap` skill, a hook that lints right after an edit under `roadmap/`, and the bundled roadmap-lint. What the plugin runs on the machine is listed in [plugin/README.md](plugin/README.md)
- Updating: `claude plugin update rdd-kit@rdd-kit`. Automatic updates are off for this marketplace until they are turned on under `/plugin` → Marketplaces

## Quick start

1. Open Claude Code in the target project and run `/roadmap init` — an interview, then an outline of the whole course, then the generated `roadmap/`. `init` also appends a section to the project's `CLAUDE.md` and, under git, creates or extends its `.gitignore`. `/roadmap` is the short form of the skill's full name, `/rdd-kit:roadmap`, and it is available unless another command already uses that name. `/plugin` shows whether the plugin is enabled
2. Run `/roadmap start` to open a session and work. The hook lints after every `Edit` or `Write` Claude makes under `roadmap/` and reports **only when there are diagnostics**. The session closes by itself once the work reaches a stopping point: it finalizes the records, commits, and recommends the next command
3. `/roadmap` with no argument follows that recommendation. `/roadmap status` shows where the project stands, `/roadmap replan <topic>` revisits the roadmap, and `/roadmap doctor` checks the records
4. To run the linter by hand, see [doc/roadmap-lint.md](doc/roadmap-lint.md)

## Uninstalling

```
claude plugin uninstall rdd-kit@rdd-kit
claude plugin marketplace remove rdd-kit
```

Pass `uninstall` the same `--scope` the install used. Removing the marketplace also uninstalls the plugin and deletes its cached files, so the second command alone removes the plugin. After an uninstall on its own, the cached copy is cleaned up in the background 14 days later, as long as another plugin is installed. What is in each project — `roadmap/`, the section in `CLAUDE.md`, the lines added to `.gitignore`, a `.roadmap-lint.json` — stays as it is.

## Documentation

| Document | Contents |
|---|---|
| [doc/concepts.md](doc/concepts.md) | Roadmap-driven development in full — the layers, phases, sessions, IDs, the spec, when the person is asked, and the language the records are written in |
| [doc/roadmap-lint.md](doc/roadmap-lint.md) | The linter — invocation, output, configuration, the rules, and how to respond to diagnostics |
| [doc/development.md](doc/development.md) | Working on rdd-kit itself — repository layout, tests, fixtures, and releases |
| [plugin/README.md](plugin/README.md) | What is distributed, what the plugin runs, and how the hook is set up |

## License

Apache-2.0. See [LICENSE](LICENSE). The copyright notice is in [NOTICE](NOTICE). The distributed bundle inlines third-party packages under the MIT and ISC licenses; their copyright notices and license texts are in [plugin/THIRD-PARTY-LICENSES.txt](plugin/THIRD-PARTY-LICENSES.txt).
