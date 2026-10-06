# roadmap-lint

roadmap-lint checks the structure of the records under `roadmap/`: front matter, the structure and placement of the files, reference integrity, ID discipline, size limits, text anomalies, and git state — 35 rules in all. It checks that the records are well-formed. Whether they are true stays with the AI and the person (see [concepts.md](concepts.md#verification)).

## Contents

- [Running it](#running-it)
- [Invocation](#invocation)
- [Output](#output)
- [Configuration](#configuration)
- [Rules](#rules)
- [Diagnostics that depend on the moment](#diagnostics-that-depend-on-the-moment)
- [How to respond to diagnostics](#how-to-respond-to-diagnostics)
- [Using the linter without the plugin](#using-the-linter-without-the-plugin)
- [Upgrade notes](#upgrade-notes)

## Running it

With the plugin installed, the linter runs without any setup:

- **From the hook** — after every `Edit` or `Write` tool call on a file under `roadmap/` in a Claude Code session. It reports only when there are diagnostics (see [plugin/README.md](../plugin/README.md)). A change made through the shell does not start the hook; it is caught at the next such edit, or by the lint before the close commit
- **From the skill** — before every close commit, and as the first step of `/roadmap doctor`
- **By hand** — `node <plugin root>/bin/roadmap-lint.js [path]`, where the plugin root is the installed copy under `~/.claude/plugins/cache/rdd-kit/rdd-kit/<version>/`. From a checkout of this repository it is `node plugin/bin/roadmap-lint.js [path]`

The bundle has no dependencies and needs only Node.js >= 24. For the places the plugin does not reach — a CI job, a hook set up by hand — see [Using the linter without the plugin](#using-the-linter-without-the-plugin).

## Invocation

```
roadmap-lint [path] [--config <path>] [--format text|json] [--fail-severity error|warning]
```

| Argument or option | Meaning | Default |
|---|---|---|
| `path` | A directory containing `roadmap/`, or `roadmap/` itself | The current directory |
| `--config <path>` | Path to a JSON config file | `.roadmap-lint.json` next to `roadmap/`, or the built-in defaults |
| `--format <text\|json>` | Output format | `text` |
| `--fail-severity <error\|warning>` | The minimum severity that makes the exit code 1 | `error` |
| `--version` | Print the version and exit | |
| `--help` | Print the help and exit | |

| Exit code | Meaning |
|---|---|
| 0 | No diagnostics at or above `--fail-severity`. Warnings can still be there — read the output itself |
| 1 | There are diagnostics at or above `--fail-severity` |
| 2 | An execution error: invalid arguments, an invalid config, or a missing target. This is not a lint result |

## Output

### Text

One line per diagnostic — the location (1-based), the severity, the rule ID, what it is, and what to do about it — then a summary line:

```
roadmap/status.md:59:3 error REF-1 Cannot find a definition for R0007. [Fix: Add the missing definition, or fix the typo in the ID.]
1 problem (1 error, 0 warnings) in 16 files.
```

A diagnostic on a whole file shows the path alone, and one on the whole repository shows `(repo)` in place of the location. A run with nothing to report prints `No problems found in 16 files.` Notices follow the summary as `Note: ` lines. A notice is display-only information: it is not a diagnostic, and it does not affect the exit code.

### JSON

`--format json` prints one object. The sample is condensed — the real output puts every key on a line of its own:

```json
{
  "version": 1,
  "diagnostics": [
    {
      "rule": "REF-1",
      "severity": "error",
      "anchor": {
        "kind": "range",
        "file": "roadmap/status.md",
        "range": {
          "start": { "line": 58, "character": 2 },
          "end": { "line": 58, "character": 7 }
        }
      },
      "message": "Cannot find a definition for R0007.",
      "suggestion": "Add the missing definition, or fix the typo in the ID."
    }
  ],
  "summary": { "errors": 1, "warnings": 0, "filesChecked": 16 },
  "notices": []
}
```

- `anchor.kind` is `range` (a position inside a file), `file` (a whole file), or `repo` (the whole repository)
- A range is compatible with an LSP `Diagnostic`: lines and characters are 0-based, and `end` is exclusive. The text format shows the same position 1-based
- Paths are relative to the parent directory of `roadmap/` and use `/` on every platform
- The order is stable and shared with the text format: by file (`repo` first), then line, then column, then rule ID
- The rule IDs are part of the interface. A rule is never renamed or removed without a major version; new rules can arrive in a minor one

## Configuration

`.roadmap-lint.json` sits next to `roadmap/` and is found automatically. `--config` names another file.

```json
{
  "rules": {
    "SIZE-1": { "options": { "maxLines": 80 } },
    "TXT-1": { "options": { "languageHeuristic": true } },
    "GIT-5": { "severity": "error" },
    "FILE-1": { "enabled": false },
    "GIT-2": { "options": { "sinceCommit": "0123abc" } }
  }
}
```

- Every rule takes `enabled`, `severity` (`error` or `warning`), and `options`. All three are optional
- The severity of a diagnostic is resolved in this order: the override in the config, then the severity the rule gives that one diagnostic, then the rule's default
- An unknown rule ID is accepted, so a config can name a rule before the installed version has it. A key beside `enabled`, `severity`, and `options`, or a wrong type for one of those three, is a config error (exit code 2)
- Inside `options`, a value that does not fit the shape of the rule's default — a non-negative number, `true` or `false`, an array of strings, a string for `sinceCommit` — and a key the rule does not have are dropped with a notice, and that one option falls back to its default while the valid options beside it still apply. The notice is not a config error: the lint goes on and the notice itself does not set the exit code, but the default now in force can change what the rule reports. `"80"` is such a slip for `maxLines` — the limit is a number, and a fraction is rounded down. The options of a rule that is turned off are not looked at
- What a rule then requires of a value that has the right shape is checked by the rule, with a notice of its own: a 7–40 digit hex hash for `sinceCommit` (the GIT rules), a Unicode script name in `expectedScripts` and a whole number of at least 2 in `unexpectedRunLength` (TXT-1 — an unknown name is dropped on its own, and when none is left the heuristic is off for the run). REF-3 drops an entry of `volatilePatterns` that is empty once its trailing separators are gone (`"/"` would match every `/word`), and says when no entry is left
- `sinceCommit` exempts history from before the commit convention: the named commit and everything before it are out of the rule's scope. It takes 7 to 40 hex digits. GIT-2, GIT-4, GIT-5, and GIT-6 each read their own — there is no shared value, so it is set under every rule that should skip the old history. For GIT-6 it covers the check of commit subjects; the hashes a session records are always checked
- **The config moves both halves of the kit.** The skill reads the same file at the start of a session and writes the records to the effective value instead of the default it prints. In a project that sets `SIZE-1` to 80, `status.md` is written to 80 lines. A value the lint reports as ignored does not count for either half — that option keeps its default, or that entry is left out of its list while the rest applies, until it is fixed

## Rules

| Rule | Default severity | What it checks | Options (default) |
|---|---|---|---|
| `FM-1` | error | Missing required front matter keys | — |
| `FM-2` | error | Front matter or structural values outside the allowed set | — |
| `FM-3` | error | Agreement between `open_session` and actual session state | — |
| `FM-4` | error | Agreement between conditional keys and file name or location | — |
| `SIZE-1` | error | Line limit for the root status.md (the Phase Index section is not counted) | `maxLines` (`60`) |
| `SIZE-2` | error | Line limit for spec/map.md | `maxLines` (`80`) |
| `SIZE-3` | error | Line limit for a contract file | `maxLines` (`200`) |
| `SIZE-4` | error | Line limit for Outcome Summary | `maxLines` (`10`) |
| `SIZE-5` | error | One line per session in Session Log | — |
| `SIZE-6` | warning | Line count of a phase status.md (a sign to split the phase) | `maxLines` (`300`) |
| `SIZE-7` | warning | Line limit for roadmap.md (a sign that done phases are not folded) | `maxLines` (`200`) |
| `STRUCT-1` | error | Missing required headings | — |
| `STRUCT-2` | error | Duplicated or out-of-order fixed headings | — |
| `STRUCT-3` | error | Within-file agreement (`next_command`, `roadmap_changed`) | — |
| `STRUCT-4` | error | A contract without a `verified_by` | — |
| `ID-1` | error | Duplicate ID definitions, and gaps in session numbers | `warnSessionGaps` (`true`) |
| `ID-2` | error | Phase agreement across roadmap.md, Phase Index, and phases/ | — |
| `ID-3` | error | ID format and naming conventions | — |
| `REF-1` | error | Referenced IDs exist, judged by layer | `scanCodeFences` (`false`), `scanInlineCode` (`false`), `scanBlockquotes` (`false`), `allowNextSessionRef` (`true`) |
| `REF-2` | error | Referenced paths exist, in structured fields, links, and inline code | `checkInlineCodePaths` (`true`) |
| `REF-3` | error | References to volatile or untracked paths in a `done` R/E | `volatilePatterns` |
| `BID-1` | error | Session artifacts match R/E `created` and `completed` (S to R/E) | — |
| `BID-2` | error | R/E `created` and `completed` match session artifacts (R/E to S) | — |
| `BID-3` | error | Session files match Session Log rows, per phase (S to row, row to S) | — |
| `FILE-1` | warning | Files outside the conventional layout | `allowNames` (`[".gitkeep"]`), `allowPaths` |
| `TXT-1` | error | Replacement characters and control characters (the script-mixing heuristic is opt-in) | `languageHeuristic` (`false`), `unexpectedRunLength` (`20`), `expectedScripts` |
| `TXT-2` | error | Broken Markdown: unclosed fences, malformed front matter, uneven table columns | — |
| `TXT-3` | error | Merge conflict markers left in a file | — |
| `GIT-1` | warning | Uncommitted changes under roadmap/ (a notice while a session is open) | — |
| `GIT-2` | warning | Commits without an [S####] prefix, after roadmap/ tracking began | `sinceCommit` (`null`) |
| `GIT-3` | error | Tracked files that match .gitignore | — |
| `GIT-4` | warning | Commit labels outside the convention vocabulary | `labels`, `sinceCommit` (`null`) |
| `GIT-5` | warning | Commit subjects ending with a period | `sinceCommit` (`null`) |
| `GIT-6` | error | Session records against git history (subject sessions, base_commit, commits) | `sinceCommit` (`null`) |
| `GIT-7` | warning | Parking Lot and Deferred items not revisited for longer than maxAgeDays | `maxAgeDays` (`30`) |

The options whose defaults are lists:

| Option | Default |
|---|---|
| `REF-3` `volatilePatterns` | `scratchpad`, `/tmp`, `%TEMP%`, `%TMP%`, `AppData/Local/Temp`, `C:\Windows\Temp`, `$TMPDIR` |
| `FILE-1` `allowPaths` | `roadmap/assets/` |
| `TXT-1` `expectedScripts` | `Latin`, `Hiragana`, `Katakana`, `Han`, `Common`, `Inherited` |
| `GIT-4` `labels` | `init`, `research`, `experiment`, `build`, `spec`, `decision`, `session-close`, `phase-close`, `post`, `wip` |

Without git — no `git` command, a git older than 2.15, or a directory that is not a repository — the GIT rules and the untracked-path half of REF-3 are skipped with a notice, and the rest run as usual. A repository with no commits yet (right after `git init`) is linted like any other: the rules that read commits (GIT-2, GIT-4, GIT-5, and GIT-6) have nothing in scope, GIT-1 reports the records as uncommitted, and GIT-7, when `Parking Lot` or `Deferred` holds an item, skips with a notice, since there is no history yet to date its items by.

## Diagnostics that depend on the moment

**An invariant holds when the records are at rest.** On a committed, clean working tree, and while a session is open, a project's `roadmap/` is expected to produce zero diagnostics, warnings included. Two exceptions are true positives rather than noise: the GIT-1 warning inside a close window, and a GIT-7 warning on an item that is waiting for its review.

Updating the records always spans several files, so a sequence of edits passes through windows where a diagnostic is true and unavoidable:

- FM-3, between creating a session file and updating `open_session`
- BID-1 and BID-2, while a research or experiment file and a session file move together
- GIT-1, ID-2, and REF-2, during a close, a phase close, or `init`

These need no reaction. The sequence of edits is finished first, and the check that nothing is left comes at the checkpoint, right before the commit.

**GIT-1** (uncommitted changes under `roadmap/`) follows the session:

- While a session is open (`open_session` in `status.md` is not null) it drops to a notice — recording as the work goes is a normal state
- During a close, between setting `open_session` to null and landing the close commit, the warning is a true positive. It clears when the close commit lands, and the exit code stays 0 because the default `--fail-severity` is `error`

**GIT-7** (a `Parking Lot` or `Deferred` item past its shelf life) follows the calendar:

- Each item is dated with `git blame` from the last commit that changed its lines, so the result depends on the day the lint runs
- The warning stays until the item is rewritten (which resets its clock), promoted to a phase, or dropped. The skill decides that at `replan` and `phase close`. Rewriting a line only to silence the warning defeats the rule
- A shallow clone, an untracked `roadmap.md`, and a repository with no commits yet cannot date the items, so GIT-7 skips there with a notice

**Notices** come in three kinds. A skip that is normal needs no action: the GIT rules without git, GIT-1 while a session is open, GIT-7 in a shallow clone, on an untracked `roadmap.md`, or in a repository with no commits yet. A setting the lint could not use — a `sinceCommit` that is not a commit hash, a `maxAgeDays` that is not a number — means the default was used instead, and the value in `.roadmap-lint.json` needs fixing. Two notices ask for a look rather than a fix: a `sinceCommit` the lint could not find is normal when it points at or before the commit that first tracked `roadmap/`, and a typo otherwise; a GIT-7 skip because `git blame` and the parser disagree on the line count points at a lone CR in `roadmap.md` (normalize its line endings) or at a file that changed while the lint ran (run it again).

## How to respond to diagnostics

1. **Suspect the records first** — the linter mechanizes the skill's own conventions. Usually the fix is to bring the records in line with the templates in the skill's `references/schemas.md`
2. **Respect the layers when fixing** — the Fact layer (closed sessions, finished research and experiment files) is not rewritten. The only edits allowed there are typos and notation that do not change the meaning, such as writing an example ID as code. The Intent, Now, and Spec layers are meant to be rewritten to follow reality
3. **Fix the rule when the linter disagrees with the skill** — when a rule's judgment disagrees with the skill's own text, the rule is what is wrong. The fix goes into the rule, with a regression case added to the fixtures (see [development.md](development.md#maintaining-fixtures))
4. **Absorb intentional exceptions in the config** — `enabled`, `severity`, or `options` per rule in `.roadmap-lint.json`. This is the last resort, for when both the records and the rule are right and a diagnostic still appears. The reason for the adjustment belongs in the session log

## Using the linter without the plugin

rdd-kit is distributed as a Claude Code plugin, and the plugin already carries the linter. It is not published to the npm registry. This section is for the places the plugin does not reach: a CI job, or a project that sets up the hook by hand. Both ways start from a checkout of this repository.

- **Run the bundle directly** — `node <path-to-rdd-kit>/plugin/bin/roadmap-lint.js [path]`. Nothing is installed; the bundle has no dependencies and needs only Node.js >= 24. A hook set up by hand finds it through `ROADMAP_LINT_BIN` pointed at that file
- **Install it as a command** — build a tarball and install it. Packing needs the checkout's dependencies installed (`pnpm install`, which fetches from the network once); the tarball itself is the same bundle with no dependencies, so the install in the target project works offline:

```
cd <path-to-rdd-kit> && pnpm install
cd packages/cli && pnpm pack --pack-destination <dir>
npm install --offline --no-audit --no-fund <dir>/roadmap-lint-<version>.tgz
```

The last command runs in the target project and installs the CLI there, where `npx roadmap-lint` and the npm scripts of that project find it. With `-g` it installs for every project and puts `roadmap-lint` on the PATH. The tarball carries the license files and the copyright notice as well: `LICENSE`, `THIRD-PARTY-LICENSES.txt`, and `NOTICE`.

## Upgrade notes

What changed in each version, newest first. 0.1.0 was the first release and has no entry.

- **0.1.1** — corrects the README on uninstalling: removing the marketplace was said to delete the plugin's installed copy, but the copy can stay behind after either `claude plugin uninstall` or `claude plugin marketplace remove`; the README now says when it can be deleted by hand. The skill, the linter, the hook, and the record formats are the same as in 0.1.0
