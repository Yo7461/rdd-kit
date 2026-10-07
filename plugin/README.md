# rdd-kit plugin

The /roadmap skill for roadmap-driven development, plus roadmap-lint — a CLI linter that makes its records tool-verifiable.

This directory is what gets distributed. It follows the Claude Code plugin layout and holds the skill, a hooks module that lints right after an edit and serves the records check as a tool, and readable copies of the lint core and of the third-party packages it uses. Claude Code runs the module inside its own process, so the plugin needs no Node.js. An installed copy holds this directory alone: the links below that lead to `../README.md` and `../doc/` point into the repository, whose address is the `repository` of `.claude-plugin/plugin.json`.

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
- **A minimal kit** — one skill, one hooks module, and one CLI. The plugin runs inside Claude Code without Node.js, and the kit's own code sends nothing off the machine

It fits solo development where what to build comes into view only through research, experiments, and decisions. The records assume a single writer, so team development that routes documents through owners and approvals calls for another kind of method.

## Installation

```
claude plugin marketplace add Yo7461/rdd-kit
claude plugin install rdd-kit@rdd-kit
```

It needs Claude Code **2.1.286 or later** in the desktop app, or **2.1.287 or later** in the terminal — the versions from which a plugin's hooks module loads by default. Hooks modules are an early-access part of Claude Code, and their interface can change between versions: each release of rdd-kit names the version it was run on (this one: 2.1.289), and a check that stops working never blocks an edit (below). Node.js is not needed; only the CLI — roadmap-lint by hand or in CI — needs Node.js >= 24. Scopes, updating, and uninstalling are in the [README](../README.md) of the repository.

## What the plugin runs

The plugin's own code is one hooks module, `hooks/register.ts`, which Claude Code loads into its own process when the plugin is enabled — no `node` process is started, and nothing is installed on the machine. The module does two things, and both are **fail-open**: a problem in the module never stops the editing flow.

- **The lint after an edit** — after every `Edit` or `Write` tool call whose file is under the project's `roadmap/`, the module runs roadmap-lint over that directory and, **only when there are diagnostics**, appends the report to the result of that tool call, where both Claude and the user read it (the result of the edit itself stays as it is). Zero diagnostics, an edit elsewhere, and a check that fails or takes longer than 20 seconds leave the result untouched; a failure is said in one dim line of the transcript. The project is the directory the session started in (or `/cd` moved it to) — a `cd` in the shell does not move it
- **The records check as a tool** — the module registers the tool `mcp__rdd-kit__roadmap_lint`, which runs the same lint on request and returns the report the CLI prints, as text or as JSON (`path` and `format` are its optional inputs; the check may take up to 60 seconds). The skill calls it for `/roadmap doctor` and before a close commit. Claude Code serves a registered tool to itself over a loopback connection on the machine; nothing leaves it

What the module reads: the files under `roadmap/`, the `.roadmap-lint.json` beside it, whether the paths the records refer to exist (existence only — the files are not opened), and the repository through `git`, run with `--no-optional-locks` (`rev-parse`, `ls-files`, `status`, `log`, `rev-list`, `blame`). It only reads: it makes no network connection, changes none of the project's files, its git history, or git's own index, and collects no usage data. `claude plugin validate` lists exactly what it calls on Claude Code: `$.fs` (`read`, `list`, `exists`, `stat`), `$.process.run`, `$.session.root`, `$.clock.after`, `$.tool.register`, and `$.ui.log`.

The skill itself is a set of instructions for Claude. Following them, Claude edits the records under `roadmap/`, works on the project's code, and makes git commits in the project's repository — through Claude Code's own tools and under its permission settings. `init` also appends a section to the project's `CLAUDE.md` and, under git, creates or extends its `.gitignore`. A research phase reads outside sources through Claude Code's web tools, and may clone a repository with `git clone --depth 1` to search it locally.

## Layout

```
plugin/
├── .claude-plugin/plugin.json   # Manifest (SemVer — one version for the skill, the module, and the CLI)
├── README.md                    # This file
├── LICENSE                      # Apache-2.0 — a copy of the repository's LICENSE
├── NOTICE                       # The copyright notice — a copy of the repository's NOTICE
├── THIRD-PARTY-LICENSES.txt     # The licenses of the packages copied into lib/vendor/
├── hooks/
│   ├── hooks.json               # Declares the module and nothing else: {"modules": ["./register.ts"]}
│   └── register.ts              # The hooks module — the lint after an edit, and the roadmap_lint tool
├── lib/
│   ├── core/                    # The lint core — a copy of packages/core/src, readable TypeScript
│   └── vendor/<package>/        # The third-party packages the core uses — readable copies, imports rewritten to relative paths
└── skills/roadmap/              # The /roadmap skill — the source of truth for the instructions
    ├── SKILL.md
    └── references/{schemas,workflows}.md
```

