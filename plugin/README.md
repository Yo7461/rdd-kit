# rdd-kit plugin

The /roadmap skill for roadmap-driven development, plus roadmap-lint — a CLI linter that makes its records tool-verifiable.

This directory is what gets distributed. It follows the Claude Code plugin layout and holds the skill, a hook that lints right after an edit, and the roadmap-lint single bundle. An installed copy holds this directory alone: the links below that lead to `../README.md` and `../doc/` point into the repository, whose address is the `repository` of `.claude-plugin/plugin.json`.

## Roadmap-driven development

Roadmap-driven development (RDD) does not finish a specification before the work starts. The work runs from a revisable roadmap of typed phases (`build`, `research`, `experiment`, `decision`) and from a file that holds the current position, in sessions that open with `/roadmap start` and close with a commit. The spec is maintained as a record of what the system guarantees now. The records live under `roadmap/` in four layers — intent, now, spec, and fact — and the fact layer is append-only.

The idea in full is in [doc/concepts.md](../doc/concepts.md) of the repository.

## Strengths

rdd-kit leaves whatever cannot be decided yet on the roadmap as research, experiment, and decision phases, and runs agile-style development — deciding as you build — as a loop in which the roles of the AI and the person are fixed.

- **A command is enough to move the work forward** — `/roadmap start` sets the session's plan from the records, does the work, and closes with a commit. Every command ends by recommending one next command, and `/roadmap` with no argument follows it
- **The AI proposes, and the person approves phase by phase** — the AI drafts the whole course at `init`, the next phase at every `phase close`, and a replan when the work breaks a premise of the roadmap. The person approves the goal, the reason, and the outcome of each phase rather than every session's plan
- **The whole record can be traced back and verified** — IDs and bidirectional references tie the four layers together, and every decision keeps an ID of its own
- **A lint over the records runs at every edit** — 35 rules pin down deterministically what an AI miscounts. Checking what the records mean stays with the AI and the person
- **Sessions are cut with usage limits in mind** — the records are written as the work goes, so the next session resumes from what is already closed
- **The person's entry point is fixed** — the current position is written in five fixed frames, apart from the facts the AI needs. Every printout — the start of a session, a question, a report — keeps the same shape from run to run
- **A minimal kit** — one skill and one CLI, Node.js only, and the kit's own code sends nothing off the machine

It fits solo development where what to build comes into view only through research, experiments, and decisions. The records assume a single writer, so team development that routes documents through owners and approvals calls for another kind of method.

## Installation

```
claude plugin marketplace add Yo7461/rdd-kit
claude plugin install rdd-kit@rdd-kit
```

Requirements, scopes, updating, and uninstalling are in the [README](../README.md) of the repository.

## What the plugin runs

The plugin's own code runs on the machine in two places. Neither makes a network connection, and neither changes the project's files, its git history, or git's own index (git runs with `--no-optional-locks`).

- **The hook** — after every `Edit` or `Write` tool call in a session, Claude Code runs `node` on `hooks/roadmap-lint-hook.mjs`. When the edited file is under the project's `roadmap/`, the hook starts one more `node` process that runs the bundled roadmap-lint over that directory. For any other file it exits at once. The hook reads the tool call on stdin and four environment variables: `CLAUDE_PLUGIN_ROOT`, `CLAUDE_PROJECT_DIR`, `PATH`, and `ROADMAP_LINT_BIN` — when that last one names an existing file, that program runs in place of the bundled linter. The linter ignores `LOG_TOKENS` and `LOG_STREAM`, the debugging switches of the YAML parser it bundles, so its report stays readable whatever the environment carries
- **The linter** — `bin/roadmap-lint.js` reads the files under `roadmap/` and the `.roadmap-lint.json` beside it, and starts `git` to query the repository (`rev-parse`, `ls-files`, `status`, `log`, `rev-list`, `blame`). It also checks whether the paths the records refer to exist — existence only, the files are not opened. The skill calls it as `node <plugin root>/bin/roadmap-lint.js`. While the plugin is enabled, Claude Code puts `bin/` on the PATH of its Bash tool

The plugin's own code sends nothing, downloads nothing, and collects no usage data. It has no dependencies to install.

The skill itself is a set of instructions for Claude. Following them, Claude edits the records under `roadmap/`, works on the project's code, and makes git commits in the project's repository — through Claude Code's own tools and under its permission settings. `init` also appends a section to the project's `CLAUDE.md` and, under git, creates or extends its `.gitignore`. A research phase reads outside sources through Claude Code's web tools, and may clone a repository with `git clone --depth 1` to search it locally.

