# rdd-kit plugin

The /roadmap skill for roadmap-driven development, plus roadmap-lint — a linter that makes its records tool-verifiable.

This folder is the plugin: the `/roadmap` skill, a hooks module that lints the records right after an edit and serves the records check as a tool, and readable copies of the lint core and of the third-party packages it uses. Claude Code runs the module inside its own process, so the plugin needs no Node.js and installs nothing; its own code sends nothing off the machine. An installed copy holds this folder alone, so the links below that lead into the repository — its README and `doc/` — go to its address on GitHub, the `repository` of `.claude-plugin/plugin.json`.

## Roadmap-driven development

Roadmap-driven development (RDD) does not finish a specification before the work starts. The work runs from a revisable roadmap of typed phases (`build`, `research`, `experiment`, `decision`) and from a file that holds the current position, in sessions that open with `/roadmap start` and close with a commit. The spec is maintained as a record of what the system guarantees now. The records live under `roadmap/` in four layers — intent, now, spec, and fact — and the fact layer is append-only.

The idea in full is in [doc/concepts.md](https://github.com/Yo7461/rdd-kit/blob/main/doc/concepts.md) of the repository.

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

It needs Claude Code **2.1.286 or later** in the desktop app, or **2.1.287 or later** in the terminal — the versions from which a plugin's hooks module loads by default. Hooks modules are an early-access part of Claude Code, and their interface can change between versions: each release of rdd-kit names the version it was run on (this one: 2.1.289, in the terminal on Windows; other surfaces were not tried), and a lint that stops working never blocks an edit (below). On an older Claude Code the skill still works, but the lint after an edit and the records-check tool are absent (not tried). Node.js is not needed; only the CLI — roadmap-lint by hand or in CI — needs Node.js >= 24. Scopes, updating, and uninstalling are in the [README](https://github.com/Yo7461/rdd-kit/blob/main/README.md) of the repository.

Once the plugin is listed in Anthropic's directory, it can also be added from **Customize > Plugins** on claude.ai — it then reaches Claude Code as a synced plugin at the next session start — or with `/plugin directory` in Claude Code 2.1.287 or later. A copy installed from the command line stays on that machine and is not added to the account; the two routes do not update each other.

## Three things to try

1. **Plan a project** — in a project with nothing under `roadmap/`, run `/roadmap init`. Claude interviews you about what you are building, prints the whole course as phases with a goal and a reason each, asks once whether to start with it, and generates `roadmap/`, with a section in the project's `CLAUDE.md` and, under git, lines in `.gitignore` and a first commit. The report that ends the command tells you what was made and recommends `/roadmap start`
2. **Work a session, and see the lint** — run `/roadmap start`. Claude prints what this session is going for and proceeds. When an edit under `roadmap/` leaves the records inconsistent — a reference to an ID that no record defines, say — a dim line such as `roadmap-lint: 1 problem (1 error, 0 warnings) after editing roadmap/.` appears under that edit, the same report joins the result Claude reads, and Claude fixes the record before going on. An edit that leaves nothing to report shows nothing
3. **Check the records on demand** — run `/roadmap doctor`. Claude calls the tool `mcp__rdd-kit__roadmap_lint`, which runs the 35 rules over `roadmap/` and returns the report, and then reads the records for what the rules cannot see: whether the contracts still describe the code, and whether the latest verification a record claims (a test count, a pass) still holds when it is run again. Nothing is changed; the report says what needs action and what to do

## What the plugin runs

The plugin's own code is one hooks module, `hooks/register.ts`, which Claude Code loads into its own process when the plugin is enabled — no `node` process is started, and nothing is installed on the machine. The module does two things, and both are **fail-open**: a problem in the module never stops the editing flow.

- **The lint after an edit** — after every `Edit` or `Write` tool call whose file is under the project's `roadmap/`, the module runs roadmap-lint over that directory and, **only when there are diagnostics**, shows the report as one dim line of the transcript and appends it to the result of that tool call, which Claude reads (the result of the edit itself stays as it is). The result of the edit waits for the lint, up to 20 seconds. Zero diagnostics, an edit elsewhere, and a lint that fails or runs out of time leave the result untouched; a failure is reported in one dim line of the transcript. The project is the directory the session started in (or `/cd` moved it to) — a `cd` in the shell does not move it. With a user-wide install the module runs in every project: any project with a `roadmap/` directory gets the lint after an edit there
- **The records check as a tool** — the module registers the tool `mcp__rdd-kit__roadmap_lint`, which runs the same lint on request and returns the report the CLI prints, as text or as JSON (`path` and `format` are its optional inputs; the lint may take up to 60 seconds). The skill calls it for `/roadmap doctor` and before a close commit. Given an absolute `path`, it reads that `roadmap/` wherever it is on the machine and runs `git` there. Claude Code serves the tool to itself on the machine; nothing leaves it. The module answers calls of this one tool itself — it is the tool's implementation — and passes every other tool call on unchanged: its hook on tool calls watches `Edit`, `Write`, and this tool, and its hook on the session's rows touches only the row that holds the result of the edit it checked, to append the report

What the module reads: the files under `roadmap/`, the `.roadmap-lint.json` beside it, whether the paths the records refer to exist (existence only — the files are not opened), and the repository through `git`, run with `--no-optional-locks` (`rev-parse`, `ls-files`, `status`, `log`, `rev-list`, `blame`) — `git` is the only program the module starts, through Claude Code's `$.process.run`, with arguments composed at run time from the directory it checks (the subcommands and options are the six just named, and the only environment variable the module sets is `GIT_NO_LAZY_FETCH`). It only reads: it makes no network connection, changes none of the project's files, its git history, or git's own index, and collects no usage data. In a partial clone (one made with `--filter`), git itself would fetch the missing objects that `blame` needs; the module and the CLI run git with `GIT_NO_LAZY_FETCH=1`, so with git 2.46 or later, which reads the variable, no fetch happens and the rule that dates shelf items (GIT-7) is skipped there with a notice (an older git ignores the variable and fetches as it always did). The report goes into the conversation like any other tool result, so Claude Code sends it to the model as part of the session. `claude plugin validate` lists exactly the Claude Code calls it makes: `$.fs` (`read`, `list`, `exists`, `stat`), `$.process.run`, `$.session.root`, `$.clock.after`, `$.tool.register`, and `$.ui.log`. The module's own code uses no getter or setter, no `defineProperty`, no `getPrototypeOf`, and no `constructor` lookup; the copies of the YAML parser and the Markdown tokenizer it imports define properties and accessors on their own objects (a node's type mark, an alias's guard against a tag, a buffer's length, and the keys of a mapping, kept as plain own properties so that a key such as `__proto__` stays data), read a node's prototype to clone it, and read a collection's `constructor` for its tag name — ordinary library code, confined to the values the module itself creates. The module itself reads no credential and no environment variable (`git`, which it starts, reads its own configuration as usual): a validator that reads the text meets the words `token` (a word of the Markdown it lints), `key` (the name of an option in `.roadmap-lint.json`), `host` (the module's interface to the file system and to `git`, `Host` in `lib/core/host.ts`), and `http:` (a scheme the reference rule recognizes in order to skip links), and none of them names a secret or a server.

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
│   ├── core/                    # The lint core — a copy of packages/core/src without testing/, readable TypeScript
│   └── vendor/<package>/        # The third-party packages the core uses — readable copies, imports rewritten to relative paths; a copy that differs from the installed file says so at its head and in THIRD-PARTY-LICENSES.txt
└── skills/roadmap/              # The /roadmap skill — the source of truth for the instructions
    ├── SKILL.md
    └── references/{schemas,workflows}.md
```

`lib/`, `LICENSE`, and `THIRD-PARTY-LICENSES.txt` are committed build artifacts, generated from the sources in the repository. How they are rebuilt and checked is in [doc/development.md](https://github.com/Yo7461/rdd-kit/blob/main/doc/development.md). The plugin carries no CLI: roadmap-lint as a command comes from the npm package in the repository ([doc/roadmap-lint.md](https://github.com/Yo7461/rdd-kit/blob/main/doc/roadmap-lint.md#using-the-linter-without-the-plugin)).

## The lint after editing roadmap/

With the plugin enabled, the module runs after every `Edit` or `Write` tool call (`hooks/hooks.json` is auto-detected; the module and its tool are loaded when a session starts). What it does with the result of the edit:

- **There are diagnostics** → the report — one summary line, one line per diagnostic, and the notices about a config option that was ignored (the wrong shape, an unknown key, an entry a rule cannot use) or a `sinceCommit` that was not found among the commits — is shown as a dim line of the transcript and appended to the body of the tool result, which Claude reads; the edit itself is never blocked. The notice goes along because what it left in force may be what the diagnostic is about
- **Zero diagnostics / an edit outside `roadmap/` / the lint failed or ran out of time** → the result is left as it is (**non-destructive** — a problem in the module never stops the editing flow). A failure is reported in one dim line of the transcript, and the next edit tries again
- GIT-1 is a notice while a session is open, so it stays silent (a notice is not part of the diagnostic list). During a close — from setting `open_session` to null until the close commit lands — the GIT-1 warning is shown as the true positive it is, and it clears with the close commit
- In the middle of a sequence of edits that spans several files (creating a session, adding a research or experiment file, closing a session, generating the records at `init`) a transient diagnostic can appear that the rest of the sequence resolves — FM-3, BID-2, and the like. Those are true positives: the sequence is finished first, and the check that nothing is left comes at the checkpoint. See [doc/roadmap-lint.md](https://github.com/Yo7461/rdd-kit/blob/main/doc/roadmap-lint.md#diagnostics-that-depend-on-the-moment)

### Without the plugin — the command hook

A setup without the plugin — a hook set up by hand, or Claude Code without plugins — gets the same lint after an edit from the roadmap-lint npm package (not on the npm registry: it is packed from a checkout of this repository, as [doc/roadmap-lint.md](https://github.com/Yo7461/rdd-kit/blob/main/doc/roadmap-lint.md#using-the-linter-without-the-plugin) describes), which ships a PostToolUse command hook, `hooks/roadmap-lint-hook.mjs`, beside its bundle. It runs the CLI in a `node` process, so it needs Node.js >= 24. With diagnostics it writes the same report to stderr and exits 2 (in PostToolUse, stderr reaches both the user and Claude, and the edit is not blocked); with zero diagnostics, an edit outside `roadmap/`, no CLI found, or a lint that failed to run, it exits 0 silently. It reads the tool call on stdin and three environment variables — `CLAUDE_PROJECT_DIR` (falling back to the call's working directory), `PATH`, and `ROADMAP_LINT_BIN` — and passes the environment on to the CLI. How it resolves the linter: 1. `ROADMAP_LINT_BIN` when it names an existing file, 2. the bundle beside it, `bundle/roadmap-lint.cjs` of the same package (always there in the package), 3. `<project>/packages/cli/dist/main.js`, only when that `packages/cli` is the roadmap-lint package itself (the linter's own development checkout — another project's program in that place is not run), 4. `roadmap-lint` on the PATH. The linter ignores `LOG_TOKENS` and `LOG_STREAM`, the debugging switches of the YAML parser it bundles, so its report stays readable whatever the environment carries.

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

## Troubleshooting

- **No line appears after an edit under `roadmap/`** — first, that is what a clean edit looks like: the module reports only when there are diagnostics. Then check, in order: `/plugin` shows the plugin enabled and a dim line such as `1 mod active · rdd-kit` under the tabs (a hooks module loads by default from Claude Code 2.1.286 in the desktop app and 2.1.287 in the terminal — `claude --version` in the terminal, `/status` in the desktop app); `disableAllHooks` is not set in your settings and the session was not started with `--safe-mode` or `--bare`, which stop every installed hooks module (Claude Code calls them mods); the session is not a WSL session of the desktop app, where plugins do not load; and the edited file is under the `roadmap/` of the project the session started in — a `cd` in the shell does not move the project, `/cd` does
- **A dim line says the check did not run** (`roadmap-lint: the check after editing roadmap/ did not run — …`) — the edit went through unchanged; the next edit tries again. A repository with a very long history (tens of thousands of commits) is more than Claude Code hands the module, so the lint inside Claude Code cannot read the history there, and the CLI is the way to run it — by hand, or through the command hook: see [doc/roadmap-lint.md](https://github.com/Yo7461/rdd-kit/blob/main/doc/roadmap-lint.md#using-the-linter-without-the-plugin)
- **`mcp__rdd-kit__roadmap_lint` is not in the tool list** — the plugin is not enabled, or Claude Code is older than the versions above. The skill then runs the records check through the CLI when one is installed, and otherwise says so
- **`/roadmap` is not found** — the full name is `/rdd-kit:roadmap`; the short form is taken when another command already uses it
- **Turning it off** — disable or uninstall the plugin from the **Installed** tab of `/plugin`; the skill, the lint after an edit, and the tool go together. Uninstalling is described in the repository's [README](https://github.com/Yo7461/rdd-kit/blob/main/README.md#uninstalling)

## Support

Questions, problems, and security concerns go to the Issues page of the repository named in `repository` of `.claude-plugin/plugin.json` (the directory listing links to it as well). Say which Claude Code version you run and whether `/plugin` lists the hooks module as active.

## Privacy

The plugin's own code collects no data and opens no network connection. This section is its privacy policy.

- **What it reads**: the files under the project's `roadmap/` (or, when the tool is given an absolute path, the `roadmap/` there), the `.roadmap-lint.json` beside it, whether the paths the records refer to exist, and the project's git metadata through `git`, read-only (the commands are listed under [What the plugin runs](#what-the-plugin-runs); from the output of `git blame` it keeps the commit's hash, time, and zone, not the names and addresses in it). With a user-wide install this happens in every project that has a `roadmap/` directory. The module itself reads no environment variable and no credential (`git`, which it starts, reads its own configuration as usual)
- **What it stores**: nothing of its own. It writes no file and no setting and keeps no usage data. The lint report and the dim lines it shows become part of the session, which Claude Code keeps in the conversation's history and its own logs, like any other tool output
- **What it sends**: nothing of its own. The module opens no network connection and the plugin declares no connector. In a partial clone (one made with `--filter`), git itself would fetch missing objects on demand; the module runs git with that fetch turned off, which git honors from 2.46. The lint report is appended to the result of the edit it checked, so it enters the conversation like any other tool result and is sent to the model as part of the session, as everything in a Claude Code session is
- **The skill**: a set of instructions for Claude. Following them, Claude reads and edits the records under `roadmap/`, works on the project's code, and makes git commits — through Claude Code's own tools and under its permission settings. A research phase reads outside sources through Claude Code's web tools, as any session can, and may clone a repository with `git clone --depth 1` to search it locally

Questions about this policy go through [Support](#support).

## License

Apache-2.0. The license text is in [LICENSE](LICENSE), a copy of the one at the root of the repository, and the copyright notice is in [NOTICE](NOTICE), a copy as well. `lib/vendor/` holds copies of third-party packages under the MIT and ISC licenses; their copyright notices and license texts are in [THIRD-PARTY-LICENSES.txt](THIRD-PARTY-LICENSES.txt).