`lib/`, `LICENSE`, and `THIRD-PARTY-LICENSES.txt` are committed build artifacts, generated from the sources in the repository. How they are rebuilt and checked is in [doc/development.md](../doc/development.md). The plugin carries no CLI: roadmap-lint as a command comes from the npm package in the repository ([doc/roadmap-lint.md](../doc/roadmap-lint.md#using-the-linter-without-the-plugin)).

## The lint after editing roadmap/

With the plugin enabled, the module runs after every `Edit` or `Write` tool call (`hooks/hooks.json` is auto-detected; `/reload-plugins` applies a change at once). What it does with the result of the edit:

- **There are diagnostics** → the report — one summary line, one line per diagnostic, and the notices about a config option that was ignored (the wrong shape, an unknown key, an entry a rule cannot use) or a `sinceCommit` that was not found among the commits — is appended to the body of the tool result, so both the user and Claude read it; the edit itself is never blocked. The notice goes along because what it left in force may be what the diagnostic is about
- **Zero diagnostics / an edit outside `roadmap/` / the check failed or ran out of time** → the result is left as it is (**non-destructive** — a problem in the module never stops the editing flow). A failure is said in one dim line of the transcript, and the next edit tries again
- GIT-1 is a notice while a session is open, so it stays silent (a notice is not part of the diagnostic list). During a close — from setting `open_session` to null until the close commit lands — the GIT-1 warning is shown as the true positive it is, and it clears with the close commit
- In the middle of a sequence of edits that spans several files (creating a session, adding a research or experiment file, closing a session, generating the records at `init`) a transient diagnostic can appear that the rest of the sequence resolves — FM-3, BID-2, and the like. Those are true positives: the sequence is finished first, and the check that nothing is left comes at the checkpoint. See [doc/roadmap-lint.md](../doc/roadmap-lint.md#diagnostics-that-depend-on-the-moment)
### Without the plugin — the command hook

A project that does not use the plugin — a hook set up by hand, or Claude Code without plugins — gets the same lint after an edit from the roadmap-lint npm package, which ships a PostToolUse command hook, `hooks/roadmap-lint-hook.mjs`, beside its bundle (how to build and install the package: [doc/roadmap-lint.md](../doc/roadmap-lint.md#using-the-linter-without-the-plugin)). It runs the CLI in a `node` process, so it needs Node.js >= 24. With diagnostics it writes the same report to stderr and exits 2 (in PostToolUse, stderr reaches both the user and Claude, and the edit is not blocked); with zero diagnostics, an edit outside `roadmap/`, no CLI found, or a lint that failed to run, it exits 0 silently. It reads the tool call on stdin and three environment variables: `CLAUDE_PROJECT_DIR`, `PATH`, and `ROADMAP_LINT_BIN`. How it resolves the linter: 1. `ROADMAP_LINT_BIN` when it names an existing file, 2. the bundle beside it, `../bundle/roadmap-lint.cjs` (in the package it is always there), 3. `<project>/packages/cli/dist/main.js`, only when that `packages/cli` is the roadmap-lint package itself (the linter's own development checkout — another project's program in that place is not run), 4. `roadmap-lint` on the PATH. The linter ignores `LOG_TOKENS` and `LOG_STREAM`, the debugging switches of the YAML parser it bundles, so its report stays readable whatever the environment carries.

Add the following to the project's `.claude/settings.json`, with the path pointing at the hook where the package was installed (a checkout of the repository has it at `packages/cli/hooks/roadmap-lint-hook.mjs`). Changes to the settings are reloaded automatically:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "node \"$CLAUDE_PROJECT_DIR/node_modules/roadmap-lint/hooks/roadmap-lint-hook.mjs\"",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

## License

Apache-2.0. The license text is in [LICENSE](LICENSE), a copy of the one at the root of the repository, and the copyright notice is in [NOTICE](NOTICE), a copy as well. `lib/vendor/` holds copies of third-party packages under the MIT and ISC licenses; their copyright notices and license texts are in [THIRD-PARTY-LICENSES.txt](THIRD-PARTY-LICENSES.txt).