## Layout

```
plugin/
├── .claude-plugin/plugin.json   # Manifest (SemVer — one version for the skill and the CLI)
├── README.md                    # This file
├── LICENSE                      # Apache-2.0 — a copy of the repository's LICENSE
├── NOTICE                       # The copyright notice — a copy of the repository's NOTICE
├── THIRD-PARTY-LICENSES.txt     # The licenses of the packages inlined in bin/roadmap-lint.js
├── bin/
│   ├── roadmap-lint.js          # esbuild single bundle (CJS, shebang, Node >=24)
│   └── package.json             # Pins the type ({"type":"commonjs"} — same reading everywhere)
├── hooks/
│   ├── hooks.json               # Hook config used when installed as a plugin (auto-detected)
│   └── roadmap-lint-hook.mjs    # The hook itself (self-contained, no dependencies, Node >=24)
└── skills/roadmap/              # The /roadmap skill — the source of truth for the instructions
    ├── SKILL.md
    └── references/{schemas,workflows}.md
```

`bin/`, `LICENSE`, and `THIRD-PARTY-LICENSES.txt` are committed build artifacts. How they are rebuilt and checked is in [doc/development.md](../doc/development.md).

## Hooks (automatic lint after editing roadmap/)

A PostToolUse hook (matcher: `Edit|Write`) runs roadmap-lint right after a file under `roadmap/` is edited.

- **There are diagnostics** → they are formatted, written to stderr, and the hook exits 2 (both the user and Claude see them; the edit itself is not blocked). When a config option was ignored (the wrong shape, an unknown key, an entry a rule cannot use) or a `sinceCommit` was not found among the commits, the notice that says so is written with them, since what it left in force may be what the diagnostic is about
- **Zero diagnostics / an edit outside `roadmap/` / no CLI found / lint failed to run** → a silent exit 0 (**non-destructive** — a problem in the hook never stops the editing flow)
- GIT-1 is a notice while a session is open, so it stays silent (a notice is not part of the diagnostic list). During a close — from setting `open_session` to null until the close commit lands — the GIT-1 warning is shown as the true positive it is, and it clears with the close commit
- In the middle of a sequence of edits that spans several files (creating a session, adding a research or experiment file, closing a session, generating the records at `init`) a transient diagnostic can appear that the rest of the sequence resolves — FM-3, BID-2, and the like. Those are true positives: the sequence is finished first, and the check that nothing is left comes at the checkpoint. See [doc/roadmap-lint.md](../doc/roadmap-lint.md#diagnostics-that-depend-on-the-moment)
- How roadmap-lint is resolved: 1. the `ROADMAP_LINT_BIN` environment variable, 2. `${CLAUDE_PLUGIN_ROOT}/bin/roadmap-lint.js` (the bundle shipped here — this is what a plugin install uses), 3. `<project>/packages/cli/dist/main.js`, only when that `packages/cli` is the roadmap-lint package itself (the linter's own development checkout — another project's program in that place is not run), 4. `roadmap-lint` on the PATH (an npm install)

There are two ways to set it up:

1. **As a plugin** — `hooks/hooks.json` is auto-detected, so enabling the plugin is enough (`/reload-plugins` applies it immediately)
2. **By hand (no plugin)** — add the following to the project's `.claude/settings.json`, with the path pointing at wherever the hook script lives in that project. In this setup there is no plugin root, so the hook finds the linter through `ROADMAP_LINT_BIN`, through the linter's own development checkout, or through `roadmap-lint` on the PATH. A global install puts the CLI on the PATH; a local install does not, and needs `ROADMAP_LINT_BIN` pointed at it (see [doc/roadmap-lint.md](../doc/roadmap-lint.md#using-the-linter-without-the-plugin)). Without a linter the hook exits silently:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "node \"$CLAUDE_PROJECT_DIR/plugin/hooks/roadmap-lint-hook.mjs\"",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

Changes to the settings are reloaded automatically.

## License

Apache-2.0. The license text is in [LICENSE](LICENSE), a copy of the one at the root of the repository, and the copyright notice is in [NOTICE](NOTICE), a copy as well. The bundle in `bin/` inlines third-party packages under the MIT and ISC licenses; their copyright notices and license texts are in [THIRD-PARTY-LICENSES.txt](THIRD-PARTY-LICENSES.txt).
